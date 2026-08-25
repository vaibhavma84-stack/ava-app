// PDF text extraction, entirely on-device.
//
// PDF.js is self-hosted in ../vendor so this works with no connection. It reads
// the text layer a PDF carries. A scanned page is an image and has no text
// layer, so nothing can be extracted without OCR.
//
// The two outcomes are reported separately, because they need different
// responses: a scan needs OCR, whereas a failure is a bug or a limit worth
// knowing about. Collapsing both into "scanned" hides real problems.

let pdfjs = null;

/** PDF.js 5 calls Math.sumPrecise, which older WebKit lacks. */
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
  // The wrapper installs the same polyfill inside the worker scope.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.wrapper.mjs', import.meta.url).href;
  return pdfjs;
}

export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

export const STATUS = {
  INDEXED: 'indexed',     // text found and stored
  NO_TEXT: 'no-text',     // parsed fine, but carries no text layer (a scan)
  FAILED: 'failed',       // could not be read at all
  ENCRYPTED: 'encrypted'  // password protected
};

/**
 * Extract text page by page.
 * @returns { status, pages, chars, pageCount, error }
 * Never throws: the caller needs the reason, not an exception.
 */
export async function extract(buffer, { onProgress } = {}) {
  let task = null;
  try {
    const pdfjsLib = await lib();
    task = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const doc = await task.promise;

    const pages = [];
    let chars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) { pages.push({ page: n, text }); chars += text.length; }
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }

    // Bias toward treating text as real. Wrongly calling a scan "indexed" costs
    // nothing — a search simply finds little. Wrongly calling a document a scan
    // silently removes it from search, which is the failure that matters. A
    // genuine scan yields zero or a handful of stray characters, so only that
    // counts as no text layer.
    const meaningful = chars >= 16;
    return {
      status: meaningful ? STATUS.INDEXED : STATUS.NO_TEXT,
      pages: meaningful ? pages : [],
      chars,
      pageCount: doc.numPages,
      error: null
    };
  } catch (ex) {
    const message = String(ex?.message || ex);
    const encrypted = /password|encrypted/i.test(message) || ex?.name === 'PasswordException';
    return {
      status: encrypted ? STATUS.ENCRYPTED : STATUS.FAILED,
      pages: [], chars: 0, pageCount: 0,
      error: message.slice(0, 200)
    };
  } finally {
    try { await task?.destroy(); } catch { /* nothing useful to do */ }
  }
}

/** Round-trip a tiny built-in PDF, to prove the engine works on this device. */
const SELF_TEST_PDF =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoK' +
  'PDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUg' +
  'L1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8' +
  'IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQg' +
  'L1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGgg' +
  'NTggPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiA3MiA3MDAgVGQgKEFWQUxJQlJBUllTRUxGVEVTVCByZWFkcyBmaW5l' +
  'KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAw' +
  'MDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBu' +
  'IAowMDAwMDAwMzE4IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYK' +
  'NDI4CiUlRU9GCg==';

export async function selfTest() {
  try {
    const raw = atob(SELF_TEST_PDF);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const result = await extract(bytes.buffer);
    const found = result.pages.some((p) => p.text.includes('AVALIBRARYSELFTEST'));
    return {
      ok: found,
      status: result.status,
      chars: result.chars,
      error: result.error,
      sample: result.pages[0]?.text?.slice(0, 60) || ''
    };
  } catch (ex) {
    return { ok: false, status: 'failed', chars: 0, error: String(ex?.message || ex), sample: '' };
  }
}
