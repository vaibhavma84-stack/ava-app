// What MPA actually sends with each circular.
//
// 565 Singapore notices are listed and none is held, because MPA publishes a
// circular as a page rather than a file. The list endpoint already returns a
// main_content field, and the reader uses it only to hunt for a PDF link
// before discarding it — so the question is whether that field holds the
// circular itself or merely a summary of it.
//
// Reads one page of each list and reports what is in it. Downloads nothing.
//
//   node tools/diagnose-mpa.mjs

import { textFromHtml } from './mirror-docs.mjs';

const MPA = 'https://www.mpa.gov.sg';
const LISTS = [
  { name: 'Shipping Circulars', id: '63fc1321-c383-4bc1-8cda-a7718c8eb28c' },
  { name: 'Port Marine Circulars', id: '0b4c161c-92d5-475e-8a41-51e096406f74' },
  { name: 'Port Marine Notices', id: '2b89298e-3d17-4bf2-8275-9079e84f63d0' }
];

const api = (id, page, limit) =>
  `${MPA}/api/items/media_releases_and_circulars?type=${id}&year=All&limit=${limit}&page=${page}`;

for (const list of LISTS) {
  console.log(`\n=== ${list.name} ===`);
  let body;
  try {
    const r = await fetch(api(list.id, 1, 10));
    if (!r.ok) { console.log(`  HTTP ${r.status}`); continue; }
    body = await r.json();
  } catch (ex) { console.log(`  failed: ${ex.message}`); continue; }

  const items = Array.isArray(body) ? body
    : body?.data || body?.items || body?.results || body?.records || [];
  if (!items.length) { console.log('  nothing returned'); continue; }

  console.log(`  fields on an item: ${Object.keys(items[0]).join(', ')}`);

  const lengths = [];
  for (const item of items) {
    const html = typeof item.main_content === 'string' ? item.main_content : '';
    lengths.push(textFromHtml(html).length);
  }
  lengths.sort((a, b) => a - b);
  const has = lengths.filter((n) => n > 0).length;
  const real = lengths.filter((n) => n > 400).length;
  console.log(`  ${has} of ${items.length} carry main_content · ${real} longer than 400 characters`);
  console.log(`  shortest ${lengths[0]} · median ${lengths[Math.floor(lengths.length / 2)]} · longest ${lengths[lengths.length - 1]}`);

  // The longest one, to see whether it reads as the circular or as a blurb.
  let best = items[0];
  for (const item of items) {
    if (textFromHtml(item.main_content || '').length > textFromHtml(best.main_content || '').length) best = item;
  }
  const text = textFromHtml(best.main_content || '');
  console.log(`\n  longest item: ${String(best.title || '').slice(0, 80)}`);
  console.log('  ---8<--- first 700 characters of its text ---8<---');
  console.log(text.slice(0, 700).split('\n').map((l) => '  | ' + l).join('\n'));
  console.log('  ---8<--- end ---8<---');

  // And whether an annex is linked from inside it.
  const pdfs = (best.main_content || '').match(/href=["']([^"']+\.pdf[^"']*)["']/gi) || [];
  console.log(`  PDF links inside that one: ${pdfs.length}`);
}
