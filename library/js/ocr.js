// Reading a scan.
//
// A scanned document has no text layer: the page is a picture, and the words
// in it are pixels. Tesseract reads them back out. It is several megabytes, so
// it is never loaded until it is asked for — a phone that only ever holds text
// PDFs never pays for any of this.
//
// Two ways to ask. The first page alone is where a document says what it is,
// and it takes seconds. The whole document makes every word in it findable and
// takes as long as it takes — a few seconds a page, so a manual is an evening.
// That one is built to be interrupted: it hands back each page as it is read,
// so stopping keeps everything up to that point and starting again carries on
// from there.

import { STATUS } from './pdftext.js';

const ENGINE = new URL('../../vendor/ocr/', import.meta.url).href;

let tesseractLoaded = null;
let pdfjsLoaded = null;

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

async function pdfLib() {
  if (pdfjsLoaded) return pdfjsLoaded;
  pdfjsLoaded = (async () => {
    await import('../../vendor/polyfills.mjs');
    const pdfjs = await import('../../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL('../../vendor/pdf.worker.wrapper.mjs', import.meta.url).href;
    return pdfjs;
  })();
  return pdfjsLoaded;
}

/**
 * One reader, however many pages.
 *
 * Starting a worker costs seconds and loads the trained data again; doing that
 * per page would spend more time starting up than reading.
 */
async function reader(onStatus) {
  const Tesseract = await engine();
  return Tesseract.createWorker('eng', 1, {
    workerPath: `${ENGINE}worker.min.js`,
    corePath: ENGINE,
    langPath: ENGINE,
    gzip: true,
    logger: (m) => {
      if (m?.status === 'recognizing text') onStatus?.(Math.round((m.progress || 0) * 100));
    }
  });
}

/**
 * Draw a page as an image for the reader to look at.
 *
 * Rendered larger than the page: Tesseract reads print far better at around
 * 200 dpi than at screen size, and a scan is already a photograph, so there is
 * no detail to lose by scaling it up before reading.
 */
async function renderPage(doc, pageNumber, scale) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
  page.cleanup();
  return canvas;
}

/** Canvases hold their pixels until told otherwise; a long read needs them let go. */
function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

const tidy = (text) => String(text || '').replace(/[ \t]+\n/g, '\n').trim();

/** Too little to be a page of a document — a poor scan, or not a document. */
const tooLittle = (text) => text.replace(/\s/g, '').length < 16;

/**
 * Read the opening pages of a scan — three by default.
 *
 * Not one: a manual often opens on a cover sheet or a revision record, and
 * what the document is called is on the page after it. Three is still seconds
 * rather than the evening a whole manual takes, and it is enough to get past
 * the front matter.
 *
 * Returns the same shape the text extractor does, so everything downstream —
 * the field suggestions, the search index — treats a read scan exactly like a
 * document that had text all along.
 */
export async function readOpeningPages(buffer, { pages = 3, onProgress } = {}) {
  const collected = [];
  const walked = await readAllPages(buffer, {
    from: 1, to: pages, onProgress, scale: 2.5,
    onPage: (read) => { collected.push(read); }
  });

  if (!collected.length) {
    return { ok: false, status: STATUS.NO_TEXT, pages: [], pageCount: walked.pageCount, text: '', lastPage: walked.lastPage };
  }
  return {
    ok: true,
    status: STATUS.INDEXED,
    // Shaped exactly as the text extractor shapes a page — { page, text } —
    // because the search index reads them the same way whichever produced
    // them. Handing back bare strings stored fine and matched nothing.
    pages: collected,
    pageCount: walked.pageCount,
    lastPage: walked.lastPage,
    text: collected.map((p) => p.text).join('\n')
  };
}

/**
 * Read every page, from wherever it left off.
 *
 * Each page is handed back the moment it is read, so the caller can keep it
 * before the next one starts. That is what makes this safe to interrupt: an
 * hour of reading that is thrown away because the app was closed is worse than
 * never having started, and on a ship it is the closing that is certain.
 */
export async function readAllPages(buffer, {
  from = 1, to = Infinity, onPage, onProgress, shouldStop, scale = 2.2
} = {}) {
  const say = (note) => { try { onProgress?.(note); } catch { /* never break the read */ } };

  say('Loading the reader…');
  const pdfjs = await pdfLib();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;
  const pageCount = doc.numPages;
  const last = Math.min(to, pageCount);

  let worker = null;
  let read = 0;
  let blank = 0;
  let page = from;

  try {
    worker = await reader();
    for (; page <= last; page++) {
      if (shouldStop?.()) return { stopped: true, lastPage: page - 1, pageCount, read, blank };

      say(`Page ${page} of ${last === pageCount ? pageCount : `${last} (of ${pageCount})`}`);
      const canvas = await renderPage(doc, page, scale);
      const { data } = await worker.recognize(canvas);
      release(canvas);

      const text = tidy(data?.text);
      // A blank or unreadable page is still a page that has been looked at:
      // it counts as done, so resuming does not start on it again forever.
      if (tooLittle(text)) blank++;
      else { read++; await onPage?.({ page, text }); }
    }
    return { stopped: false, lastPage: last, pageCount, read, blank };
  } finally {
    try { await worker?.terminate(); } catch { /* nothing useful to do */ }
    try { await task.destroy(); } catch { /* nothing useful to do */ }
  }
}

/**
 * Read a picture — a photograph or a screenshot attached on its own.
 *
 * No page to render first: the file is already the image, so it goes straight
 * to the reader. A nameplate, a whiteboard, a diagram saved as a JPEG — none
 * of it was searchable before, because only PDFs were ever read.
 */
export async function readImage(blob, { onProgress } = {}) {
  const say = (note) => { try { onProgress?.(note); } catch { /* never break the read */ } };
  let worker = null;
  try {
    say('Loading the reader\u2026');
    worker = await reader();
    say('Reading the picture\u2026');
    const { data } = await worker.recognize(blob);
    const text = tidy(data?.text);
    return { ok: !tooLittle(text), text };
  } finally {
    try { await worker?.terminate(); } catch { /* nothing useful to do */ }
  }
}

/** How many pages a PDF has, without reading any of them. */
export async function countPages(buffer) {
  const pdfjs = await pdfLib();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  try {
    return (await task.promise).numPages;
  } finally {
    try { await task.destroy(); } catch { /* nothing useful to do */ }
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
