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

    let fromFeed = 0;
    try {
      const items = readFeed(await get(`${MPA}/feeds/media-releases`, 'text'), shape);
      fromFeed = items.length;
      found.push(...items);
    } catch (ex) { console.warn(`  Singapore feed: ${ex.message}`); }

    // The listing pages come back as an empty shell — MPA draws its links with
    // script, so fetching the markup finds nothing in it. Kept anyway, because
    // it costs one request and would start working the day they render on the
    // server; the browser pass below is what actually reads them.
    let fromMarkup = 0;
    for (const type of SG_LISTINGS) {
      try {
        const items = readLinks(await get(`${MPA}/media-centre?type=${type}`, 'text'), {
          base: MPA, match: SG_LINK, ...shape
        });
        fromMarkup += items.length;
        found.push(...items);
      } catch (ex) { console.warn(`  Singapore ${type}: ${ex.message}`); }
    }

    // The endpoint behind the listings, read directly. This is where the bulk
    // of the catalogue comes from.
    let fromApi = 0;
    const seenShape = new Set();
    for (const list of SG_LISTS) {
      const items = await readSgList(list, shape, seenShape);
      fromApi += items.length;
      found.push(...items);
    }

    // Only if the endpoint gave nothing: rendering is slower and thinner, but
    // it is what found the endpoint in the first place and would find its
    // replacement.
    const fromBrowser = fromApi ? 0 : await renderSingapore(found, shape);
    console.log(`  [feed ${fromFeed}, markup ${fromMarkup}, api ${fromApi}, rendered ${fromBrowser}]`);
    return found;
  }
};

const SG_LISTINGS = ['Shipping+Circulars', 'Port+Marine+Circulars', 'Port+Marine+Notices'];
const SG_LINK = /\/(media-centre\/details|docs\/mpalibraries)\//i;

/**
 * What actually feeds MPA's media centre.
 *
 * Rendering the listings in a browser worked, but only returned ten items —
 * which was the page size, not the catalogue. Logging what the rendered page
 * requested gave up the endpoint behind it, and these three type ids with it.
 * A listing drawn by script is being fed by something; this is that something,
 * and it can be read with a plain fetch.
 */
const SG_LISTS = [
  { name: 'Shipping Circulars', id: '63fc1321-c383-4bc1-8cda-a7718c8eb28c' },
  { name: 'Port Marine Circulars', id: '0b4c161c-92d5-475e-8a41-51e096406f74' },
  { name: 'Port Marine Notices', id: '2b89298e-3d17-4bf2-8275-9079e84f63d0' }
];

const sgApi = (id, page, limit) =>
  `${MPA}/api/items/media_releases_and_circulars`
  + `?type=${id}&year=All&limit=${limit}&page=${page}`;

const firstOf = (item, keys) => {
  for (const key of keys) {
    const value = item?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

/**
 * Read one of MPA's listings from its own endpoint.
 *
 * The reply's shape is not documented anywhere, so the fields are looked for
 * by the names such a thing usually uses, and the keys of the first item are
 * logged once. If a run comes back thin, the log says what it was actually
 * given rather than leaving it to guesswork.
 */
async function readSgList({ name, id }, shape, seenShape) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    let body;
    try { body = await get(sgApi(id, page, 100), 'json'); }
    catch (ex) { if (page === 1) console.warn(`  Singapore ${name}: ${ex.message}`); break; }

    const items = Array.isArray(body) ? body
      : body?.data || body?.items || body?.results || body?.records || [];
    if (!Array.isArray(items) || !items.length) break;

    if (!seenShape.has(name)) {
      seenShape.add(name);
      console.log(`  ${name} fields: ${Object.keys(items[0] || {}).join(', ')}`);
    }

    for (const item of items) {
      const title = firstOf(item, ['title', 'name', 'heading', 'subject']);
      const ref = shape.refOf(title);
      if (!ref) continue;

      const href = firstOf(item, ['url', 'link', 'documentUrl', 'fileUrl', 'file', 'permalink']);
      const slug = firstOf(item, ['slug', 'urlName', 'itemUrl']);
      const sourceUrl = href
        ? new URL(href, MPA).href
        : slug ? `${MPA}/media-centre/details/${slug.replace(/^\/+/, '')}` : '';

      out.push({
        title,
        refNo: ref.refNo,
        docType: shape.types[ref.prefix] || '',
        date: isoDay(firstOf(item, ['date', 'publishedDate', 'releaseDate', 'publicationDate', 'created', 'lastModified'])),
        sourceUrl
      });
    }

    if (items.length < 100) break;
  }
  return out;
}

/**
 * Read MPA's listings the only way they can be read: in a browser.
 *
 * The pages are drawn by script, so the markup a server receives holds no
 * links at all. Rendering them here is fine — this is CI, not the ship — and
 * it is the difference between the handful of recent items the feed carries
 * and the actual catalogue.
 *
 * Every request the page makes is logged, because the listing is almost
 * certainly fed by an endpoint that could be read directly. Finding it means
 * this can go back to being a plain fetch.
 */
async function renderSingapore(found, shape) {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.warn('  Singapore: no browser available, listings not rendered'); return 0; }

  const before = found.length;
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const seenApi = new Set();
    page.on('request', (req) => {
      const url = req.url();
      if (/\/(api|rest|odata|sitefinity|services)\b/i.test(url) && !seenApi.has(url)) {
        seenApi.add(url);
      }
    });

    for (const type of SG_LISTINGS) {
      try {
        await page.goto(`${MPA}/media-centre?type=${type}`, { waitUntil: 'networkidle', timeout: 60000 });
        // The listing paginates. Follow it while a next control is offered.
        for (let round = 0; round < 25; round++) {
          const links = await page.$$eval('a[href]', (as) =>
            as.map((a) => ({ href: a.href, text: (a.textContent || '').replace(/\s+/g, ' ').trim() })));
          for (const { href, text } of links) {
            if (!SG_LINK.test(href)) continue;
            const ref = shape.refOf(text) || shape.refOf(href);
            if (!ref) continue;
            found.push({
              title: text || ref.refNo, refNo: ref.refNo,
              docType: shape.types[ref.prefix] || '', date: '', sourceUrl: href
            });
          }

          const next = page.locator(
            'a[rel="next"], button:has-text("Load more"), a:has-text("Next"), li.next > a, .pagination__next'
          ).first();
          if (!await next.count() || !await next.isVisible().catch(() => false)) break;
          await next.click({ timeout: 5000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        }
      } catch (ex) { console.warn(`  Singapore render ${type}: ${ex.message}`); }
    }

    if (seenApi.size) {
      console.log('  endpoints the listing called:');
      for (const url of [...seenApi].slice(0, 8)) console.log(`    ${url}`);
    }
  } catch (ex) {
    console.warn(`  Singapore render: ${ex.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return found.length - before;
}

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
