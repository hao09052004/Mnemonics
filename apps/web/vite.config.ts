import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env so the HTML template's `%VITE_*%` placeholders resolve
  // at build time. We deliberately do NOT use the default Vite
  // `import.meta.env` mechanism here because that doesn't run for
  // raw HTML.
  const env = loadEnv(mode, process.cwd(), '');
  const canonicalBase = env.VITE_WEB_URL || 'http://localhost:3000';
  return {
    plugins: [
      react(),
      {
        // Tiny inline plugin: replace `%VITE_*%` tokens in index.html
        // before the React plugin sees it. Kept here (not in a
        // separate file) so the relationship is obvious in review.
        name: 'mnemonics-html-tokens',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            return html
              .replaceAll('%VITE_WEB_URL%', canonicalBase)
              .replaceAll(
                '%VITE_CANONICAL_URL%',
                env.VITE_CANONICAL_URL || canonicalBase
              );
          }
        }
      }
    ],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true
        }
      }
    }
  };
});
