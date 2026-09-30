// Watches the rival bot for N seconds while the player idles; prints its task log.
// Usage: node scripts/bot-watch.mjs [seconds] [url]
import { chromium } from '@playwright/test';

const seconds = Number(process.argv[2] ?? 70);
const url = process.argv[3] ?? 'http://127.0.0.1:5188/';
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: process.env.HEADLESS === '1',
  args: ['--window-position=-2400,0', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', null, { timeout: 60000 });
await page.click('#play-button');
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'playing', null, { timeout: 20000 });

let last = '';
const start = Date.now();
while (Date.now() - start < seconds * 1000) {
  const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  const line = `${d.bot.task} | held=${d.bot.held ?? '-'} | coins=${d.bot.coins} dishes=${d.bot.dishes}`;
  if (line !== last) {
    console.log(`t=${d.elapsed.toFixed(1)} fps=${d.fps} ${line}`);
    last = line;
  }
  await page.waitForTimeout(250);
}
const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
console.log('FINAL bot', JSON.stringify(d.bot), 'renderer', JSON.stringify(d.renderer), 'batching', d.batching, 'fps', d.fps);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
