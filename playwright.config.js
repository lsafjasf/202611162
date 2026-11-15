import { defineConfig } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Prefer the full Chromium build (the headless-shell variant is not installed).
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), '.cache', 'ms-playwright'),
    '/home/hj/.codex-relay-home-4z19xif2/.cache/ms-playwright',
  ].filter(Boolean);
  for (const root of roots) {
    try {
      const dir = readdirSync(root).find((name) => name.startsWith('chromium-'));
      if (dir) return join(root, dir, 'chrome-linux64', 'chrome');
    } catch { /* try next root */ }
  }
  return undefined;
}

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4399',
    headless: true,
    launchOptions: {
      executablePath: findChromium(),
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'node tests/static-server.js',
    url: 'http://127.0.0.1:4399',
    reuseExistingServer: !process.env.CI,
  },
});
