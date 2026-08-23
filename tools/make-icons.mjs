// Rasterise the lion mark to PNG using the Chromium already on this machine.
//   node tools/make-icons.mjs
import { chromium } from 'playwright';
import { lionSVG } from './lion.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const TARGETS = [
  { file: 'icons/icon-192.png', size: 192, scale: 1 },
  { file: 'icons/icon-512.png', size: 512, scale: 1 },
  // Maskable icons are cropped to a circle, so the art is pulled in.
  { file: 'icons/icon-512-maskable.png', size: 512, scale: 0.76 },
  { file: 'icons/apple-touch-icon.png', size: 180, scale: 1 }
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const { file, size, scale } of TARGETS) {
  const svg = lionSVG({ size, scale });
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>${svg}`,
    { waitUntil: 'load' }
  );
  const out = path.join(ROOT, file);
  await page.locator('svg').screenshot({ path: out, omitBackground: true });
  console.log(`${file}  ${size}x${size}  ${fs.statSync(out).size.toLocaleString()} bytes`);
}

// A standalone SVG is handy for the README and any future use.
fs.writeFileSync(path.join(ROOT, 'icons/lion.svg'), lionSVG({ size: 512, scale: 1 }));
console.log('icons/lion.svg');

await browser.close();
