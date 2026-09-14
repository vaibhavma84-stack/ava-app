// The circular is in the page after all — just not where markup usually keeps it.
//
// Rendering one detail page and logging every request showed no content
// endpoint at all: the only response carrying the notice was the page itself.
// The _next/ chunks and ?_rsc= requests say what kind of page it is — Next.js,
// App Router — and that kind ships its content inside the React payload,
// in self.__next_f.push([1,"…"]) chunks, rather than in <main>. Which is why
// <main> measured 384 characters while the notice's own words appeared
// fourteen times in the same markup.
//
// If that payload can be unpacked from a plain fetch, Singapore costs 565
// ordinary requests and no browser at all. This is that test.
//
// Reads only.

import { textFromHtml } from './mirror-docs.mjs';

const MPA = 'https://www.mpa.gov.sg';
const LISTS = [
  ['Shipping Circulars', '63fc1321-c383-4bc1-8cda-a7718c8eb28c'],
  ['Port Marine Circulars', '0b4c161c-92d5-475e-8a41-51e096406f74'],
  ['Port Marine Notices', '2b89298e-3d17-4bf2-8275-9079e84f63d0']
];

/** Put the React payload back together and take the words out of it. */
export function textFromNextPage(html) {
  // Each chunk is a JSON string literal in a push() call. Parsing them as JSON
  // is what turns \\n and \\" back into the characters they stand for.
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try { chunks.push(JSON.parse(m[1])); } catch { /* a chunk that will not parse is not the body */ }
  }
  const flight = chunks.join('');
  if (!flight) return '';

  // Inside the payload the body is HTML in string fields. Take every run of
  // markup long enough to be prose rather than a class name.
  const html_bits = flight.match(/<(?:p|div|table|ul|ol|h[1-6])\b[\s\S]{80,}?<\/(?:p|div|table|ul|ol|h[1-6])>/g) || [];
  const text = textFromHtml(html_bits.join('\n'));
  return text;
}

for (const [name, id] of LISTS) {
  const list = await fetch(`${MPA}/api/items/media_releases_and_circulars?type=${id}&year=All&limit=2&page=1`)
    .then((r) => r.json());
  const items = Array.isArray(list) ? list : list?.data || list?.items || [];

  for (const item of items.slice(0, 1)) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${name}: ${String(item.title).slice(0, 80)}`);
    const html = await fetch(`${MPA}/media-centre/details/${item.slug}`).then((r) => r.text());
    const text = textFromNextPage(html);
    console.log(`  plain fetch: ${(html.length / 1024).toFixed(0)} KB of markup → ${text.length} characters of notice`);
    console.log('  ---8<---');
    console.log(text.slice(0, 1100).split('\n').filter((l) => l.trim()).slice(0, 22).map((l) => '  | ' + l).join('\n'));
    console.log('  ---8<---');

    const pdfs = [...new Set((html.match(/https?:\/\/[^"'\\\s]+\.pdf/gi) || []))];
    console.log(`  PDFs linked from it: ${pdfs.length}`);
    pdfs.slice(0, 3).forEach((u) => console.log(`    ${u}`));
  }
}
