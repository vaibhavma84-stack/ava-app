// Profile lion marks. A side view avoids the sunburst read that every
// front-facing mane produces, but it lives or dies on the contour, so the
// brow / snout / jaw line is drawn deliberately rather than approximated.

const NAVY = '#05101b';
const NAVY_HI = '#12293e';
const BRASS = '#c9a227';
const BRASS_HI = '#e3bd4a';
const C = 256;

const tidy = (d) => d.replace(/\s+/g, ' ').trim();

/**
 * The face, looking right. Reads top-of-skull -> brow -> nose bridge -> blunt
 * nose -> lip -> chin -> jaw, then back under the cheek into the mane.
 */
const FACE = tidy(`
M286,150
C322,152 352,168 374,194
C388,210 400,226 408,240
C412,248 409,256 400,258
C393,259 386,256 381,251
C377,262 369,271 357,276
C359,287 352,297 339,300
C327,303 315,298 309,288
C292,298 272,302 252,300
C226,296 205,280 194,256
C182,230 184,198 202,174
C220,150 252,148 286,150
Z`);

/** Ear, set high and slightly back, breaking the mane edge. */
const EAR = tidy(`
M268,152
C258,128 240,116 224,120
C216,140 224,164 244,176
Z`);

/** Mane: a rounded mass with a wavy outer edge, heavier below the jaw. */
const MANE = tidy(`
M286,150
C232,138 180,152 148,190
C112,232 108,296 140,340
C158,364 184,380 212,386
C204,368 202,348 208,330
C186,336 168,330 158,314
C176,318 192,314 202,302
C180,296 166,282 162,262
C178,276 196,280 210,272
C190,258 182,238 188,216
C196,238 210,250 226,252
C214,232 216,208 232,190
C232,212 242,228 258,234
C254,210 262,182 282,164
Z`);

/** Nostril, eye and mouth, cut out of the face. */
const MARKS = tidy(`
M392,240 C398,238 402,242 400,246 C395,248 391,245 392,240 Z
M334,206 C346,198 362,200 370,209 C360,215 344,215 334,206 Z
M357,276 C348,284 334,286 324,282 C334,292 351,289 357,276 Z`);
const EYE = { cx: 350, cy: 207, r: 6 };

function frame(inner, { size, scale = 1 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
    <stop offset="0%" stop-color="${NAVY_HI}"/><stop offset="100%" stop-color="${NAVY}"/>
  </radialGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(${C},${C}) scale(${scale}) translate(${-C},${-C})">${inner}</g>
</svg>`;
}

const BODY = (faceFill, maneFill, markFill) => `
  <g transform="translate(-6,-6)">
    <path d="${MANE}" fill="${maneFill}"/>
    <path d="${EAR}" fill="${maneFill}"/>
    <path d="${FACE}" fill="${faceFill}"/>
    <path d="${MARKS}" fill="${markFill}"/>
    <circle cx="${EYE.cx}" cy="${EYE.cy}" r="${EYE.r}" fill="${markFill}"/>
  </g>`;

export const VARIANTS = [
  {
    id: 'P1',
    name: 'Profile — solid',
    note: 'One brass shape, mane and face merged, features cut out. Boldest contour.',
    render: (o) => frame(BODY(BRASS, BRASS, NAVY), o)
  },
  {
    id: 'P2',
    name: 'Profile — two-tone',
    note: 'Face a shade lighter than the mane, so the head separates without an outline.',
    render: (o) => frame(BODY(BRASS_HI, BRASS, NAVY), o)
  },
  {
    id: 'P3',
    name: 'Profile — outline',
    note: 'Linework only. Elegant large, thins out badly small.',
    render: (o) => frame(`
      <g transform="translate(-6,-6)" fill="none" stroke="${BRASS}" stroke-width="12"
         stroke-linejoin="round" stroke-linecap="round">
        <path d="${MANE}"/><path d="${EAR}"/><path d="${FACE}"/>
      </g>
      <g transform="translate(-6,-6)">
        <circle cx="${EYE.cx}" cy="${EYE.cy}" r="7" fill="${BRASS}"/>
      </g>`, o)
  },
  {
    id: 'P4',
    name: 'Profile — disc',
    note: 'Head knocked out of a brass disc. Reads as a coin or a cap badge.',
    render: (o) => frame(`
      <circle cx="${C}" cy="${C}" r="216" fill="${BRASS}"/>
      <g transform="translate(-6,-6)">
        <path d="${MANE}" fill="${NAVY}"/>
        <path d="${EAR}" fill="${NAVY}"/>
        <path d="${FACE}" fill="${NAVY}"/>
        <path d="${MARKS}" fill="${BRASS}"/>
        <circle cx="${EYE.cx}" cy="${EYE.cy}" r="${EYE.r}" fill="${BRASS}"/>
      </g>`, o)
  }
];
