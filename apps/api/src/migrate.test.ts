import { describe,expect,it } from 'vitest';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from './migrate.js';
describe('runMigrations',()=>{it('runs sorted SQL files and always closes the pool',async()=>{const dir=await mkdtemp(join(tmpdir(),'rag-migrations-'));await writeFile(join(dir,'002.sql'),'second');await writeFile(join(dir,'001.sql'),'first');const queries:string[]=[];let ended=false;await runMigrations({connectionString:'postgresql://test',migrationsDirectory:dir,createPool:()=>({query:async sql=>{queries.push(sql)},end:async()=>{ended=true}})});expect(queries).toEqual(['first','second']);expect(ended).toBe(true)});it('requires a URL',async()=>{await expect(runMigrations({connectionString:undefined,createPool:()=>({query:async()=>{},end:async()=>{}})})).rejects.toThrow('DATABASE_URL')})});
