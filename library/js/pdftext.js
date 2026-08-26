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

async function lib() {
  if (pdfjs) return pdfjs;
  // Older WebKit lacks built-ins PDF.js assumes; install them before it loads.
  await import('../../vendor/polyfills.mjs');
  pdfjs = await import('../../vendor/pdf.min.mjs');
  // The wrapper installs the same polyfill inside the worker scope.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.wrapper.mjs', import.meta.url).href;
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
    // Include where it failed: "undefined is not a function" alone says nothing
    // about which call was missing.
    const frame = String(ex?.stack || '').split('\n').find((l) => /\.mjs/.test(l)) || '';
    return {
      status: encrypted ? STATUS.ENCRYPTED : STATUS.FAILED,
      pages: [], chars: 0, pageCount: 0,
      error: `${ex?.name || 'Error'}: ${message}`.slice(0, 160)
           + (frame ? ` — ${frame.trim().slice(0, 90)}` : '')
    };
  } finally {
    try { await task?.destroy(); } catch { /* nothing useful to do */ }
  }
}

/**
 * Read just enough of a PDF to describe it: its embedded metadata and the text
 * of the first page, with the largest lines picked out. Only one page is
 * parsed, so this is quick enough to run the moment a file is chosen.
 */
export async function describe(buffer) {
  let task = null;
  try {
    const pdfjsLib = await lib();
    task = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const doc = await task.promise;

    let info = {};
    try { ({ info } = await doc.getMetadata()); } catch { /* often absent */ }

    const page = await doc.getPage(1);
    const content = await page.getTextContent();

    // Group text fragments into lines by their vertical position, and keep the
    // drawn height of each: a title is usually simply the biggest text there.
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const size = Math.abs(item.transform[0]) || item.height || 0;
      const line = lines.get(y) || { y, size: 0, text: '' };
      line.size = Math.max(line.size, size);
      line.text += item.str;
      lines.set(y, line);
    }
    const ordered = [...lines.values()]
      .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
      .filter((l) => l.text.length > 1);

    const firstPageText = ordered
      .slice()
      .sort((a, b) => b.y - a.y)          // PDF y grows upward, so top first
      .map((l) => l.text)
      .join('\n');

    // A heading often wraps: "Admiralty List of Radio" / "Signals" are two
    // lines of one title. Join neighbouring lines drawn at the same size so the
    // title comes back whole rather than truncated at the line break.
    const byY = ordered.slice().sort((a, b) => b.y - a.y);
    const blocks = [];
    for (const line of byY) {
      const prev = blocks[blocks.length - 1];
      const sameSize = prev && Math.abs(prev.size - line.size) <= Math.max(0.6, prev.size * 0.06);
      const adjacent = prev && (prev.lastY - line.y) <= prev.size * 1.9;
      if (sameSize && adjacent) {
        prev.text += ' ' + line.text;
        prev.lastY = line.y;
      } else {
        blocks.push({ size: line.size, text: line.text, y: line.y, lastY: line.y });
      }
    }
    const biggest = blocks.slice().sort((a, b) => b.size - a.size || b.y - a.y);
    page.cleanup();

    return {
      ok: true,
      info: info || {},
      pageCount: doc.numPages,
      firstPageText,
      largestLines: biggest.slice(0, 6).map((l) => l.text)
    };
  } catch (ex) {
    return { ok: false, info: {}, pageCount: 0, firstPageText: '', largestLines: [],
             error: String(ex?.message || ex) };
  } finally {
    try { await task?.destroy(); } catch { /* nothing useful to do */ }
  }
}

/** Round-trip a tiny built-in PDF, to prove the engine works on this device. */
export const SELF_TEST_PDF_B64 =
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
    const raw = atob(SELF_TEST_PDF_B64);
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
