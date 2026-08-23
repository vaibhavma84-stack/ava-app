// Turn a photo into a two-tone brass-on-navy icon set.
//
//   node tools/two-tone.mjs <image> [--threshold N] [--invert] [--out DIR]
//
// A photograph at 60px is mush: fur, background and depth all collapse into
// noise. Reducing it to two tones keeps the subject's shape and throws away the
// detail that cannot survive the shrink, which is what makes an icon read.
//
// The split point is chosen by Otsu's method (the level that best separates the
// image into two groups) unless --threshold is given.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const NAVY = [5, 16, 27];
const BRASS = [201, 162, 39];

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? null : args[i + 1];
};
if (!src) {
  console.error('usage: node tools/two-tone.mjs <image> [--threshold 0-255] [--invert] [--out DIR]');
  process.exit(1);
}
const outDir = flag('out') || path.join(process.cwd(), 'icons');
const manualThreshold = flag('threshold') ? Number(flag('threshold')) : null;
const invert = args.includes('--invert');

const ext = path.extname(src).slice(1).toLowerCase();
const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
const dataUri = `data:image/${mime};base64,${fs.readFileSync(src).toString('base64')}`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

const result = await page.evaluate(async ({ dataUri, NAVY, BRASS, manualThreshold, invert }) => {
  const img = new Image();
  img.src = dataUri;
  await img.decode();

  // Square centre crop, so the subject is not squashed by the icon's aspect.
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;

  const S = 512;
  const c = document.getElementById('c');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);

  const data = ctx.getImageData(0, 0, S, S);
  const px = data.data;

  // Luminance histogram.
  const lum = new Uint8Array(S * S);
  const hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const l = Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
    lum[p] = l;
    hist[l]++;
  }

  // Otsu: pick the split maximising between-class variance.
  let threshold = manualThreshold;
  if (threshold === null) {
    const total = S * S;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = t; }
    }
  }

  let brassCount = 0;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    let light = lum[p] > threshold;
    if (invert) light = !light;
    const [r, g, b] = light ? BRASS : NAVY;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    if (light) brassCount++;
  }
  ctx.putImageData(data, 0, 0);

  return { png: c.toDataURL('image/png'), threshold, brassShare: brassCount / (S * S) };
}, { dataUri, NAVY, BRASS, manualThreshold, invert });

fs.mkdirSync(outDir, { recursive: true });
const full = path.join(outDir, 'two-tone-512.png');
fs.writeFileSync(full, Buffer.from(result.png.split(',')[1], 'base64'));

// Resample the 512 master down to the sizes the manifest needs.
for (const size of [192, 180]) {
  await page.setContent(`<img id="s" src="${result.png}"><canvas id="d" width="${size}" height="${size}"></canvas>`);
  const scaled = await page.evaluate(async (size) => {
    const img = document.getElementById('s');
    await img.decode();
    const d = document.getElementById('d');
    const ctx = d.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size, size);
    return d.toDataURL('image/png');
  }, size);
  fs.writeFileSync(path.join(outDir, `two-tone-${size}.png`),
    Buffer.from(scaled.split(',')[1], 'base64'));
}

console.log(`threshold ${result.threshold} (${manualThreshold === null ? 'auto, Otsu' : 'manual'})`);
console.log(`brass covers ${(result.brassShare * 100).toFixed(1)}% of the frame`);
console.log(`wrote ${outDir}/two-tone-{512,192,180}.png`);
if (result.brassShare > 0.75 || result.brassShare < 0.08) {
  console.log('NOTE: very lopsided split — try --threshold, or --invert, or a higher-contrast source.');
}

await browser.close();
