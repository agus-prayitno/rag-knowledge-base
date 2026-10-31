import { describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({poolOptions:null as any,listen:null as any,hook:null as any}));
vi.mock('pg',()=>({Pool:class {constructor(options:any){state.poolOptions=options}async end(){}}}));
vi.mock('./repository.js',()=>({PgRepository:class {constructor(..._args:any[]){}}}));
vi.mock('./service.js',()=>({GeminiEmbedder:class {dimensions=1536},RagService:class {constructor(..._args:any[]){}}}));
vi.mock('./app.js',()=>({buildApp:()=>({addHook:(name:string,fn:unknown)=>{state.hook={name,fn}},listen:async(options:unknown)=>{state.listen=options}})}));
import { startServer } from './server.js';
describe('server runtime',()=>{it('wires pool shutdown and starts on the configured port',async()=>{const env:{[key:string]:string}={DATABASE_URL:'postgresql://db',DATABASE_SSL:'false',PORT:'4010',VITE_GEMINI_API_KEY:'key'};await startServer(env);expect(state.poolOptions).toEqual({connectionString:'postgresql://db',ssl:false});expect(state.listen).toEqual({host:'0.0.0.0',port:4010});expect(state.hook.name).toBe('onClose');expect(env.GEMINI_API_KEY).toBe('key')});it('rejects missing database configuration',async()=>{await expect(startServer({})).rejects.toThrow('DATABASE_URL')})});
