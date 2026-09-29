// Bundle Anthropic's SDK into vendor/anthropic-sdk.mjs, for Library's Ask.
//
// The app is plain files with no build step, and loads nothing from a CDN,
// so the SDK is bundled once into a single ES module and kept here. It is
// only loaded when a question is asked -- a phone that never asks never pays
// for it -- and asking needs a connection anyway.
//
// Pinned, like everything else in vendor/.
//
//   node tools/vendor-anthropic.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SDK = '0.129.0';
const ESBUILD = '0.28.2';

const work = mkdtempSync(join(tmpdir(), 'anthropic-sdk-'));
writeFileSync(join(work, 'package.json'), '{"private":true}');
writeFileSync(join(work, 'entry.mjs'), "export { default } from '@anthropic-ai/sdk';\n");
execFileSync('npm', ['install', '--no-audit', '--no-fund', `@anthropic-ai/sdk@${SDK}`, `esbuild@${ESBUILD}`],
  { cwd: work, stdio: 'inherit' });
execFileSync(join(work, 'node_modules/.bin/esbuild'), [
  'entry.mjs', '--bundle', '--format=esm', '--platform=browser', '--minify',
  // The oldest Safari the rest of the app is made to run on.
  '--target=safari15', '--legal-comments=eof', '--outfile=anthropic-sdk.mjs'
], { cwd: work, stdio: 'inherit' });
copyFileSync(join(work, 'anthropic-sdk.mjs'), 'vendor/anthropic-sdk.mjs');
console.log(`vendor/anthropic-sdk.mjs — SDK ${SDK}, ${(statSync('vendor/anthropic-sdk.mjs').size / 1024).toFixed(0)} KB`);
