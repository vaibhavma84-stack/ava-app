// In-app document viewer.
//
// window.open() on a blob: URL does nothing in an installed iOS web app, so the
// old Open button was inert. Documents are rendered here instead: images
// directly, PDFs page by page through PDF.js, which is already vendored for
// text extraction and works with no connection.
//
// Pages render only as they scroll into view, so a three-hundred page manual
// opens immediately instead of rasterising itself first.

import { el, clear } from './ui.js';

const MAX_CANVAS_WIDTH = 1400;   // beyond this, a phone gains nothing but memory use

let pdfjs = null;
async function lib() {
  if (!pdfjs) {
    await import('../../vendor/polyfills.mjs');
    pdfjs = await import('../../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL('../../vendor/pdf.worker.wrapper.mjs', import.meta.url).href;
  }
  return pdfjs;
}

function isPdfBlob(blob, name) {
  return blob.type === 'application/pdf' || /\.pdf$/i.test(name || '');
}
function isImageBlob(blob, name) {
  return blob.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name || '');
}

/**
 * Show a stored file. Returns a teardown function the caller runs on close so
 * object URLs and the PDF task do not outlive the sheet.
 */
export async function renderInto(container, blob, name, { onStatus } = {}) {
  clear(container);

  if (isImageBlob(blob, name)) {
    const url = URL.createObjectURL(blob);
    container.append(el('img', { class: 'viewer-image', src: url, alt: name }));
    return () => URL.revokeObjectURL(url);
  }

  if (!isPdfBlob(blob, name)) {
    container.append(el('div', { class: 'empty' }, [
      el('h3', { text: 'Cannot show this file' }),
      el('p', { text: 'Only PDFs and images can be shown here. Use Save to Files to open it elsewhere.' })
    ]));
    return () => {};
  }

  const pdfjsLib = await lib();
  const task = pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await task.promise;
  onStatus?.(`${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`);

  const width = Math.min(MAX_CANVAS_WIDTH, Math.round(container.clientWidth * (window.devicePixelRatio || 1)));
  const rendered = new Set();

  const draw = async (canvas, pageNo) => {
    if (rendered.has(pageNo)) return;
    rendered.add(pageNo);
    try {
      const page = await doc.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      page.cleanup();
    } catch (ex) {
      rendered.delete(pageNo);
      console.warn('Could not draw page', pageNo, ex);
    }
  };

  // Placeholders keep the scroll height right before anything is drawn.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) draw(entry.target, Number(entry.target.dataset.page));
    }
  }, { root: container, rootMargin: '600px 0px' });

  for (let n = 1; n <= doc.numPages; n++) {
    const canvas = el('canvas', { class: 'viewer-page', 'data-page': String(n), 'aria-label': `Page ${n}` });
    canvas.style.aspectRatio = '1 / 1.414';   // A4 until the real ratio is known
    container.append(canvas);
    observer.observe(canvas);
  }

  // Draw the first page immediately so the sheet is never blank.
  const first = container.querySelector('canvas');
  if (first) await draw(first, 1);

  return () => {
    observer.disconnect();
    task.destroy().catch(() => {});
  };
}
