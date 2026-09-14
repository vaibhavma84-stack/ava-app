// What does a detail page ask for, to draw the circular?
//
// Settled so far: main_content is a fifty-character header, there is no
// per-item API at any of the obvious shapes, and the served markup holds the
// menu and not the notice — <main> has 384 characters in it. The page is drawn
// by script.
//
// Which is how the listing endpoint was found in the first place: render one
// page and log everything it asks for. A page drawing a circular is fetching
// that circular from somewhere. If that somewhere can be read directly, 565
// notices cost 565 plain fetches instead of 565 browser loads.
//
// One page. Reads only, downloads nothing, commits nothing.

import { textFromHtml } from './mirror-docs.mjs';

const MPA = 'https://www.mpa.gov.sg';
const LIST = '63fc1321-c383-4bc1-8cda-a7718c8eb28c';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.log('no browser available'); process.exit(1); }

const first = await fetch(`${MPA}/api/items/media_releases_and_circulars?type=${LIST}&year=All&limit=1&page=1`)
  .then((r) => r.json());
const items = Array.isArray(first) ? first : first?.data || first?.items || [];
const item = items[0];
console.log(`Rendering: ${String(item.title).slice(0, 80)}`);
console.log(`  ${MPA}/media-centre/details/${item.slug}\n`);

const browser = await chromium.launch();
const page = await browser.newPage();

const seen = [];
page.on('response', async (res) => {
  const url = res.url();
  if (!/mpa\.gov\.sg|cms\./i.test(url)) return;
  if (/\.(png|jpe?g|gif|svg|woff2?|ttf|css|ico|webp)(\?|$)/i.test(url)) return;
  let body = '';
  try { body = await res.text(); } catch { return; }
  if (body.length < 200) return;
  seen.push({ url, status: res.status(), body });
});

await page.goto(`${MPA}/media-centre/details/${item.slug}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

// What the page ended up showing, so there is something to compare against.
const shown = await page.evaluate(() => {
  const main = document.querySelector('main') || document.body;
  return (main.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
});
console.log(`=== what the rendered page shows: ${shown.length} characters ===`);
console.log(shown.slice(0, 900).split('\n').filter(Boolean).slice(0, 20).map((l) => '  | ' + l).join('\n'));

console.log(`\n=== ${seen.length} responses worth looking at ===`);
// A response that carries the circular will carry its distinctive words.
const words = String(item.title).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/)
  .filter((w) => w.length > 6).slice(0, 3);
console.log(`  (looking for: ${words.join(', ')})\n`);

for (const res of seen) {
  const text = /json/i.test(res.body.slice(0, 200)) || res.body.trim().startsWith('{') || res.body.trim().startsWith('[')
    ? res.body : textFromHtml(res.body);
  const hits = words.filter((w) => new RegExp(w, 'i').test(res.body)).length;
  const flag = hits === words.length ? '  <<< carries the circular' : '';
  console.log(`  [${res.status}] ${(res.body.length / 1024).toFixed(0)} KB  ${res.url.replace(MPA, '').slice(0, 110)}${flag}`);
  if (hits === words.length && res.url.includes('/api/')) {
    console.log('      --- what it holds ---');
    console.log(textFromHtml(text).slice(0, 500).split('\n').filter(Boolean).slice(0, 10).map((l) => '      | ' + l).join('\n'));
  }
}

await browser.close();
