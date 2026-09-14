// How many circulars does Panama actually publish?
//
// The catalogue holds 64: 34 MMCs and 30 MMNs, none older than 2019. The
// registry has been issuing them for decades and MMC numbers run past 300, so
// 64 is very unlikely to be all of them.
//
// The reader asks the WordPress media library for "MMC-" and "MMN-". Titles
// there are written "MMC 270 – 03 09 2026", with a space, and only the file
// name carries the hyphen — so a search for the hyphenated form may be finding
// whatever WordPress happens to match rather than the catalogue.
//
// This counts what is there: the whole media library paged through, several
// search terms compared, and the circulars page read for links. Reads only.
//
//   node tools/diagnose-panama.mjs

const HOSTS = [
  ['registry', 'https://www.panamashipregistry.com'],
  ['authority', 'https://www.amp.gob.pa']
];

const isCircular = (text) => /\b(MMC|MMN)\b[\s\-–—]*\d/i.test(String(text || ''));
const refOf = (text) => (String(text || '').match(/\b(MMC|MMN)\b[\s\-–—]*(\d+)/i) || []).slice(1).join(' ');

async function media(host, { search = '', pages = 12 } = {}) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const url = `${host}/wp-json/wp/v2/media?media_type=application&per_page=100&page=${page}`
      + (search ? `&search=${encodeURIComponent(search)}` : '')
      + '&orderby=date&order=desc&_fields=title,slug,date,source_url';
    let batch;
    try {
      const r = await fetch(url);
      if (!r.ok) { if (page === 1) return { error: `HTTP ${r.status}`, items: [] }; break; }
      batch = await r.json();
    } catch (ex) { if (page === 1) return { error: ex.message, items: [] }; break; }
    if (!Array.isArray(batch) || !batch.length) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return { items: out };
}

for (const [name, host] of HOSTS) {
  console.log(`\n${'='.repeat(70)}\n${name}: ${host}`);

  for (const search of ['MMC-', 'MMN-', 'MMC', 'MMN', 'circular', '']) {
    const got = await media(host, { search, pages: search ? 6 : 12 });
    if (got.error) { console.log(`  search ${JSON.stringify(search).padEnd(11)} → ${got.error}`); continue; }
    const pdfs = got.items.filter((i) => /\.pdf$/i.test(i.source_url || ''));
    const circulars = pdfs.filter((i) => isCircular(i.title?.rendered) || isCircular(i.slug));
    const refs = new Set(circulars.map((i) => refOf(i.title?.rendered) || refOf(i.slug)).filter(Boolean));
    const dates = circulars.map((i) => String(i.date || '').slice(0, 10)).filter(Boolean).sort();
    console.log(`  search ${JSON.stringify(search).padEnd(11)} → ${String(got.items.length).padStart(4)} media ·`
      + ` ${String(pdfs.length).padStart(4)} PDFs · ${String(circulars.length).padStart(4)} look like circulars ·`
      + ` ${String(refs.size).padStart(4)} distinct refs`
      + (dates.length ? ` · ${dates[0]} → ${dates[dates.length - 1]}` : ''));
  }

  // And the page a person would actually open.
  try {
    const r = await fetch(`${host}/circulars/`);
    const html = await r.text();
    const links = [...new Set((html.match(/https?:\/\/[^"'\s]+\.pdf/gi) || []))];
    const circulars = links.filter(isCircular);
    console.log(`  /circulars/ → HTTP ${r.status} · ${(html.length / 1024).toFixed(0)} KB · ${links.length} PDF links · ${circulars.length} look like circulars`);
    circulars.slice(0, 3).forEach((u) => console.log(`      ${u}`));
  } catch (ex) { console.log(`  /circulars/ → ${ex.message}`); }
}
