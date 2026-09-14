// Publish what the site holds, so the phone can find it.
//
// The lists and the documents come from different places. MCA's list is read
// live from GOV.UK, which is the right source for it — but GOV.UK has no idea
// where a copy of each notice sits on this site, and a notice that does not
// know where its document is can never be told to fetch it. Updating the list
// could not fix that, because the list was never the thing that knew.
//
// So the mirror publishes the answer separately: one small file per
// administration, saying which of its notices this site holds and under what
// name. Keyed by source URL, which is unique per notice and is the one field
// every list carries whichever source it came from.
//
//   node tools/write-file-index.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'library/data';

/** The longest string every key starts with, so it is stored once. */
function commonPrefix(values) {
  if (!values.length) return '';
  let prefix = values[0];
  for (const v of values) {
    while (prefix && !v.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

export function indexFor(data) {
  const held = (data.notices || []).filter((n) => n.file && n.sourceUrl);
  const urlPrefix = commonPrefix(held.map((n) => n.sourceUrl));
  const filePrefix = commonPrefix(held.map((n) => n.file));

  const files = {};
  for (const n of held) files[n.sourceUrl.slice(urlPrefix.length)] = n.file.slice(filePrefix.length);

  return {
    administration: data.administration || '',
    fetched: data.fetched || '',
    urlPrefix,
    filePrefix,
    // How many of its notices this site holds, said plainly so the app can
    // report it without counting the keys itself.
    held: held.length,
    listed: (data.notices || []).length,
    files
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const admin of ['mca', 'panama', 'singapore']) {
    const catalogue = join(DATA, `${admin}.json`);
    if (!existsSync(catalogue)) continue;
    const index = indexFor(JSON.parse(readFileSync(catalogue, 'utf8')));
    const out = join(DATA, `${admin}-files.json`);
    writeFileSync(out, JSON.stringify(index) + '\n');
    const kb = (JSON.stringify(index).length / 1024).toFixed(1);
    console.log(`${out} — ${index.held} of ${index.listed} held, ${kb} KB`);
  }
}
