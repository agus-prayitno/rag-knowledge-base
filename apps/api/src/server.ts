import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { PgRepository } from './repository.js';
import { GeminiEmbedder, RagService } from './service.js';

interface ClosableApp {
  addHook(name: 'onClose', hook: () => Promise<void>): void;
  close(): Promise<unknown>;
  listen(options: { host: string; port: number }): Promise<unknown>;
}

export function connectionStringFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const host = env.DATABASE_HOST ?? env.VITE_DATABASE_HOST;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!host) return undefined;
  const user = encodeURIComponent(env.DATABASE_USER ?? env.VITE_DATABASE_USER ?? 'postgres');
  const password = encodeURIComponent(env.DATABASE_PASSWORD ?? env.VITE_DATABASE_PASSWORD ?? '');
  const port = env.DATABASE_PORT ?? '5432';
  const database = env.DATABASE_NAME ?? 'postgres';
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

export function installGracefulShutdown(app: ClosableApp): () => void {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await app.close(); } catch { process.exitCode = 1; }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return () => { process.off('SIGTERM', shutdown); process.off('SIGINT', shutdown); };
}

export async function startServer(env: NodeJS.ProcessEnv = process.env) {
  const connectionString = connectionStringFromEnv(env);
  if (!connectionString) throw new Error('DATABASE_URL required (or database host, user, password).');
  if (!env.GEMINI_API_KEY && env.VITE_GEMINI_API_KEY) env.GEMINI_API_KEY = env.VITE_GEMINI_API_KEY;
  const embedder = new GeminiEmbedder();
  const pool = new Pool({ connectionString, ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  const uiRoot = fileURLToPath(new URL('../../ui/dist/', import.meta.url));
  const app = buildApp(new RagService(new PgRepository(pool, embedder.dimensions), embedder), uiRoot, env) as unknown as ClosableApp;
  app.addHook('onClose', async () => pool.end());
  const removeShutdownHandlers = installGracefulShutdown(app);
  app.addHook('onClose', async () => { removeShutdownHandlers(); });
  await app.listen({ host: '0.0.0.0', port: Number(env.PORT ?? 3000) });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await startServer();
