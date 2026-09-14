// Does MPA serve the page to anything that is not a browser?
//
// A plain fetch of a detail page comes back "Page not Found" — for every one
// of the three lists. That also retires an earlier reading of mine: the
// notice's words did appear in that markup, but they were the slug out of the
// URL echoed by the error page, not the circular. A check that looked for the
// title was always going to pass on a 404 whose URL contains the title.
//
// The request log named a likely reason: /_Incapsula_Resource, which is bot
// protection. Protection like that usually turns on the headers a browser
// sends. So this asks the same URL three ways — bare, with a browser's
// headers, and through a real browser — and prints what each gets back.
//
// Reads only.

const MPA = 'https://www.mpa.gov.sg';
const LIST = '63fc1321-c383-4bc1-8cda-a7718c8eb28c';

const BROWSERISH = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-GB,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'upgrade-insecure-requests': '1',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none'
};

const notFound = (html) => /Page not Found|Sorry! Page not found/i.test(html);

const list = await fetch(`${MPA}/api/items/media_releases_and_circulars?type=${LIST}&year=All&limit=1&page=1`)
  .then((r) => r.json());
const items = Array.isArray(list) ? list : list?.data || list?.items || [];
const item = items[0];
const url = `${MPA}/media-centre/details/${item.slug}`;
console.log(`${String(item.title).slice(0, 80)}\n${url}\n`);

for (const [label, init] of [['bare fetch', {}], ['with a browser’s headers', { headers: BROWSERISH }]]) {
  try {
    const r = await fetch(url, init);
    const html = await r.text();
    console.log(`${label}: HTTP ${r.status} · ${(html.length / 1024).toFixed(0)} KB · ${notFound(html) ? 'PAGE NOT FOUND' : 'looks like a real page'}`);
  } catch (ex) { console.log(`${label}: failed — ${ex.message}`); }
}

// And the only reading that settles it: what a browser actually ends up showing.
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.log('\nno browser available, cannot compare'); process.exit(0); }

const browser = await chromium.launch();
const page = await browser.newPage();
const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
const shown = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.trim());
console.log(`\nthrough a browser: HTTP ${res.status()} · ${shown.length} characters shown · ${notFound(shown) ? 'PAGE NOT FOUND' : 'looks like a real page'}`);
console.log('---8<---');
console.log(shown.slice(0, 1200).split('\n').filter((l) => l.trim()).slice(0, 25).map((l) => '| ' + l).join('\n'));
console.log('---8<---');
await browser.close();
