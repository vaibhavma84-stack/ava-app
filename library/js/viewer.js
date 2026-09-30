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

export async function renderInto(container, blob, name, { onStatus, startPage = 1, book = false, onLayout } = {}) {
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

  if (/epub/i.test(blob?.type || '') || /\.epub$/i.test(String(name || ''))) {
    const { renderEpub } = await import('./epub.js');
    return renderEpub(container, blob, { onStatus, startPage });
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
      // Its real shape is known now, rather than A4.
      if (bookOn && !canvas.classList.contains('book-off')) { fit(canvas); onLayout?.(); }
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
  }, { root: container, rootMargin: '600px 600px' });

  for (let n = 1; n <= doc.numPages; n++) {
    const canvas = el('canvas', { class: 'viewer-page', 'data-page': String(n), 'aria-label': `Page ${n}` });
    canvas.style.aspectRatio = '1 / 1.414';   // A4 until the real ratio is known
    container.append(canvas);
    observer.observe(canvas);
  }

  // ── book view ───────────────────────────────────────────────────────────
  //
  // One page to the screen, turned the way a book's are. The pages do not
  // scroll: they lie stacked where they are, the finger moves the page it is
  // on directly, and letting go finishes the turn -- or lets the page fall
  // back -- as an animation the phone's graphics hardware runs by itself.
  // Tying the turn to the scroll made each frame wait for script to catch up
  // with a scroll that had already moved, and that is what juddered.
  //
  // Going forward the page lifts from its right edge and swings over on its
  // spine, uncovering the next lying beneath it, which comes out of shadow as
  // it is uncovered; going back the previous page swings back over. Only the
  // page on screen and the ones either side of it are laid out at all.
  let bookOn = false;
  let current = 1;
  let busy = false;
  let suppressClick = false;
  const pageEl = (n) => container.querySelector(`canvas[data-page="${n}"]`);
  const shade = el('div', { class: 'book-shade' });
  const SPINE = 'perspective(1800px) rotateY';
  const EASE = 'transform 300ms cubic-bezier(.2,.75,.25,1), opacity 300ms ease-out';

  const fit = (canvas) => {
    const W = container.clientWidth;
    const H = container.clientHeight;
    const ratio = canvas.width && canvas.height ? canvas.height / canvas.width : 1.414;
    const w = Math.min(W, H / ratio);
    const h = w * ratio;
    Object.assign(canvas.style, {
      width: `${w}px`, height: `${h}px`, aspectRatio: '', margin: '0',
      left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px`
    });
  };

  // At rest: the page on screen on top, its neighbours ready beneath it and
  // folded back, everything else not laid out.
  const place = () => {
    for (const canvas of container.querySelectorAll('canvas[data-page]')) {
      const n = Number(canvas.dataset.page);
      const near = Math.abs(n - current) <= 1;
      canvas.classList.toggle('book-off', !near);
      if (!near) continue;
      fit(canvas);
      canvas.style.transition = '';
      canvas.style.transformOrigin = 'left center';
      canvas.style.transform = n === current - 1 ? `${SPINE}(-90deg)` : '';
      canvas.style.opacity = n === current ? '1' : '0';
      canvas.style.zIndex = n === current ? '2' : '1';
    }
    shade.style.transition = '';
    shade.style.opacity = '0';
    container.classList.remove('turning');
    container.dataset.current = String(current);
    onLayout?.();
    // Everything that watches the page in view listens for a scroll.
    container.dispatchEvent(new Event('scroll'));
  };

  // How far a turn has gone, 0 to 1. dir 1 is forward, -1 back.
  const progress = (dir, q) => {
    const turning = pageEl(dir > 0 ? current : current - 1);
    const under = pageEl(dir > 0 ? current + 1 : current);
    if (!turning || !under) return;
    // Notes and highlights belong to the page at rest; they step aside while
    // it moves rather than hang in the air over it.
    container.classList.add('turning');
    under.style.opacity = '1';
    under.style.zIndex = '1';
    turning.style.opacity = '1';
    turning.style.zIndex = '3';
    turning.style.transformOrigin = 'left center';
    turning.style.transform = `${SPINE}(${dir > 0 ? -q * 90 : -(1 - q) * 90}deg)`;
    shade.style.opacity = String((dir > 0 ? 1 - q : q) * 0.4);
  };

  const finish = (dir, complete, from) => {
    busy = true;
    const turning = pageEl(dir > 0 ? current : current - 1);
    for (const node of [turning, shade]) if (node) node.style.transition = EASE;
    // Laid down first, so the animation starts from where the finger left it.
    progress(dir, from);
    void container.offsetWidth;
    progress(dir, complete ? 1 : 0);
    setTimeout(() => {
      if (complete) current += dir;
      busy = false;
      place();
    }, 320);
  };

  let drag = null;
  container.addEventListener('pointerdown', (e) => {
    if (!bookOn || busy || container.classList.contains('marking')) return;
    if (!e.target.closest?.('canvas[data-page]')) return;
    drag = { x: e.clientX, t: performance.now(), dir: 0, q: 0, id: e.pointerId };
  });
  container.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.dir) {
      if (Math.abs(dx) < 8) return;
      drag.dir = dx < 0 ? 1 : -1;
      if (!pageEl(current + (drag.dir > 0 ? 1 : -1))) { drag = null; return; }
      try { container.setPointerCapture(drag.id); } catch { /* already gone */ }
    }
    e.preventDefault();
    drag.q = Math.min(Math.max((-dx * drag.dir) / (container.clientWidth * 0.8), 0), 1);
    drag.speed = dx / Math.max(performance.now() - drag.t, 1);
    progress(drag.dir, drag.q);
  });
  const release = () => {
    if (!drag) return;
    const { dir, q } = drag;
    const flick = Math.abs(drag.speed || 0) > 0.45 && Math.sign(-(drag.speed || 0)) === dir;
    drag = null;
    if (!dir) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    finish(dir, q > 0.35 || (q > 0.06 && flick), q);
  };
  container.addEventListener('pointerup', release);
  container.addEventListener('pointercancel', release);
  // A swipe ends in a click as well; it is not a tap on the page.
  container.addEventListener('click', (e) => {
    if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  const onResize = () => { if (bookOn) place(); };
  window.addEventListener('resize', onResize);

  const setBook = (on, page) => {
    bookOn = on;
    container.classList.toggle('book', on);
    if (on) {
      current = Math.min(Math.max(1, page || 1), doc.numPages);
      container.append(shade);
      container.scrollTop = 0;
      place();
      return;
    }
    shade.remove();
    for (const canvas of container.querySelectorAll('canvas[data-page]')) {
      canvas.classList.remove('book-off');
      Object.assign(canvas.style, {
        width: '', height: '', left: '', top: '', margin: '', transform: '', transformOrigin: '',
        transition: '', opacity: '', zIndex: '', aspectRatio: canvas.width ? '' : '1 / 1.414'
      });
    }
    delete container.dataset.current;
    pageEl(page)?.scrollIntoView({ block: 'start' });
    onLayout?.();
  };

  // Draw the page being jumped to first, so the sheet is never blank and a
  // search result lands where it should rather than at the front of the book.
  const target = Math.min(Math.max(1, startPage), doc.numPages);
  const wanted = container.querySelector(`canvas[data-page="${target}"]`);
  if (wanted) {
    await draw(wanted, target);
    if (book) setBook(true, target);
    else if (target > 1) wanted.scrollIntoView({ block: 'start' });
  }

  const teardown = () => {
    observer.disconnect();
    window.removeEventListener('resize', onResize);
    container.classList.remove('book');
    task.destroy().catch(() => {});
  };
  teardown.setBook = setBook;
  teardown.isBook = () => bookOn;
  /** Turn to a page, in either view. */
  teardown.goTo = (page) => {
    const at = pageEl(page);
    if (!at) return;
    if (!bookOn) { at.scrollIntoView({ block: 'start' }); return; }
    if (busy || page === current) return;
    // The next or the previous page turns; further than that, it opens there.
    if (Math.abs(page - current) === 1) finish(page > current ? 1 : -1, true, 0);
    else { current = page; place(); }
  };
  teardown.current = () => (bookOn ? current : null);
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
