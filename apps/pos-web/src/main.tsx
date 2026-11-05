import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './pwa/register';
import '@fontsource-variable/inter/wght.css';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/primitives.css';
import './styles/session.css';
import './styles/food.css';
import './styles/order.css';
import './styles/kitchen.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) registerServiceWorker();
