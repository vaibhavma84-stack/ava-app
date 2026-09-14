// Find where each Singapore circular's document actually lives.
//
// MPA does publish its circulars as PDFs — the belief that it published them
// as pages was wrong, and had gone unchecked for weeks. What it publishes as a
// page is the landing page the PDF hangs off, and that page is served only to
// a browser: a plain fetch of it is refused with a "Page not Found" 237 KB
// long, headers and all.
//
// The PDFs themselves are not protected. So this is the one part that needs a
// browser: render each landing page, take the link, and write it into the
// catalogue. Everything after that is an ordinary download.
//
// Only notices that do not already know where their document is, so the first
// run does the lot and every run after it does the handful that are new.
//
//   node tools/mpa-links.mjs [--limit=50] [--width=8]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DATA = 'library/data/singapore.json';
const MPA = 'https://www.mpa.gov.sg';
const args = process.argv.slice(2);
const flag = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const LIMIT = Number(flag('limit') || 0);
const WIDTH = Number(flag('width') || 8);

if (!existsSync(DATA)) { console.log('No Singapore catalogue yet.'); process.exit(0); }
const data = JSON.parse(readFileSync(DATA, 'utf8'));
const notices = data.notices || [];

let pending = notices.filter((n) => !n.docUrl && n.sourceUrl && n.sourceUrl.includes('/media-centre/details/'));
if (LIMIT) pending = pending.slice(0, LIMIT);

console.log(`Singapore: ${notices.length} notices, ${notices.filter((n) => n.docUrl).length} already know their document.`);
if (!pending.length) { console.log('Nothing to look up.'); process.exit(0); }
console.log(`Looking up ${pending.length}, ${WIDTH} at a time.\n`);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.log('No browser available — the landing pages cannot be read without one.'); process.exit(0); }

const browser = await chromium.launch();

/** One page: render it, take the document link, close it. */
async function lookUp(context, notice) {
  const page = await context.newPage();
  try {
    await page.goto(notice.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('a[href*=".pdf"]', { timeout: 12000 }).catch(() => {});
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .map((a) => a.href)
      .filter((h) => /\.pdf(\?|$)/i.test(h)));
    // The circular itself is the first document on the page; anything after it
    // is an annex, and an annex is not what the entry is for.
    return links[0] || '';
  } catch {
    return '';
  } finally {
    await page.close().catch(() => {});
  }
}

let found = 0, missing = 0, done = 0;
const started = Date.now();
let next = 0;

await Promise.all(Array.from({ length: Math.min(WIDTH, pending.length) }, async () => {
  // A context each, so one slow page never holds up the others.
  const context = await browser.newContext();
  try {
    for (;;) {
      const i = next++;
      if (i >= pending.length) return;
      const notice = pending[i];
      const href = await lookUp(context, notice);
      if (href) { notice.docUrl = href; found++; } else { missing++; }
      done++;
      if (done % 50 === 0 || done === pending.length) {
        const rate = done / ((Date.now() - started) / 1000);
        console.log(`  ${done} of ${pending.length} · ${found} found · ${rate.toFixed(1)}/s`);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
}));

await browser.close();

console.log(`\n${found} now know where their document is · ${missing} had no document link on the page.`);
if (found) {
  writeFileSync(DATA, JSON.stringify(data, null, 1) + '\n');
  console.log(`${DATA} updated.`);
}
