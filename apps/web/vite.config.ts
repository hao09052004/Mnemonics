import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { devApiPlugin } from './src/mocks/dev-api-plugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const canonicalBase = env.VITE_WEB_URL || 'http://localhost:3000';
  return {
    define: {
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(env.VITE_DEMO_MODE || 'true')
    },
    plugins: [
      devApiPlugin(),
      react(),
      {
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
      host: '0.0.0.0',
      port: 3000
    }
  };
});

