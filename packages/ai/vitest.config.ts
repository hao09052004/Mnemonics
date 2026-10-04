import { defineConfig } from 'vitest/config';

// Explicit per-package config so vitest never loads the repository-root
// `vite.config.ts` (the Figma Make scaffold, which imports
// `@tailwindcss/vite` and reads `./.figma/make/site.json`). Neither is a
// dependency of this package, so loading it crashed the whole suite.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
});
