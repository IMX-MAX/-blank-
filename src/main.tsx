import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/inter/opsz.css';
import './fonts.css';
import './styles.css';
import { detectAppFont } from './lib/app-font';
import { registerOfflineShell } from './lib/shell-cache';
import { installBounce } from './lib/bounce';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

detectAppFont();
registerOfflineShell();
installBounce();
