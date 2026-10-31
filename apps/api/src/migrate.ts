import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
export interface MigrationPool { query(sql:string):Promise<unknown>; end():Promise<void> }
export async function runMigrations({connectionString,migrationsDirectory=fileURLToPath(new URL('../../../migrations/',import.meta.url)),createPool=(url:string)=>new Pool({connectionString:url})}:{connectionString?:string;migrationsDirectory?:string;createPool?:(url:string)=>MigrationPool}){if(!connectionString)throw new Error('DATABASE_URL is required');const pool=createPool(connectionString);try{for(const file of (await readdir(migrationsDirectory)).filter(file=>file.endsWith('.sql')).sort())await pool.query(await readFile(join(migrationsDirectory,file),'utf8'))}finally{await pool.end()}}
if(process.argv[1]===fileURLToPath(import.meta.url))await runMigrations({connectionString:process.env.DATABASE_URL});
