import { useState, useRef, useEffect, type ReactNode } from 'react';
import {
  Send, Loader2, FileText, MessageSquare, Trash2, FilePlus2, BookOpen, Sparkles,
  Tag, Search, X, FolderOpen, AlertTriangle,
} from 'lucide-react';
import type { PublicConfig } from '@rag/domain';

interface DocumentRow {
  file_id: string;
  source_path: string;
  source_name: string;
  chunk_count: number;
  updated_at: string;
  tag: string | null;
}

interface ChatSource {
  file_id: string;
  chunk_index: number;
  similarity: number;
  snippet: string;
}

interface ChatNotice {
  code: string;
  message: string;
  reason?: string;
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSource[];
  notice?: ChatNotice;
}

const API_BASE = '/api/rag';

const ERROR_TITLES: Record<string, string> = {
  GENERATION_PROVIDER_ERROR: 'AI answer unavailable',
  EMBEDDING_PROVIDER_ERROR: 'Search service unavailable',
  VALIDATION_ERROR: 'Invalid request',
  NOT_FOUND: 'Not found',
  DIMENSION_MISMATCH: 'Index needs rebuilding',
  REPOSITORY_ERROR: 'Database error',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported file type',
  INTERNAL_ERROR: 'Something went wrong',
};

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const envelope = (body as { error?: { code?: string; message?: string } })?.error;
    const err = new Error(
      envelope?.message ?? `Request failed (${res.status}). Please try again shortly.`,
    );
    (err as Error & { code?: string }).code = envelope?.code;
    throw err;
  }
  return body as T;
}

/** Tag pill shown on each row; click it to open the tag editor. */
function TagPill({ doc, onEdit }: { doc: DocumentRow; onEdit: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onEdit(); }}
      className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
        doc.tag
          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          : 'bg-stone-100 text-stone-400 hover:bg-stone-200 hover:text-stone-500'
      }`}
      title={doc.tag ? `Change tag "${doc.tag}"` : 'Set a tag'}
    >
      <Tag size={10} />
      {doc.tag ?? 'untagged'}
    </button>
  );
}

/** Inline editor to set or change a document's tag. */
function TagEditor({
  doc, saving, onSave, onCancel,
}: {
  doc: DocumentRow;
  saving: boolean;
  onSave: (tag: string | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(doc.tag ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <form
      className="flex items-center gap-1.5 mt-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value.trim() || null);
      }}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value.toLowerCase())}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        placeholder="tag name"
        className="w-28 px-2 py-0.5 rounded border border-emerald-300 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-600"
      />
      <button
        type="submit"
        disabled={saving}
        className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40"
      >
        {saving ? '...' : 'Save'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[11px] px-1.5 py-0.5 rounded text-stone-500 hover:bg-stone-100"
      >
        Cancel
      </button>
    </form>
  );
}

const JIRA_TICKET_PATTERN = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g;

/** Render an assistant answer, turning bare Jira ticket IDs into clickable links. */
function AssistantAnswer({ text, jiraBaseUrl }: { text: string; jiraBaseUrl: string | null }) {
  if (!jiraBaseUrl) return <>{text}</>;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  JIRA_TICKET_PATTERN.lastIndex = 0;
  let key = 0;
  while ((match = JIRA_TICKET_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const ticket = match[0];
    nodes.push(
      <a
        key={`jira-${key++}`}
        href={`${jiraBaseUrl}/${ticket}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
      >
        {ticket}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return <>{nodes}</>;
}

