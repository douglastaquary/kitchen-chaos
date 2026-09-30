// Quick smoke run: loads the game, captures title + active play, drives a few inputs.
// Usage: node scripts/smoke.mjs [url] [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const out = process.argv[3] ?? 'artifacts/smoke';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  // Headless Chrome falls back to SwiftShader here; a real (off-screen) window gets the GPU.
  headless: process.env.HEADLESS === '1',
  args: ['--window-position=-2400,0', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || (m.type() === 'warning' && !m.text().includes('GPU stall'))) errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));

const diag = () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
const waitPhase = async (phase, timeout) => {
  try {
    await page.waitForFunction((p) => window.__THREE_GAME_DIAGNOSTICS__?.phase === p, phase, { timeout });
  } catch {
    await page.screenshot({ path: `${out}/fail-${phase}.png` });
    console.log(`FAILED waiting for ${phase}; diag:`, JSON.stringify(await diag()));
    console.log('errors:\n' + errors.join('\n'));
    await browser.close();
    process.exit(1);
  }
};
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

await page.goto(url);
await waitPhase('title', 30000);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/title.png` });
{
  const d = await diag();
  console.log('title diag: gpu=', d.gpu, 'fps=', d.fps, 'renderer=', JSON.stringify(d.renderer), 'camera=', JSON.stringify(d.camera));
}

await page.click('#play-button');
await waitPhase('playing', 10000);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/play-start.png` });

await hold('KeyD', 500);
await hold('KeyW', 350);
await page.keyboard.press('KeyE');
await page.waitForTimeout(300);
const d1 = await diag();
console.log('after grab:', d1.target, d1.held);
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/play-10s.png` });
const d2 = await diag();
console.log('bot:', JSON.stringify(d2.bot), 'orders:', d2.orders, 'renderer:', JSON.stringify(d2.renderer), 'assets:', JSON.stringify(d2.assets));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
