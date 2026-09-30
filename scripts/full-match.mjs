// Bot playtest: the player chef is driven by the planner (?autoplay) for a full match.
// Verifies progression → results → rematch reset, and writes metrics JSON.
// Usage: node scripts/full-match.mjs [url] [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5188/';
const out = process.argv[3] ?? 'artifacts/full-match';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: process.env.HEADLESS === '1',
  args: ['--window-position=-2400,0', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('close', () => console.log('PAGE CLOSED', JSON.stringify(errors)));
const diag = () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);

await page.goto(`${base}?autoplay`);
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', null, { timeout: 60000 });
await page.click('#play-button');
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'playing', null, { timeout: 20000 });

const samples = [];
let shotMid = false;
for (;;) {
  const d = await diag();
  samples.push({ t: d.elapsed, fps: d.fps, calls: d.renderer.calls, tris: d.renderer.triangles, you: d.stats.coins, bot: d.bot.coins });
  if (samples.length % 15 === 0) console.log(`t=${d.elapsed?.toFixed?.(1)} phase=${d.phase} fps=${d.fps} you=${d.stats.coins} bot=${d.bot.coins}`);
  if (!shotMid && d.elapsed > 70) {
    await page.screenshot({ path: `${out}/mid-match.png` });
    shotMid = true;
  }
  if (d.phase === 'results') break;
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/results.png` });
const end = await diag();

await page.click('#rematch-button');
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'playing', null, { timeout: 20000 });
const after = await diag();

const fps = samples.map((s) => s.fps).filter((f) => f > 0);
const metrics = {
  outcome: end.outcome,
  player: end.stats,
  bot: end.bot,
  rematchReset: after.stats.coins === 0 && after.bot.coins === 0 && after.elapsed < 5,
  fps: { min: Math.min(...fps), avg: Math.round(fps.reduce((a, b) => a + b, 0) / fps.length), max: Math.max(...fps) },
  maxCalls: Math.max(...samples.map((s) => s.calls)),
  maxTriangles: Math.max(...samples.map((s) => s.tris)),
  gpu: end.gpu,
  errors,
};
writeFileSync(`${out}/metrics.json`, JSON.stringify({ metrics, samples }, null, 2));
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
