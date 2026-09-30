// Emulates phones (touch, mobile viewport) in landscape and portrait and captures each screen.
// Usage: node scripts/mobile-check.mjs [url] [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5188/';
const out = process.argv[3] ?? 'artifacts/mobile';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: process.env.HEADLESS === '1',
  args: ['--window-position=-2400,0', '--ignore-gpu-blocklist'],
});
const phones = [
  ['iphone-landscape', 844, 390],
  ['android-landscape', 915, 412],
  ['small-landscape', 667, 375],
  ['iphone-portrait', 390, 844],
];
const errors = [];
for (const [name, width, height] of phones) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-title.png` });
  if (height > width) {
    const blocked = await page.evaluate(() => getComputedStyle(document.querySelector('#rotate-screen')).display !== 'none');
    console.log(`${name}: rotate overlay shown = ${blocked}`);
    await context.close();
    continue;
  }
  await page.tap('#play-button');
  await page.waitForTimeout(3500);
  const phase = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.phase);
  await page.screenshot({ path: `${out}/${name}-play.png` });
  if (width > height) {
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('results'));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${name}-results.png` });
  }
  console.log(`${name}: phase after tapping play = ${phase}`);
  await context.close();
}
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
