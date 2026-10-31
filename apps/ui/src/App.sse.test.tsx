import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import App from './App.js';

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SSE chat events', () => {
  it('keeps sources and replaces the pending answer when the API sends an error event', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/rag/chat') return Promise.resolve(new Response(new ReadableStream({ start(streamController) { controller = streamController; } })));
      return Promise.resolve(Response.json(url === '/api/rag/documents' ? { documents: [] } : { embeddingConfigured: true }));
    }) as typeof fetch;

    const { fireEvent, render, waitFor } = await import('@testing-library/react');
    const view = render(<App />);
    const input = Array.from(view.container.querySelectorAll('input')).at(-1)!;
    fireEvent.change(input, { target: { value: 'q' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/rag/chat', expect.anything()));

    controller!.enqueue(new TextEncoder().encode(
      'event: sources\ndata: {"sources":[{"file_id":"a","chunk_index":2,"similarity":0.9,"snippet":"x"}]}\n\n' +
      'event: notice\ndata: {"code":"GENERATION_PROVIDER_ERROR","message":"Fallback"}\n\n' +
      'event: error\ndata: {"code":"EMBEDDING_PROVIDER_ERROR","message":"Stopped"}\n\n',
    ));
    controller!.close();

    await waitFor(() => {
      expect(view.container.textContent).toContain('source chunk #2');
      expect(view.container.textContent).toContain('Fallback');
      expect(view.container.textContent).toContain('Sorry, I could not answer that right now.');
    });
  });

  it('shows a visible failure when a stream ends without done', async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/rag/chat') return Promise.resolve(new Response('event: sources\ndata: {"sources":[]}\n\n'));
      return Promise.resolve(Response.json(url === '/api/rag/documents' ? { documents: [] } : { embeddingConfigured: true }));
    }) as typeof fetch;

    const { fireEvent, render, waitFor } = await import('@testing-library/react');
    const view = render(<App />);
    const input = Array.from(view.container.querySelectorAll('input')).at(-1)!;
    fireEvent.change(input, { target: { value: 'q' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(view.container.textContent).toContain('Sorry, I could not answer that right now.'));
  });
});
