// Singapore publishes PDFs after all.
//
// Every premise I started from was wrong. main_content is a header, there is
// no per-item API, and a plain fetch of a detail page is refused with a "Page
// not Found" that is 237 KB long. But rendered in a browser the same page
// shows "CURRENT .PDF — Sc No 8 of 2026 (279 KB, .pdf)": MPA does not publish
// the circular as a page at all. The page is a landing page, and the circular
// is the PDF hanging off it.
//
// So the remaining question is only how dear it is. The pages need a browser.
// The PDFs themselves are served from somewhere else, and if that somewhere
// answers a plain fetch then the expensive part is one render per notice,
// once, and the documents come down the ordinary way.
//
// Reads only. Fetches one PDF per list to weigh it, keeps none.

const MPA = 'https://www.mpa.gov.sg';
const LISTS = [
  ['Shipping Circulars', '63fc1321-c383-4bc1-8cda-a7718c8eb28c'],
  ['Port Marine Circulars', '0b4c161c-92d5-475e-8a41-51e096406f74'],
  ['Port Marine Notices', '2b89298e-3d17-4bf2-8275-9079e84f63d0']
];

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();

for (const [name, id] of LISTS) {
  const list = await fetch(`${MPA}/api/items/media_releases_and_circulars?type=${id}&year=All&limit=2&page=1`)
    .then((r) => r.json());
  const items = Array.isArray(list) ? list : list?.data || list?.items || [];

  for (const item of items.slice(0, 1)) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${name}: ${String(item.title).slice(0, 80)}`);

    const started = Date.now();
    await page.goto(`${MPA}/media-centre/details/${item.slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // The link is in the markup once the page has drawn; no need to idle.
    await page.waitForSelector('a[href*=".pdf"], a[href*="/assets/"]', { timeout: 15000 }).catch(() => {});
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .map((a) => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 70) }))
      .filter((l) => /\.pdf|\/assets\//i.test(l.href)));
    console.log(`  rendered in ${((Date.now() - started) / 1000).toFixed(1)}s · ${links.length} document link(s)`);
    for (const l of links.slice(0, 4)) console.log(`    ${l.text}\n      ${l.href}`);

    // The decisive part: is the document itself behind the same protection?
    const target = links[0]?.href;
    if (!target) { console.log('  no document link found'); continue; }
    try {
      const r = await fetch(target, { redirect: 'follow' });
      const buf = Buffer.from(await r.arrayBuffer());
      const isPdf = buf.slice(0, 5).toString() === '%PDF-';
      console.log(`  plain fetch of the document: HTTP ${r.status} · ${(buf.length / 1024).toFixed(0)} KB · ${isPdf ? 'a real PDF' : 'NOT a PDF'}`);
      console.log(`  content-type: ${r.headers.get('content-type')}`);
    } catch (ex) {
      console.log(`  plain fetch of the document failed: ${ex.message}`);
    }
  }
}
await browser.close();
