// Second round of lion marks. The first round all shared one radial-spike mane,
// so these deliberately vary the underlying shape language instead.

const NAVY = '#05101b';
const NAVY_HI = '#12293e';
const BRASS = '#c9a227';
const BRASS_HI = '#e3bd4a';
const C = 256;

const tidy = (d) => d.replace(/\s+/g, ' ').trim();
const pt = (r, a) => [C + Math.cos(a) * r, C + Math.sin(a) * r];
const f = (n) => n.toFixed(1);

/** Heraldic mane: each lock sweeps and curls one way, like carved hair. */
function maneLocks({ locks = 13, inner = 146, outer = 214, curl = 0.55 } = {}) {
  const step = (Math.PI * 2) / locks;
  let d = '';
  for (let i = 0; i < locks; i++) {
    const a0 = i * step - Math.PI / 2, a1 = a0 + step;
    const [sx, sy] = pt(inner, a0);
    const [tx, ty] = pt(outer, a0 + step * curl);
    const [ex, ey] = pt(inner, a1);
    const [c1x, c1y] = pt(outer * 0.86, a0 - step * 0.10);
    const [c2x, c2y] = pt(outer * 1.0, a0 + step * (curl - 0.22));
    const [c3x, c3y] = pt(outer * 0.90, a0 + step * (curl + 0.30));
    const [c4x, c4y] = pt(inner * 1.06, a1 - step * 0.06);
    if (i === 0) d += `M${f(sx)},${f(sy)}`;
    d += `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(tx)},${f(ty)}`;
    d += `C${f(c3x)},${f(c3y)} ${f(c4x)},${f(c4y)} ${f(ex)},${f(ey)}`;
  }
  return d + 'Z';
}

function maneSpikes({ tufts = 14, inner = 152, outer = 212 } = {}) {
  const step = (Math.PI * 2) / tufts;
  let d = '';
  for (let i = 0; i < tufts; i++) {
    const a0 = i * step - Math.PI / 2, a1 = a0 + step, mid = a0 + step / 2;
    const [sx, sy] = pt(inner, a0);
    const [tx, ty] = pt(outer, mid);
    const [ex, ey] = pt(inner, a1);
    const [c1x, c1y] = pt(inner + (outer - inner) * 0.55, a0 + step * 0.30);
    const [c2x, c2y] = pt(outer * 0.94, mid - step * 0.07);
    const [c3x, c3y] = pt(outer * 0.94, mid + step * 0.07);
    const [c4x, c4y] = pt(inner + (outer - inner) * 0.55, a1 - step * 0.30);
    if (i === 0) d += `M${f(sx)},${f(sy)}`;
    d += `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(tx)},${f(ty)}`;
    d += `C${f(c3x)},${f(c3y)} ${f(c4x)},${f(c4y)} ${f(ex)},${f(ey)}`;
  }
  return d + 'Z';
}

/** Short radial bars — a mane implied rather than drawn. */
function maneBars({ bars = 16, inner = 150, outer = 206, w = 15 } = {}) {
  let out = '';
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const [x1, y1] = pt(inner, a);
    const [x2, y2] = pt(outer, a);
    out += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke-width="${w}"/>`;
  }
  return out;
}

const HEAD = tidy(`
M256,116 C214,116 186,128 168,146 C160,132 146,124 132,126
C124,146 128,166 140,178 C130,198 126,222 128,244
C130,276 142,302 162,322 C182,342 214,356 256,356
C298,356 330,342 350,322 C370,302 382,276 384,244
C386,222 382,198 372,178 C384,166 388,146 380,126
C366,124 352,132 344,146 C326,128 298,116 256,116 Z`);

const FEATURES = tidy(`
M212,214 C224,204 244,204 254,214 C244,220 224,220 212,214 Z
M258,214 C268,204 288,204 300,214 C288,220 268,220 258,214 Z
M256,246 L236,266 C236,280 246,288 256,288 C266,288 276,280 276,266 Z
M256,288 C256,302 246,310 232,308 C244,316 258,312 256,300 Z
M256,288 C256,302 266,310 280,308 C268,316 254,312 256,300 Z
M196,278 C206,274 218,276 224,282 C214,284 204,284 196,278 Z
M316,278 C306,274 294,276 288,282 C298,284 308,284 316,278 Z
M196,300 C206,296 218,298 224,304 C214,306 204,306 196,300 Z
M316,300 C306,296 294,298 288,304 C298,306 308,306 316,300 Z`);

/** Ears drawn as separate shapes so they can break the mane outline. */
const EARS = tidy(`
M170,150 C154,130 132,124 120,132 C118,154 130,174 150,182 Z
M342,150 C358,130 380,124 392,132 C394,154 382,174 362,182 Z`);

/** Roaring: open jaw with canines. */
const ROAR = tidy(`
M212,212 C224,202 244,202 254,212 C244,218 224,218 212,212 Z
M258,212 C268,202 288,202 300,212 C288,218 268,218 258,212 Z
M256,244 L238,262 C238,272 246,278 256,278 C266,278 274,272 274,262 Z
M206,292 C230,282 282,282 306,292 C302,326 282,346 256,346 C230,346 210,326 206,292 Z`);
const ROAR_TEETH = tidy(`
M222,296 L232,314 L240,298 Z
M290,296 L280,314 L272,298 Z`);

const ANCHOR = tidy(`
M256,300 L256,404 M232,326 L280,326
M196,368 C204,398 228,416 256,416 C284,416 308,398 316,368
M196,368 L182,360 M196,368 L196,352
M316,368 L330,360 M316,368 L316,352`);

function frame(inner, { size, scale = 1 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
    <stop offset="0%" stop-color="${NAVY_HI}"/><stop offset="100%" stop-color="${NAVY}"/>
  </radialGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(${C},${C}) scale(${scale}) translate(${-C},${-C})">${inner}</g>
</svg>`;
}

