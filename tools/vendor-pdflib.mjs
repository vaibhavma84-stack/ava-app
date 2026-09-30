// Bundle pdf-lib into vendor/pdf-lib.mjs, for Library's page sharing and
// camera scans.
//
// pdf-lib copies pages out of one PDF into another with their text intact,
// and builds a PDF from photographs. Bundled once into a single ES module,
// like the SDK beside it, and loaded only when a page is shared or a scan is
// saved.
//
// Pinned, like everything else in vendor/.
//
//   node tools/vendor-pdflib.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PDFLIB = '1.17.1';
const ESBUILD = '0.28.2';

const work = mkdtempSync(join(tmpdir(), 'pdf-lib-'));
writeFileSync(join(work, 'package.json'), '{"private":true}');
writeFileSync(join(work, 'entry.mjs'), "export { PDFDocument, degrees } from 'pdf-lib';\n");
execFileSync('npm', ['install', '--no-audit', '--no-fund', `pdf-lib@${PDFLIB}`, `esbuild@${ESBUILD}`],
  { cwd: work, stdio: 'inherit' });
execFileSync(join(work, 'node_modules/.bin/esbuild'), [
  'entry.mjs', '--bundle', '--format=esm', '--platform=browser', '--minify',
  // The oldest Safari the rest of the app is made to run on.
  '--target=safari15', '--legal-comments=eof', '--outfile=pdf-lib.mjs'
], { cwd: work, stdio: 'inherit' });
copyFileSync(join(work, 'pdf-lib.mjs'), 'vendor/pdf-lib.mjs');
console.log(`vendor/pdf-lib.mjs — pdf-lib ${PDFLIB}, ${(statSync('vendor/pdf-lib.mjs').size / 1024).toFixed(0)} KB`);
