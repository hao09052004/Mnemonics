import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    testTimeout: 8000
  }
});
