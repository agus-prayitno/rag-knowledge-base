import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from './repository.js';
import { FakeEmbedder, RagService } from './service.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function ready(geminiKey = '') {
  const service = new RagService(new MemoryRepository(), new FakeEmbedder(), geminiKey);
  await service.ingest({
    source_path: 'guide.md',
    content: 'Streaming sends tokens to the browser.',
  });
  return service;
}

describe('chat event generator', () => {
  it('uses extractive fallback when no Gemini key is configured', async () => {
    const events = [];
    for await (const event of (await ready()).chatEvents('How does streaming work?')) {
      events.push(event);
    }

    expect(events.map((event) => event.event)).toEqual(['sources', 'token', 'done']);
    expect(String(events[1].data.text)).toContain('Streaming');
  });

  it('streams Gemini SSE tokens when configured', async () => {
    const service = await ready('key');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"Generated "}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"answer"}]}}]}\n\n',
    ))));

    const events = [];
    for await (const event of service.chatEvents('How?')) events.push(event);

    expect(events.filter((event) => event.event === 'token').map((event) => event.data.text))
      .toEqual(['Generated ', 'answer']);
    expect(events.at(-1)?.event).toBe('done');
  });

  it('emits fallback notice when provider fails before a token', async () => {
    const service = await ready('key');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('no', { status: 500 }))));

    const events = [];
    for await (const event of service.chatEvents('How?')) events.push(event);

    expect(events.map((event) => event.event)).toEqual(['sources', 'notice', 'token', 'done']);
  });

  it('emits a visible error when retrieval cannot create a query embedding', async () => {
    const failingEmbedder = new FakeEmbedder();
    vi.spyOn(failingEmbedder, 'embed').mockRejectedValueOnce(new TypeError('fetch failed'));
    const service = new RagService(new MemoryRepository(), failingEmbedder);

    const events = [];
    for await (const event of service.chatEvents('How?')) events.push(event);

    expect(events).toEqual([{ event: 'error', data: {
      code: 'EMBEDDING_PROVIDER_ERROR',
      message: 'Unable to retrieve relevant documents. Please try again.',
    } }]);
  });
});