export const VARIANTS = [
  {
    id: 7,
    name: 'Silhouette + ears',
    note: 'The shipped mark with ears notched back through the mane, so it reads as a cat, not a sun.',
    render: (o) => frame(`
      <path d="${maneSpikes()}" fill="${BRASS}"/>
      <g transform="translate(0,19)">
        <path d="${EARS}" fill="${BRASS}"/>
        <path d="${HEAD}" fill="${BRASS}"/>
        <path d="${EARS}" fill="none" stroke="${NAVY}" stroke-width="9"/>
        <path d="${FEATURES}" fill="${NAVY}"/>
      </g>`, o)
  },
  {
    id: 8,
    name: 'Heraldic',
    note: 'Mane as carved locks that all curl one way. Coat-of-arms feel rather than a starburst.',
    render: (o) => frame(`
      <path d="${maneLocks()}" fill="${BRASS}"/>
      <g transform="translate(0,19)">
        <path d="${HEAD}" fill="${BRASS_HI}"/>
        <path d="${FEATURES}" fill="${NAVY}"/>
      </g>`, o)
  },
  {
    id: 9,
    name: 'Geometric',
    note: 'Built from circles and triangles, mane implied by bars. The most modern and the cleanest small.',
    render: (o) => frame(`
      <g stroke="${BRASS}" stroke-linecap="round">${maneBars()}</g>
      <circle cx="${C}" cy="266" r="122" fill="${BRASS_HI}"/>
      <path d="M168,180 L150,120 L212,150 Z" fill="${BRASS_HI}"/>
      <path d="M344,180 L362,120 L300,150 Z" fill="${BRASS_HI}"/>
      <circle cx="216" cy="252" r="13" fill="${NAVY}"/>
      <circle cx="296" cy="252" r="13" fill="${NAVY}"/>
      <path d="M256,286 L236,306 C236,320 246,328 256,328 C266,328 276,320 276,306 Z" fill="${NAVY}"/>
      <path d="M256,328 C256,344 240,350 226,342 M256,328 C256,344 272,350 286,342"
            fill="none" stroke="${NAVY}" stroke-width="9" stroke-linecap="round"/>`, o)
  },
  {
    id: 10,
    name: 'Roaring',
    note: 'Open jaw with canines. Most character, but the mouth is the first thing lost when it shrinks.',
    render: (o) => frame(`
      <path d="${maneSpikes({ tufts: 15, inner: 150, outer: 216 })}" fill="${BRASS}"/>
      <g transform="translate(0,19)">
        <path d="${HEAD}" fill="${BRASS_HI}"/>
        <path d="${ROAR}" fill="${NAVY}"/>
        <path d="${ROAR_TEETH}" fill="${BRASS_HI}"/>
      </g>`, o)
  },
  {
    id: 11,
    name: 'Ship\'s crest',
    note: 'Lion over a fouled anchor in a rope ring. Most on-theme for the job, busiest at small size.',
    render: (o) => frame(`
      <circle cx="${C}" cy="${C}" r="232" fill="none" stroke="${BRASS}" stroke-width="13"
              stroke-dasharray="26 13" stroke-linecap="round"/>
      <g transform="translate(0,-42) scale(0.62) translate(97,97)">
        <path d="${maneSpikes()}" fill="${BRASS}"/>
        <g transform="translate(0,19)">
          <path d="${HEAD}" fill="${BRASS}"/><path d="${FEATURES}" fill="${NAVY}"/>
        </g>
      </g>
      <g transform="translate(0,-18) scale(0.86) translate(36,36)">
        <path d="${ANCHOR}" fill="none" stroke="${BRASS_HI}" stroke-width="15"
              stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="256" cy="292" r="15" fill="none" stroke="${BRASS_HI}" stroke-width="13"/>
      </g>`, o)
  },
  {
    id: 12,
    name: 'Inverted',
    note: 'Brass field with the lion knocked out in navy. Loudest on a Home Screen — it reads as a solid tile.',
    render: (o) => frame(`
      <rect x="26" y="26" width="460" height="460" rx="104" fill="${BRASS}"/>
      <path d="${maneSpikes()}" fill="${NAVY}"/>
      <g transform="translate(0,19)">
        <path d="${HEAD}" fill="${NAVY}"/>
        <path d="${FEATURES}" fill="${BRASS}"/>
      </g>`, o)
  }
];
