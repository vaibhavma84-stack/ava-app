// Lion + anchor: the sailor's trade and Leo in one mark.
//
// The earlier crest failed because it stacked a lion, an anchor and a rope ring
// into 60px. These keep to one bold composition each, and every element is sized
// to survive the shrink.

const NAVY = '#05101b';
const NAVY_HI = '#12293e';
const BRASS = '#c9a227';
const BRASS_HI = '#e3bd4a';
const C = 256;

const tidy = (d) => d.replace(/\s+/g, ' ').trim();
const pt = (r, a, cx = C, cy = C) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
const f = (n) => n.toFixed(1);

/** Spiked mane, drawn about an arbitrary centre so it can be placed. */
function mane({ tufts = 13, inner = 152, outer = 212, cx = C, cy = C } = {}) {
  const step = (Math.PI * 2) / tufts;
  let d = '';
  for (let i = 0; i < tufts; i++) {
    const a0 = i * step - Math.PI / 2, a1 = a0 + step, mid = a0 + step / 2;
    const [sx, sy] = pt(inner, a0, cx, cy);
    const [tx, ty] = pt(outer, mid, cx, cy);
    const [ex, ey] = pt(inner, a1, cx, cy);
    const [c1x, c1y] = pt(inner + (outer - inner) * 0.55, a0 + step * 0.30, cx, cy);
    const [c2x, c2y] = pt(outer * 0.94, mid - step * 0.07, cx, cy);
    const [c3x, c3y] = pt(outer * 0.94, mid + step * 0.07, cx, cy);
    const [c4x, c4y] = pt(inner + (outer - inner) * 0.55, a1 - step * 0.30, cx, cy);
    if (i === 0) d += `M${f(sx)},${f(sy)}`;
    d += `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(tx)},${f(ty)}`;
    d += `C${f(c3x)},${f(c3y)} ${f(c4x)},${f(c4y)} ${f(ex)},${f(ey)}`;
  }
  return d + 'Z';
}

const HEAD = tidy(`
M256,116 C214,116 186,128 168,146 C160,132 146,124 132,126
C124,146 128,166 140,178 C130,198 126,222 128,244
C130,276 142,302 162,322 C182,342 214,356 256,356
C298,356 330,342 350,322 C370,302 382,276 384,244
C386,222 382,198 372,178 C384,166 388,146 380,126
C366,124 352,132 344,146 C326,128 298,116 256,116 Z`);

/** Bolder features: thin whiskers vanish at icon size, so these are chunky. */
const FEATURES = tidy(`
M206,212 C220,200 244,200 256,212 C244,220 220,220 206,212 Z
M256,212 C268,200 292,200 306,212 C292,220 268,220 256,212 Z
M256,248 L232,270 C232,286 244,296 256,296 C268,296 280,286 280,270 Z
M256,296 C256,314 242,324 224,320 C240,332 258,326 256,308 Z
M256,296 C256,314 270,324 288,320 C272,332 254,326 256,308 Z`);

/** Admiralty anchor, stroked so the weight can be tuned per composition. */
function anchor({ top = 210, bottom = 430, w = 19 } = {}) {
  const ringR = 24;
  const stockY = top + 46;
  const armY = bottom - 74;
  return `
    <g fill="none" stroke="${BRASS_HI}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="${C}" cy="${top}" r="${ringR}"/>
      <line x1="${C}" y1="${top + ringR}" x2="${C}" y2="${bottom - 6}"/>
      <line x1="${C - 58}" y1="${stockY}" x2="${C + 58}" y2="${stockY}"/>
      <path d="M${C - 92},${armY} C${C - 82},${armY + 52} ${C - 44},${bottom} ${C},${bottom}
               C${C + 44},${bottom} ${C + 82},${armY + 52} ${C + 92},${armY}"/>
    </g>
    <path d="M${C - 92},${armY} L${C - 124},${armY - 18} L${C - 106},${armY + 30} Z" fill="${BRASS_HI}"/>
    <path d="M${C + 92},${armY} L${C + 124},${armY - 18} L${C + 106},${armY + 30} Z" fill="${BRASS_HI}"/>`;
}

