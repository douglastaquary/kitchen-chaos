// Capture busy-kitchen on short phone landscapes to verify kitchen fill.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5188/';
const out = process.argv[3] ?? 'artifacts/mobile-zoom';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'chrome',
  headless: process.env.HEADLESS === '1',
  args: ['--window-position=-2400,0', '--ignore-gpu-blocklist'],
});
// Logical CSS sizes close to real devices in landscape.
const sizes = [
  ['iphone16', 852, 393],
  ['iphone16pro', 874, 402],
  ['iphonese', 667, 375],
  ['android', 915, 412],
];
for (const [name, width, height] of sizes) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ && window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', null, {
    timeout: 60000,
  });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('busy-kitchen'));
  await page.waitForTimeout(900);
  const cam = await page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    const hud = document.querySelector('#hud');
    const canvas = document.querySelector('#game-canvas');
    return {
      camera: d.camera,
      canvas: d.canvas,
      fps: d.fps,
      hudBottom: hud && !hud.classList.contains('hidden') ? Math.round(hud.getBoundingClientRect().bottom) : 0,
      canvasH: canvas?.clientHeight,
      touch: document.body.classList.contains('touch'),
    };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name} ${width}x${height}`, JSON.stringify(cam));
  await context.close();
}
await browser.close();
