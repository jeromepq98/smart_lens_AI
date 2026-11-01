import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['./tests/global-setup.js'],
    env: {
      NODE_ENV: 'test',
      DB_NAME: 'smartlens_ai_test',
      LOG_LEVEL: 'silent',
      GEMINI_API_KEY: '',
    },
    testTimeout: 20000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