function frame(inner, { size, scale = 1 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
    <stop offset="0%" stop-color="${NAVY_HI}"/><stop offset="100%" stop-color="${NAVY}"/>
  </radialGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(${C},${C}) scale(${scale}) translate(${-C},${-C})">${inner}</g>
</svg>`;
}

/** The lion head, scaled and placed. */
const lionAt = (cy, s, fill = BRASS, face = BRASS) => `
  <g transform="translate(${C},${cy}) scale(${s}) translate(${-C},${-C - 19})">
    <path d="${mane()}" fill="${fill}"/>
    <g transform="translate(0,19)">
      <path d="${HEAD}" fill="${face}"/>
      <path d="${FEATURES}" fill="${NAVY}"/>
    </g>
  </g>`;

export const VARIANTS = [
  {
    id: 'A1',
    name: 'Lion over anchor',
    note: 'Lion above, anchor below. The classic crest arrangement, stripped of the rope ring.',
    render: (o) => frame(`${anchor({ top: 250, bottom: 452, w: 20 })}${lionAt(176, 0.60)}`, o)
  },
  {
    id: 'A2',
    name: 'Lion as the ring',
    note: 'The lion head replaces the anchor\'s ring — one object, not two stacked.',
    render: (o) => frame(`
      <g fill="none" stroke="${BRASS_HI}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
        <line x1="${C}" y1="248" x2="${C}" y2="430"/>
        <line x1="${C - 64}" y1="300" x2="${C + 64}" y2="300"/>
        <path d="M150,352 C160,406 200,442 256,442 C312,442 352,406 362,352"/>
      </g>
      <path d="M150,352 L114,332 L134,386 Z" fill="${BRASS_HI}"/>
      <path d="M362,352 L398,332 L378,386 Z" fill="${BRASS_HI}"/>
      ${lionAt(168, 0.62)}`, o)
  },
  {
    id: 'A3',
    name: 'Anchor in the mane',
    note: 'Anchor rising behind the lion, its stock reading as part of the mane.',
    render: (o) => frame(`
      <g fill="none" stroke="${BRASS}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round">
        <line x1="${C}" y1="120" x2="${C}" y2="424"/>
        <path d="M158,344 C168,398 206,436 256,436 C306,436 344,398 354,344"/>
      </g>
      <path d="M158,344 L122,324 L142,378 Z" fill="${BRASS}"/>
      <path d="M354,344 L390,324 L370,378 Z" fill="${BRASS}"/>
      ${lionAt(214, 0.56, BRASS, BRASS_HI)}`, o)
  },
  {
    id: 'A4',
    name: 'Anchor disc',
    note: 'Lion on a brass disc with the anchor knocked out below it. Heaviest presence on a Home Screen.',
    render: (o) => frame(`
      <circle cx="${C}" cy="${C}" r="220" fill="${BRASS}"/>
      <g fill="none" stroke="${NAVY}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
        <line x1="${C}" y1="286" x2="${C}" y2="440"/>
        <line x1="${C - 58}" y1="322" x2="${C + 58}" y2="322"/>
        <path d="M162,368 C172,414 208,444 256,444 C304,444 340,414 350,368"/>
      </g>
      <path d="M162,368 L130,350 L148,398 Z" fill="${NAVY}"/>
      <path d="M350,368 L382,350 L364,398 Z" fill="${NAVY}"/>
      <g transform="translate(${C},188) scale(0.52) translate(${-C},${-C - 19})">
        <path d="${mane()}" fill="${NAVY}"/>
        <g transform="translate(0,19)">
          <path d="${HEAD}" fill="${NAVY}"/>
          <path d="${FEATURES}" fill="${BRASS}"/>
        </g>
      </g>`, o)
  }
];
