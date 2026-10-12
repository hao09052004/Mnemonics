import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The repo-root vite.config.ts pulls in @tailwindcss/vite, which
    // this package does not depend on. Scoping a config here keeps the
    // database tests runnable without installing web-app tooling.
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one database; a single fork avoids
    // connection-pool contention and makes failures readable.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The suite is integration-only: every spec in src/__tests__ needs a
    // live Postgres. Skipping when DATABASE_URL is absent is friendlier
    // than 28 connection errors on a contributor's laptop, and the skip
    // message names the reason so it cannot be mistaken for a pass.
    setupFiles: ['./src/__tests__/setup.ts']
  }
});
