// Renders every candidate mark onto one comparison sheet, each shown large and
// at Home Screen size, since an icon that works at 512 can still fail at 60.
import { chromium } from 'playwright';
const MODULE = process.env.VARIANTS_MODULE || './lion-variants.mjs';
const { VARIANTS } = await import(MODULE);
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(ROOT, 'tests', 'screens', 'lion-options.png');

const cards = VARIANTS.map((v) => `
  <div class="card">
    <div class="row">
      <div class="big">${v.render({ size: 200 })}</div>
      <div class="smalls">
        <div class="sq">${v.render({ size: 60 })}</div>
        <div class="lbl">60px</div>
      </div>
    </div>
    <div class="meta">
      <div class="name"><b>${v.id}</b> · ${v.name}</div>
      <div class="note">${v.note}</div>
    </div>
  </div>`).join('');

const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; padding:26px; background:#05101b; color:#e7eef6;
         font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; width:900px; }
  h1 { font-family:'Arial Narrow',sans-serif; letter-spacing:.2em; text-transform:uppercase;
       font-size:19px; color:#c9a227; margin:0 0 4px; }
  .sub { color:#8ea6bb; font-size:13.5px; margin:0 0 22px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  .card { background:#0c1f31; border:1px solid rgba(201,162,39,.18); border-radius:14px; padding:16px; }
  .row { display:flex; gap:16px; align-items:center; }
  .big svg, .sq svg { display:block; border-radius:22%; }
  .sq svg { border-radius:24%; }
  .smalls { text-align:center; }
  .lbl { color:#5f7a92; font-size:11px; margin-top:6px; font-family:'Arial Narrow',sans-serif; letter-spacing:.12em; }
  .meta { margin-top:14px; }
  .name { font-family:'Arial Narrow',sans-serif; letter-spacing:.1em; text-transform:uppercase;
          font-size:14px; color:#e3bd4a; }
  .name b { color:#fff; margin-right:2px; }
  .note { color:#8ea6bb; font-size:13px; margin-top:5px; line-height:1.5; }
</style>
<h1>AVA — lion mark options</h1>
<p class="sub">Each shown at 200px and at 60px, the size iOS actually draws on the Home Screen.</p>
<div class="grid">${cards}</div>`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: OUT, fullPage: true });
console.log('wrote ' + OUT);
await browser.close();
