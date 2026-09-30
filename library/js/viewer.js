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
const isTextBlob = (blob, name) =>
  /^text\//i.test(blob?.type || '') || /\.txt$/i.test(String(name || ''));

export async function renderInto(container, blob, name, { onStatus, startPage = 1 } = {}) {
  clear(container);

  if (isImageBlob(blob, name)) {
    const url = URL.createObjectURL(blob);
    container.append(el('img', { class: 'viewer-image', src: url, alt: name }));
    return () => URL.revokeObjectURL(url);
  }

  // A notice that its administration publishes as a page rather than a file is
  // mirrored as its words. There is nothing to lay out — showing it is showing
  // the text — but it still has to be readable rather than only searchable.
  if (isTextBlob(blob, name)) {
    const words = await blob.text();
    onStatus?.(`${words.split(/\n+/).filter(Boolean).length} lines`);
    container.append(el('pre', { class: 'viewer-text', text: words }));
    return () => {};
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
  // What to highlight: given the words of one text fragment, the [start, end]
  // of each part of it to mark. Null for nothing.
  let marks = null;

  const draw = async (canvas, pageNo) => {
    if (rendered.has(pageNo)) return;
    rendered.add(pageNo);
    try {
      const page = await doc.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (marks) await highlight(page, viewport, ctx, marks);
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

  // Draw the page being jumped to first, so the sheet is never blank and a
  // search result lands where it should rather than at the front of the book.
  const target = Math.min(Math.max(1, startPage), doc.numPages);
  const wanted = container.querySelector(`canvas[data-page="${target}"]`);
  if (wanted) {
    await draw(wanted, target);
    if (target > 1) wanted.scrollIntoView({ block: 'start' });
  }

  const teardown = () => {
    observer.disconnect();
    task.destroy().catch(() => {});
  };
  // Highlight something new: every page already drawn is drawn again with it,
  // and pages drawn later pick it up as they come into view.
  teardown.setMarks = async (next) => {
    marks = next;
    const drawn = [...rendered];
    rendered.clear();
    for (const n of drawn) {
      const canvas = container.querySelector(`canvas[data-page="${n}"]`);
      if (canvas) await draw(canvas, n);
    }
  };
  // What is written inside a rectangle of a page, for a highlight: the text
  // and the tight boxes around it, both in fractions of the page.
  teardown.pick = (pageNo, rect) => pickText(doc, pageNo, rect);
  return teardown;
}

let measurer = null;
function widths(str, fontFamily, size) {
  measurer = measurer || document.createElement('canvas').getContext('2d');
  measurer.font = `${Math.max(Math.round(size), 1)}px ${fontFamily || 'sans-serif'}`;
  const edges = [0];
  for (let i = 1; i <= str.length; i++) edges.push(measurer.measureText(str.slice(0, i)).width);
  return edges;
}

/**
 * The words a dragged rectangle covers.
 *
 * Every fragment of the page's text that the rectangle crosses, cut to the
 * letters inside it, and the box around each -- so a sweep across half a line
 * marks those words and not the whole line. Returned as fractions of the page
 * so it lands in the same place at any width. A scan has no text layer; its
 * highlight is the rectangle itself, with no words.
 */
async function pickText(doc, pageNo, rect) {
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const W = viewport.width;
  const H = viewport.height;
  const content = await page.getTextContent();
  const { Util } = pdfjs;
  const r = { x0: rect.x * W, y0: rect.y * H, x1: (rect.x + rect.w) * W, y1: (rect.y + rect.h) * H };
  const parts = [];

  for (const item of content.items) {
    const str = item.str || '';
    if (!str.trim()) continue;
    const tx = Util.transform(viewport.transform, item.transform);
    const h = Math.hypot(tx[2], tx[3]) || 10;
    const top = tx[5] - h * 0.95;
    const bottom = tx[5] + h * 0.25;
    // Crossed by the rectangle for a good part of the line's height, not
    // grazed by its edge -- or a sweep along one line takes the next one too.
    const overlap = Math.min(bottom, r.y1) - Math.max(top, r.y0);
    if (overlap < (bottom - top) * 0.4) continue;
    const length = item.width || 0;
    if (tx[4] > r.x1 || tx[4] + length < r.x0) continue;

    const edges = widths(str, content.styles?.[item.fontName]?.fontFamily, h);
    const k = length / (edges[edges.length - 1] || 1);
    let from = 0;
    while (from < str.length && tx[4] + edges[from + 1] * k <= r.x0) from++;
    let to = str.length;
    while (to > from && tx[4] + edges[to - 1] * k >= r.x1) to--;
    const text = str.slice(from, to);
    if (!text.trim()) continue;
    parts.push({
      text, top, bottom, baseline: tx[5],
      x: tx[4] + edges[from] * k,
      right: tx[4] + edges[to] * k
    });
  }
  page.cleanup();

  if (!parts.length) return { text: '', rects: [rect] };

  // Into lines, top to bottom and left to right; a line's pieces become one
  // box, the way a highlighter pen goes along it.
  parts.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines = [];
  for (const p of parts) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.baseline - p.baseline) < (p.bottom - p.top) * 0.5) {
      line.pieces.push(p);
      line.x = Math.min(line.x, p.x); line.right = Math.max(line.right, p.right);
      line.top = Math.min(line.top, p.top); line.bottom = Math.max(line.bottom, p.bottom);
    } else {
      lines.push({ baseline: p.baseline, pieces: [p], x: p.x, right: p.right, top: p.top, bottom: p.bottom });
    }
  }
  const join = (pieces) => pieces.sort((a, b) => a.x - b.x)
    .reduce((out, p) => (out && !/\s$/.test(out) && !/^\s/.test(p.text) ? `${out} ${p.text}` : out + p.text), '');
  return {
    // A sweep that starts a hair early takes the colon before the word.
    text: lines.map((l) => join(l.pieces).replace(/\s+/g, ' ').trim()).join('\n')
      .replace(/^[\s:;,.)\]–—-]+/, '').replace(/[\s:;,(\[–—-]+$/, ''),
    rects: lines.map((l) => ({ x: l.x / W, y: l.top / H, w: (l.right - l.x) / W, h: (l.bottom - l.top) / H }))
  };
}

