import { defineConfig, devices } from '@playwright/test';
import { E2E_DB } from './e2e-db';

const E2E_BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const E2E_API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  // Reset to the canonical seed once up front (and fail fast if the DB is
  // unreachable) before any browser starts. Per-test reseeding is handled by the
  // auto `freshDatabase` fixture in fixtures/test.ts.
  globalSetup: './global-setup',
  // Tests run serially against a single shared DB that is reseeded before each
  // test. Parallelizing would require per-worker DB isolation that the schema
  // doesn't support today.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // API on host so socket.remoteAddress is genuinely loopback for stub auth.
      // ts-node directly (no nodemon) — we don't need file watching during E2E.
      command: 'npx ts-node server.ts',
      cwd: '../server',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !isCI,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...E2E_DB,
        PORT: '3000',
        METRICS_PORT: '9465',
        METRICS_HOST: '127.0.0.1',
        NODE_ENV: 'development',
        ALLOW_STUB_AUTH: 'true',
        CORS_ORIGIN: E2E_BASE_URL,
        LOG_LEVEL: 'warn',
        // Entra is unused in stub mode but the modules read these on import.
        ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000000',
        ENTRA_CLIENT_ID: '00000000-0000-0000-0000-000000000000',
        ENTRA_CLIENT_SECRET: '',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      cwd: '../client',
      url: E2E_BASE_URL,
      reuseExistingServer: !isCI,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        VITE_AUTH_MODE: 'stub',
        VITE_API_URL: E2E_API_URL,
        VITE_REDIRECT_URI: E2E_BASE_URL,
        VITE_ENTRA_CLIENT_ID: '00000000-0000-0000-0000-000000000000',
        VITE_ENTRA_TENANT_ID: 'common',
      },
    },
  ],
});
