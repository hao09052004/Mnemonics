import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,mjs}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 8000
  }
});
