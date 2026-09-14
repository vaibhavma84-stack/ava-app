// Find the document behind each notice, and measure what holding them costs.
//
// The catalogues list notices; this is about the PDFs themselves. None of the
// three hosts will let the app fetch a document directly — that was settled on
// the device — so if the documents are to be held offline they have to come
// through here, the same way the lists do.
//
// Before anything is downloaded, it is measured. A thousand documents at an
// unknown size each is not something to find out about by filling a repository
// with them: --measure resolves every link and asks each host how big the file
// is, without keeping any of it.
//
//   node tools/mirror-docs.mjs --measure [--only=Panama]
//   node tools/mirror-docs.mjs [--only=Panama] [--budget=150]
//
// --budget is megabytes per administration. Newest first, so a budget that
// cannot hold everything holds the part most likely to be wanted.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DATA = 'library/data';
const DOCS = 'library/docs';
const GOVUK = 'https://www.gov.uk';

const MAX_FILE_MB = 25;          // a single document larger than this is left alone
const args = process.argv.slice(2);
const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];
const has = (name) => args.includes(`--${name}`);

const mb = (bytes) => (bytes / 1048576).toFixed(1);

/**
 * Work through a list several at a time, keeping the order of the results.
 *
 * A thousand documents one after another is a thousand round trips end to
 * end, and the first measuring run was still going after fifteen minutes. The
 * hosts are not the bottleneck; waiting for each reply before asking the next
 * question is. Eight at a time is brisk without leaning on anyone's server.
 */
async function inParallel(items, width, work) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function head(url) {
  // Some hosts refuse HEAD but answer a ranged GET, which costs one byte.
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (r.ok) {
      const len = Number(r.headers.get('content-length'));
      if (len > 0) return { ok: true, bytes: len, type: r.headers.get('content-type') || '' };
    }
  } catch { /* fall through to the ranged read */ }

  try {
    const r = await fetch(url, { headers: { range: 'bytes=0-0' }, redirect: 'follow' });
    if (!r.ok && r.status !== 206) return { ok: false, reason: `HTTP ${r.status}` };
    const range = r.headers.get('content-range');
    const total = range ? Number(range.split('/')[1]) : Number(r.headers.get('content-length'));
    return { ok: true, bytes: Number.isFinite(total) ? total : 0, type: r.headers.get('content-type') || '' };
  } catch (ex) {
    return { ok: false, reason: ex.message };
  }
}

const isPdf = (url) => /\.pdf(\?|$)/i.test(String(url || ''));

/**
 * GOV.UK gives a page per notice, and the file hangs off it as an attachment.
 * The content API lists those, so the page itself never has to be scraped.
 */
const reportedShape = new Set();
const admin = 'MCA';

/**
 * Turn a GOV.UK HTML body into the words it carries.
 *
 * No parser here on purpose: Node has no DOM, the app has no dependencies, and
 * what is wanted is the reading text, not the markup. Block tags become line
 * breaks so the paragraphs and list items stay apart, everything else goes,
 * and the entities that actually appear in a notice come back as characters.
 */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  pound: '\u00a3', euro: '\u20ac', cent: '\u00a2', yen: '\u00a5',
  deg: '\u00b0', times: '\u00d7', divide: '\u00f7', plusmn: '\u00b1',
  frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', sup2: '\u00b2', sup3: '\u00b3',
  micro: '\u00b5', middot: '\u00b7', bull: '\u2022', hellip: '\u2026',
  ndash: '\u2013', mdash: '\u2014', minus: '\u2212',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', sect: '\u00a7', para: '\u00b6',
  eacute: '\u00e9', egrave: '\u00e8', agrave: '\u00e0', ccedil: '\u00e7', ouml: '\u00f6'
};

