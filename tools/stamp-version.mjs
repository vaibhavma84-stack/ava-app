// Write the version the site is serving, where the app can read it cheaply.
//
// The app compares this with the version it is running, so that a copy left
// behind by a wedged service worker can say so. It is read with a query string
// no cache has seen, which is the whole point — but that means it is read
// often, so it is deliberately a few bytes rather than the whole of app.js.
//
// Generated from APP_VERSION so the two cannot drift; a test checks they agree.

import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('library/js/app.js', 'utf8');
const version = (source.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
if (!version) { console.error('No APP_VERSION found in library/js/app.js'); process.exit(1); }

writeFileSync('library/version.json', JSON.stringify({ version }) + '\n');
console.log(`library/version.json → ${version}`);
