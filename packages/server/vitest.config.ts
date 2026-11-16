import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/test-env.js';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      SCRYPT_LOG_N: '12', // cheap password hashing so tests stay fast
      RATE_LIMIT_MAX: '1000',
    },
    globalSetup: ['./test/global-setup.ts'],
    // All test files share one database, so run them one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
