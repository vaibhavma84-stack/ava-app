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
import { docSource } from './pdfsource.js';

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
  const task = pdfjsLib.getDocument(await docSource(pdfjsLib, blob));
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
      if (bookOn && !canvas.classList.contains('book-off')) {
        fit(canvas);
        onLayout?.();
        // Drawn again -- marks added, or its real shape known -- so strips
        // cut from it before are out of date.
        forget(pageNo);
        prepare();
      }
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

  // ── the roll ──
  //
  // A page is turned the way paper turns: it rolls up from its edge round a
  // cylinder that travels across it, the part already over lying flat on its
  // back beyond the roll. The page is cut into narrow strips when a turn
  // begins -- each a copy of its slice of the page, drawn once -- and every
  // strip is placed where the cylinder puts it: flat before the roll, round it
  // tilted to its tangent and lifted towards the reader, face down after it.
  // Only where each strip is and how shaded it is change as the finger moves,
  // and those the phone's graphics hardware moves by itself.
  let curl = null;

  // Cutting a page into its strips takes a moment -- long enough, done when
  // the finger lands, to make the start of a turn catch. So it is done
  // ahead, while the page lies still: for the page on screen and the one
  // before it, a few strips a frame, kept out of sight until a turn needs
  // them. A turn that comes before they are ready finishes the cutting then.
  //
  // A page taken by its top or bottom corner rolls on the slant, that corner
  // first, the way a page does when a book is turned by its corner. The
  // strips then run along the slant, so the page is cut three ways -- straight,
  // and slanted each way -- all ahead of time. The slant is set by where the
  // finger lands and kept for the turn: cutting afresh for every angle as the
  // finger moves is the catch this was built to avoid.
  const TILT = 0.2;          // radians, about 11 degrees
  const ready = new Map();   // "page|tilt" -> strips cut for it
  const keyOf = (page, tilt) => `${page}|${tilt}`;
  const sizeOf = (canvas) => `${parseFloat(canvas.style.width)}x${parseFloat(canvas.style.height)}x${canvas.width}`;

  const startCurl = (canvas, tilt) => {
    const w = parseFloat(canvas.style.width);
    const h = parseFloat(canvas.style.height);
    const phi = tilt * TILT;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    // The page in the turned frame: u across the roll, v along it.
    const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
    const us = corners.map((c) => c[0]);
    const vs = corners.map((c) => c[1]);
    const umin = Math.min(...us), umax = Math.max(...us);
    const vmin = Math.min(...vs), vmax = Math.max(...vs);

    const layer = el('div', { class: 'curl' });
    Object.assign(layer.style, {
      left: canvas.style.left, top: canvas.style.top, width: `${w}px`, height: `${h}px`, display: 'none'
    });
    const frame = el('div', { class: 'curl-frame' });
    frame.style.transform = `rotateZ(${phi}rad)`;
    // The shadow the roll casts on the page it is uncovering, kept to the page.
    const castClip = el('div', { class: 'curl-cast-clip' });
    Object.assign(castClip.style, {
      left: `${umin}px`, top: `${vmin}px`, width: `${umax - umin}px`, height: `${vmax - vmin}px`,
      clipPath: tilt ? `polygon(${corners.map(([u, v]) => `${(u - umin).toFixed(2)}px ${(v - vmin).toFixed(2)}px`).join(',')})` : ''
    });
    const cast = el('div', { class: 'curl-cast' });
    castClip.append(cast);
    frame.append(castClip);
    layer.append(frame);
    container.append(layer);
    // About one strip to every two points across the roll -- some 170 on a
    // phone, at most 200. Finer than that the roll looks no rounder, and each
    // strip is one more thing for the phone to move every frame.
    const count = Math.max(40, Math.min(200, Math.round((umax - umin) / 2)));
    return { layer, frame, strips: [], count, w, h, canvas, cast, tilt, phi, cos, sin, corners, umin, umax, vmin, vmax,
      page: Number(canvas.dataset.page), size: sizeOf(canvas) };
  };

  const cutStrips = (c, upTo) => {
    const span = c.umax - c.umin;
    const su = span / c.count;
    const len = c.vmax - c.vmin;
    const scale = c.canvas.width / c.w;          // page pixels to the point
    for (let i = c.strips.length; i < Math.min(upTo, c.count); i++) {
      const u0 = c.umin + i * su;
      const strip = el('div', { class: 'curl-strip' });
      // A hair wider than its share, so no seam of light shows between them.
      Object.assign(strip.style, { width: `${su + 0.6}px`, height: `${len}px` });
      const face = document.createElement('canvas');
      face.className = 'curl-face';
      face.width = Math.max(1, Math.ceil((su + 0.6) * scale));
      face.height = Math.max(1, Math.ceil(len * scale));
      const ctx = face.getContext('2d');
      if (!c.tilt) {
        ctx.drawImage(c.canvas, u0 * scale, 0, (su + 0.6) * scale, c.canvas.height, 0, 0, face.width, face.height);
      } else {
        // The page, turned into the strip's frame: local = R(-phi) * page.
        ctx.setTransform(new DOMMatrix()
          .translate(-u0 * scale, -c.vmin * scale)
          .rotate(0, 0, -c.phi * 180 / Math.PI));
        ctx.drawImage(c.canvas, 0, 0);
      }
      let dark, backDark, back;
      if (!c.tilt) {
        dark = el('div', { class: 'curl-dark' });
        backDark = el('div', { class: 'curl-dark' });
        back = el('div', { class: 'curl-back' }, [backDark]);
      } else {
        // Only the page, not the corners of the band beyond it. The face is
        // cut to it already -- it is transparent outside -- and the shading
        // and the paper back are drawn to the same shape. Not trimmed with a
        // clip: a clipped layer turned in 3D breaks up into fragments.
        // Drawn narrow and stretched: flat colour needs little detail.
        const bw = su + 0.6;
        const shape = (colour, mirror) => {
          const shaped = document.createElement('canvas');
          shaped.width = 4;
          shaped.height = Math.max(2, Math.ceil(len * 1.5));
          const sx = shaped.width / bw;
          const sy = shaped.height / len;
          const g = shaped.getContext('2d');
          g.fillStyle = colour;
          g.beginPath();
          for (const [u, v] of c.corners) {
            const x = u - u0;
            g.lineTo((mirror ? bw - x : x) * sx, (v - c.vmin) * sy);
          }
          g.fill();
          return shaped;
        };
        dark = shape('#000', false);
        dark.className = 'curl-dark shaped';
        // The back is turned over, so what is left of it is on the right.
        backDark = shape('#000', true);
        backDark.className = 'curl-dark shaped';
        const paper = shape('#f4f2ed', true);
        paper.className = 'curl-paper';
        back = el('div', { class: 'curl-back shaped' }, [paper, backDark]);
      }
      strip.append(face, dark, back);
      c.frame.append(strip);
      c.strips.push({ strip, dark, backDark, u0 });
    }
  };

  const forget = (page) => {
    for (const [key, c] of [...ready]) {
      if (c.page === page) { c.layer.remove(); ready.delete(key); }
    }
  };

  let preparing = 0;
  const prepare = () => {
    clearTimeout(preparing);
    preparing = setTimeout(() => {
      if (!bookOn || busy) return;
      // Forward: this page, straight or by either corner. Back: the page
      // before, straight.
      const wanted = [[current, 0], [current, -1], [current, 1], [current - 1, 0]];
      const keep = new Set(wanted.map(([p, t]) => keyOf(p, t)));
      for (const [key, c] of [...ready]) if (!keep.has(key)) { c.layer.remove(); ready.delete(key); }
      const queue = [];
      for (const [page, tilt] of wanted) {
        const canvas = pageEl(page);
        if (!canvas || !canvas.width || canvas.classList.contains('book-off')) continue;
        const key = keyOf(page, tilt);
        const had = ready.get(key);
        if (had && had.size === sizeOf(canvas)) continue;
        if (had) { had.layer.remove(); ready.delete(key); }
        const c = startCurl(canvas, tilt);
        ready.set(key, c);
        queue.push([key, c]);
      }
      // One after another, a few strips a frame, straight ones first.
      const more = () => {
        while (queue.length && (ready.get(queue[0][0]) !== queue[0][1] || queue[0][1].strips.length >= queue[0][1].count)) queue.shift();
        if (!queue.length || busy) return;
        const c = queue[0][1];
        cutStrips(c, c.strips.length + 20);
        requestAnimationFrame(more);
      };
      requestAnimationFrame(more);
    }, 120);
  };

  const takeCurl = (canvas, tilt) => {
    const page = Number(canvas.dataset.page);
    const key = keyOf(page, tilt);
    let c = ready.get(key);
    if (!c || c.size !== sizeOf(canvas)) { if (c) c.layer.remove(); c = startCurl(canvas, tilt); }
    ready.delete(key);
    cutStrips(c, c.count);
    c.layer.style.display = '';
    return c;
  };

  // q: how far the page has rolled over, 0 flat to 1 gone.
  const rollTo = (q) => {
    const { strips, umin, umax, vmin } = curl;
    const R = Math.max(curl.w * 0.1, 22);
    const a = umax - q * (umax - umin + Math.PI * R + 6);
    for (const s of strips) {
      const x = s.u0 - a;
      let X = s.u0;
      let Z = 0;
      let th = 0;
      if (x > 0) {
        th = x / R;
        if (th < Math.PI) {
          X = a + R * Math.sin(th);
          Z = R * (1 - Math.cos(th));
        } else {
          th = Math.PI;
          X = a - (x - Math.PI * R);
          Z = 2 * R;
        }
      }
      s.strip.style.transform = `translate3d(${X.toFixed(2)}px,${vmin.toFixed(2)}px,${Z.toFixed(2)}px) rotateY(${(-th).toFixed(4)}rad)`;
      // Light from in front: the face darkens as it turns away up the roll,
      // the back is darkest where it comes over the top and lightens as it
      // lies down flat. Smooth from strip to strip, so the roll reads as one
      // curved sheet rather than a row of slats.
      s.dark.style.opacity = th < Math.PI / 2 ? ((1 - Math.cos(th)) * 0.42).toFixed(3) : '0.42';
      s.backDark.style.opacity = th > Math.PI / 2 ? ((1 + Math.cos(th)) * 0.38).toFixed(3) : '0.38';
    }
    // Cast from the top of the roll across the page beneath, deepest as the
    // page stands up and fading as it lies down on the far side.
    const edge = Math.min(a + R, umax);
    Object.assign(curl.cast.style, {
      transform: `translateX(${(edge - umin).toFixed(1)}px)`,
      width: `${(R * 1.6).toFixed(1)}px`,
      opacity: (Math.sin(Math.min(q, 1) * Math.PI) * 0.9 + (q > 0 ? 0.1 : 0)).toFixed(3)
    });
  };

  const endCurl = () => {
    if (!curl) return;
    curl.layer.remove();
    curl.canvas.style.visibility = '';
    curl = null;
  };
  const forgetAll = () => { for (const c of ready.values()) c.layer.remove(); ready.clear(); };

  // At rest: the page on screen on top, its neighbours ready beneath it,
  // everything else not laid out.
  const place = () => {
    endCurl();
    for (const canvas of container.querySelectorAll('canvas[data-page]')) {
      const n = Number(canvas.dataset.page);
      const near = Math.abs(n - current) <= 1;
      canvas.classList.toggle('book-off', !near);
      if (!near) continue;
      fit(canvas);
      canvas.style.transition = '';
      canvas.style.transformOrigin = 'left center';
      canvas.style.transform = '';
      canvas.style.visibility = '';
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
    prepare();
  };

  // How far a turn has gone, 0 to 1. dir 1 is forward, -1 back.
  const progress = (dir, q, tilt = 0) => {
    const turning = pageEl(dir > 0 ? current : current - 1);
    const under = pageEl(dir > 0 ? current + 1 : current);
    if (!turning || !under) return;
    // Notes and highlights belong to the page at rest; they step aside while
    // it moves rather than hang in the air over it.
    container.classList.add('turning');
    under.style.opacity = '1';
    under.style.zIndex = '1';
    // Forward, the page on screen rolls away; back, the previous page rolls
    // back over it from the left.
    const rolled = dir > 0 ? q : 1 - q;
    if (!curl && turning.width) {
      // Only a forward turn is taken by a corner; the page coming back
      // over from the left comes straight.
      curl = takeCurl(turning, dir > 0 ? tilt : 0);
      turning.style.visibility = 'hidden';
    }
    if (curl) rollTo(rolled);
    else {
      // Not drawn yet, so there is nothing to cut into strips: it swings.
      turning.style.opacity = '1';
      turning.style.zIndex = '3';
      turning.style.transform = `${SPINE}(${-rolled * 90}deg)`;
    }
    shade.style.opacity = String((1 - rolled) * 0.35);
  };

  // Finished by the same hand that moved it, frame by frame: the strips go
  // where the roll puts them, so they cannot simply be left to a transition.
  const finish = (dir, complete, from, tilt = 0) => {
    busy = true;
    const to = complete ? 1 : 0;
    const start = performance.now();
    const span = 180 + Math.abs(to - from) * 260;
    const step = (now) => {
      const t = Math.min((now - start) / span, 1);
      const eased = 1 - (1 - t) ** 3;
      progress(dir, from + (to - from) * eased, tilt);
      if (t < 1) { requestAnimationFrame(step); return; }
      if (complete) current += dir;
      busy = false;
      place();
    };
    requestAnimationFrame(step);
  };

  let drag = null;
  container.addEventListener('pointerdown', (e) => {
    if (!bookOn || busy || container.classList.contains('marking')) return;
    if (!e.target.closest?.('canvas[data-page]')) return;
    drag = { x: e.clientX, y: e.clientY, tilt: 0, t: performance.now(), lastX: e.clientX, lastT: performance.now(), speed: 0, dir: 0, q: 0, id: e.pointerId };
  });
  container.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.dir) {
      if (Math.abs(dx) < 8) return;
      drag.dir = dx < 0 ? 1 : -1;
      // Taken by the top or the bottom corner, the page rolls on the slant.
      const page = pageEl(current)?.getBoundingClientRect();
      if (page && drag.dir > 0) {
        const at = (drag.y - page.top) / page.height;
        drag.tilt = at < 0.3 ? -1 : at > 0.7 ? 1 : 0;
      }
      if (!pageEl(current + (drag.dir > 0 ? 1 : -1))) { drag = null; return; }
      try { container.setPointerCapture(drag.id); } catch { /* already gone */ }
    }
    e.preventDefault();
    drag.q = Math.min(Math.max((-dx * drag.dir) / (container.clientWidth * 0.8), 0), 1);
    // How fast the finger is going as it leaves, not on average: a flick is
    // fast at the end whatever it was at the start.
    const now = performance.now();
    const v = (e.clientX - drag.lastX) / Math.max(now - drag.lastT, 1);
    drag.speed = drag.speed ? drag.speed * 0.4 + v * 0.6 : v;
    drag.lastX = e.clientX;
    drag.lastT = now;
    // Once a frame, however often the finger reports.
    if (!drag.frame) {
      drag.frame = requestAnimationFrame(() => {
        if (!drag) return;
        drag.frame = 0;
        progress(drag.dir, drag.q, drag.tilt);
      });
    }
  });
  const release = () => {
    if (!drag) return;
    const { dir, q, tilt } = drag;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    const flick = Math.abs(drag.speed || 0) > 0.45 && Math.sign(-(drag.speed || 0)) === dir;
    drag = null;
    if (!dir) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    finish(dir, q > 0.35 || (q > 0.06 && flick), q, tilt);
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
    endCurl();
    forgetAll();
    for (const canvas of container.querySelectorAll('canvas[data-page]')) {
      canvas.classList.remove('book-off');
      canvas.style.visibility = '';
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
