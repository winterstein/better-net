import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'smoke',
      testMatch: '**/smoke.spec.ts',
      timeout: 30_000,
    },
    {
      name: 'e2e',
      testMatch: '**/fixtures.spec.ts',
      dependencies: ['smoke'],
    },
    {
      name: 'online',
      testMatch: '**/online.spec.ts',
      timeout: 120_000,
    },
  ],
});
