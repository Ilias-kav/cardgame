import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The fuzz tests play many complete games and take a few seconds each.
    testTimeout: 120_000,
  },
});
