// A4 with ears. Two treatments, against the earless original for comparison.
//
// Ears are the cue that separates a lion from a sunburst, but on an inverted
// mark they need a contrasting edge or they vanish into the mane.

const NAVY = '#05101b';
const NAVY_HI = '#12293e';
const BRASS = '#c9a227';
const C = 256;

const tidy = (d) => d.replace(/\s+/g, ' ').trim();
const pt = (r, a) => [C + Math.cos(a) * r, C + Math.sin(a) * r];
const f = (n) => n.toFixed(1);

function mane({ tufts = 13, inner = 152, outer = 212 } = {}) {
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

const HEAD = tidy(`
M256,116 C214,116 186,128 168,146 C160,132 146,124 132,126
C124,146 128,166 140,178 C130,198 126,222 128,244
C130,276 142,302 162,322 C182,342 214,356 256,356
C298,356 330,342 350,322 C370,302 382,276 384,244
C386,222 382,198 372,178 C384,166 388,146 380,126
C366,124 352,132 344,146 C326,128 298,116 256,116 Z`);

const FEATURES = tidy(`
M206,212 C220,200 244,200 256,212 C244,220 220,220 206,212 Z
M256,212 C268,200 292,200 306,212 C292,220 268,220 256,212 Z
M256,248 L232,270 C232,286 244,296 256,296 C268,296 280,286 280,270 Z
M256,296 C256,314 242,324 224,320 C240,332 258,326 256,308 Z
M256,296 C256,314 270,324 288,320 C272,332 254,326 256,308 Z`);

/** Ears held inside the mane — they only show as an outlined notch. */
const EARS_INNER = tidy(`
M170,150 C154,128 130,120 118,130 C116,154 128,176 150,184 Z
M342,150 C358,128 382,120 394,130 C396,154 384,176 362,184 Z`);

/** Ears pushed past the mane's outer edge so they break the silhouette. */
const EARS_OUT = tidy(`
M176,148 C148,104 106,90 84,106 C80,146 102,180 138,194 Z
M336,148 C364,104 406,90 428,106 C432,146 410,180 374,194 Z`);

function frame(inner, { size, scale = 1 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
    <stop offset="0%" stop-color="${NAVY_HI}"/><stop offset="100%" stop-color="${NAVY}"/>
  </radialGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(${C},${C}) scale(${scale}) translate(${-C},${-C})">${inner}</g>
</svg>`;
}

/** The A4 shell: brass disc with the anchor knocked out in navy. */
const DISC_AND_ANCHOR = `
  <circle cx="${C}" cy="${C}" r="220" fill="${BRASS}"/>
  <g fill="none" stroke="${NAVY}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
    <line x1="${C}" y1="286" x2="${C}" y2="440"/>
    <line x1="${C - 58}" y1="322" x2="${C + 58}" y2="322"/>
    <path d="M162,368 C172,414 208,444 256,444 C304,444 340,414 350,368"/>
  </g>
  <path d="M162,368 L130,350 L148,398 Z" fill="${NAVY}"/>
  <path d="M350,368 L382,350 L364,398 Z" fill="${NAVY}"/>`;

const lion = (ears) => `
  <g transform="translate(${C},188) scale(0.52) translate(${-C},${-C - 19})">
    <path d="${mane()}" fill="${NAVY}"/>
    <g transform="translate(0,19)">
      ${ears ? `<path d="${ears}" fill="${NAVY}"/>` : ''}
      <path d="${HEAD}" fill="${NAVY}"/>
      ${ears ? `<path d="${ears}" fill="none" stroke="${BRASS}" stroke-width="11"/>` : ''}
      <path d="${FEATURES}" fill="${BRASS}"/>
    </g>
  </g>`;

export const VARIANTS = [
  {
    id: 'A4',
    name: 'As shown before',
    note: 'No ears. The head merges into the mane, so it reads as a burst before it reads as a lion.',
    render: (o) => frame(`${DISC_AND_ANCHOR}${lion(null)}`, o)
  },
  {
    id: 'A4a',
    name: 'Inner ears',
    note: 'Ears held inside the mane, shown by a brass outline. Subtle — keeps the round silhouette.',
    render: (o) => frame(`${DISC_AND_ANCHOR}${lion(EARS_INNER)}`, o)
  },
  {
    id: 'A4b',
    name: 'Ears breaking the outline',
    note: 'Ears pushed past the mane so they interrupt the edge. Strongest cat read at small size.',
    render: (o) => frame(`${DISC_AND_ANCHOR}${lion(EARS_OUT)}`, o)
  }
];
