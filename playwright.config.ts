import { defineConfig, devices } from '@playwright/test';

const e2eDatabasePath = `data/runtime/e2e-${Date.now()}.sqlite`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // AI settings are intentionally global server state. Keep browser projects serialized so one
  // viewport cannot replace another viewport's provider while a launch is still in progress.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:3100/api/v1/health',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: '3100',
      DATABASE_PATH: e2eDatabasePath,
      NODE_ENV: 'test',
      // The complete two-worker suite legitimately exceeds 1,000 API reads while exercising
      // map refreshes. Keep rate-limit behavior covered by server tests instead of throttling
      // the isolated browser database and turning later UI assertions into unrelated 429s.
      GLOBAL_RATE_LIMIT_PER_MINUTE: '100000',
      LLM_RATE_LIMIT_PER_MINUTE: '100000',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
