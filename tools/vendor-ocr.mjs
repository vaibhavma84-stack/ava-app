// Fetch the OCR engine into vendor/ocr/, so the app never needs a CDN.
//
// A scanned manual is a picture of its pages: there is no text in it to find,
// which is why nothing fills itself in from one. Reading the letters out of
// the picture needs Tesseract, and Tesseract is several megabytes — so it is
// vendored here rather than loaded from someone else's server at sea, and the
// app fetches it only when the reader is first asked for.
//
// Pinned by version. An OCR engine that changes under the app without anyone
// noticing is the sort of thing that works in port and fails on passage.
//
//   node tools/vendor-ocr.mjs

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'vendor/ocr';

const TESSERACT = '5.1.1';
const CORE = '5.1.1';

const FILES = [
  // The library and the worker it spawns.
  [`https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT}/dist/tesseract.min.js`, 'tesseract.min.js'],
  [`https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT}/dist/worker.min.js`, 'worker.min.js'],

  // All four builds of the engine, because Tesseract chooses between them
  // itself and only says which it wanted by asking for it. The reader is
  // created in LSTM-only mode, so the -lstm pair is what actually gets
  // fetched — vendoring only the other two got as far as the worker starting
  // and then a 404 for a file nobody had mentioned.
  [`https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE}/tesseract-core.wasm.js`, 'tesseract-core.wasm.js'],
  [`https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE}/tesseract-core-simd.wasm.js`, 'tesseract-core-simd.wasm.js'],
  [`https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE}/tesseract-core-lstm.wasm.js`, 'tesseract-core-lstm.wasm.js'],
  [`https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE}/tesseract-core-simd-lstm.wasm.js`, 'tesseract-core-simd-lstm.wasm.js'],

  // The trained data. "fast" rather than "best": a quarter of the size, and
  // the difference on a printed manual is slight.
  ['https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz', 'eng.traineddata.gz']
];

const kb = (n) => `${Math.round(n / 1024)} KB`;

async function get(url, name) {
  const target = join(OUT, name);
  if (existsSync(target)) {
    console.log(`  ${name.padEnd(30)} already here (${kb(statSync(target).size)})`);
    return statSync(target).size;
  }

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  // A CDN that answers a missing file with its own HTML error page would
  // otherwise be vendored as if it were the engine.
  if (bytes.length < 1024) throw new Error(`${name} came back as only ${bytes.length} bytes`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(target, bytes);
  console.log(`  ${name.padEnd(30)} ${kb(bytes.length)}`);
  return bytes.length;
}

let total = 0;
for (const [url, name] of FILES) total += await get(url, name);
console.log(`\nOCR engine vendored: ${(total / 1048576).toFixed(1)} MB in ${OUT}`);
console.log('Fetched by the app only when the reader is first asked for.');
