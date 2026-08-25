// PDF text extraction, entirely on-device.
//
// PDF.js is self-hosted in ../vendor so this works with no connection. It reads
// the text layer a PDF carries; a scanned page is an image and has no text
// layer, so nothing can be extracted from it without OCR. That case is reported
// rather than hidden, so a document that is not searchable says so.

let pdfjs = null;

/**
 * PDF.js 5 calls Math.sumPrecise, which older WebKit does not carry. It is only
 * used for glyph metrics, so an ordinary sum is a good enough stand-in and
 * keeps the library working on older iOS rather than filling the console with
 * font warnings and mis-measuring text.
 */
function polyfillSumPrecise() {
  if (typeof Math.sumPrecise === 'function') return;
  Math.sumPrecise = (values) => {
    let total = 0;
    for (const v of values) total += Number(v);
    return total;
  };
}

async function lib() {
  if (pdfjs) return pdfjs;
  polyfillSumPrecise();
  pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

/**
 * Pull the text out of a PDF, page by page.
 * Returns { pages: [{ page, text }], chars, scanned }.
 * `scanned` means the file parsed but carried almost no text — an image scan.
 */
export async function extract(buffer, { onProgress } = {}) {
  const pdfjsLib = await lib();
  // destroy() lives on the loading task, not on the document proxy.
  const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;
  const pages = [];
  let chars = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // Join with spaces: PDF text items are positioned fragments, not words.
    const text = content.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (text) { pages.push({ page: n, text }); chars += text.length; }
    page.cleanup();
    onProgress?.(n, doc.numPages);
  }
  await task.destroy();

  // A handful of characters across many pages means a scan with stray labels.
  const scanned = chars < Math.max(40, doc.numPages * 12);
  return { pages, chars, scanned, pageCount: doc.numPages };
}
