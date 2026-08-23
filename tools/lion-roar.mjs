// Growling lion in profile, facing left. Asymmetric mane, open jaw.
//
// The open mouth is cut into the silhouette as a notch rather than drawn as an
// interior shape — that is what gives a roaring profile its recognisable
// outline, and it survives shrinking far better than interior detail.

const NAVY = '#05101b';
const NAVY_HI = '#12293e';
const BRASS = '#c9a227';
const BRASS_HI = '#e3bd4a';
const C = 256;

const tidy = (d) => d.replace(/\s+/g, ' ').trim();
const rad = (d) => (d * Math.PI) / 180;
const f = (n) => n.toFixed(1);

/**
 * Mane: spikes along an arc behind the head, lengths varied so the outline is
 * ragged, each tip swept back for flow. Closed through the head interior, which
 * the head shape then covers.
 */
function mane({ cx = 300, cy = 254, rIn = 96, rOut = 208, from = -150, to = 152, n = 17, sweep = 11 } = {}) {
  const pattern = [1.0, 0.80, 0.93, 0.70, 1.04, 0.86, 0.76, 0.98];
  const step = (to - from) / n;
  const at = (r, deg) => [cx + Math.cos(rad(deg)) * r, cy + Math.sin(rad(deg)) * r];
  let d = '';
  let first = null;
  for (let i = 0; i < n; i++) {
    const a0 = from + i * step;
    const a1 = a0 + step;
    const mid = a0 + step / 2;
    const len = rOut * pattern[i % pattern.length];
    const [vx, vy] = at(rIn, a0);
    const [tx, ty] = at(len, mid + sweep);
    const [nx, ny] = at(rIn, a1);
    const [c1x, c1y] = at(rIn + (len - rIn) * 0.5, a0 + step * 0.28);
    const [c2x, c2y] = at(len * 0.9, mid + sweep * 0.4);
    const [c3x, c3y] = at(len * 0.9, mid + sweep * 1.4);
    const [c4x, c4y] = at(rIn + (len - rIn) * 0.5, a1 - step * 0.1);
    if (i === 0) { d += `M${f(vx)},${f(vy)}`; first = [vx, vy]; }
    d += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(tx)},${f(ty)}`;
    d += ` C${f(c3x)},${f(c3y)} ${f(c4x)},${f(c4y)} ${f(nx)},${f(ny)}`;
  }
  return d + ` L${f(first[0])},${f(first[1])} Z`;
}

/**
 * Head facing left. Skull -> brow -> nose bridge -> nose -> upper lip, then the
 * jaw notch opens, the lower jaw runs forward to the chin, and the ruff carries
 * back under the jaw into the mane.
 */
const HEAD = tidy(`
M252,140
C214,142 184,156 164,180
C152,190 138,196 124,204
C110,212 100,220 98,230
C96,240 104,247 116,247
C128,248 140,252 150,258
C178,272 208,280 236,281
C216,300 188,316 160,328
C144,336 132,346 130,356
C136,368 152,375 170,376
C202,382 236,382 268,376
C316,366 352,338 368,296
C386,248 378,192 344,162
C318,140 286,138 252,140
Z`);

/** Fangs biting into the jaw notch, upper and lower. */
const FANGS = tidy(`
M150,258 L162,290 L176,264 Z
M212,278 L206,304 L228,286 Z
M196,300 L206,272 L216,298 Z
M236,281 L230,306 L250,292 Z`);

/**
 * One eye only — a second horizontal slit alongside it read as a second eye,
 * which a profile must not have. The brow is a thin angled wedge above it, and
 * the remaining marks are the nostril and a single cheek line by the mouth.
 */
const MARKS = tidy(`
M178,206 C192,190 216,188 230,199 C216,212 192,215 178,206 Z
M172,182 C192,172 218,174 232,184 C216,184 192,187 176,192 Z
M116,224 C124,219 133,222 132,229 C124,232 116,230 116,224 Z
M166,240 C184,234 202,236 212,244 C196,250 178,249 166,240 Z`);
const EYE = { cx: 204, cy: 201, r: 8 };

function frame(inner, { size, scale = 1 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
    <stop offset="0%" stop-color="${NAVY_HI}"/><stop offset="100%" stop-color="${NAVY}"/>
  </radialGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(${C},${C}) scale(${scale}) translate(${-C},${-C})">${inner}</g>
</svg>`;
}

const body = (maneFill, headFill, cutFill) => `
  <path d="${mane()}" fill="${maneFill}"/>
  <path d="${HEAD}" fill="${headFill}"/>
  <path d="${FANGS}" fill="${headFill}"/>
  <path d="${MARKS}" fill="${cutFill}"/>
  <circle cx="${EYE.cx}" cy="${EYE.cy}" r="${EYE.r}" fill="${cutFill}"/>`;

export const VARIANTS = [
  {
    id: 'R1',
    name: 'Growling profile',
    note: 'One brass tone, jaw open, mane swept back. Asymmetric throughout.',
    render: (o) => frame(body(BRASS, BRASS, NAVY), o)
  },
  {
    id: 'R2',
    name: 'Growling, two-tone',
    note: 'Head a shade lighter than the mane so the skull separates.',
    render: (o) => frame(body(BRASS, BRASS_HI, NAVY), o)
  },
  {
    id: 'R3',
    name: 'Growling on a disc',
    note: 'Inverted on brass. Heaviest presence on a Home Screen.',
    render: (o) => frame(`
      <circle cx="${C}" cy="${C}" r="222" fill="${BRASS}"/>
      <g transform="translate(${C},${C}) scale(0.86) translate(${-C},${-C})">
        ${body(NAVY, NAVY, BRASS)}
      </g>`, o)
  }
];
