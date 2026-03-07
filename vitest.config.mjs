import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false,
    globalSetup: './tests/global-setup.mjs',
    setupFiles: ['./tests/setup.js'],
    testTimeout: 15000,
    forceRerunTriggers: [],
  },
});
