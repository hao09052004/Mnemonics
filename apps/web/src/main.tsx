/**
 * Web Dashboard - React App
 *
 * Main entry point for the standalone web dashboard.
 * Uses Vite-style React imports.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
