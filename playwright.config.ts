import { defineConfig, devices } from '@playwright/test';

const e2eDatabasePath = `data/runtime/e2e-${Date.now()}.sqlite`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
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
      GLOBAL_RATE_LIMIT_PER_MINUTE: '1000',
      LLM_RATE_LIMIT_PER_MINUTE: '1000',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
