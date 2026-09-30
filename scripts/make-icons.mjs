// Rasterises the app icon used by the web manifest into public/icon-192.png and public/icon-512.png.
import { chromium } from '@playwright/test';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#f3d6ae"/>
  <circle cx="32" cy="32" r="26" fill="#3cc4b0"/>
  <ellipse cx="32" cy="38" rx="17" ry="16" fill="#fffdf7" stroke="#2c2c46" stroke-width="2.4"/>
  <path d="M32 22c-5-8-12-7-12-7s2 8 12 7zm0 0c5-8 12-7 12-7s-2 8-12 7z" fill="#7cc957" stroke="#2c2c46" stroke-width="1.6"/>
  <circle cx="26" cy="38" r="2.2" fill="#2c2c46"/><circle cx="38" cy="38" r="2.2" fill="#2c2c46"/>
  <ellipse cx="22.5" cy="42.5" rx="2.6" ry="1.6" fill="#f7a6a0"/><ellipse cx="41.5" cy="42.5" rx="2.6" ry="1.6" fill="#f7a6a0"/>
  <path d="M29 42.5q3 2.6 6 0" fill="none" stroke="#2c2c46" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `public/icon-${size}.png` });
  await page.close();
}
await browser.close();
console.log('icons written');
