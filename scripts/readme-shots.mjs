// Captures the screenshots used by README.md into docs/screenshots/.
// Usage: node scripts/readme-shots.mjs [url]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5188/';
const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: process.env.HEADLESS === '1',
  args: ['--window-position=-2400,0', '--ignore-gpu-blocklist'],
});

async function open(width, height, query = '') {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${base}${query}`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ && window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', null, { timeout: 60000 });
  await page.waitForTimeout(600);
  return page;
}

async function state(width, height, name, file) {
  const page = await open(width, height);
  await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__.setState(s), name);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${file}` });
  console.log(`captured ${file}`);
  await page.close();
}

const title = await open(1440, 900);
await title.screenshot({ path: `${out}/title.png` });
console.log('captured title.png');
await title.close();

await state(1440, 900, 'busy-kitchen', 'gameplay.png');
await state(1440, 900, 'results', 'results.png');
// Phone in landscape with touch controls visible.
{
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ && window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/mobile-landscape-title.png` });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('busy-kitchen'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/mobile-landscape.png` });
  console.log('captured mobile-landscape.png');
  await context.close();
}

// A real autoplay moment: both chefs working mid-service.
const live = await open(1440, 900, '?autoplay');
await live.click('#play-button');
await live.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'playing', null, { timeout: 20000 });
await live.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.elapsed > 38, null, { timeout: 90000 });
await live.screenshot({ path: `${out}/live-service.png` });
console.log('captured live-service.png');
await live.close();

await browser.close();
