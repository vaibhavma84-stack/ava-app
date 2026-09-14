// Is the circular in the detail page's markup, or only the menu around it?
//
// There is no per-item API — four shapes, all 404. The detail page serves
// 236 KB of markup and 6,689 characters of text, but the opening of that text
// is MPA's site menu ("Who We Are", "Whistleblowing Channel"), and 6,689
// characters of navigation is entirely plausible. So this looks past the menu:
// it hunts the markup for the circular's own words, names whichever container
// holds them, and prints what is in it.
//
// If the words are there, 565 notices can be held for the cost of 565 plain
// fetches. If they are not, the page is drawn by script and the only way in is
// a browser, 565 times — worth knowing before spending it.
//
// Reads only. Downloads nothing, commits nothing.

import { textFromHtml } from './mirror-docs.mjs';

const MPA = 'https://www.mpa.gov.sg';
const LIST = '63fc1321-c383-4bc1-8cda-a7718c8eb28c';

const first = await fetch(`${MPA}/api/items/media_releases_and_circulars?type=${LIST}&year=All&limit=3&page=1`)
  .then((r) => r.json());
const items = Array.isArray(first) ? first : first?.data || first?.items || [];

for (const item of items.slice(0, 2)) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(String(item.title).slice(0, 90));

  const html = await fetch(`${MPA}/media-centre/details/${item.slug}`).then((r) => r.text());
  console.log(`  markup ${(html.length / 1024).toFixed(1)} KB · text ${textFromHtml(html).length} characters`);

  // Containers a CMS usually puts the body in.
  const containers = [
    ['<main', /<main\b[^>]*>([\s\S]*?)<\/main>/i],
    ['role="main"', /<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/\w+>/i],
    ['<article', /<article\b[^>]*>([\s\S]*?)<\/article>/i],
    ['class~=content', /<div[^>]+class=["'][^"']*(?:content-body|rte|rich-text|article-body|cms-content|detail-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i]
  ];
  for (const [label, re] of containers) {
    const found = html.match(re);
    console.log(`  ${label.padEnd(14)} ${found ? `${textFromHtml(found[1]).length} characters of text` : 'not found'}`);
  }

  // The decisive test: does any of the circular's own language appear in the
  // markup at all, outside the <title>? Take distinctive words from the title.
  const words = String(item.title)
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 5 && !/^(RESOLUTIONS|CIRCULAR|NOTICE|MARINE)$/i.test(w))
    .slice(0, 4);
  console.log(`  looking for: ${words.join(', ')}`);
  const body = html.replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<head>[\s\S]*?<\/head>/i, '');
  for (const w of words) {
    const count = (body.match(new RegExp(w, 'gi')) || []).length;
    console.log(`    "${w}" appears ${count} time(s) in the body markup`);
  }

  // And the tail of the page text, which is where the body would sit if the
  // menu comes first.
  const text = textFromHtml(html);
  const lines = text.split('\n').filter((l) => l.trim().length > 30);
  console.log('  --- the 12 longest lines of the page text ---');
  for (const line of lines.sort((a, b) => b.length - a.length).slice(0, 12)) {
    console.log(`    | ${line.slice(0, 150)}`);
  }
}
