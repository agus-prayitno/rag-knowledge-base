import { describe,expect,it } from 'vitest';
import { connectionStringFromEnv } from './server.js';
describe('server configuration',()=>{it('prefers DATABASE_URL and builds a safe local URL fallback',()=>{expect(connectionStringFromEnv({DATABASE_URL:'postgresql://explicit'})).toBe('postgresql://explicit');expect(connectionStringFromEnv({DATABASE_HOST:'db.internal',DATABASE_USER:'user@name',DATABASE_PASSWORD:'p@ss word',DATABASE_PORT:'5433',DATABASE_NAME:'rag'})).toBe('postgresql://user%40name:p%40ss%20word@db.internal:5433/rag');expect(connectionStringFromEnv({})).toBeUndefined()})});
