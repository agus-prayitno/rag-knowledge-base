import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import pressure from '@fastify/under-pressure';
import { toErrorEnvelope, validationError, type PublicConfig } from '@rag/domain';
import type { RagService } from './service.js';

const sourcePathSchema = { type: 'string', minLength: 1, maxLength: 4096 } as const;
const tagSchema = { anyOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] } as const;
const ingestFileSchema = {
  type: 'object', additionalProperties: false, required: ['source_path', 'content'],
  properties: { source_path: sourcePathSchema, source_name: { type: 'string', minLength: 1, maxLength: 255 }, content: { type: 'string', minLength: 1, maxLength: 5_000_000 }, tag: tagSchema },
} as const;

const toolDefinitions = {
  search_knowledge_base: { description: 'Search the knowledge base and return retrieved excerpts.', inputSchema: { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', minLength: 1, maxLength: 20_000 }, top_k: { type: 'integer', minimum: 1, maximum: 20 } } } },
  ingest_document: { description: 'Ingest a Markdown or plain-text document.', inputSchema: ingestFileSchema },
  set_document_tag: { description: 'Set or remove a document tag.', inputSchema: { type: 'object', additionalProperties: false, required: ['source_path', 'tag'], properties: { source_path: sourcePathSchema, tag: tagSchema } } },
  delete_document: { description: 'Delete a document and all its chunks.', inputSchema: { type: 'object', additionalProperties: false, required: ['source_path'], properties: { source_path: sourcePathSchema } } },
} as const;
const tools = Object.entries(toolDefinitions).map(([name, definition]) => ({ name, ...definition }));
type ToolName = keyof typeof toolDefinitions;

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireString(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw validationError(`${name} must be a non-empty string`); return value; }
function rejectUnexpectedArguments(args: Record<string, unknown>, allowed: readonly string[]): void { for (const key of Object.keys(args)) if (!allowed.includes(key)) throw validationError(`Unexpected argument: ${key}`); }
function parseMcpArguments(name: ToolName, args: unknown): Record<string, unknown> {
  if (!isRecord(args)) throw validationError('Tool arguments must be an object');
  switch (name) {
    case 'search_knowledge_base':
      rejectUnexpectedArguments(args, ['question', 'top_k']); requireString(args.question, 'question');
      if (args.top_k !== undefined && (!Number.isInteger(args.top_k) || (args.top_k as number) < 1 || (args.top_k as number) > 20)) throw validationError('top_k must be an integer between 1 and 20');
      return args;
    case 'ingest_document':
      rejectUnexpectedArguments(args, ['source_path', 'source_name', 'content', 'tag']); requireString(args.source_path, 'source_path'); requireString(args.content, 'content');
      if (args.source_name !== undefined) requireString(args.source_name, 'source_name');
      if (args.tag !== undefined && args.tag !== null && typeof args.tag !== 'string') throw validationError('tag must be a string or null');
      return args;
    case 'set_document_tag':
      rejectUnexpectedArguments(args, ['source_path', 'tag']); requireString(args.source_path, 'source_path');
      if (!Object.hasOwn(args, 'tag') || (args.tag !== null && typeof args.tag !== 'string')) throw validationError('tag must be a string or null');
      return args;
    case 'delete_document':
      rejectUnexpectedArguments(args, ['source_path']); requireString(args.source_path, 'source_path'); return args;
  }
}
async function writeSse(raw: { write(text: string): boolean; once(event: 'drain', listener: () => void): void }, text: string): Promise<void> { if (!raw.write(text)) await new Promise<void>((resolve) => raw.once('drain', resolve)); }

export function jiraBaseUrlFromEnv(env: NodeJS.ProcessEnv): string | null {
  const value = env.JIRA_BASE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function buildApp(service: RagService, staticRoot?: string, env: NodeJS.ProcessEnv = process.env) {
  const app = Fastify({ logger: true, bodyLimit: 5_100_000 });
  if (staticRoot) { app.register(staticPlugin, { root: staticRoot, wildcard: false }); app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => reply.sendFile(`assets/${request.params['*']}`)); }
  app.register(pressure, { healthCheck: async () => { await service.documents(); return true; }, healthCheckInterval: 5_000, exposeStatusRoute: '/ready' });
  app.setErrorHandler((error, _request, reply) => { const envelope = toErrorEnvelope(error); reply.code(envelope.status).send({ error: envelope.error }); });
  // Liveness intentionally does not depend on PostgreSQL or Gemini.
  app.get('/health', { config: { pressureHandler: () => null } }, async () => ({ status: 'ok' }));
  app.get('/api/rag/health', async () => ({ status: 'ok', embeddingConfigured: Boolean(process.env.GEMINI_API_KEY) }));
  app.get('/api/rag/config', async (): Promise<PublicConfig> => ({ jiraBaseUrl: jiraBaseUrlFromEnv(env) }));
  app.get('/api/rag/documents', async () => ({ documents: await service.documents() }));
  app.post<{ Body: { files: unknown[] } }>('/api/rag/ingest', { schema: { body: { type: 'object', additionalProperties: false, required: ['files'], properties: { files: { type: 'array', minItems: 1, items: ingestFileSchema } } } } }, async (request, reply) => { const result = await service.batch(request.body.files as Parameters<RagService['batch']>[0]); reply.code(result.has_failures ? 207 : 200); return result; });
  app.post<{ Body: { source_path: string } }>('/api/rag/delete', { schema: { body: { type: 'object', additionalProperties: false, required: ['source_path'], properties: { source_path: sourcePathSchema } } } }, async (request) => service.delete(request.body.source_path));
  app.post<{ Body: { source_path: string; tag: string | null } }>('/api/rag/tag', { schema: { body: { type: 'object', additionalProperties: false, required: ['source_path', 'tag'], properties: { source_path: sourcePathSchema, tag: tagSchema } } } }, async (request) => service.tag(request.body.source_path, request.body.tag));
  app.post<{ Body: { question: string; top_k?: number } }>('/api/rag/chat', { schema: { body: { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', minLength: 1, maxLength: 20_000 }, top_k: { type: 'integer', minimum: 1, maximum: 20 } } } } }, async (request, reply) => {
    reply.hijack(); reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const abort = new AbortController(); reply.raw.on('close', () => abort.abort()); const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
    try { for await (const event of service.chatEvents(request.body.question, request.body.top_k, abort.signal)) { await writeSse(reply.raw, `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`); if (event.event === 'error') break; } } catch (error) { if (!abort.signal.aborted && !reply.raw.destroyed) { request.log.error({ err: error }, 'Chat stream failed'); await writeSse(reply.raw, 'event: error\ndata: {"code":"INTERNAL_ERROR","message":"The chat request could not be completed. Please try again."}\n\n'); } } finally { clearInterval(heartbeat); reply.raw.end(); }
  });
  app.post<{ Body: { jsonrpc: string; id?: string | number | null; method: string; params?: Record<string, unknown> } }>('/mcp', { schema: { body: { type: 'object', additionalProperties: false, required: ['jsonrpc', 'method'], properties: { jsonrpc: { const: '2.0' }, id: {}, method: { type: 'string', minLength: 1 }, params: { type: 'object' } } } } }, async (request, reply) => {
    const body = request.body;
    if (Object.hasOwn(body, 'id') && body.id !== null && typeof body.id !== 'string' && typeof body.id !== 'number') {
      reply.code(400);
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request ID' } };
    }
    if (body.method === 'notifications/initialized') {
      reply.code(202).send();
      return;
    }
    if (body.method === 'tools/list') return { jsonrpc: '2.0', id: body.id, result: { tools } };
    if (body.method === 'ping') return { jsonrpc: '2.0', id: body.id, result: {} };
    if (body.method === 'initialize') return { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'rag-knowledge-base', version: '1.0.0' } } };
    if (body.method === 'tools/call') {
      try {
        const name = body.params?.name; if (typeof name !== 'string' || !Object.hasOwn(toolDefinitions, name)) throw validationError(`Unknown tool: ${typeof name === 'string' ? name : ''}`);
        const args = parseMcpArguments(name as ToolName, body.params?.arguments); let result: unknown;
        switch (name as ToolName) { case 'search_knowledge_base': result = await service.chat(args.question as string, args.top_k as number | undefined); break; case 'ingest_document': result = await service.ingest(args as unknown as Parameters<RagService['ingest']>[0]); break; case 'set_document_tag': result = await service.tag(args.source_path as string, args.tag as string | null); break; case 'delete_document': result = await service.delete(args.source_path as string); break; }
        return { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } };
      } catch (error) { return { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true } }; }
    }
    reply.code(404); return { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } };
  });
  if (staticRoot) app.setNotFoundHandler((request, reply) => request.method === 'GET' && !request.url.startsWith('/api/') && request.url !== '/mcp' ? reply.sendFile('index.html') : reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
  return app;
}
