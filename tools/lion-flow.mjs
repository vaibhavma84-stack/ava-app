// An original lion drawn in the spirit of the references: bold front-facing
// symmetry, and a mane of pointed locks of varying length rather than the
// uniform radial spikes of the earlier marks.
//
// The left half is authored and mirrored, so symmetry is exact and there is
// half as much to tune.

const NAVY = '#05101b';
const NAVY_HI = '#12293e';
const BRASS = '#c9a227';
const BRASS_HI = '#e3bd4a';
const C = 256;

const tidy = (d) => d.replace(/\s+/g, ' ').trim();
const rad = (deg) => (deg * Math.PI) / 180;
const f = (n) => n.toFixed(1);
const at = (r, deg, cy = 268) => [C + Math.cos(rad(deg)) * r, cy + Math.sin(rad(deg)) * r];

/**
 * One mane lock: a curved spike from an inner base out to a tip, swept
 * tangentially so the mane looks combed rather than radiating.
 */
function lock({ deg, len, base = 108, half = 11, sweep = 9, cy = 268 }) {
  const [tx, ty] = at(len, deg + sweep, cy);
  const [b1x, b1y] = at(base, deg - half, cy);
  const [b2x, b2y] = at(base, deg + half, cy);
  const [c1x, c1y] = at(base + (len - base) * 0.55, deg - half * 0.55 + sweep * 0.3, cy);
  const [c2x, c2y] = at(len * 0.93, deg + sweep * 0.55, cy);
  const [c3x, c3y] = at(len * 0.93, deg + sweep * 1.1, cy);
  const [c4x, c4y] = at(base + (len - base) * 0.55, deg + half * 0.75 + sweep * 0.3, cy);
  return `M${f(b1x)},${f(b1y)} C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(tx)},${f(ty)}`
       + ` C${f(c3x)},${f(c3y)} ${f(c4x)},${f(c4y)} ${f(b2x)},${f(b2y)} Z`;
}

// Locks around the left half and the crown. Lengths vary so the outline is
// ragged like fur instead of a cog.
const LOCKS = [
  { deg: -90, len: 196, half: 12 },   // crown
  { deg: -68, len: 214, half: 12 },
  { deg: -46, len: 198, half: 13 },
  { deg: -24, len: 216, half: 13 },
  { deg: -2, len: 202, half: 13 },
  { deg: 20, len: 214, half: 13 },
  { deg: 42, len: 196, half: 13 },
  { deg: 64, len: 208, half: 12 },
  { deg: 86, len: 184, half: 12 },
  { deg: 108, len: 198, half: 12 },
];

const maneHalf = () => LOCKS.map((l) => lock(l)).join(' ');

/** Head: broad brow, defined cheeks, narrowing to the muzzle. */
const HEAD = tidy(`
M256,150
C214,150 182,164 164,190
C148,212 144,244 150,272
C156,302 172,326 196,342
C216,356 236,362 256,362
C276,362 296,356 316,342
C340,326 356,302 362,272
C368,244 364,212 348,190
C330,164 298,150 256,150 Z`);

/** Ears, tucked at the upper corners of the head. */
const EARS = tidy(`
M176,182 C162,158 140,148 126,158 C126,184 142,206 166,214 Z
M336,182 C350,158 372,148 386,158 C386,184 370,206 346,214 Z`);

/** Brow ridges, eyes, nose, muzzle and chin, all cut out of the face. */
const FACE = tidy(`
M198,214 C216,204 238,208 248,222 C232,222 214,222 198,214 Z
M314,214 C296,204 274,208 264,222 C280,222 298,222 314,214 Z
M202,240 C218,230 240,234 246,248 C230,254 212,252 202,240 Z
M310,240 C294,230 272,234 266,248 C282,254 300,252 310,240 Z
M256,262 L232,286 C232,300 243,309 256,309 C269,309 280,300 280,286 Z
M256,309 C256,326 240,336 220,331 C238,345 258,338 256,320 Z
M256,309 C256,326 272,336 292,331 C274,345 254,338 256,320 Z
M186,282 C200,276 216,278 224,286 C210,290 196,290 186,282 Z
M326,282 C312,276 296,278 288,286 C302,290 316,290 326,282 Z
M188,306 C202,300 218,302 226,310 C212,314 198,314 188,306 Z
M324,306 C310,300 294,302 286,310 C300,314 314,314 324,306 Z`);

function frame(inner, { size, scale = 1 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
    <stop offset="0%" stop-color="${NAVY_HI}"/><stop offset="100%" stop-color="${NAVY}"/>
  </radialGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(${C},${C}) scale(${scale}) translate(${-C},${-C})">${inner}</g>
</svg>`;
}

/** Mane, mirrored about the vertical axis for exact symmetry. */
const mane = (fill) => `
  <g fill="${fill}">
    <path d="${maneHalf()}"/>
    <g transform="translate(512,0) scale(-1,1)"><path d="${maneHalf()}"/></g>
  </g>`;

const lionBody = (maneFill, faceFill, cutFill) => `
  ${mane(maneFill)}
  <path d="${EARS}" fill="${maneFill}"/>
  <path d="${HEAD}" fill="${faceFill}"/>
  <path d="${FACE}" fill="${cutFill}"/>`;

const ANCHOR_CUT = (stroke) => `
  <g fill="none" stroke="${stroke}" stroke-width="21" stroke-linecap="round" stroke-linejoin="round">
    <line x1="${C}" y1="300" x2="${C}" y2="446"/>
    <line x1="${C - 56}" y1="334" x2="${C + 56}" y2="334"/>
    <path d="M168,378 C178,420 210,448 256,448 C302,448 334,420 344,378"/>
  </g>
  <path d="M168,378 L138,360 L154,406 Z" fill="${stroke}"/>
  <path d="M344,378 L374,360 L358,406 Z" fill="${stroke}"/>`;

export const VARIANTS = [
  {
    id: 'F1',
    name: 'Flowing mane',
    note: 'Locks of varying length, swept rather than radiating. Original drawing, no traced artwork.',
    render: (o) => frame(lionBody(BRASS, BRASS, NAVY), o)
  },
  {
    id: 'F2',
    name: 'Flowing, two-tone',
    note: 'Face a shade lighter so the head separates from the mane.',
    render: (o) => frame(lionBody(BRASS, BRASS_HI, NAVY), o)
  },
  {
    id: 'F3',
    name: 'Flowing over anchor',
    note: 'The same lion sized down over the anchor — your trade and the Leo sign together.',
    render: (o) => frame(`
      ${ANCHOR_CUT(BRASS_HI)}
      <g transform="translate(${C},196) scale(0.60) translate(${-C},-268)">
        ${lionBody(BRASS, BRASS, NAVY)}
      </g>`, o)
  },
  {
    id: 'F4',
    name: 'Flowing on a disc',
    note: 'Inverted on brass, anchor knocked out below.',
    render: (o) => frame(`
      <circle cx="${C}" cy="${C}" r="220" fill="${BRASS}"/>
      ${ANCHOR_CUT(NAVY)}
      <g transform="translate(${C},190) scale(0.55) translate(${-C},-268)">
        ${lionBody(NAVY, NAVY, BRASS)}
      </g>`, o)
  }
];
