import { defineConfig } from 'vitest/config';

// An explicit per-package vitest config exists so vitest never walks up
// and loads the repository-root `vite.config.ts`. That root config is the
// Figma Make scaffold (it imports `@tailwindcss/vite` and reads
// `./.figma/make/site.json`), neither of which is a dependency of this
// package — loading it made `pnpm --filter @mnemonics/shared test` fail
// with "Cannot find module '@tailwindcss/vite'".
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node'
  }
});
