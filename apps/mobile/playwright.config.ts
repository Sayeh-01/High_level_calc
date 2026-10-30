/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

const PORT = 4199;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './e2e/.output',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    // The API serves the exported web build from the same origin, with a fresh in-memory PGlite database.
    command: 'pnpm --filter @circle/server start',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      STATIC_DIR: join(__dirname, 'dist'),
      FILES_DIR: join(__dirname, 'e2e/.output/files'),
      NODE_ENV: 'development',
      PUBLIC_URL: `http://localhost:${PORT}`,
      // deterministic stand-in model so AI screens can be exercised without an API key (never in production)
      AI_FAKE: '1',
    },
  },
});
