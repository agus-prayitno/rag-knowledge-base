import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import App from './App.js';

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

function mockApi(jiraBaseUrl: string | null) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/rag/chat') return Promise.resolve(new Response('event: token\ndata: {"text":"See RAG-123."}\n\nevent: done\ndata: {"finish_reason":"stop"}\n\n'));
    if (url === '/api/rag/documents') return Promise.resolve(Response.json({ documents: [] }));
    if (url === '/api/rag/config') return Promise.resolve(Response.json({ jiraBaseUrl }));
    return Promise.resolve(Response.json({ embeddingConfigured: true }));
  }) as typeof fetch;
}

describe('Jira links', () => {
  it('links ticket IDs when runtime config provides a Jira base URL', async () => {
    mockApi('https://jira.example.test/browse');
    const { fireEvent, render, waitFor } = await import('@testing-library/react');
    const view = render(<App />);
    const input = Array.from(view.container.querySelectorAll('input')).at(-1)!;
    fireEvent.change(input, { target: { value: 'What changed?' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(view.getByRole('link', { name: 'RAG-123' }).getAttribute('href')).toBe('https://jira.example.test/browse/RAG-123'));
  });

  it('leaves ticket IDs as text when runtime config is unavailable', async () => {
    mockApi(null);
    const { fireEvent, render, waitFor } = await import('@testing-library/react');
    const view = render(<App />);
    const input = Array.from(view.container.querySelectorAll('input')).at(-1)!;
    fireEvent.change(input, { target: { value: 'What changed?' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(view.container.textContent).toContain('See RAG-123.'));
    expect(view.queryByRole('link', { name: 'RAG-123' })).toBeNull();
  });
});
