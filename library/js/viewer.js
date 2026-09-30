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
import { referencesIn } from './xref.js';

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

export async function renderInto(container, blob, name, { onStatus, startPage = 1, book = false, onLayout, onLink } = {}) {
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
    return renderEpub(container, blob, { onStatus, startPage, onLink });
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
  // What can be tapped on each page drawn: the document's own links, and
  // the references in its words that were found and underlined.
  const links = new Map();

  // factor: drawn again, at that many times the usual detail -- a page
  // pinched in, or put back to the usual (1) once it is not.
  const draw = async (canvas, pageNo, factor = 0) => {
    if (rendered.has(pageNo) && !factor) return;
    rendered.add(pageNo);
    try {
      const page = await doc.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const across = Math.min(Math.round(width * (factor || 1)), 2600);
      const viewport = page.getViewport({ scale: across / base.width });
      // Drawn again over a page already showing, it is drawn aside and put
      // in place whole, so the page never goes blank while it is redrawn.
      const target = factor ? document.createElement('canvas') : canvas;
      target.width = Math.round(viewport.width);
      target.height = Math.round(viewport.height);
      const ctx = target.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (marks) await highlight(page, viewport, ctx, marks);
      links.set(pageNo, await linksOn(page, viewport, ctx));
      page.cleanup();
      if (target !== canvas) {
        canvas.width = target.width;
        canvas.height = target.height;
        canvas.getContext('2d').drawImage(target, 0, 0);
        target.width = 0;
        target.height = 0;
      }
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
  // How far the page on screen is zoomed in by pinching; 1 is not at all.
  const zoom = { z: 1, x: 0, y: 0 };
  const zoomed = () => zoom.z > 1.02;
  let current = 1;
  let busy = false;
  let suppressClick = false;
  const pageEl = (n) => container.querySelector(`canvas[data-page="${n}"]`);
  const shade = el('div', { class: 'book-shade' });
  const SPINE = 'perspective(1800px) rotateY';

  // Held sideways -- or on a tablet -- the pages lie open two at a time, as
  // a book does: odd pages on the left, even on the right, the spine
  // between. Turned, the right-hand page rolls over the spine and its back
  // is the next left-hand page.
  let spread = false;
  const wantsSpread = () => bookOn && doc.numPages > 1 && container.clientWidth > container.clientHeight * 1.1;
  const step = () => (spread ? 2 : 1);
  const lead = (n) => (spread && n % 2 === 0 ? n - 1 : n);
  const sideOf = (n) => (spread ? (n % 2 === 1 ? 'L' : 'R') : null);

  const fit = (canvas, side = sideOf(Number(canvas.dataset.page))) => {
    const W = container.clientWidth;
    const H = container.clientHeight;
    const room = side ? W / 2 : W;
    const ratio = canvas.width && canvas.height ? canvas.height / canvas.width : 1.414;
    const w = Math.min(room, H / ratio);
    const h = w * ratio;
    const left = side === 'L' ? W / 2 - w : side === 'R' ? W / 2 : (W - w) / 2;
    Object.assign(canvas.style, {
      width: `${w}px`, height: `${h}px`, aspectRatio: '', margin: '0',
      left: `${left}px`, top: `${(H - h) / 2}px`
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
  const ready = new Map();   // "page|tilt|back" -> strips cut for it
  const keyOf = (page, tilt, back = 0) => `${page}|${tilt}|${back}`;
  const sizeOf = (canvas) => `${parseFloat(canvas.style.width)}x${parseFloat(canvas.style.height)}x${canvas.width}`;

  // back: in a two-page spread, the page printed on the back of the sheet
  // being turned -- the next left-hand page -- rather than plain paper.
  const startCurl = (canvas, tilt, back = null) => {
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
      back, page: Number(canvas.dataset.page), size: sizeOf(canvas) + (back ? `/${sizeOf(back)}` : '') };
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
      if (c.back) {
        // The back of the sheet is the next page. Seen from behind, the
        // strip's left edge is where the page's mirror image puts it, so the
        // slice comes from the other end of that page.
        const bscale = c.back.width / c.w;
        const paper = document.createElement('canvas');
        paper.className = 'curl-paper';
        paper.width = Math.max(1, Math.ceil((su + 0.6) * bscale));
        paper.height = Math.max(1, Math.ceil(len * bscale));
        const from = (c.w - (u0 - c.umin) - (su + 0.6)) / c.w;
        paper.getContext('2d').drawImage(c.back, from * c.back.width, 0, ((su + 0.6) / c.w) * c.back.width, c.back.height,
          0, 0, paper.width, paper.height);
        dark = el('div', { class: 'curl-dark' });
        backDark = el('div', { class: 'curl-dark' });
        back = el('div', { class: 'curl-back' }, [paper, backDark]);
      } else if (!c.tilt) {
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
      if (!bookOn || busy || zoomed()) return;
      // Forward: this page, straight or by either corner. Back: the page
      // before, straight. In a spread, the right-hand page with the next
      // left-hand page on its back, and the sheet before, back over.
      const wanted = spread
        ? [[current + 1, 0, current + 2], [current - 1, 0, current]]
        : [[current, 0], [current, -1], [current, 1], [current - 1, 0]];
      const keep = new Set(wanted.map(([p, t, b]) => keyOf(p, t, b)));
      for (const [key, c] of [...ready]) if (!keep.has(key)) { c.layer.remove(); ready.delete(key); }
      const queue = [];
      for (const [page, tilt, backPage] of wanted) {
        const canvas = pageEl(page);
        if (!canvas || !canvas.width || canvas.classList.contains('book-off')) continue;
        const back = backPage ? pageEl(backPage) : null;
        if (backPage && (!back || !back.width)) continue;
        const key = keyOf(page, tilt, backPage);
        const had = ready.get(key);
        if (had && had.size === sizeOf(canvas) + (back ? `/${sizeOf(back)}` : '')) continue;
        if (had) { had.layer.remove(); ready.delete(key); }
        const c = startCurl(canvas, tilt, back);
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

  const takeCurl = (canvas, tilt, back = null) => {
    const page = Number(canvas.dataset.page);
    const key = keyOf(page, tilt, back ? Number(back.dataset.page) : 0);
    let c = ready.get(key);
    const size = sizeOf(canvas) + (back ? `/${sizeOf(back)}` : '');
    if (!c || c.size !== size) { if (c) c.layer.remove(); c = startCurl(canvas, tilt, back); }
    ready.delete(key);
    cutStrips(c, c.count);
    c.layer.style.display = '';
    return c;
  };

  // q: how far the page has rolled over, 0 flat to 1 gone.
  const rollTo = (q) => {
    const { strips, umin, umax, vmin } = curl;
    // A single page rolls away off its left edge. A sheet in a spread lands
    // face down on the far side of the spine, as its mirror image: the roll
    // tightens as it goes, until at the end the sheet lies flat.
    const R = curl.back ? Math.max(Math.max(curl.w * 0.1, 22) * (1 - q), 0.5) : Math.max(curl.w * 0.1, 22);
    const a = curl.back ? umax - q * (umax - umin) : umax - q * (umax - umin + Math.PI * R + 6);
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
    const was = spread;
    spread = wantsSpread();
    if (spread !== was) forgetAll();
    current = lead(Math.min(Math.max(1, current), doc.numPages));
    settleZoom();
    const open = spread ? [current, current + 1] : [current];
    for (const canvas of container.querySelectorAll('canvas[data-page]')) {
      const n = Number(canvas.dataset.page);
      // Laid out: what is open, and what a turn either way uncovers.
      const near = spread ? n >= current - 2 && n <= current + 3 : Math.abs(n - current) <= 1;
      canvas.classList.toggle('book-off', !near);
      if (!near) continue;
      fit(canvas);
      canvas.style.transition = '';
      canvas.style.transformOrigin = 'left center';
      canvas.style.transform = '';
      canvas.style.visibility = '';
      canvas.style.opacity = open.includes(n) ? '1' : '0';
      canvas.style.zIndex = open.includes(n) ? '2' : '1';
    }
    // In a spread only the right-hand side is covered and uncovered.
    Object.assign(shade.style, { transition: '', opacity: '0', left: spread ? '50%' : '0', width: spread ? '50%' : '100%' });
    container.classList.toggle('spread', spread);
    container.classList.remove('turning');
    container.dataset.current = String(current);
    onLayout?.();
    // Everything that watches the page in view listens for a scroll.
    container.dispatchEvent(new Event('scroll'));
    prepare();
  };

  // How far a turn has gone, 0 to 1. dir 1 is forward, -1 back.
  const progress = (dir, q, tilt = 0) => {
    // The sheet that turns, what is printed on its back in a spread, and
    // what it uncovers.
    const turning = pageEl(spread ? current + dir : dir > 0 ? current : current - 1);
    const back = spread ? pageEl(dir > 0 ? current + 2 : current) : null;
    const under = spread ? pageEl(dir > 0 ? current + 3 : current - 2) : pageEl(dir > 0 ? current + 1 : current);
    if (!turning || (spread ? !back : !under)) return;
    // Notes and highlights belong to the page at rest; they step aside while
    // it moves rather than hang in the air over it.
    container.classList.add('turning');
    if (under) {
      under.style.opacity = '1';
      under.style.zIndex = '1';
    }
    // Going back in a spread, the left-hand page is the back of the sheet
    // coming over, and goes with it.
    if (spread && dir < 0) back.style.visibility = 'hidden';
    // Forward, the page on screen rolls away; back, the previous page rolls
    // back over it from the left.
    const rolled = dir > 0 ? q : 1 - q;
    if (!curl && turning.width && (!back || back.width)) {
      // Only a forward turn of a single page is taken by a corner; the page
      // coming back over from the left comes straight.
      curl = takeCurl(turning, dir > 0 && !spread ? tilt : 0, back);
      turning.style.visibility = 'hidden';
    }
    if (curl) rollTo(rolled);
    else {
      // Not drawn yet, so there is nothing to cut into strips: it swings.
      turning.style.opacity = '1';
      turning.style.zIndex = '3';
      turning.style.transform = `${SPINE}(${-rolled * (spread ? 180 : 90)}deg)`;
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
    const frame = (now) => {
      const t = Math.min((now - start) / span, 1);
      const eased = 1 - (1 - t) ** 3;
      progress(dir, from + (to - from) * eased, tilt);
      if (t < 1) { requestAnimationFrame(frame); return; }
      if (complete) current += dir * step();
      busy = false;
      place();
    };
    requestAnimationFrame(frame);
  };

  // ── pinching ──
  //
  // Two fingers zoom the open page in, about the point between them, and
  // move it about as they go. Zoomed, one finger moves the page rather than
  // turning it; a double tap zooms in on the middle of a page, and out again.
  // Let go zoomed in, the page is drawn again finer, so small print and
  // drawings stay sharp rather than blown up.
  const pointers = new Map();
  let pinch = null;
  let pan = null;
  let lastTap = null;
  let zoomFrame = 0;
  const opened = () => [...container.querySelectorAll('canvas[data-page]')]
    .filter((c) => !c.classList.contains('book-off') && c.style.opacity === '1');
  const local = (p) => {
    const r = container.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  };
  const applyZoom = () => {
    zoomFrame = 0;
    for (const c of opened()) {
      // Every page open scales about the same point, as one sheet.
      c.style.transformOrigin = `${-parseFloat(c.style.left)}px ${-parseFloat(c.style.top)}px`;
      c.style.transform = zoomed() ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z})` : '';
    }
    container.classList.toggle('zoomed', zoomed());
  };
  const showZoom = () => { if (!zoomFrame) zoomFrame = requestAnimationFrame(applyZoom); };
  const clampZoom = () => {
    const W = container.clientWidth;
    const H = container.clientHeight;
    zoom.z = Math.min(Math.max(zoom.z, 1), 5);
    zoom.x = Math.min(0, Math.max(W - W * zoom.z, zoom.x));
    zoom.y = Math.min(0, Math.max(H - H * zoom.z, zoom.y));
  };
  const sharpen = () => {
    const factor = Math.min(zoom.z, 2.5);
    for (const c of opened()) {
      if (Number(c.dataset.sharp || 1) >= factor - 0.05) continue;
      c.dataset.sharp = String(factor);
      draw(c, Number(c.dataset.page), factor);
    }
  };
  // Back to the page as it was: its ordinary drawing, which holds a good
  // deal less of the phone's memory than a sharpened one.
  const settleZoom = () => {
    zoom.z = 1; zoom.x = 0; zoom.y = 0;
    pinch = null;
    pan = null;
    container.classList.remove('zoomed');
    for (const c of container.querySelectorAll('canvas[data-sharp]')) {
      delete c.dataset.sharp;
      draw(c, Number(c.dataset.page), 1);
    }
  };
  const resetZoom = () => {
    settleZoom();
    applyZoom();
    onLayout?.();
  };
  const quietClick = () => {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
  };
  const tapped = (e) => {
    const now = performance.now();
    const twice = lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
    lastTap = twice ? null : { t: now, x: e.clientX, y: e.clientY };
    if (!twice) return;
    if (zoomed()) { resetZoom(); quietClick(); return; }
    // The middle of a page: its edges are for turning it.
    const canvas = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('canvas[data-page]');
    const box = canvas?.getBoundingClientRect();
    if (!box) return;
    const fx = (e.clientX - box.left) / box.width;
    if (fx < 0.3 || fx > 0.7) return;
    const at = local({ x: e.clientX, y: e.clientY });
    zoom.z = 2.2;
    zoom.x = at.x - at.x * zoom.z;
    zoom.y = at.y - at.y * zoom.z;
    clampZoom();
    applyZoom();
    sharpen();
    onLayout?.();
    quietClick();
  };

  let drag = null;
  container.addEventListener('pointerdown', (e) => {
    if (!bookOn || container.classList.contains('marking')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // A second finger: a pinch -- unless a turn is already under way.
      if (busy || drag?.dir) return;
      drag = null;
      pan = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), z: zoom.z, x: zoom.x, y: zoom.y };
      for (const id of pointers.keys()) { try { container.setPointerCapture(id); } catch { /* already gone */ } }
      return;
    }
    if (pointers.size > 2 || busy) return;
    if (!e.target.closest?.('canvas[data-page]')) return;
    if (zoomed()) {
      pan = { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y, moved: false };
      try { container.setPointerCapture(e.pointerId); } catch { /* already gone */ }
      return;
    }
    drag = { x: e.clientX, y: e.clientY, tilt: 0, t: performance.now(), lastX: e.clientX, lastT: performance.now(), speed: 0, dir: 0, q: 0, id: e.pointerId };
  });
  container.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pointers.size < 2) return;
      e.preventDefault();
      const [a, b] = [...pointers.values()];
      const mid = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      // The point of the page first under the fingers stays under them.
      const cx = (pinch.mid.x - pinch.x) / pinch.z;
      const cy = (pinch.mid.y - pinch.y) / pinch.z;
      zoom.z = Math.min(Math.max(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), 1), 5);
      zoom.x = mid.x - cx * zoom.z;
      zoom.y = mid.y - cy * zoom.z;
      clampZoom();
      showZoom();
      return;
    }
    if (pan) {
      e.preventDefault();
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      if (Math.hypot(dx, dy) > 6) pan.moved = true;
      zoom.x = pan.zx + dx;
      zoom.y = pan.zy + dy;
      clampZoom();
      showZoom();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.dir) {
      if (Math.abs(dx) < 8) return;
      drag.dir = dx < 0 ? 1 : -1;
      // Taken by the top or the bottom corner, the page rolls on the slant.
      const page = spread ? null : pageEl(current)?.getBoundingClientRect();
      if (page && drag.dir > 0) {
        const at = (drag.y - page.top) / page.height;
        drag.tilt = at < 0.3 ? -1 : at > 0.7 ? 1 : 0;
      }
      if (!pageEl(current + drag.dir * step())) { drag = null; return; }
      try { container.setPointerCapture(drag.id); } catch { /* already gone */ }
    }
    e.preventDefault();
    // A single page goes when the finger has crossed most of the screen; a
    // sheet of a spread, when it has crossed most of both pages.
    const reach = spread ? (parseFloat(pageEl(current)?.style.width) || container.clientWidth / 2) * 1.6 : container.clientWidth * 0.8;
    drag.q = Math.min(Math.max((-dx * drag.dir) / reach, 0), 1);
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
    quietClick();
    finish(dir, q > 0.35 || (q > 0.06 && flick), q, tilt);
  };
  const lift = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size >= 2) return;
      pinch = null;
      quietClick();
      if (zoom.z < 1.08) resetZoom();
      else { sharpen(); onLayout?.(); }
      return;
    }
    if (pan) {
      const moved = pan.moved;
      pan = null;
      if (moved) { quietClick(); onLayout?.(); } else if (e.type === 'pointerup') tapped(e);
      return;
    }
    if (drag && !drag.dir && e.type === 'pointerup') tapped(e);
    release();
  };
  container.addEventListener('pointerup', lift);
  container.addEventListener('pointercancel', lift);
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
    settleZoom();
    spread = false;
    container.classList.remove('spread');
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

  // A tap on a link follows it. Listened for before anything else sees the
  // tap, so a reference at the edge of a book page is followed rather than
  // turning the page.
  const onTap = (e) => {
    if (container.classList.contains('marking') || zoomed()) return;
    const canvas = e.target.closest?.('canvas[data-page]');
    const pageNo = Number(canvas?.dataset.page);
    const list = links.get(pageNo);
    if (!list?.length) return;
    const box = canvas.getBoundingClientRect();
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    // A fingertip is wider than a word's underline, so a tap near one takes
    // it -- the nearest, where two lines' references are both near.
    const px = (l) => {
      const dx = Math.max(l.x - fx, 0, fx - (l.x + l.w)) * box.width;
      const dy = Math.max(l.y - fy, 0, fy - (l.y + l.h)) * box.height;
      return Math.hypot(dx, dy);
    };
    let hit = null;
    let best = 9;
    for (const l of list) { const d = px(l); if (d < best) { best = d; hit = l; } }
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    follow(hit, pageNo);
  };
  container.addEventListener('click', onTap, true);
  const follow = async (hit, from) => {
    if (hit.url) { onLink?.({ url: hit.url, from }); return; }
    if (hit.ref) { onLink?.({ ref: hit.ref, from }); return; }
    try {
      const page = await destPage(doc, hit.dest);
      if (page) onLink?.({ page, from });
    } catch { /* a broken link in the file: nothing to follow */ }
  };

  let contents = null;
  const teardown = () => {
    container.removeEventListener('click', onTap, true);
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
    const to = lead(page);
    if (busy || to === current) return;
    // The next or the previous page turns; further than that, it opens there.
    if (!zoomed() && Math.abs(to - current) === step()) finish(to > current ? 1 : -1, true, 0);
    else { current = to; place(); }
  };
  teardown.isZoomed = zoomed;
  teardown.isSpread = () => spread;
  teardown.current = () => (bookOn ? current : null);
  teardown.pageCount = doc.numPages;
  /** The document's own contents list -- its bookmarks -- where it has one. */
  teardown.contents = async () => {
    if (contents) return contents;
    const out = [];
    const walk = async (entries, depth) => {
      for (const entry of entries || []) {
        if (out.length >= 800) return;
        let page = null;
        try { page = await destPage(doc, entry.dest); } catch { /* broken entry */ }
        const title = String(entry.title || '').replace(/\s+/g, ' ').trim();
        if (title && page) out.push({ title, page, depth });
        if (depth < 3) await walk(entry.items, depth + 1);
      }
    };
    try { await walk(await doc.getOutline(), 0); } catch { /* none */ }
    contents = out;
    return out;
  };
  // Highlight something new: every page already drawn is drawn again with it,
  // and pages drawn later pick it up as they come into view.
  teardown.setMarks = async (next) => {
    marks = next;
    const drawn = [...rendered];
    rendered.clear();
    for (const n of drawn) {
      const canvas = container.querySelector(`canvas[data-page="${n}"]`);
      if (canvas) await draw(canvas, n, Number(canvas.dataset.sharp) || 0);
    }
  };
  // What is written inside a rectangle of a page, for a highlight: the text
  // and the tight boxes around it, both in fractions of the page.
  teardown.pick = (pageNo, rect) => pickText(doc, pageNo, rect);
  return teardown;
}

/** The page a link's destination is on. */
async function destPage(doc, dest) {
  const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  const ref = Array.isArray(d) ? d[0] : null;
  if (ref == null) return null;
  return (typeof ref === 'number' ? ref : await doc.getPageIndex(ref)) + 1;
}

/**
 * What can be tapped on a page: the links the file itself carries, and the
 * references in its words -- "see section 4.3" -- underlined as they are
 * found, so it is plain they can be followed. Kept as fractions of the page.
 */
async function linksOn(page, viewport, ctx) {
  const W = viewport.width;
  const H = viewport.height;
  const out = [];
  const box = (x0, y0, x1, y1) => ({
    x: Math.min(x0, x1) / W, y: Math.min(y0, y1) / H, w: Math.abs(x1 - x0) / W, h: Math.abs(y1 - y0) / H
  });
  try {
    const [ma, mb, mc, md, me, mf] = viewport.transform;
    const at = (x, y) => [ma * x + mc * y + me, mb * x + md * y + mf];
    for (const a of await page.getAnnotations({ intent: 'display' })) {
      if (a.subtype !== 'Link' || !(a.dest || a.url)) continue;
      const [x0, y0] = at(a.rect[0], a.rect[1]);
      const [x1, y1] = at(a.rect[2], a.rect[3]);
      out.push({ ...box(x0, y0, x1, y1), dest: a.dest || null, url: a.dest ? null : a.url });
    }
  } catch { /* no annotations to read */ }

  const content = await page.getTextContent();
  const { Util } = pdfjs;
  ctx.save();
  ctx.strokeStyle = 'rgba(30, 90, 200, 0.8)';
  ctx.lineWidth = Math.max(1, W / 700);
  for (const item of content.items) {
    const str = item.str || '';
    if (!str.trim()) continue;
    const refs = referencesIn(str);
    if (!refs.length) continue;
    const tx = Util.transform(viewport.transform, item.transform);
    const height = Math.hypot(tx[2], tx[3]) || 10;
    ctx.font = `${Math.max(Math.round(height), 1)}px ${content.styles?.[item.fontName]?.fontFamily || 'sans-serif'}`;
    const k = ((item.width || 0) * viewport.scale) / (ctx.measureText(str).width || str.length);
    for (const ref of refs) {
      const x = tx[4] + ctx.measureText(str.slice(0, ref.start)).width * k;
      const w = Math.max(ctx.measureText(str.slice(ref.start, ref.end)).width * k, 6);
      // A link the file already has here is the better one to follow.
      const b = box(x, tx[5] - height * 0.95, x + w, tx[5] + height * 0.25);
      if (out.some((o) => !o.ref && b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)) continue;
      out.push({ ...b, ref: { kind: ref.kind, word: ref.word, label: ref.label } });
      ctx.beginPath();
      ctx.moveTo(x, tx[5] + height * 0.14);
      ctx.lineTo(x + w, tx[5] + height * 0.14);
      ctx.stroke();
    }
  }
  ctx.restore();
  return out;
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
