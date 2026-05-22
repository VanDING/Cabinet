import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    channel: 'msedge',
    viewport: { width: 1280, height: 720 },
  },
  webServer: [
    { command: 'cd ../../apps/server && pnpm dev', port: 3000, reuseExistingServer: true },
    {
      command: 'cd ../../apps/desktop && npx vite --port 5173',
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
