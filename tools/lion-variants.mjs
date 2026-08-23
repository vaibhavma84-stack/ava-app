// Candidate designs for the AVA lion mark. Each returns a full SVG at any size
// so it can be judged both large and at Home Screen size.

const NAVY = '#05101b';
const NAVY_HI = '#12293e';
const BRASS = '#c9a227';
const BRASS_HI = '#e3bd4a';
const C = 256;

const tidy = (d) => d.replace(/\s+/g, ' ').trim();
const pt = (r, a) => [C + Math.cos(a) * r, C + Math.sin(a) * r];
const f = (n) => n.toFixed(1);

/** Soft, curved mane tufts. */
function maneCurved({ tufts = 16, inner = 148, outer = 218 } = {}) {
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

/** Straight-edged mane: angular spikes, no curves. */
function maneFaceted({ tufts = 18, inner = 152, outer = 220 } = {}) {
  const step = (Math.PI * 2) / tufts;
  let d = '';
  for (let i = 0; i < tufts; i++) {
    const a0 = i * step - Math.PI / 2, mid = a0 + step / 2, a1 = a0 + step;
    const [sx, sy] = pt(inner, a0);
    const [tx, ty] = pt(i % 2 ? outer * 0.86 : outer, mid);
    const [ex, ey] = pt(inner, a1);
    if (i === 0) d += `M${f(sx)},${f(sy)}`;
    d += `L${f(tx)},${f(ty)}L${f(ex)},${f(ey)}`;
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

/** Angular head for the faceted treatment. */
const HEAD_FACETED = tidy(`
M256,118 L196,138 L168,150 L156,126 L132,124 L130,158 L146,180
L130,214 L134,258 L156,310 L200,346 L256,358 L312,346 L356,310
L378,258 L382,214 L366,180 L382,158 L380,124 L356,126 L344,150
L316,138 Z`);

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

/** Reduced feature set — eyes and nose only, for small-size legibility. */
const FEATURES_MIN = tidy(`
M214,216 C226,206 246,206 256,216 C246,222 226,222 214,216 Z
M256,216 C266,206 286,206 298,216 C286,222 266,222 256,216 Z
M256,250 L234,272 C234,288 246,296 256,296 C266,296 278,288 278,272 Z`);

/** Lion in profile, facing right: brow, snout, jaw, then mane sweeping back. */
const PROFILE_HEAD = tidy(`
M262,140 C298,140 330,152 354,174 C370,188 384,202 394,214
C401,222 400,232 392,236 C384,240 374,236 368,230
C366,244 358,256 344,264 C348,276 342,288 330,292
C316,296 302,290 296,280 C282,288 266,292 250,290
C232,288 216,278 206,262 C190,238 186,206 196,180
C208,152 232,140 262,140 Z`);

const PROFILE_EAR = tidy(`
M238,142 C226,124 208,118 194,124 C196,142 208,158 224,164 Z`);

const PROFILE_MANE = tidy(`
M262,140 C202,132 152,164 132,218 C110,278 128,344 180,376
C204,390 232,394 258,390 C224,372 200,342 190,306
C176,258 184,206 210,172 C224,154 242,144 262,140 Z`);

function frame(inner, { size, scale = 1, flat = false }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  ${flat ? `<rect width="512" height="512" fill="${NAVY}"/>`
    : `<defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
        <stop offset="0%" stop-color="${NAVY_HI}"/><stop offset="100%" stop-color="${NAVY}"/>
      </radialGradient></defs><rect width="512" height="512" fill="url(#g)"/>`}
  <g transform="translate(${C},${C}) scale(${scale}) translate(${-C},${-C})">${inner}</g>
</svg>`;
}

export const VARIANTS = [
  {
    id: 1,
    name: 'Emblem',
    note: 'Current design. Face inset in the mane with a navy ring separating them.',
    render: (o) => frame(`
      <path d="${maneCurved()}" fill="${BRASS}"/>
      <circle cx="${C}" cy="${C}" r="143" fill="${NAVY}"/>
      <g transform="translate(0,19)">
        <path d="${HEAD}" fill="${BRASS_HI}"/><path d="${FEATURES}" fill="${NAVY}"/>
      </g>`, o)
  },
  {
    id: 2,
    name: 'Solid silhouette',
    note: 'One unbroken brass shape, features cut out. The most literal silhouette.',
    render: (o) => frame(`
      <path d="${maneCurved({ tufts: 14, inner: 152, outer: 212 })}" fill="${BRASS}"/>
      <g transform="translate(0,19)"><path d="${HEAD}" fill="${BRASS}"/></g>
      <g transform="translate(0,19)"><path d="${FEATURES}" fill="${NAVY}"/></g>`, o)
  },
  {
    id: 3,
    name: 'Faceted',
    note: 'Straight edges only — angular mane and planed head. Industrial, matches the app type.',
    render: (o) => frame(`
      <path d="${maneFaceted()}" fill="${BRASS}"/>
      <circle cx="${C}" cy="${C}" r="146" fill="${NAVY}"/>
      <g transform="translate(0,17)">
        <path d="${HEAD_FACETED}" fill="${BRASS_HI}"/><path d="${FEATURES_MIN}" fill="${NAVY}"/>
      </g>`, o)
  },
  {
    id: 4,
    name: 'Outline',
    note: 'Brass linework on navy, nothing filled. Lightest and most restrained.',
    render: (o) => frame(`
      <g fill="none" stroke="${BRASS}" stroke-width="11" stroke-linejoin="round" stroke-linecap="round">
        <path d="${maneCurved({ inner: 156, outer: 214 })}"/>
        <g transform="translate(0,19)"><path d="${HEAD}"/></g>
      </g>
      <g transform="translate(0,19)"><path d="${FEATURES_MIN}" fill="${BRASS}"/></g>`, o)
  },
  {
    id: 5,
    name: 'Profile',
    note: 'Side-facing head with the mane swept back. Reads differently from every other app icon.',
    render: (o) => frame(`
      <g transform="translate(-8,-14)">
        <path d="${PROFILE_MANE}" fill="${BRASS}"/>
        <path d="${PROFILE_EAR}" fill="${BRASS}"/>
        <path d="${PROFILE_HEAD}" fill="${BRASS_HI}"/>
        <path d="M318,196 C330,188 346,190 352,198 C344,204 328,204 318,196 Z" fill="${NAVY}"/>
        <circle cx="336" cy="196" r="6" fill="${BRASS_HI}"/>
        <path d="M384,222 C392,219 397,224 394,229 C388,231 383,227 384,222 Z" fill="${NAVY}"/>
        <path d="M356,250 C346,258 330,258 320,252 C332,264 350,262 356,250 Z" fill="${NAVY}"/>
      </g>`, o)
  },
  {
    id: 6,
    name: 'Roundel',
    note: 'Mane held inside a brass ring, like a ship\'s badge or a cap device.',
    render: (o) => frame(`
      <circle cx="${C}" cy="${C}" r="228" fill="none" stroke="${BRASS}" stroke-width="14"/>
      <circle cx="${C}" cy="${C}" r="206" fill="none" stroke="${BRASS}" stroke-width="5" opacity="0.55"/>
      <path d="${maneCurved({ inner: 126, outer: 186 })}" fill="${BRASS}"/>
      <circle cx="${C}" cy="${C}" r="122" fill="${NAVY}"/>
      <g transform="translate(0,16) scale(0.85) translate(38,38)">
        <path d="${HEAD}" fill="${BRASS_HI}"/><path d="${FEATURES}" fill="${NAVY}"/>
      </g>`, o)
  }
];
