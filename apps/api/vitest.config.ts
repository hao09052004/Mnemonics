import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@mnemonics/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@mnemonics/database': resolve(__dirname, '../../packages/database/src/index.ts')
    }
  }
});