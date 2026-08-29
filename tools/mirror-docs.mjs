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

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DATA = 'library/data';
const DOCS = 'library/docs';
const GOVUK = 'https://www.gov.uk';

const MAX_FILE_MB = 25;          // a single document larger than this is left alone
const args = process.argv.slice(2);
const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];
const has = (name) => args.includes(`--${name}`);

const mb = (bytes) => (bytes / 1048576).toFixed(1);

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
    return pdf?.url || '';
  } catch { return ''; }
}

/** Singapore and Panama carry the link in the catalogue already. */
const resolveDirect = (notice) => notice.docUrl || (isPdf(notice.sourceUrl) ? notice.sourceUrl : '');

const RESOLVE = { MCA: resolveMca, Panama: resolveDirect, Singapore: resolveDirect };

/** A name that survives a filesystem and still says which notice it is. */
const fileNameFor = (notice) =>
  `${notice.refNo || notice.title}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) + '.pdf';

async function run() {
  const only = flag('only');
  const measuring = has('measure');
  const budget = Number(flag('budget') || 150) * 1048576;

  for (const admin of ['MCA', 'Panama', 'Singapore']) {
    if (only && only !== admin) continue;

    const catalogue = join(DATA, `${admin.toLowerCase()}.json`);
    if (!existsSync(catalogue)) { console.log(`${admin}: no catalogue yet`); continue; }
    const data = JSON.parse(readFileSync(catalogue, 'utf8'));

    let resolved = 0, unresolved = 0, held = 0, tooBig = 0, refused = 0;
    let totalBytes = 0, takenBytes = 0, stoppedAt = 0;
    let changed = false;

    for (const notice of data.notices) {
      const localPath = join(DOCS, admin.toLowerCase(), fileNameFor(notice));

      if (!measuring && existsSync(localPath)) {
        held++;
        takenBytes += statSync(localPath).size;
        if (notice.file !== localPath.replace('library/', '')) {
          notice.file = localPath.replace('library/', '');
          changed = true;
        }
        continue;
      }

      const url = await RESOLVE[admin](notice);
      if (!url) { unresolved++; continue; }
      resolved++;

      const size = await head(url);
      if (!size.ok) { refused++; continue; }
      totalBytes += size.bytes;

      if (size.bytes > MAX_FILE_MB * 1048576) { tooBig++; continue; }
      if (measuring) continue;

      // Newest first, so a budget that cannot hold everything holds the part
      // most likely to be wanted rather than an arbitrary slice.
      if (takenBytes + size.bytes > budget) { stoppedAt++; continue; }

      try {
        const r = await fetch(url, { redirect: 'follow' });
        if (!r.ok) { refused++; continue; }
        const bytes = Buffer.from(await r.arrayBuffer());
        mkdirSync(dirname(localPath), { recursive: true });
        writeFileSync(localPath, bytes);
        takenBytes += bytes.length;
        notice.file = localPath.replace('library/', '');
        notice.bytes = bytes.length;
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
      if (unresolved) console.log(`  ${unresolved} had no document to fetch`);
      if (changed) writeFileSync(catalogue, JSON.stringify(data, null, 1) + '\n');
    }
  }
}

run().catch((ex) => { console.error(ex); process.exit(1); });
