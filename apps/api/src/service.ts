import {
  DEFAULT_TOP_K,
  FileIdentityResolver,
  chunkText,
  deriveTag,
  normalizeTag,
  sha256Hex,
  unsupportedMediaTypeError,
  validationError,
  type BatchSummary,
  type ChatGenerationResult,
  type ChatSource,
  type DeleteFileResult,
  type DocumentSummary,
  type IngestCommandRequest,
  type IngestFileResult,
  type SetTagResult,
  type SseEvent,
} from '@rag/domain';
import type { Point, Repository } from './repository.js';

export interface Embedder {
  readonly dimensions: number;
  readonly configured: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

interface GeminiEmbeddingResponse {
  embedding?: { values?: unknown };
}

interface GeminiGenerationResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
}

export class GeminiEmbedder implements Embedder {
  readonly dimensions = 1536;

  constructor(private readonly key = process.env.GEMINI_API_KEY) {}

  get configured(): boolean {
    return Boolean(this.key);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const key = this.key;
    if (!key) throw new Error('GEMINI_API_KEY not configured');

    return Promise.all(texts.map(async (text) => {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            content: { parts: [{ text }] },
            outputDimensionality: this.dimensions,
          }),
        },
      );
      const body = await response.json() as GeminiEmbeddingResponse;
      const values = body.embedding?.values;
      if (!response.ok || !Array.isArray(values) || !values.every((value) => typeof value === 'number')) {
        throw new Error('Embedding provider request failed');
      }
      return values;
    }));
  }
}

export class FakeEmbedder implements Embedder {
  readonly configured = true;

  constructor(readonly dimensions = 8) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const embedding = Array<number>(this.dimensions).fill(0);
      for (const character of text) embedding[character.charCodeAt(0) % this.dimensions] += 1;
      return embedding;
    });
  }
}

export class RagService {
  constructor(
    private readonly repo: Repository,
    private readonly embedder: Embedder,
    public geminiKey = process.env.GEMINI_API_KEY,
  ) {}

  async ingest(request: IngestCommandRequest): Promise<IngestFileResult> {
    if (!request.content?.trim()) throw validationError('content must be non-empty string');
    if (!/\.(md|markdown|txt|text)$/i.test(request.source_path)) {
      throw unsupportedMediaTypeError('Only markdown and text files are supported');
    }

    const identity = await new FileIdentityResolver().resolve(request.source_path, request.source_name);
    const tag = request.tag === undefined
      ? deriveTag(identity.source_path)
      : request.tag === null ? null : normalizeTag(request.tag);
    const chunks = chunkText(request.content).chunks;
    const embeddings = await this.embedder.embed(chunks.map((chunk) => chunk.text));
    const points: Point[] = await Promise.all(chunks.map(async (chunk, index) => ({
      point_id: await sha256Hex(`${identity.file_id}:${chunk.index}:${chunk.text}`),
      file_id: identity.file_id,
      chunk_index: chunk.index,
      content_hash: await sha256Hex(chunk.text),
      text: chunk.text,
      embedding: embeddings[index],
      source_path: identity.source_path,
      source_name: identity.source_name,
      tag,
      content_size: Buffer.byteLength(request.content),
    })));

    await this.repo.replace(points);
    return { ...identity, chunk_count: chunks.length, updated_at: new Date().toISOString(), tag };
  }

  async batch(files: IngestCommandRequest[]): Promise<BatchSummary<IngestFileResult>> {
    const succeeded: IngestFileResult[] = [];
    const failed: Array<{ source_path: string; error: string }> = [];
    for (const file of files) {
      try {
        succeeded.push(await this.ingest(file));
      } catch (error) {
        failed.push({ source_path: file.source_path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { succeeded, failed, has_failures: failed.length > 0 };
  }

  async delete(path: string): Promise<DeleteFileResult> {
    const identity = await new FileIdentityResolver().resolve(path);
    const deletedChunks = await this.repo.delete(identity.file_id);
    if (!deletedChunks) throw validationError('No document found for path');
    return { file_id: identity.file_id, source_path: identity.source_path, deleted_chunks: deletedChunks };
  }

  async tag(path: string, tag: string | null): Promise<SetTagResult> {
    const identity = await new FileIdentityResolver().resolve(path);
    const normalizedTag = tag === null ? null : normalizeTag(tag);
    await this.repo.tag(identity.file_id, normalizedTag);
    return { file_id: identity.file_id, source_path: identity.source_path, tag: normalizedTag };
  }

  async chat(question: string, topK = DEFAULT_TOP_K): Promise<ChatGenerationResult> {
    if (!question.trim()) throw validationError('question must be non-empty string');
    const [queryEmbedding] = await this.embedder.embed([question]);
    const hits = await this.repo.search(queryEmbedding, topK);
    const sources: ChatSource[] = hits.map((hit) => ({
      file_id: hit.file_id,
      source_path: hit.source_path,
      chunk_index: hit.chunk_index,
      similarity: Number(hit.similarity),
      snippet: hit.text.slice(0, 240),
    }));
    return {
      answer: hits.length
        ? hits.map((hit) => hit.text).join('\n\n').slice(0, 1800)
        : 'No matching documents found in the knowledge base.',
      sources,
    };
  }

  async *chatEvents(question: string, topK = DEFAULT_TOP_K, signal?: AbortSignal): AsyncGenerator<SseEvent> {
    let fallback: ChatGenerationResult;
    try {
      fallback = await this.chat(question, topK);
    } catch {
      yield {
        event: 'error',
        data: {
          code: 'EMBEDDING_PROVIDER_ERROR',
          message: 'Unable to retrieve relevant documents. Please try again.',
        },
      };
      return;
    }
    yield { event: 'sources', data: { sources: fallback.sources } };

    if (!this.geminiKey) {
      yield { event: 'token', data: { text: fallback.answer } };
      yield { event: 'done', data: { finish_reason: 'stop' } };
      return;
    }

    let emitted = false;
    try {
      const prompt = `Answer only from excerpts:\n${fallback.sources.map((source, index) => `[${index + 1}] ${source.snippet}`).join('\n')}\nQuestion: ${question}`;
      const model = process.env.GEMINI_GENERATION_MODEL ?? 'gemini-3.5-flash-lite';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.geminiKey)}`,
        {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1000 },
          }),
        },
      );
      if (!response.ok || !response.body) throw new Error(`Generation provider failed (${response.status})`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Normalize only after appending: the network may split a CRLF sequence
        // across two chunks (for example, `\r` then `\n`).
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const raw = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (!raw) continue;
          const payload = JSON.parse(raw) as GeminiGenerationResponse;
          const text = (payload.candidates?.[0]?.content?.parts ?? [])
            .map((part) => typeof part.text === 'string' ? part.text : '')
            .join('');
          if (text) {
            emitted = true;
            yield { event: 'token', data: { text } };
          }
        }
      }
      yield { event: 'done', data: { finish_reason: 'stop' } };
    } catch (error) {
      if (!emitted) {
        yield { event: 'notice', data: { code: 'GENERATION_PROVIDER_ERROR', message: 'Generation failed; showing retrieved excerpts instead.' } };
        yield { event: 'token', data: { text: fallback.answer } };
        yield { event: 'done', data: { finish_reason: 'fallback' } };
      } else {
        yield {
          event: 'error',
          data: { code: 'GENERATION_PROVIDER_ERROR', message: error instanceof Error ? error.message : 'Generation failed' },
        };
      }
    }
  }

  async documents(): Promise<DocumentSummary[]> {
    return this.repo.documents();
  }
}
