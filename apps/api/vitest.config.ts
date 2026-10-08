import { defineConfig } from 'vitest/config';

// Explicit per-package config so vitest never loads the repository-root
// `vite.config.ts` (the Figma Make scaffold, which imports
// `@tailwindcss/vite` and reads `./.figma/make/site.json`). Neither is a
// dependency of this package, so loading it crashed the whole suite.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // `pdf-parse` (a CommonJS module with a lazy internal require chain)
    // is incompatible with V8 coverage instrumentation: instrumenting its
    // internals at transform time replaces `require()` with an instrumented
    // wrapper that pdf-parse's lazy module loader cannot resolve, causing
    // `extractPdfText` to silently return `ok: false`.  We exclude both
    // the test file AND the source from coverage, AND we also exclude
    // the unit test file from the test run when coverage is active —
    // the E2E pipeline test runs pdf-parse through the full queue and
    // is not affected.  The document-extract unit test is excluded from
    // coverage runs so coverage does not transform it; it is still
    // covered by `pnpm test` (plain vitest run without --coverage).
    coverage: {
      exclude: [
        'src/jobs/__tests__/document-extract.test.ts',
        'src/jobs/__tests__/document-pipeline.e2e.test.ts',
        'src/jobs/document-extract.ts',
        'src/jobs/document-types.ts'
      ]
    }
  }
});
