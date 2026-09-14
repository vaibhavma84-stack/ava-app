// Where MPA keeps the body of a circular.
//
// The list endpoint's main_content turned out to be a fifty-character header —
// "PORT MARINE NOTICE / NO. 112 OF 2026 / 14 Sep 2026" — and not the circular
// at all. So the text is somewhere else, and this asks where: the per-item API
// if there is one, the detail page's own markup, and whatever that markup
// holds once the tags are gone.
//
// Reads only. Downloads nothing, commits nothing.
//
//   node tools/diagnose-mpa.mjs

import { textFromHtml } from './mirror-docs.mjs';

const MPA = 'https://www.mpa.gov.sg';
const LIST = '63fc1321-c383-4bc1-8cda-a7718c8eb28c';   // Shipping Circulars

const show = (label, text) => {
  console.log(`\n  ${label} — ${text.length} characters`);
  if (!text.length) return;
  console.log(text.slice(0, 600).split('\n').slice(0, 14).map((l) => '  | ' + l).join('\n'));
};

async function tryJson(url) {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    const type = r.headers.get('content-type') || '';
    const body = await r.text();
    if (!/json/i.test(type)) return { ok: false, why: `content-type ${type.split(';')[0]}` };
    return { ok: true, json: JSON.parse(body), raw: body };
  } catch (ex) { return { ok: false, why: ex.message }; }
}

const first = await fetch(`${MPA}/api/items/media_releases_and_circulars?type=${LIST}&year=All&limit=3&page=1`)
  .then((r) => r.json());
const items = Array.isArray(first) ? first : first?.data || first?.items || [];
const item = items[0];
if (!item) { console.log('no items came back'); process.exit(1); }

console.log(`Asking about: ${String(item.title).slice(0, 80)}`);
console.log(`  id   : ${item.id}`);
console.log(`  slug : ${item.slug}`);

// 1. A per-item endpoint, the cheapest thing if it exists.
console.log('\n=== per-item API ===');
for (const url of [
  `${MPA}/api/items/media_releases_and_circulars/${item.id}`,
  `${MPA}/api/items/media_releases_and_circulars?id=${item.id}`,
  `${MPA}/api/items/media_releases_and_circulars/${item.slug}`,
  `${MPA}/api/item/media_releases_and_circulars/${item.id}`
]) {
  const got = await tryJson(url);
  if (!got.ok) { console.log(`  ${url.replace(MPA, '')} → ${got.why}`); continue; }
  const body = Array.isArray(got.json) ? got.json[0] : got.json?.data || got.json;
  const keys = body && typeof body === 'object' ? Object.keys(body).join(', ') : '(not an object)';
  console.log(`  ${url.replace(MPA, '')} → OK · fields: ${keys}`);
  for (const key of ['content', 'body', 'main_content', 'description', 'details']) {
    const v = body?.[key];
    if (typeof v === 'string' && v.length > 100) show(`${key} from that endpoint`, textFromHtml(v));
  }
}

// 2. The detail page itself. Drawn by script, so the served markup may be a
//    shell — but the words are often embedded in it for search engines.
console.log('\n=== the detail page ===');
const pageUrl = `${MPA}/media-centre/details/${item.slug}`;
try {
  const r = await fetch(pageUrl);
  const html = await r.text();
  console.log(`  ${pageUrl.replace(MPA, '')} → HTTP ${r.status}, ${(html.length / 1024).toFixed(1)} KB of markup`);
  show('the page, as text', textFromHtml(html));

  // Script-drawn sites usually ship their state in a script tag.
  for (const re of [
    /<script[^>]+application\/json[^>]*>([\s\S]*?)<\/script>/i,
    /__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/i,
    /window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/i
  ]) {
    const found = html.match(re);
    if (!found) continue;
    console.log(`  embedded state found: ${found[1].length} characters`);
    const hit = found[1].match(/"(?:content|main_content|body)"\s*:\s*"((?:[^"\\]|\\.){400,})"/);
    if (hit) show('content inside the embedded state', textFromHtml(JSON.parse(`"${hit[1]}"`)));
    break;
  }
  const pdfs = [...new Set((html.match(/https?:\/\/[^"']+\.pdf[^"']*/gi) || []))];
  console.log(`  PDF links on the page: ${pdfs.length}`);
  pdfs.slice(0, 3).forEach((u) => console.log(`    ${u}`));
} catch (ex) {
  console.log(`  failed: ${ex.message}`);
}
