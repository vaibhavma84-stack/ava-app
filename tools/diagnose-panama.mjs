// Confirm the pages before wiring any of them into a button.
//
// WordPress named these itself. I sent one unverified URL today already and it
// was a 404, so each is opened here and weighed by what it actually holds
// before it goes anywhere near the app.
//
// Reads only.

const PANAMA = 'https://www.panamashipregistry.com';
const CANDIDATES = [
  '/segumar/merchant-marine-circulars/',
  '/segumar/merchant-marine-circulars/marine-notices/',
  '/segumar/merchant-marine-circulars/cancelled-2/',
  '/segumar/merchant-marine-circulars/psc-current/',
  '/segumar/offshore-mmcs/',
  '/circulars-e-book/',
  '/document-category/circulars/'
];

const BROWSERISH = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

for (const path of CANDIDATES) {
  let r;
  try { r = await fetch(PANAMA + path, { headers: BROWSERISH, redirect: 'follow' }); }
  catch (ex) { console.log(`[--] ${path} → ${ex.message}`); continue; }
  const html = await r.text();
  const text = html.replace(/<[^>]+>/g, ' ');
  const named = new Set([...text.matchAll(/\b(MMC|MMN)\b[\s\-–—_]*(\d{1,4})/gi)]
    .map((m) => `${m[1].toUpperCase()} ${m[2]}`));
  const pdfs = [...new Set((html.match(/https?:\/\/[^"'\s]+\.pdf/gi) || []))];
  const mine = pdfs.filter((u) => u.includes('panamashipregistry.com'));
  const missing = /page not found|404|no encontrada/i.test(text.slice(0, 4000));
  console.log(`[${r.status}] ${String(named.size).padStart(4)} circulars named · ${String(pdfs.length).padStart(4)} PDFs (${mine.length} Panama's own)`
    + `${missing ? ' · LOOKS LIKE A 404 PAGE' : ''}  ${path}`);
  const nums = [...named].map((n) => Number(n.split(' ')[1])).filter(Boolean).sort((a, b) => a - b);
  if (nums.length) console.log(`       numbers ${nums[0]} → ${nums[nums.length - 1]}`);
}

// The document category hints at a custom post type, which WordPress will list
// far more completely than a page of links ever could.
console.log('\nwp/v2 types that might hold the documents:');
try {
  const types = await fetch(`${PANAMA}/wp-json/wp/v2/types`, { headers: BROWSERISH }).then((x) => x.json());
  for (const [name, t] of Object.entries(types || {})) {
    console.log(`  ${name.padEnd(22)} rest_base=${t?.rest_base || '-'}`);
  }
} catch (ex) { console.log(`  failed: ${ex.message}`); }
