// Records ~10s of autoplay and builds a promotional GIF for social posts.
// Usage: node scripts/promo-gif.mjs [url]
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5199/';
const framesDir = 'artifacts/promo-frames';
const outDir = 'docs/promo';
const outGif = `${outDir}/kitchen-chaos-promo.gif`;
const seconds = 10;
const fps = 10;
const width = 720;
const height = 405;

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: process.env.HEADLESS === '1',
  args: ['--window-position=-2400,0', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}?autoplay`);
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ && window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', null, {
  timeout: 60000,
});
await page.click('#play-button');
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'playing', null, { timeout: 20000 });
// Skip the calm opening; start mid-service when both chefs are busy.
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.elapsed ?? 0) > 28, null, { timeout: 90000 });

const total = seconds * fps;
const interval = 1000 / fps;
for (let i = 0; i < total; i += 1) {
  const name = join(framesDir, `f${String(i).padStart(4, '0')}.png`);
  await page.screenshot({ path: name, type: 'png' });
  if (i % 10 === 0) console.log(`frame ${i}/${total}`);
  await page.waitForTimeout(interval);
}
await browser.close();

const frames = readdirSync(framesDir)
  .filter((f) => f.endsWith('.png'))
  .sort()
  .map((f) => join(framesDir, f));

console.log(`encoding ${frames.length} frames → ${outGif}`);
// delay is centiseconds: 10 → 10 fps
execFileSync(
  'convert',
  [
    '-delay',
    '10',
    '-loop',
    '0',
    '-resize',
    `${width}x${height}`,
    '-layers',
    'Optimize',
    ...frames,
    outGif,
  ],
  { stdio: 'inherit' },
);

const kb = Math.round(Number(execFileSync('stat', ['-f', '%z', outGif]).toString()) / 1024);
writeFileSync(`${outDir}/README.md`, `# Promo assets\n\n- \`kitchen-chaos-promo.gif\` — ~${seconds}s, ${width}×${height}, ~${kb} KB\n`);
console.log(`done: ${outGif} (${kb} KB)`);
