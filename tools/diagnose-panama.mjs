// Where does Panama list its circulars now?
//
// /circulars/ is a 404 on both hosts, and the app's check-against-the-source
// button still points at it. The sitemap attempt told me nothing — it reported
// no candidates without saying whether there was a sitemap at all, which is a
// probe that cannot distinguish "nothing matched" from "nothing was read".
//
// So: ask WordPress for its own pages, and read the homepage's navigation.
// Both are the site listing its pages rather than me guessing at paths.
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
const LIKELY = /circular|notice|mmc|mmn|merchant.marine|download|resource|publication/i;

async function get(url) {
  try {
    const r = await fetch(url, { headers: BROWSERISH, redirect: 'follow' });
    return { ok: r.ok, status: r.status, body: await r.text() };
  } catch (ex) { return { ok: false, status: 0, why: ex.message, body: '' }; }
}

for (const [name, host] of HOSTS) {
  console.log(`\n${'='.repeat(72)}\n${name}: ${host}`);

  // 1. Is there a sitemap at all? Say so either way this time.
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/robots.txt']) {
    const r = await get(host + path);
    const locs = (r.body.match(/<loc>/gi) || []).length;
    const maps = (r.body.match(/[Ss]itemap:\s*\S+/g) || []).map((s) => s.split(/\s+/)[1]);
    console.log(`  ${path.padEnd(20)} [${r.status}] ${(r.body.length / 1024).toFixed(0)} KB`
      + (locs ? ` · ${locs} <loc> entries` : '')
      + (maps.length ? ` · names ${maps.join(', ')}` : ''));
  }

  // 2. WordPress listing its own pages — the registry runs on it.
  for (const kind of ['pages', 'posts']) {
    for (const search of ['circular', 'merchant marine', '']) {
      const url = `${host}/wp-json/wp/v2/${kind}?per_page=100&_fields=link,title`
        + (search ? `&search=${encodeURIComponent(search)}` : '');
      const r = await get(url);
      if (!r.ok) { console.log(`  wp/${kind} ${JSON.stringify(search).padEnd(18)} → HTTP ${r.status}`); continue; }
      let items = [];
      try { items = JSON.parse(r.body); } catch { console.log(`  wp/${kind} ${JSON.stringify(search).padEnd(18)} → not JSON`); continue; }
      const hits = items.filter((i) => LIKELY.test(i.link || '') || LIKELY.test(i.title?.rendered || ''));
      console.log(`  wp/${kind} ${JSON.stringify(search).padEnd(18)} → ${String(items.length).padStart(3)} items · ${hits.length} look relevant`);
      for (const h of hits.slice(0, 8)) {
        console.log(`      ${String(h.title?.rendered || '').replace(/<[^>]+>/g, '').slice(0, 60).padEnd(62)} ${h.link}`);
      }
    }
  }

  // 3. What the site's own menu offers.
  const home = await get(host + '/');
  if (home.ok) {
    const links = [...new Set([...home.body.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]))]
      .map((h) => { try { return new URL(h, host).href; } catch { return ''; } })
      .filter((h) => h.startsWith(host) && LIKELY.test(h));
    console.log(`  homepage menu → ${links.length} link(s) that might be it`);
    for (const l of links.slice(0, 12)) console.log(`      ${l}`);
  } else {
    console.log(`  homepage → HTTP ${home.status}`);
  }
}
