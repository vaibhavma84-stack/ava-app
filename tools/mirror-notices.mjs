// Fetch the notice catalogues on a server, and commit them beside the app.
//
// CORS is a rule browsers apply; a server has no such restriction. MPA refuses
// the app outright — its feed and all three of its listing pages — so there is
// no arrangement of requests from an iPhone that will ever read it. Read from
// here instead, where nothing is blocking, and write the result into the site.
// The phone then reads its own origin, which needs no one's permission.
//
// This costs the ship nothing extra. The mirror is already parsed, so it is a
// fraction of the data of scraping three pages of markup, and it is one
// request rather than four. It is still only fetched when the button is
// tapped.
//
// Run: node tools/mirror-notices.mjs [--only=Singapore] [--out=library/data]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MPA, SG_TYPES, PANAMA_TYPES, MCA_TYPES,
  singaporeRef, panamaRef,
  parseGovukCollection, parseWpMedia
} from '../library/js/updates.js';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const decode = (s) => clean(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#3[92];/g, "'").replace(/&nbsp;/g, ' ')
  .trim();

const isoDay = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
};

// ---------------------------------------------------------------------------
// Reading markup without a DOM.
//
// The browser has DOMParser; Node does not, and pulling in a parser would put
// a dependency into a project that has none. These two readers are deliberately
// blunt — they are fed a feed and a page of links, not arbitrary documents.
// ---------------------------------------------------------------------------

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};

export function readFeed(xml, { refOf, types }) {
  const out = [];
  const blocks = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const title = tag(block, 'title');
    const ref = refOf(title);
    if (!ref) continue;

    // RSS puts the URL in the element's text; Atom puts it in an href.
    const href = tag(block, 'link')
      || (block.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || '';

    out.push({
      title,
      refNo: ref.refNo,
      docType: types[ref.prefix] || '',
      date: isoDay(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')),
      sourceUrl: href
    });
  }
  return out;
}

export function readLinks(html, { base, match, refOf, types }) {
  const out = [];
  const anchors = String(html).match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const anchor of anchors) {
    const raw = (anchor.match(/href=["']([^"']+)["']/i) || [])[1];
    let href;
    try { href = new URL(raw, base).href; } catch { continue; }
    if (!match.test(href)) continue;

    const text = decode(anchor.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, ''));
    const ref = refOf(text) || refOf(href);
    if (!ref) continue;
    out.push({ title: text || ref.refNo, refNo: ref.refNo, docType: types[ref.prefix] || '', date: '', sourceUrl: href });
  }
  return out;
}

// ---------------------------------------------------------------------------

const GOVUK = 'https://www.gov.uk';
const PANAMA = 'https://www.panamashipregistry.com';
const PANAMA_AMP = 'https://www.amp.gob.pa';

const wpMedia = (host, search, page) =>
  `${host}/wp-json/wp/v2/media?media_type=application&per_page=100&page=${page}`
  + `&search=${encodeURIComponent(search)}`
  + '&orderby=date&order=desc&_fields=title,slug,date,date_gmt,source_url';

async function get(url, as) {
  const response = await fetch(url, { headers: { 'user-agent': 'ava-library-mirror' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return as === 'json' ? response.json() : response.text();
}

/** Walk a WordPress search until a page comes back short. */
async function wpAll(host, search) {
  const found = [];
  for (let page = 1; page <= 6; page++) {
    let batch;
    try { batch = await get(wpMedia(host, search, page), 'json'); }
    catch { break; }          // a page past the end is an error, not an empty list
    if (!Array.isArray(batch) || !batch.length) break;
    found.push(...parseWpMedia(batch));
    if (batch.length < 100) break;
  }
  return found;
}

/** Each source reports what it managed, so a bad day is visible in the log. */
const SOURCES = {
  MCA: async () => {
    const slugs = [
      'merchant-shipping-notices-msns',
      'active-marine-guidance-notes-mgns',
      'marine-guidance-notices-mgns',
      'marine-information-notes-mins'
    ];
    const found = [];
    for (const slug of slugs) {
      try {
        found.push(...parseGovukCollection(await get(`${GOVUK}/api/content/government/collections/${slug}`, 'json')));
      } catch (ex) { console.warn(`  MCA ${slug}: ${ex.message}`); }
    }
    return found;
  },

  Panama: async () => {
    const found = [];
    for (const host of [PANAMA, PANAMA_AMP]) {
      for (const search of ['MMC-', 'MMN-']) {
        try { found.push(...await wpAll(host, search)); }
        catch (ex) { console.warn(`  Panama ${host} ${search}: ${ex.message}`); }
      }
    }
    return found;
  },

  Singapore: async () => {
    const found = [];
    const shape = { refOf: singaporeRef, types: SG_TYPES };

    try {
      found.push(...readFeed(await get(`${MPA}/feeds/media-releases`, 'text'), shape));
    } catch (ex) { console.warn(`  Singapore feed: ${ex.message}`); }

    const listings = ['Shipping+Circulars', 'Port+Marine+Circulars', 'Port+Marine+Notices'];
    for (const type of listings) {
      try {
        found.push(...readLinks(await get(`${MPA}/media-centre?type=${type}`, 'text'), {
          base: MPA, match: /\/(media-centre\/details|docs\/mpalibraries)\//i, ...shape
        }));
      } catch (ex) { console.warn(`  Singapore ${type}: ${ex.message}`); }
    }
    return found;
  }
};

/** Newest first, one entry per reference. */
function tidy(notices) {
  const seen = new Set();
  return notices
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .filter((n) => {
      const key = (n.refNo || n.sourceUrl || n.title).toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function main() {
  const args = process.argv.slice(2);
  const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  const out = (args.find((a) => a.startsWith('--out=')) || '').split('=')[1] || 'library/data';
  mkdirSync(out, { recursive: true });

  let failed = 0;
  for (const [admin, read] of Object.entries(SOURCES)) {
    if (only && only !== admin) continue;
    process.stdout.write(`${admin}: `);

    let notices = [];
    try { notices = tidy(await read()); }
    catch (ex) { console.log(`failed — ${ex.message}`); failed++; continue; }

    const file = join(out, `${admin.toLowerCase()}.json`);

    // An empty read means the source changed shape or was down. Keeping the
    // last good copy is better than publishing nothing to the ship.
    if (!notices.length) {
      console.log(existsSync(file) ? 'nothing read — keeping the last copy' : 'nothing read');
      failed++;
      continue;
    }

    // Only the notices decide whether the file changed; a timestamp that moves
    // every run would commit noise every week.
    const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const same = previous && JSON.stringify(previous.notices) === JSON.stringify(notices);
    if (same) { console.log(`${notices.length} documents, unchanged`); continue; }

    writeFileSync(file, JSON.stringify({
      administration: admin,
      fetched: new Date().toISOString().slice(0, 10),
      notices
    }, null, 1) + '\n');
    console.log(`${notices.length} documents`);
  }

  // A source being down should not fail the run and leave the site unbuilt.
  if (failed) console.log(`\n${failed} source(s) gave nothing this run; their last copies stand.`);
}

// Importable for tests; only fetches when run directly.
if (process.argv[1] && process.argv[1].endsWith('mirror-notices.mjs')) {
  main().catch((ex) => { console.error(ex); process.exit(1); });
}