/** Amber warning strip inside an assistant bubble explaining a degraded answer. */
function ChatNoticeBanner({ notice }: { notice: ChatNotice }) {
  const [showReason, setShowReason] = useState(false);
  return (
    <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
      <p className="text-xs font-medium flex items-center gap-1.5">
        <AlertTriangle size={12} className="shrink-0" />
        {ERROR_TITLES[notice.code] ?? 'Heads up'}
      </p>
      <p className="text-xs mt-1 leading-relaxed">{notice.message}</p>
      {notice.reason && (
        <div className="mt-1.5">
          <button
            onClick={() => setShowReason((v) => !v)}
            className="text-[11px] font-medium text-amber-700 hover:text-amber-900 underline underline-offset-2"
          >
            {showReason ? 'Hide technical details' : 'Show technical details'}
          </button>
          {showReason && (
            <pre className="mt-1.5 text-[10px] leading-snug bg-amber-100/70 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {notice.reason}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ embeddingConfigured: boolean } | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null); // null = all, 'untagged' = untagged
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingTag, setSavingTag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const refreshDocuments = async () => {
    try {
      const data = await callApi<{ documents: DocumentRow[] }>('documents');
      setDocuments(data.documents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    }
  };

  useEffect(() => {
    refreshDocuments();
    callApi<{ embeddingConfigured: boolean }>('health')
      .then(setHealth)
      .catch(() => setHealth(null));
    callApi<PublicConfig>('config')
      .then((config) => setJiraBaseUrl(config.jiraBaseUrl ?? null))
      .catch(() => setJiraBaseUrl(null));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  const tagCounts = new Map<string, number>();
  for (const doc of documents) {
    const key = doc.tag ?? 'untagged';
    tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
  }
  const sortedTags = Array.from(tagCounts.keys()).sort((a, b) => {
    if (a === 'untagged') return 1;
    if (b === 'untagged') return -1;
    return a.localeCompare(b);
  });

  const visibleDocs = documents.filter((doc) => {
    if (activeTag === 'untagged' && doc.tag) return false;
    if (activeTag && activeTag !== 'untagged' && doc.tag !== activeTag) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!doc.source_name.toLowerCase().includes(q) && !doc.source_path.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const handleIngest = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploading) return;
    setError(null);
    setUploading(true);
    const names = Array.from(files).map((f) => f.name);
    try {
      const requests = [];
      for (const file of Array.from(files)) {
        const content = await file.text();
        requests.push({ content, source_path: file.name, source_name: file.name });
      }
      const summary = await callApi<{
        succeeded: { source_path: string; chunk_count: number }[];
        failed: { source_path: string; error: string }[];
      }>('ingest', { method: 'POST', body: JSON.stringify({ files: requests }) });
      await refreshDocuments();
      if (summary.failed.length > 0) {
        setError(
          `${summary.failed.length} of ${names.length} document(s) failed to process:\n` +
            summary.failed.map((f) => `${f.source_path} — ${f.error}`).join('\n'),
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error';
      setError(
        `Upload failed before the server could finish. No changes were verified for:\n` +
          names.map((n) => `${n} — ${reason}`).join('\n'),
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: DocumentRow) => {
    setError(null);
    try {
      await callApi('delete', { method: 'POST', body: JSON.stringify({ source_path: doc.source_path }) });
      await refreshDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleSaveTag = async (doc: DocumentRow, tag: string | null) => {
    setSavingTag(true);
    try {
      await callApi('tag', {
        method: 'POST',
        body: JSON.stringify({ source_path: doc.source_path, tag }),
      });
      setEditingId(null);
      await refreshDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set tag');
    } finally {
      setSavingTag(false);
    }
  };

  const handleChat = async () => {
    const q = question.trim();
    if (!q || chatLoading) return;
    const assistantId = `assistant-${Date.now()}-${Math.random()}`;
    setQuestion('');
    setMessages((m) => [...m, { role: 'user', text: q }, { id: assistantId, role: 'assistant', text: '' }]);
    setChatLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) });
      if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let completed = false;
      const update = (change: Partial<ChatMessage>) => setMessages((m) => m.map((x) => x.id === assistantId ? { ...x, ...change } : x));
      while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split('\n\n'); buffer = events.pop() ?? ''; for (const event of events) { const kind = event.match(/^event: (.+)$/m)?.[1]; const raw = event.match(/^data: (.+)$/m)?.[1]; if (!kind || !raw) continue; const data = JSON.parse(raw); if (kind === 'sources') update({ sources: data.sources }); if (kind === 'token') setMessages((m) => m.map((x) => x.id === assistantId ? { ...x, text: x.text + data.text } : x)); if (kind === 'notice') update({ notice: data }); if (kind === 'done') completed = true; if (kind === 'error') { const error = Object.assign(new Error(data.message), { code: data.code }); throw error; } } }
      if (!completed) throw new Error('Chat stream ended before completion.');
      setError(null);
    } catch (err) {
      const e = err as Error & { code?: string };
      setMessages((m) => m.map((message) => message.id === assistantId ? {
        ...message,
        text: message.text || 'Sorry, I could not answer that right now. Please try again in a moment — if the problem persists, the service may be temporarily unavailable.',
        notice: message.notice ?? {
          code: e.code ?? 'INTERNAL_ERROR',
          message: 'The request to the knowledge base failed.',
          reason: e.message,
        },
      } : message));
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-700 text-white flex items-center justify-center">
            <BookOpen size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">RAG Knowledge Base</h1>
            <p className="text-xs text-stone-500">Ingest markdown or text, then ask questions</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium ${
                health?.embeddingConfigured
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  health?.embeddingConfigured ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {health?.embeddingConfigured ? 'Embeddings ready' : 'Embedding key not set'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8">
        <section className="space-y-6">
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center gap-2">
              <FileText size={16} className="text-emerald-700" />
              <h2 className="font-semibold text-sm">Documents</h2>
              <span className="ml-auto text-xs text-stone-400">{documents.length} indexed</span>
            </div>

            <div className="px-5 py-4 border-b border-stone-100 space-y-3">
              {uploading ? (
                <div className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50 text-sm text-emerald-800">
                  <Loader2 size={16} className="animate-spin" />
                  Document upload in progress
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg border-2 border-dashed border-stone-300 text-sm text-stone-600 cursor-pointer hover:border-emerald-600 hover:text-emerald-700 transition-colors">
                  <FilePlus2 size={16} />
                  Upload .md or .txt files
                  <input
                    type="file"
                    multiple
                    accept=".md,.markdown,.txt,.text"
                    className="hidden"
                    onChange={(e) => {
                      handleIngest(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by name or path..."
                  className="w-full pl-8 pr-8 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-stone-400 hover:text-stone-600"
                    title="Clear filter"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {sortedTags.length > 0 && (
              <div className="px-5 py-3 border-b border-stone-100 flex flex-wrap gap-1.5">
                <button
                  onClick={() => setActiveTag(null)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    activeTag === null
                      ? 'bg-stone-900 text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  All <span className="opacity-60">{documents.length}</span>
                </button>
                {sortedTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      activeTag === tag
                        ? tag === 'untagged'
                          ? 'bg-stone-900 text-white'
                          : 'bg-emerald-700 text-white'
                        : tag === 'untagged'
                          ? 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {tag === 'untagged' ? <FolderOpen size={11} /> : <Tag size={11} />}
                    {tag} <span className="opacity-60">{tagCounts.get(tag)}</span>
                  </button>
                ))}
              </div>
            )}

            <ul className="divide-y divide-stone-100 max-h-[420px] overflow-y-auto">
              {visibleDocs.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-stone-400">
                  {documents.length === 0
                    ? 'No documents yet. Upload a markdown file to get started.'
                    : 'No documents match the current filter.'}
                </li>
              )}
              {visibleDocs.map((doc) => (
                <li key={doc.file_id} className="px-5 py-3 flex items-start gap-3 hover:bg-stone-50 transition-colors group">
                  <FileText size={15} className="text-stone-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{doc.source_name}</p>
                    <p className="text-xs text-stone-400">
                      {doc.chunk_count} chunks · {new Date(doc.updated_at).toLocaleDateString()}
                    </p>
                    {editingId === doc.file_id ? (
                      <TagEditor
                        doc={doc}
                        saving={savingTag}
                        onSave={(tag) => handleSaveTag(doc, tag)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <TagPill doc={doc} onEdit={() => setEditingId(doc.file_id)} />
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(doc)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 transition-all"
                    title={`Delete ${doc.source_name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 whitespace-pre-line">
              {error}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-stone-200 shadow-sm flex flex-col h-[640px]">
          <div className="px-5 py-4 border-b border-stone-100 flex items-center gap-2">
            <MessageSquare size={16} className="text-emerald-700" />
            <h2 className="font-semibold text-sm">Ask your knowledge base</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 text-stone-400">
                <Sparkles size={28} />
                <p className="text-sm max-w-xs">
                  Ingest some documents, then ask a question. Answers are grounded in the most
                  similar chunks of your indexed files.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-emerald-700 text-white rounded-br-md'
                      : 'bg-stone-100 text-stone-800 rounded-bl-md'
                  }`}
                >
                  {m.role === 'assistant' ? <AssistantAnswer text={m.text} jiraBaseUrl={jiraBaseUrl} /> : m.text}
                  {m.notice && <ChatNoticeBanner notice={m.notice} />}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-stone-300/50 space-y-1">
                      {m.sources.map((s, j) => (
                        <p key={j} className="text-[11px] text-stone-500 truncate">
                          source chunk #{s.chunk_index} · {(s.similarity * 100).toFixed(0)}% match
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-stone-100 rounded-2xl rounded-bl-md px-4 py-3">
                  <Loader2 size={16} className="animate-spin text-stone-400" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="px-5 py-4 border-t border-stone-100">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleChat();
              }}
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about your documents..."
                className="flex-1 rounded-lg border border-stone-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={!question.trim() || chatLoading}
                className="rounded-lg bg-emerald-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
