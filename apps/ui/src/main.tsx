import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
export function renderApp(root:Element|null=document.getElementById('root')){if(!root)throw new Error('Missing #root element');createRoot(root).render(<StrictMode><App/></StrictMode>)}
if(document.getElementById('root'))renderApp();
