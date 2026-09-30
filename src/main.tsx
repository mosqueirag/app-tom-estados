import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { aplicarPreferencias } from './lib/preferencias';

aplicarPreferencias(); // antes de dibujar, para que no parpadee en claro

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
