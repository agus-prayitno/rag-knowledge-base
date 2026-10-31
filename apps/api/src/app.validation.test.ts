import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { MemoryRepository } from './repository.js';
import { FakeEmbedder, RagService } from './service.js';

describe('request validation and probes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects invalid REST bodies before beginning an SSE response', async () => {
    const app = buildApp(new RagService(new MemoryRepository(), new FakeEmbedder()));
    const response = await app.inject({ method: 'POST', url: '/api/rag/chat', payload: { question: '', top_k: 0, unexpected: true } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('publishes strict MCP tool schemas and rejects malformed arguments', async () => {
    const app = buildApp(new RagService(new MemoryRepository(), new FakeEmbedder()));
    const list = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    const ingest = list.json().result.tools.find((tool: { name: string }) => tool.name === 'ingest_document');
    expect(ingest.inputSchema.required).toEqual(['source_path', 'content']);
    expect(ingest.inputSchema.additionalProperties).toBe(false);
    const malformed = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_knowledge_base', arguments: { question: 'x', top_k: 0 } } } });
    expect(malformed.statusCode).toBe(200);
    expect(malformed.json().result.isError).toBe(true);
    await app.close();
  });

  it('keeps liveness available while readiness reflects database failure', async () => {
    const service = { documents: vi.fn().mockRejectedValue(new Error('database unavailable')) } as unknown as RagService;
    const app = buildApp(service);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(503);
    await app.close();
  });

  it('exposes only a valid public Jira base URL', async () => {
    const service = new RagService(new MemoryRepository(), new FakeEmbedder());
    const configured = buildApp(service, undefined, { JIRA_BASE_URL: 'https://jira.example.test/browse/' });
    expect((await configured.inject({ method: 'GET', url: '/api/rag/config' })).json()).toEqual({ jiraBaseUrl: 'https://jira.example.test/browse' });
    await configured.close();
    const invalid = buildApp(service, undefined, { JIRA_BASE_URL: 'http://jira.example.test/browse' });
    expect((await invalid.inject({ method: 'GET', url: '/api/rag/config' })).json()).toEqual({ jiraBaseUrl: null });
    await invalid.close();
  });
});
