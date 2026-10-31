import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PgRepository, type Point } from './repository.js';

const adminUrl = process.env.RAG_TEST_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
const database = `rag_integration_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const unitVector = (dimension = 0) => Array.from({ length: 1536 }, (_unused, index) => index === dimension ? 1 : 0);
const point = (overrides: Partial<Point> = {}): Point => ({
  point_id: 'point-1', file_id: 'file-1', chunk_index: 0, content_hash: 'hash-1', text: 'integration text', embedding: unitVector(),
  source_path: 'test/a.md', source_name: 'a.md', tag: null, content_size: 16, ...overrides,
});

suite('PostgreSQL pgvector repository', () => {
  let admin: Pool;
  let pool: Pool;
  let repo: PgRepository;
  let databaseCreated = false;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`create database ${quote(database)}`);
    databaseCreated = true;
    const url = new URL(adminUrl!);
    url.pathname = `/${database}`;
    pool = new Pool({ connectionString: url.toString() });
    const sql = await readFile(fileURLToPath(new URL('../../../migrations/001_rag.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    repo = new PgRepository(pool, 1536);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin && databaseCreated) {
      await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid <> pg_backend_pid()', [database]);
      await admin.query(`drop database if exists ${quote(database)}`);
    }
    await admin?.end();
  });

  it('persists replacement chunks, searches nearest vectors, and updates document tags', async () => {
    await repo.replace([point(), point({ point_id: 'point-2', chunk_index: 1, text: 'second chunk', content_hash: 'hash-2', embedding: unitVector(1) })]);
    expect((await repo.search(unitVector(), 2)).map((hit) => hit.text)).toEqual(['integration text', 'second chunk']);
    expect((await repo.documents())[0]).toMatchObject({ file_id: 'file-1', chunk_count: 2, tag: null });
    await repo.tag('file-1', 'guide');
    expect(await repo.getTag('file-1')).toBe('guide');
    expect((await repo.documents())[0].tag).toBe('guide');
  });

  it('rolls back a failed replacement and retains the previously indexed document', async () => {
    await repo.replace([point({ point_id: 'stable-point', text: 'stable content' })]);
    await expect(repo.replace([
      point({ point_id: 'duplicate-point', text: 'first replacement chunk' }),
      point({ point_id: 'duplicate-point', chunk_index: 1, text: 'second replacement chunk' }),
    ])).rejects.toMatchObject({ code: 'REPOSITORY_ERROR' });
    expect((await repo.search(unitVector(), 5)).map((hit) => hit.text)).toEqual(['stable content']);
    expect((await repo.documents())[0]).toMatchObject({ chunk_count: 1, source_path: 'test/a.md' });
  });

  it('rejects vectors with a dimension different from the index', async () => {
    await expect(repo.search([1, 0, 0], 1)).rejects.toMatchObject({ code: 'DIMENSION_MISMATCH' });
  });
});
