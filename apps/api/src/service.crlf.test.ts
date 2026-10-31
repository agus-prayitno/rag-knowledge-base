import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRepository } from './repository.js';
import { FakeEmbedder, RagService } from './service.js';

afterEach(() => vi.unstubAllGlobals());

it('parses a Gemini CRLF-delimited SSE frame split between CR and LF', async () => {
  const service = new RagService(new MemoryRepository(), new FakeEmbedder(), undefined);
  await service.ingest({ source_path: 'guide.md', content: 'streaming' });
  service.geminiKey = 'key';
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"CRLF token"}]}}]}\r'));
      controller.enqueue(encoder.encode('\n\r'));
      controller.enqueue(encoder.encode('\n'));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body))));

  const events = [];
  for await (const event of service.chatEvents('stream?')) events.push(event);

  expect(events.some((event) => event.event === 'token' && event.data.text === 'CRLF token')).toBe(true);
});