export function textFromHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n\u2022 ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    // Named entities by name. Dropping the ones not on the list used to turn a
    // £50 fee into a 50 fee — a number changed by the mirror, which is worse
    // than a character lost, because it still reads as a fee.
    .replace(/&([a-z][a-z0-9]*);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The notice's words, for the ones GOV.UK publishes as a page rather than a file.
 *
 * Asked and answered: of the 180 MCA notices that resolve to no PDF, 179 carry
 * an HTML attachment and none has a PDF that was missed. They are not missing
 * documents — they are documents that are not files. The words are in the
 * content API under the attachment's own path, so they can be mirrored as text
 * and reach the phone like everything else.
 */
async function mcaText(notice) {
  const path = String(notice.sourceUrl || '').replace(GOVUK, '');
  if (!path.startsWith('/')) return '';
  try {
    const r = await fetch(`${GOVUK}/api/content${path}`);
    if (!r.ok) return '';
    const body = await r.json();
    const html = (body?.details?.attachments || []).find((a) => (a?.attachment_type || '') === 'html');
    if (!html?.url) return '';

    const sub = await fetch(`${GOVUK}/api/content${String(html.url).replace(GOVUK, '')}`);
    if (!sub.ok) return '';
    const page = await sub.json();
    const markup = page?.details?.body || page?.details?.govspeak || '';
    const text = textFromHtml(markup);
    if (text.length < 200) return '';

    // Headed by what it is, so the file reads as the notice and not as a
    // fragment of one, and so its number is in the text as well as the name.
    return `${notice.refNo || ''} ${notice.title || ''}`.trim()
      + `\n${notice.date || ''}\nSource: ${notice.sourceUrl}\n\n${text}\n`;
  } catch { return ''; }
}

async function resolveMca(notice) {
  if (isPdf(notice.sourceUrl)) return notice.sourceUrl;
  const path = String(notice.sourceUrl || '').replace(GOVUK, '');
  if (!path.startsWith('/')) return '';

  try {
    const r = await fetch(`${GOVUK}/api/content${path}`);
    if (!r.ok) return '';
    const body = await r.json();
    const attachments = body?.details?.attachments || [];
    // The notice itself, not the consultation response or the impact
    // assessment that sometimes sits beside it: the first PDF is the document.
    const pdf = attachments.find((a) => isPdf(a?.url));
    if (pdf?.url) return pdf.url;

    // Nothing to fetch. Say what was there instead, once, so that 179 notices
    // without a file are explained rather than merely counted — GOV.UK has
    // been moving M-notices to HTML attachments, and an HTML notice has no
    // document to download at all.
    if (!reportedShape.has(admin)) {
      reportedShape.add(admin);
      const kinds = attachments.map((a) => a?.attachment_type || a?.content_type || 'unknown');
      console.log(`  first notice with no PDF: ${attachments.length} attachment(s)`
        + (kinds.length ? ` of type ${[...new Set(kinds)].join(', ')}` : '')
        + ` · document_type ${body?.document_type || 'unknown'}`);
    }
    return '';
  } catch { return ''; }
}

/** Singapore and Panama carry the link in the catalogue already. */
const resolveDirect = (notice) => notice.docUrl || (isPdf(notice.sourceUrl) ? notice.sourceUrl : '');

const RESOLVE = { MCA: resolveMca, Panama: resolveDirect, Singapore: resolveDirect };

/** A name that survives a filesystem and still says which notice it is. */
const fileNameFor = (notice) =>
  `${notice.refNo || notice.title}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) + '.pdf';

const textNameFor = (notice) => fileNameFor(notice).replace(/\.pdf$/, '.txt');

/**
 * Notices that are listed but never fetched.
 *
 * MINs are information notes rather than requirements, and they are not wanted
 * on the phone — so they stay in the catalogue, numbered and listed, and no
 * document is fetched for them at all. Not a filter on the phone: fetching
 * them here and then declining to send them would spend the site's space and
 * the run's time on something nobody asked for.
 */
export const listOnly = (admin, notice) => admin === 'MCA'
  && (/^MIN\b/i.test(notice.docType || '') || /^MIN\b/i.test(notice.refNo || ''));

async function run() {
  const only = flag('only');
  const measuring = has('measure');
  const budget = Number(flag('budget') || 150) * 1048576;

  for (const admin of ['MCA', 'Panama', 'Singapore']) {
    if (only && only !== admin) continue;

    const catalogue = join(DATA, `${admin.toLowerCase()}.json`);
    if (!existsSync(catalogue)) { console.log(`${admin}: no catalogue yet`); continue; }
    const data = JSON.parse(readFileSync(catalogue, 'utf8'));

    let resolved = 0, unresolved = 0, held = 0, tooBig = 0, refused = 0, asText = 0;
    let listed = 0, dropped = 0;
    let totalBytes = 0, takenBytes = 0, stoppedAt = 0;
    let changed = false;

    // Resolving and sizing is all network, so it is done several at a time.
    const sized = await inParallel(data.notices, 8, async (notice) => {
      const localPath = join(DOCS, admin.toLowerCase(), fileNameFor(notice));
      if (listOnly(admin, notice)) return { notice, localPath, listed: true };
      if (!measuring && existsSync(localPath)) return { notice, localPath, alreadyHere: true };

      const url = await RESOLVE[admin](notice);
      if (url) return { notice, localPath, url, size: await head(url) };

      // No file — but for MCA that mostly means the notice is a page, not that
      // it is missing. Take the words instead.
      if (admin === 'MCA' && !measuring) {
        const textPath = join(DOCS, 'mca', textNameFor(notice));
        if (existsSync(textPath)) {
          return { notice, localPath: textPath, alreadyHere: true };
        }
        const text = await mcaText(notice);
        if (text) return { notice, localPath, textPath, text };
      }
      return { notice, localPath, unresolved: true };
    });

    for (const row of sized) {
      if (row.listed) {
        listed++;
        // Anything fetched before the rule existed goes, rather than sitting
        // on the site being offered to a phone that does not want it.
        for (const stale of [row.localPath, row.localPath.replace(/\.pdf$/, '.txt')]) {
          if (existsSync(stale)) { rmSync(stale); dropped++; changed = true; }
        }
        if (row.notice.file) { delete row.notice.file; delete row.notice.bytes; changed = true; }
        continue;
      }
      if (row.alreadyHere) {
        held++;
        takenBytes += statSync(row.localPath).size;
        const rel = row.localPath.replace('library/', '');
        if (row.notice.file !== rel) { row.notice.file = rel; changed = true; }
        continue;
      }
      if (row.unresolved) { unresolved++; continue; }
      if (row.textPath) {
        // Published as a page rather than a file. Its words are mirrored so
        // the notice still reaches the phone and is still searchable — the
        // only thing it lacks is a PDF, which nobody published.
        mkdirSync(dirname(row.textPath), { recursive: true });
        writeFileSync(row.textPath, row.text);
        takenBytes += Buffer.byteLength(row.text);
        row.notice.file = row.textPath.replace('library/', '');
        row.notice.bytes = Buffer.byteLength(row.text);
        asText++;
        changed = true;
        continue;
      }
      resolved++;
      if (!row.size.ok) { refused++; continue; }
      totalBytes += row.size.bytes;
      if (row.size.bytes > MAX_FILE_MB * 1048576) { tooBig++; continue; }
      if (measuring) continue;

      // Newest first, so a budget that cannot hold everything holds the part
      // most likely to be wanted rather than an arbitrary slice. Kept
      // sequential: this is where the bytes are actually spent.
      if (takenBytes + row.size.bytes > budget) { stoppedAt++; continue; }

      try {
        const r = await fetch(row.url, { redirect: 'follow' });
        if (!r.ok) { refused++; continue; }
        const bytes = Buffer.from(await r.arrayBuffer());
        mkdirSync(dirname(row.localPath), { recursive: true });
        writeFileSync(row.localPath, bytes);
        takenBytes += bytes.length;
        row.notice.file = row.localPath.replace('library/', '');
        row.notice.bytes = bytes.length;
        changed = true;
      } catch { refused++; }
    }

    if (measuring) {
      const average = resolved ? totalBytes / resolved : 0;
      console.log(`${admin}: ${resolved} of ${data.notices.length} resolved to a file`);
      console.log(`  unresolved ${unresolved} · refused ${refused} · over ${MAX_FILE_MB}MB ${tooBig}`);
      console.log(`  total ${mb(totalBytes)} MB · average ${Math.round(average / 1024)} KB`);
    } else {
      console.log(`${admin}: holding ${held + (changed ? 1 : 0)} documents, ${mb(takenBytes)} MB`);
      if (stoppedAt) console.log(`  ${stoppedAt} left out — the ${mb(budget)} MB budget was reached`);
      if (asText) console.log(`  ${asText} published as a page, mirrored as text`);
      if (listed) console.log(`  ${listed} listed only, no document fetched`
        + (dropped ? ` — ${dropped} previously fetched file removed` : ''));
      if (unresolved) console.log(`  ${unresolved} had nothing to fetch at all`);
      if (changed) writeFileSync(catalogue, JSON.stringify(data, null, 1) + '\n');
    }
  }
}

run().catch((ex) => { console.error(ex); process.exit(1); });
