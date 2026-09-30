// Captures the busy-kitchen state at several viewports to verify the camera framing.
// Usage: node scripts/camera-check.mjs [url] [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5188/';
const out = process.argv[3] ?? 'artifacts/camera';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: process.env.HEADLESS === '1',
  args: ['--window-position=-2400,0', '--ignore-gpu-blocklist'],
});
const sizes = [
  [1440, 900],
  [1280, 620],
  [1920, 780],
  [1024, 700],
  [390, 844],
  [844, 390],
];
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(base);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ && window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', null, { timeout: 60000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('busy-kitchen'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/busy-${w}x${h}.png` });
  console.log(`captured ${w}x${h}`);
  await page.close();
}
await browser.close();
