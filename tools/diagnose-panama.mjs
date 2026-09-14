// Where can Panama's back catalogue actually be read?
//
// Settled: the registry's media library reaches back only to August 2025 for
// MMCs, the authority's holds a dozen, and /circulars/ is a 404 on both — the
// page the app links to for checking against the source no longer exists.
// That is why the catalogue holds 64, and it is not a search bug.
//
// So this looks at the two places suggested instead. One is a consulate, which
// is an arm of the registry; the other is a third-party aggregator. Counting
// what each holds is the first question. Where each document is actually
// served from is the second, and matters more: an index worth using may still
// be an index that points back at Panama's own servers, which is where a
// document anyone might rely on ought to come from.
//
// Reads only.

const SOURCES = [
  ['consulate', 'https://www.panamaconsulate.gr/gr/en/articles/updated-merchant-marine-circulars-january-2026'],
  ['flagadmin', 'https://flagadmin.com/en/tsirkulyari-ot-panami']
];

const BROWSERISH = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-GB,en;q=0.9'
};

const refOf = (t) => (String(t || '').match(/\b(MMC|MMN)\b[\s\-–—_]*(\d{1,4})/i) || []).slice(1).join(' ').toUpperCase();

for (const [name, url] of SOURCES) {
  console.log(`\n${'='.repeat(72)}\n${name}: ${url}`);
  let html;
  try {
    const r = await fetch(url, { headers: BROWSERISH, redirect: 'follow' });
    html = await r.text();
    console.log(`  HTTP ${r.status} · ${(html.length / 1024).toFixed(0)} KB`);
    if (!r.ok) continue;
  } catch (ex) { console.log(`  failed: ${ex.message}`); continue; }

  const links = [...new Set([...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]))]
    .map((h) => { try { return new URL(h, url).href; } catch { return ''; } })
    .filter(Boolean);
  const pdfs = links.filter((h) => /\.pdf(\?|$)/i.test(h));
  console.log(`  ${links.length} links · ${pdfs.length} PDFs`);

  // Which of them name a circular, and how many distinct ones.
  const refs = new Map();
  for (const h of pdfs) {
    const ref = refOf(decodeURIComponent(h.split('/').pop() || ''));
    if (ref) refs.set(ref, h);
  }
  // The page text often names circulars the links do not.
  const text = html.replace(/<[^>]+>/g, ' ');
  const named = new Set([...text.matchAll(/\b(MMC|MMN)\b[\s\-–—_]*(\d{1,4})/gi)]
    .map((m) => `${m[1].toUpperCase()} ${m[2]}`));
  console.log(`  ${refs.size} circulars linked as PDFs · ${named.size} named anywhere on the page`);

  // Where the documents are served from decides whether this is an index
  // worth following or a copy worth being wary of.
  const hosts = {};
  for (const h of refs.values()) {
    const host = new URL(h).host;
    hosts[host] = (hosts[host] || 0) + 1;
  }
  console.log('  documents served from:');
  for (const [host, n] of Object.entries(hosts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${host}`);
  }
  const sample = [...refs.entries()].slice(0, 5);
  for (const [ref, h] of sample) console.log(`    ${ref.padEnd(8)} ${h.slice(0, 110)}`);

  const numbers = [...refs.keys()].map((r) => Number(r.split(' ')[1])).filter(Boolean).sort((a, b) => a - b);
  if (numbers.length) console.log(`  numbers run ${numbers[0]} → ${numbers[numbers.length - 1]}`);
}