/**
 * Paint the parts of a page the search found, over the page itself.
 *
 * Where each word is comes from the page's text layer: every fragment has a
 * position and a width, and a word inside a fragment is placed along it by
 * its share of the characters. Close enough to put a mark on the right word;
 * a scan has no text layer, and gets no marks, only the jump to its page.
 */
async function highlight(page, viewport, ctx, marks) {
  const content = await page.getTextContent();
  const { Util } = pdfjs;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 196, 0, 0.42)';
  ctx.globalCompositeOperation = 'multiply';
  for (const item of content.items) {
    const str = item.str || '';
    if (!str.trim()) continue;
    const spans = marks(str);
    if (!spans?.length) continue;
    const tx = Util.transform(viewport.transform, item.transform);
    const height = Math.hypot(tx[2], tx[3]) || 10;
    const length = (item.width || 0) * viewport.scale;
    // Measured in a font like the page's, then scaled to the fragment's real
    // width: an "i" is narrower than an "m", and a share of the characters
    // puts the mark a word out along a long line.
    ctx.font = `${Math.max(Math.round(height), 1)}px ${content.styles?.[item.fontName]?.fontFamily || 'sans-serif'}`;
    const whole = ctx.measureText(str).width || str.length;
    const k = length / whole;
    for (const [s, e] of spans) {
      const x = tx[4] + ctx.measureText(str.slice(0, s)).width * k;
      const w = Math.max(ctx.measureText(str.slice(s, e)).width * k, 3);
      ctx.fillRect(x - 1, tx[5] - height * 0.95, w + 2, height * 1.2);
    }
  }
  ctx.restore();
}
