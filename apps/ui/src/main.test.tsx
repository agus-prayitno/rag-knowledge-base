import { beforeAll,describe,expect,it,vi } from 'vitest';
import { JSDOM } from 'jsdom';
const render=vi.fn();const createRoot=vi.fn(()=>({render}));
vi.mock('react-dom/client',()=>({createRoot}));
beforeAll(()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})});
describe('renderApp',()=>{it('mounts the React app and rejects a missing mount point',async()=>{const {renderApp}=await import('./main.js');const root=document.createElement('div');renderApp(root);expect(createRoot).toHaveBeenCalledWith(root);expect(render).toHaveBeenCalledTimes(1);expect(()=>renderApp(null)).toThrow('Missing #root')})});
