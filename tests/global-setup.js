import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function globalSetup() {
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_NAME: 'smartlens_ai_test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET:
      process.env.SESSION_SECRET || 'test-session-secret-at-least-32-characters-long',
    ADMIN_INITIAL_PASSWORD:
      process.env.ADMIN_INITIAL_PASSWORD || 'test-admin-password-123',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  };

  execFileSync(process.execPath, [path.resolve('database/migrate.js')], {
    env: baseEnv,
    stdio: 'pipe',
  });
  execFileSync(process.execPath, [path.resolve('database/seed.js')], {
    env: baseEnv,
    stdio: 'pipe',
  });
}
