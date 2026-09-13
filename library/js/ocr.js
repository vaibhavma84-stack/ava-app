// Reading a scan.
//
// A scanned document has no text layer: the page is a picture, and the words
// in it are pixels. Tesseract reads them back out. It is several megabytes, so
// it is never loaded until it is asked for — a phone that only ever holds text
// PDFs never pays for any of this.
//
// Only the first page, deliberately. That is where a document says what it is,
// and it is a few seconds rather than the hour a whole manual would take. The
// rest of the pages are a separate question with a separate answer.

import { STATUS } from './pdftext.js';

const ENGINE = new URL('../../vendor/ocr/', import.meta.url).href;

let tesseractLoaded = null;

/** Load the engine once, from this site rather than from a CDN. */
async function engine() {
  if (tesseractLoaded) return tesseractLoaded;
  tesseractLoaded = (async () => {
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${ENGINE}tesseract.min.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('The reader could not be loaded'));
        document.head.append(script);
      });
    }
    if (!window.Tesseract) throw new Error('The reader loaded but did not start');
    return window.Tesseract;
  })();
  return tesseractLoaded;
}

/**
 * Draw a PDF page as an image for the reader to look at.
 *
 * Rendered larger than the page: Tesseract reads print far better at around
 * 200 dpi than at screen size, and a scan that is already a photograph has no
 * detail to lose from being scaled up before it is read.
 */
async function pageAsImage(pdfjs, buffer, pageNumber, scale) {
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    page.cleanup();
    return { canvas, pageCount: doc.numPages };
  } finally {
    try { await task.destroy(); } catch { /* nothing useful to do */ }
  }
}

/**
 * Read the first page of a scan.
 *
 * Returns the same shape the text extractor does, so everything downstream —
 * the field suggestions, the search index — treats a read scan exactly like a
 * document that had text all along.
 */
export async function readFirstPage(buffer, { onProgress, scale = 2.5 } = {}) {
  const say = (note) => { try { onProgress?.(note); } catch { /* a report must never break the read */ } };

  say('Loading the reader…');
  const Tesseract = await engine();

  say('Drawing the page…');
  await import('../../vendor/polyfills.mjs');
  const pdfjs = await import('../../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.wrapper.mjs', import.meta.url).href;
  const { canvas, pageCount } = await pageAsImage(pdfjs, buffer, 1, scale);

  say('Reading the page…');
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: `${ENGINE}worker.min.js`,
    corePath: ENGINE,
    langPath: ENGINE,
    gzip: true,
    logger: (m) => {
      if (m?.status === 'recognizing text') say(`Reading the page… ${Math.round((m.progress || 0) * 100)}%`);
    }
  });

  try {
    const { data } = await worker.recognize(canvas);
    const text = String(data?.text || '').replace(/[ \t]+\n/g, '\n').trim();

    // A page that yields almost nothing is a page the reader could not make
    // out — a poor scan, or a photograph of something that is not a document.
    // Saying so is more useful than handing back three characters of noise.
    if (text.replace(/\s/g, '').length < 16) {
      return { ok: false, status: STATUS.NO_TEXT, pages: [], pageCount, text: '' };
    }
    return { ok: true, status: STATUS.INDEXED, pages: [text], pageCount, text };
  } finally {
    try { await worker.terminate(); } catch { /* nothing useful to do */ }
  }
}

/**
 * What `describe()` gives for a text PDF, built from what was read instead.
 *
 * The suggestions work on lines and on the largest text; a read page has the
 * lines but no type sizes, so the first few stand in as the headings — which
 * on a circular or a manual is where the title actually is.
 */
export function describeFromText(text, pageCount) {
  const lines = String(text).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return {
    ok: true,
    info: {},
    pageCount,
    firstPageText: lines.join('\n'),
    largestLines: lines.slice(0, 6)
  };
}
