// Where does Panama list its circulars now?
//
// The app's "check against the source" button points at /circulars/, which is
// a 404 on both the registry and the authority. A button that sends you to a
// missing page to verify a notice is worse than no button, so this finds the
// page that exists — from the site's own sitemap, which is the site saying
// where its pages are rather than me guessing.
//
// Reads only.

const HOSTS = [
  ['registry', 'https://www.panamashipregistry.com'],
  ['authority', 'https://www.amp.gob.pa']
];

const BROWSERISH = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

const LIKELY = /circular|notice|mmc|mmn|merchant.marine|download|resource|publication|regulation/i;

async function get(url) {
  try {
    const r = await fetch(url, { headers: BROWSERISH, redirect: 'follow' });
    return { ok: r.ok, status: r.status, url: r.url, body: await r.text() };
  } catch (ex) { return { ok: false, status: 0, why: ex.message, body: '' }; }
}

/** A sitemap, or an index of sitemaps — follow one level down. */
async function fromSitemap(host) {
  const found = new Set();
  const seen = new Set();
  const queue = [`${host}/sitemap.xml`, `${host}/sitemap_index.xml`, `${host}/wp-sitemap.xml`];

  while (queue.length && seen.size < 12) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await get(url);
    if (!r.ok) continue;
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    for (const loc of locs) {
      if (/\.xml(\?|$)/i.test(loc)) {
        // A sitemap of sitemaps: only follow the ones that might hold pages.
        if (queue.length < 10 && !/image|media|attachment/i.test(loc)) queue.push(loc);
      } else if (LIKELY.test(loc)) {
        found.add(loc);
      }
    }
  }
  return [...found];
}

for (const [name, host] of HOSTS) {
  console.log(`\n${'='.repeat(72)}\n${name}: ${host}`);

  const pages = await fromSitemap(host);
  console.log(`  sitemap named ${pages.length} page(s) that might be it`);
  for (const p of pages.slice(0, 25)) console.log(`    ${p}`);

  // Each candidate, opened and weighed by whether it actually names circulars.
  console.log('\n  what each one holds:');
  for (const url of pages.slice(0, 12)) {
    const r = await get(url);
    if (!r.ok) { console.log(`    [${r.status}] ${url.replace(host, '')}`); continue; }
    const text = r.body.replace(/<[^>]+>/g, ' ');
    const named = new Set([...text.matchAll(/\b(MMC|MMN)\b[\s\-–—_]*(\d{1,4})/gi)]
      .map((m) => `${m[1].toUpperCase()} ${m[2]}`));
    const pdfs = [...new Set((r.body.match(/https?:\/\/[^"'\s]+\.pdf/gi) || []))];
    console.log(`    [${r.status}] ${String(named.size).padStart(4)} circulars named · ${String(pdfs.length).padStart(4)} PDF links · ${url.replace(host, '')}`);
  }
}
