import { defineConfig } from 'vitest/config';
import path from 'path';

/** Banc de montage : lancé à la main, jamais par la suite normale (`vitest.config.ts` n'inclut que `src/`). */
export default defineConfig({
  test: { environment: 'node', globals: true, include: ['e2e/banc-montage/*.bench.ts'], testTimeout: 1_800_000 },
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
});
