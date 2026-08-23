// The AVA mark: a lion head in brass on navy.
//
// Built from geometry rather than a traced bitmap, so it stays crisp at every
// size and can be retuned by changing numbers here. Rendered to PNG by
// tools/make-icons.mjs using headless Chromium.

export const NAVY = '#05101b';
export const NAVY_HI = '#12293e';
export const BRASS = '#c9a227';
export const BRASS_HI = '#e3bd4a';

const C = 256; // centre of the 512 canvas

/** Mane: tapered tufts around a ring, curved so they read as fur, not gear teeth. */
function mane({ tufts = 16, inner = 148, outer = 218, twist = 0.38 } = {}) {
  const step = (Math.PI * 2) / tufts;
  const pt = (r, a) => [C + Math.cos(a) * r, C + Math.sin(a) * r];
  let d = '';
  for (let i = 0; i < tufts; i++) {
    const a0 = i * step - Math.PI / 2;
    const a1 = a0 + step;
    const mid = a0 + step / 2;
    const [sx, sy] = pt(inner, a0);
    const [tx, ty] = pt(outer, mid - step * twist * 0.25);
    const [ex, ey] = pt(inner, a1);
    // Control points bulge outward so each tuft has a soft shoulder.
    // Control points hug the tip so each tuft tapers to a point.
    const [c1x, c1y] = pt(inner + (outer - inner) * 0.55, a0 + step * 0.30);
    const [c2x, c2y] = pt(outer * 0.94, mid - step * 0.07);
    const [c3x, c3y] = pt(outer * 0.94, mid + step * 0.07);
    const [c4x, c4y] = pt(inner + (outer - inner) * 0.55, a1 - step * 0.30);
    d += (i === 0 ? `M${sx.toFixed(1)},${sy.toFixed(1)}` : '');
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
    d += `C${c3x.toFixed(1)},${c3y.toFixed(1)} ${c4x.toFixed(1)},${c4y.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
  }
  return d + 'Z';
}

/**
 * Head: a broad brow tapering to a narrow muzzle, with ears set wide.
 * Drawn as one closed path so the silhouette stays unbroken.
 */
const HEAD = `
M256,116
C214,116 186,128 168,146
C160,132 146,124 132,126
C124,146 128,166 140,178
C130,198 126,222 128,244
C130,276 142,302 162,322
C182,342 214,356 256,356
C298,356 330,342 350,322
C370,302 382,276 384,244
C386,222 382,198 372,178
C384,166 388,146 380,126
C366,124 352,132 344,146
C326,128 298,116 256,116
Z`.replace(/\s+/g, ' ').trim();

/** Muzzle, eyes and nose, punched out in the background colour. */
const FEATURES = `
<path d="M212,214 C224,204 244,204 254,214 C244,220 224,220 212,214 Z"/>
<path d="M258,214 C268,204 288,204 300,214 C288,220 268,220 258,214 Z"/>
<path d="M256,246 L236,266 C236,280 246,288 256,288 C266,288 276,280 276,266 Z"/>
<path d="M256,288 C256,302 246,310 232,308 C244,316 258,312 256,300 Z"/>
<path d="M256,288 C256,302 266,310 280,308 C268,316 254,312 256,300 Z"/>
<path d="M196,278 C206,274 218,276 224,282 C214,284 204,284 196,278 Z"/>
<path d="M316,278 C306,274 294,276 288,282 C298,284 308,284 316,278 Z"/>
<path d="M196,300 C206,296 218,298 224,304 C214,306 204,306 196,300 Z"/>
<path d="M316,300 C306,296 294,298 288,304 C298,306 308,306 316,300 Z"/>`;

/**
 * @param scale shrink the art for maskable icons, whose corners get cropped.
 */
export function lionSVG({ size = 512, scale = 1, background = true } = {}) {
  // The head path is drawn around y=236; nudge it down so it sits concentric
  // with the mane rather than riding high in it.
  const inner = `
    <path d="${mane()}" fill="${BRASS}"/>
    <circle cx="${C}" cy="${C}" r="143" fill="${NAVY}"/>
    <g transform="translate(0,19)">
      <path d="${HEAD}" fill="${BRASS_HI}"/>
      <g fill="${NAVY}">${FEATURES}</g>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  ${background ? `<defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
      <stop offset="0%" stop-color="${NAVY_HI}"/><stop offset="100%" stop-color="${NAVY}"/>
    </radialGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/>` : ''}
  <g transform="translate(${C},${C}) scale(${scale}) translate(${-C},${-C})">${inner}</g>
</svg>`;
}
