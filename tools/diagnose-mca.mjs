// Why 180 MCA notices have no document, answered with evidence.
//
// The mirror resolves each notice to a PDF through the GOV.UK content API and
// reports a count when it cannot. A count is not a diagnosis: it says how many
// are missing, never what is there instead. This asks every unresolved notice
// what it actually carries, and groups the answers.
//
// It downloads nothing. It reads the content API, which is JSON, and prints
// what shape each notice is in — so the fix is chosen from what GOV.UK is
// really publishing rather than from a guess about it.
//
//   node tools/diagnose-mca.mjs [--limit=200]

import { readFileSync } from 'node:fs';

const GOVUK = 'https://www.gov.uk';
const args = process.argv.slice(2);
const flag = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const LIMIT = Number(flag('limit') || 0);

const isPdf = (url) => /\.pdf(\?|$)/i.test(String(url || ''));

async function inParallel(items, width, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

const data = JSON.parse(readFileSync('library/data/mca.json', 'utf8'));
const all = data.notices || [];
let missing = all.filter((n) => !n.file);
if (LIMIT) missing = missing.slice(0, LIMIT);

console.log(`MCA: ${all.length} notices, ${all.length - all.filter((n) => !n.file).length} with a file, ${all.filter((n) => !n.file).length} without.`);
console.log(`Asking GOV.UK about ${missing.length} of the ones without.\n`);

const looked = await inParallel(missing, 8, async (notice) => {
  const path = String(notice.sourceUrl || '').replace(GOVUK, '');
  if (!path.startsWith('/')) return { notice, shape: 'no gov.uk url' };
  try {
    const r = await fetch(`${GOVUK}/api/content${path}`);
    if (!r.ok) return { notice, shape: `content API ${r.status}` };
    const body = await r.json();
    const atts = body?.details?.attachments || [];
    const kinds = [...new Set(atts.map((a) => a?.attachment_type || a?.content_type || 'unknown'))];
    const anyPdf = atts.some((a) => isPdf(a?.url));
    // An HTML attachment keeps the notice's words in the API itself, under
    // its own content id — which would make it mirrorable as text even though
    // there is no file to download.
    const html = atts.filter((a) => (a?.attachment_type || '') === 'html');
    const govspeak = html.find((a) => a?.govspeak || a?.body);
    return {
      notice,
      shape: atts.length === 0 ? 'no attachments at all'
        : anyPdf ? 'has a PDF after all'
        : kinds.join('+'),
      attachments: atts.length,
      htmlAttachments: html.length,
      carriesText: Boolean(govspeak) || html.some((a) => a?.url),
      documentType: body?.document_type || 'unknown',
      sampleUrl: atts[0]?.url || ''
    };
  } catch (ex) {
    return { notice, shape: `failed: ${ex.message}` };
  }
});

const byShape = new Map();
for (const look of looked) {
  const key = `${look.shape}`;
  if (!byShape.has(key)) byShape.set(key, []);
  byShape.get(key).push(look);
}

console.log('What the notices without a file actually carry:\n');
for (const [shape, rows] of [...byShape.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const withText = rows.filter((r) => r.carriesText).length;
  console.log(`  ${String(rows.length).padStart(4)}  ${shape}`
    + (withText ? `  (${withText} carry their text)` : ''));
  for (const row of rows.slice(0, 2)) {
    console.log(`         e.g. ${row.notice.refNo || row.notice.title}`);
    console.log(`              ${row.notice.sourceUrl}`);
    if (row.sampleUrl) console.log(`              first attachment: ${row.sampleUrl}`);
    console.log(`              document_type: ${row.documentType}`);
  }
}

const mirrorableAsText = looked.filter((l) => l.carriesText).length;
const reallyNothing = looked.filter((l) => !l.carriesText && l.shape !== 'has a PDF after all').length;
console.log(`\nSummary of ${looked.length} asked:`);
console.log(`  ${looked.filter((l) => l.shape === 'has a PDF after all').length} do have a PDF the resolver missed`);
console.log(`  ${mirrorableAsText} publish their text rather than a file — mirrorable as text`);
console.log(`  ${reallyNothing} have nothing to mirror`);
