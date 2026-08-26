// Fetching notice catalogues straight from an administration.
//
// Nothing here runs on its own. Every fetch is behind a button, because data
// on board is metered and paid for.
//
// A browser will only read another site's response if that site sends CORS
// headers permitting it. GOV.UK publishes a documented content API and allows
// the read — that was settled on the device, not assumed. Panama and Singapore
// publish no such API, so this tries the routes they do offer and reports
// exactly what each one did. An administration that cannot be read says so and
// falls back to its links, rather than being a button that quietly does
// nothing at sea.

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const pad2 = (n) => String(parseInt(n, 10)).padStart(2, '0');

function isoDate(value) {
  const iso = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

function absolute(href, base) {
  try { return new URL(href, base).href; } catch { return ''; }
}

// ---------------------------------------------------------------- MCA -----

const GOVUK = 'https://www.gov.uk';

const MCA_TYPES = {
  MSN: 'MSN (Merchant Shipping Notice)',
  MGN: 'MGN (Marine Guidance Note)',
  MIN: 'MIN (Marine Information Note)'
};

/** Titles read like "MSN 1871 (M) Amendment 1" or "MGN 654 (M+F)". */
function mcaRef(text) {
  const m = String(text).match(/\b(MSN|MGN|MIN)\s*(\d{1,4})\s*(\([A-Z+]+\))?/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  return {
    prefix,
    refNo: `${prefix} ${m[2]}${m[3] ? ' ' + m[3].toUpperCase() : ''}`
  };
}

function parseGovukCollection(data) {
  // Documents hang off links.documents; the collection groups list the same
  // paths without titles, so this reads the former.
  const docs = data?.links?.documents || [];
  return docs.map((doc) => {
    const title = clean(doc?.title);
    if (!title) return null;
    const ref = mcaRef(title);
    return {
      title,
      refNo: ref ? ref.refNo : '',
      docType: ref ? MCA_TYPES[ref.prefix] : '',
      date: isoDate(doc.public_updated_at),
      // The document page, not the PDF: the asset host refuses cross-origin
      // reads, so the file is fetched by opening this in Safari.
      sourceUrl: doc.base_path ? GOVUK + doc.base_path : ''
    };
  }).filter(Boolean);
}

const collection = (slug) =>
  `${GOVUK}/api/content/government/collections/${slug}`;

// ------------------------------------------------------------- Panama -----

// The bare host redirects to www, and a cross-origin redirect only survives if
// every hop carries the CORS headers — so the canonical host is addressed
// directly. The maritime authority's own site runs the same software and
// carries the same circulars, so it stands behind the registry as a second
// host rather than a second guess.
const PANAMA = 'https://www.panamashipregistry.com';
const PANAMA_AMP = 'https://www.amp.gob.pa';

const PANAMA_TYPES = {
  MMC: 'Merchant Marine Circular',
  MMN: 'MMN (Merchant Marine Notice)'
};

/** Circulars are referenced as MMC-230, notices as MMN 7-070. */
function panamaRef(text) {
  const m = String(text).match(/\b(MMC|MMN)[\s._-]*(\d{1,4}(?:-\d{1,4})?)\b/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  return { prefix, refNo: `${prefix} ${m[2]}` };
}

/**
 * WordPress serves its own REST API with permissive CORS where a plain page
 * would not, and every circular on the registry's site is an uploaded PDF, so
 * the media endpoint is the closest thing Panama has to a catalogue.
 */
function parseWpMedia(data) {
  const list = Array.isArray(data) ? data : [];
  return list.map((item) => {
    const url = String(item?.source_url || '');
    const raw = clean(item?.title?.rendered || item?.slug || '');
    const ref = panamaRef(raw) || panamaRef(url);
    if (!ref) return null;   // uploads hold the whole site, not just circulars
    return {
      title: raw.replace(/[-_]+/g, ' ').trim() || ref.refNo,
      refNo: ref.refNo,
      docType: PANAMA_TYPES[ref.prefix] || '',
      date: isoDate(item?.date_gmt || item?.date),
      sourceUrl: url
    };
  }).filter(Boolean);
}

const WP_PAGE = 100;

/**
 * One page of a WordPress media search, newest first.
 *
 * The search term does real work and has to stay. Dropping it and reading the
 * listing by date instead looked tidier and cost the authority's site most of
 * its catalogue — 13 documents became 2 — because its circulars are old
 * uploads that four pages of newest-first never reach. Search finds them
 * whatever their date.
 *
 * media_type=application asks for the uploaded files rather than the site's
 * photographs, and _fields trims each record to the five that are used, so a
 * page of a hundred is a small read on a metered connection.
 */
const wpMedia = (host, search) => (page) =>
  `${host}/wp-json/wp/v2/media?media_type=application&per_page=${WP_PAGE}&page=${page}`
  + `&search=${encodeURIComponent(search)}`
  + '&orderby=date&order=desc&_fields=title,slug,date,date_gmt,source_url';

// ---------------------------------------------------------- Singapore -----

const MPA = 'https://www.mpa.gov.sg';

const SG_TYPES = {
  SC: 'Shipping Circular',
  PC: 'Port Marine Circular',
  PN: 'Marine Notice'
};

/**
 * Singapore writes references out in full on the page — "PORT MARINE CIRCULAR
 * NO. 01 OF 2025" — and short in the filename — "pc25-01".
 */
function singaporeRef(text) {
  const t = String(text);

  const spelt = t.match(
    /\b(shipping circular|port marine circular|port marine notice|marine notice)\s*no\.?\s*0*(\d{1,3})\s*of\s*(\d{4})/i
  );
  if (spelt) {
    const kind = spelt[1].toLowerCase();
    const prefix = kind.startsWith('shipping') ? 'SC' : kind.includes('circular') ? 'PC' : 'PN';
    return { prefix, refNo: `${prefix} ${pad2(spelt[2])}/${spelt[3]}` };
  }

  const short = t.match(/\b(sc|pc|pn)[_-]?(\d{2})[-_](\d{1,3})\b/i);
  if (short) {
    const prefix = short[1].toUpperCase();
    return { prefix, refNo: `${prefix} ${pad2(short[3])}/20${short[2]}` };
  }
  return null;
}

/**
 * Read an RSS or Atom feed. A published feed is a list an administration keeps
 * deliberately, so it beats scraping a page whose links are drawn by script
 * and may not be in the HTML at all.
 *
 * MPA's feed carries media releases as well as circulars, so anything without
 * a recognisable reference is left out.
 */
function parseFeed({ refOf, types }) {
  return (xml) => {
    const doc = new DOMParser().parseFromString(String(xml), 'application/xml');
    if (doc.querySelector('parsererror')) return [];

    const out = [];
    for (const entry of doc.querySelectorAll('item, entry')) {
      const title = clean(entry.querySelector('title')?.textContent);
      const ref = refOf(title);
      if (!ref) continue;

      const linkEl = entry.querySelector('link');
      const href = clean(linkEl?.textContent) || linkEl?.getAttribute('href') || '';
      const when = entry.querySelector('pubDate, published, updated')?.textContent;
      const parsed = when ? new Date(when) : null;

      out.push({
        title,
        refNo: ref.refNo,
        docType: types[ref.prefix] || '',
        date: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '',
        sourceUrl: href
      });
    }
    return out;
  };
}

/**
 * Read a published index page for the links it lists. Coarser than a feed, but
 * it is what an administration without one gives you.
 */
function parseLinkIndex({ base, match, refOf, types }) {
  return (html) => {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const out = [];
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const href = absolute(anchor.getAttribute('href'), base);
      if (!href || !match.test(href)) continue;
      const text = clean(anchor.textContent);
      const ref = refOf(text) || refOf(href);
      if (!ref) continue;
      out.push({
        title: text || ref.refNo,
        refNo: ref.refNo,
        docType: types[ref.prefix] || '',
        date: '',
        sourceUrl: href
      });
    }
    return out;
  };
}

// -------------------------------------------------------------- Feeds -----

/**
 * What each administration publishes and how to read it.
 *
 * A group is one class of document. Its alternatives are routes to the same
 * list, tried in order until one returns something — so a site that moves its
 * API still has its index page to fall back on.
 */
export const FEEDS = {
  MCA: {
    issuer: 'Maritime & Coastguard Agency',
    note: 'GOV.UK publishes a public content API and permits the read.',
    groups: [
      {
        name: 'MSNs',
        alternatives: [{
          label: 'GOV.UK collection', kind: 'json',
          url: collection('merchant-shipping-notices-msns'),
          parse: parseGovukCollection
        }]
      },
      {
        // GOV.UK has moved this collection more than once and keeps the old
        // paths as redirects, which the content API answers with a document
        // that lists nothing. So the current path is tried first and the
        // earlier ones stand behind it.
        name: 'MGNs',
        alternatives: [
          {
            label: 'GOV.UK collection (active)', kind: 'json',
            url: collection('active-marine-guidance-notes-mgns'),
            parse: parseGovukCollection
          },
          {
            label: 'GOV.UK collection (notices)', kind: 'json',
            url: collection('marine-guidance-notices-mgns'),
            parse: parseGovukCollection
          },
          {
            label: 'GOV.UK collection (notes)', kind: 'json',
            url: collection('marine-guidance-notes-mgns'),
            parse: parseGovukCollection
          }
        ]
      },
      {
        name: 'MINs',
        alternatives: [
          {
            label: 'GOV.UK collection', kind: 'json',
            url: collection('marine-information-notes-mins'),
            parse: parseGovukCollection
          },
          {
            label: 'GOV.UK collection (active)', kind: 'json',
            url: collection('active-marine-information-notes-mins'),
            parse: parseGovukCollection
          }
        ]
      }
    ]
  },

  Panama: {
    issuer: 'Panama Maritime Authority',
    note: 'The registry runs on WordPress, whose REST API is readable where its pages are not.',
    groups: [
      {
        name: 'Merchant Marine Circulars',
        alternatives: [
          { label: 'Registry API', kind: 'json', paged: wpMedia(PANAMA, 'MMC-'), parse: parseWpMedia },
          { label: 'Authority API', kind: 'json', paged: wpMedia(PANAMA_AMP, 'MMC-'), parse: parseWpMedia },
          {
            label: 'Circulars page', kind: 'html', url: `${PANAMA}/circulars/`,
            parse: parseLinkIndex({
              base: PANAMA, match: /\/wp-content\/uploads\/.+\.pdf(\?|$)/i,
              refOf: panamaRef, types: PANAMA_TYPES
            })
          }
        ]
      },
      {
        name: 'Merchant Marine Notices',
        alternatives: [
          { label: 'Registry API', kind: 'json', paged: wpMedia(PANAMA, 'MMN-'), parse: parseWpMedia },
          { label: 'Authority API', kind: 'json', paged: wpMedia(PANAMA_AMP, 'MMN-'), parse: parseWpMedia }
        ]
      }
    ]
  },

  Singapore: {
    issuer: 'Maritime & Port Authority of Singapore',
    note: 'MPA publishes a feed of its releases, which carries the circulars and notices among them.',
    groups: [
      {
        // One class, because the feed does not separate them — each item is
        // sorted by the reference in its own title. The listing pages behind
        // it are split by type, so all three are read together.
        name: 'Circulars and notices',
        alternatives: [
          {
            label: 'MPA feed', kind: 'xml', url: `${MPA}/feeds/media-releases`,
            parse: parseFeed({ refOf: singaporeRef, types: SG_TYPES })
          },
          {
            label: 'Media centre', kind: 'html',
            urls: [
              `${MPA}/media-centre?type=Shipping+Circulars`,
              `${MPA}/media-centre?type=Port+Marine+Circulars`,
              `${MPA}/media-centre?type=Port+Marine+Notices`
            ],
            parse: parseLinkIndex({
              base: MPA, match: /\/(media-centre\/details|docs\/mpalibraries)\//i,
              refOf: singaporeRef, types: SG_TYPES
            })
          }
        ]
      }
    ]
  }
};

/** The administrations a fetch can be asked for, in the order they are shown. */
export const SYNCABLE = Object.keys(FEEDS);

const message = (ex) =>
  `${ex?.name === 'TypeError' ? 'blocked or offline' : ex?.name || 'Error'}: ${String(ex?.message || ex)}`
    .slice(0, 120);

async function readOne(url, alternative) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = alternative.kind === 'json' ? await response.json() : await response.text();
  const items = alternative.parse(payload);
  // How many records the reply held, as against how many were recognised —
  // a page of a hundred uploads holding three circulars is a full page, and
  // there is another behind it.
  return { items, held: Array.isArray(payload) ? payload.length : items.length };
}

/** Every URL an alternative names. One of them answering is enough. */
const urlsOf = (alternative) => alternative.urls || [alternative.url];

/**
 * Walk a paged listing until it runs out.
 *
 * Stops at the first short page, so a search returning forty documents costs
 * one request and only a genuinely long catalogue costs more. A page past the
 * end is an error from WordPress, not an empty list, so that ends it too —
 * but only after the pages before it have been kept.
 */
async function readPaged(alternative) {
  const found = [];
  let first = null;
  for (let page = 1; page <= (alternative.maxPages || 4); page++) {
    let batch;
    try {
      batch = await readOne(alternative.paged(page), alternative);
    } catch (ex) {
      if (page === 1) first = ex;
      break;
    }
    found.push(...batch.items);
    if (batch.held < WP_PAGE) break;
  }
  if (!found.length && first) throw first;
  return found;
}

async function read(alternative) {
  if (alternative.paged) return readPaged(alternative);

  const urls = urlsOf(alternative);
  const found = [];
  const errors = [];
  for (const url of urls) {
    try { found.push(...(await readOne(url, alternative)).items); }
    catch (ex) { errors.push(ex); }
  }
  // Only a total refusal is a failure: one listing being renamed should not
  // take the other two down with it.
  if (!found.length && errors.length === urls.length) throw errors[0];
  return found;
}

/** Newest first, one entry per reference. */
function dedupe(notices) {
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

/**
 * The current notices for one administration.
 *
 * Throws only when nothing at all could be read, so a partial result — three
 * classes published, one of them unreachable — still files what it got and
 * names what it missed.
 */
export async function fetchNotices(admin) {
  const feed = FEEDS[admin];
  if (!feed) throw new Error(`No source is configured for ${admin}.`);

  const notices = [];
  const used = [];
  const failed = [];

  for (const group of feed.groups) {
    let got = null;
    // Every route that was tried is reported, not just the last one, so a
    // failure says which hosts were reached and what each of them did.
    const tried = [];
    for (const alternative of group.alternatives) {
      try {
        const parsed = await read(alternative);
        if (parsed.length) { got = parsed; used.push(`${group.name} via ${alternative.label}`); break; }
        tried.push(`${alternative.label}: nothing recognisable in the reply`);
      } catch (ex) {
        tried.push(`${alternative.label}: ${message(ex)}`);
      }
    }
    if (got) notices.push(...got);
    else failed.push(`${group.name} — ${tried.join('; ') || 'no route configured'}`);
  }

  if (!notices.length) throw new Error(failed.join('; ') || 'nothing came back');
  return { notices: dedupe(notices), used, failed };
}

async function attempt(label, alternative) {
  const started = Date.now();
  try {
    // Read exactly as a real fetch would, so what the probe reports is what a
    // sync will actually get — not a single page standing in for the walk.
    const found = await read(alternative);
    return {
      label, ok: found.length > 0, ms: Date.now() - started,
      detail: found.length ? `${found.length} documents listed` : 'read, but nothing recognisable in it'
    };
  } catch (ex) {
    // A CORS refusal surfaces as a TypeError with no status at all.
    return { label, ok: false, ms: Date.now() - started, detail: message(ex) };
  }
}

/** Try every route one administration has, and report what the device reached. */
export async function probeFeed(admin) {
  const feed = FEEDS[admin];
  const results = [];
  for (const group of feed.groups) {
    for (const alternative of group.alternatives) {
      results.push(await attempt(`${group.name} · ${alternative.label}`, alternative));
    }
  }
  const canList = results.some((r) => r.ok);
  return {
    admin, results, canList,
    verdict: canList
      ? `${admin} can be read from the app.`
      : `${admin} cannot be read from the app on this connection.`
  };
}

/** The same check across every administration. */
export async function probeAll() {
  const reports = [];
  for (const admin of SYNCABLE) reports.push(await probeFeed(admin));
  return reports;
}
