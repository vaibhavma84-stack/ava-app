// Library's mark: book spines on layered dark, copper accent.
// Rendered to PNG by tools/make-library-icons.mjs.

const INK = '#070809';
const INK_HI = '#1a1f24';
const COPPER = '#c98a4b';
const COPPER_HI = '#e2a566';
const PARCHMENT = '#e8e4dc';

/** One upright spine with a band across it. */
function spine({ x, w, top, fill, band }) {
  const bottom = 396;
  const r = 8;
  return `
    <rect x="${x}" y="${top}" width="${w}" height="${bottom - top}" rx="${r}" fill="${fill}"/>
    <rect x="${x}" y="${top + (bottom - top) * 0.26}" width="${w}" height="16" fill="${band}" opacity="0.85"/>
    <rect x="${x}" y="${top + (bottom - top) * 0.62}" width="${w}" height="9" fill="${band}" opacity="0.55"/>`;
}

export function librarySVG({ size = 512, scale = 1 } = {}) {
  const art = `
    ${spine({ x: 116, w: 58, top: 148, fill: COPPER, band: INK })}
    ${spine({ x: 184, w: 62, top: 118, fill: PARCHMENT, band: INK })}
    ${spine({ x: 256, w: 58, top: 160, fill: COPPER_HI, band: INK })}
    <!-- A leaning volume, so the stack reads as shelved books, not a bar chart -->
    <g transform="rotate(13 360 300)">
      ${spine({ x: 330, w: 56, top: 176, fill: COPPER, band: INK })}
    </g>
    <rect x="96" y="396" width="320" height="20" rx="8" fill="${PARCHMENT}" opacity="0.9"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
    <defs><radialGradient id="g" cx="50%" cy="38%" r="74%">
      <stop offset="0%" stop-color="${INK_HI}"/><stop offset="100%" stop-color="${INK}"/>
    </radialGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/>
    <g transform="translate(256,256) scale(${scale}) translate(-256,-256)">${art}</g>
  </svg>`;
}
