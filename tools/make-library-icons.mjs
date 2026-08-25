import { chromium } from 'playwright';
import { librarySVG } from './library-icon.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TARGETS = [
  { file: 'library/icons/icon-192.png', size: 192, scale: 1 },
  { file: 'library/icons/icon-512.png', size: 512, scale: 1 },
  { file: 'library/icons/icon-512-maskable.png', size: 512, scale: 0.74 },
  { file: 'library/icons/apple-touch-icon.png', size: 180, scale: 1 }
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const { file, size, scale } of TARGETS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${librarySVG({ size, scale })}`,
    { waitUntil: 'load' });
  const out = path.join(ROOT, file);
  await page.locator('svg').screenshot({ path: out });
  console.log(`${file}  ${size}x${size}  ${fs.statSync(out).size.toLocaleString()} bytes`);
}
await browser.close();
