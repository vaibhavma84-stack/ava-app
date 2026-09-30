// A small PDF writer: A4 pages, the two built-in Helvetica faces, lines, filled
// boxes and JPEG pictures. Enough for a CV or a sea service statement, made on
// the phone with no connection and no library.
//
// Coordinates are in points from the top-left of the page, y growing down;
// they are flipped to PDF's bottom-left origin only when drawn.

export const A4 = { width: 595.28, height: 841.89 };

// Advance widths (per 1000 em) for ASCII 32-126, from the Adobe core font metrics.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

// Unicode punctuation that WinAnsiEncoding has a slot for outside Latin-1.
const WIN_ANSI = {
  0x20ac: 0x80, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2122: 0x99
};

/** A character as its WinAnsi byte; anything the font cannot show becomes '?'. */
function winAnsi(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  if (WIN_ANSI[cp]) return WIN_ANSI[cp];
  if (cp === 0x09) return 32;
  return 63;
}

function charWidth(code, bold) {
  if (code >= 32 && code <= 126) return (bold ? HELVETICA_BOLD : HELVETICA)[code - 32];
  if (code === 0x95) return 350;
  if (code === 0x97) return 1000;
  if (code === 0x91 || code === 0x92) return bold ? 278 : 222;
  return bold ? 611 : 556;
}

/** Width of a string in points. */
export function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of String(str ?? '')) w += charWidth(winAnsi(ch), bold);
  return (w * size) / 1000;
}

/**
 * Break text into lines no wider than maxWidth. Existing line breaks are kept;
 * a single word longer than the line is cut rather than allowed to overflow.
 */
export function wrapText(str, maxWidth, size, bold = false) {
  const out = [];
  for (const para of String(str ?? '').split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (let word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      while (textWidth(word, size, bold) > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > maxWidth) cut--;
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
    out.push(line);
  }
  return out;
}

/** A PDF literal string: WinAnsi bytes, with anything unsafe as an octal escape. */
function pdfString(str) {
  let out = '(';
  for (const ch of String(str ?? '')) {
    const code = winAnsi(ch);
    if (code === 40 || code === 41 || code === 92) out += '\\' + String.fromCharCode(code);
    else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  }
  return out + ')';
}

const num = (n) => (Math.round(n * 100) / 100).toString();

/** '#1b354f' -> '0.106 0.208 0.31' */
function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');
}

/** Pixel size of a baseline or progressive JPEG, read from its SOF marker. */
export function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9]
      };
    }
    i += 2 + len;
  }
  throw new Error('Not a readable JPEG');
}

export function createPdf({ title = '', author = '' } = {}) {
  const pages = [];
  const images = [];
  let ops = null;

  const H = A4.height;
  const Y = (y) => num(H - y);

  const doc = {
    width: A4.width,
    height: A4.height,

    addPage() {
      ops = [];
      pages.push(ops);
      return doc;
    },

    get pageCount() { return pages.length; },

    /** Go back to an earlier page, e.g. to number every page at the end. */
    goToPage(index) {
      ops = pages[index];
      return doc;
    },

    text(str, x, y, { size = 10, bold = false, color = '#000000', align = 'left' } = {}) {
      if (str === null || str === undefined || str === '') return doc;
      let tx = x;
      if (align !== 'left') {
        const w = textWidth(str, size, bold);
        tx = align === 'right' ? x - w : x - w / 2;
      }
      // y is the top of the line; the baseline sits about 0.8 em below it.
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ${num(tx)} ${Y(y + size * 0.8)} Td ${pdfString(str)} Tj ET`);
      return doc;
    },

    rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
      const path = `${num(x)} ${Y(y + h)} ${num(w)} ${num(h)} re`;
      if (fill && stroke) ops.push(`${rgb(fill)} rg ${rgb(stroke)} RG ${num(lineWidth)} w ${path} B`);
      else if (fill) ops.push(`${rgb(fill)} rg ${path} f`);
      else if (stroke) ops.push(`${rgb(stroke)} RG ${num(lineWidth)} w ${path} S`);
      return doc;
    },

    line(x1, y1, x2, y2, { color = '#000000', width = 0.5 } = {}) {
      ops.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${Y(y1)} m ${num(x2)} ${Y(y2)} l S`);
      return doc;
    },

    /** Place a JPEG (Uint8Array) in the given box. */
    image(jpeg, x, y, w, h) {
      const { width, height, components } = jpegSize(jpeg);
      const name = `Im${images.length + 1}`;
      images.push({ name, jpeg, width, height, components });
      ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${Y(y + h)} cm /${name} Do Q`);
      return doc;
    },

    /** The finished file as bytes. */
    output() {
      const enc = new TextEncoder();
      const chunks = [];
      const offsets = [];
      let length = 0;
      const push = (part) => {
        const bytes = typeof part === 'string' ? enc.encode(part) : part;
        chunks.push(bytes);
        length += bytes.length;
      };
      const object = (id, body) => {
        offsets[id] = length;
        push(`${id} 0 obj\n`);
        for (const part of [].concat(body)) push(part);
        push('\nendobj\n');
      };

      // 1 catalog, 2 page tree, 3-4 fonts, 5 info, then images, then pages.
      const imageIds = images.map((_, i) => 6 + i);
      const firstPage = 6 + images.length;
      const pageIds = pages.map((_, i) => firstPage + i * 2);

      push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
      object(1, '<< /Type /Catalog /Pages 2 0 R >>');
      object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
      object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      object(5, `<< /Title ${pdfString(title)} /Author ${pdfString(author)} /Producer (AVA) >>`);

      images.forEach((img, i) => {
        const space = img.components === 1 ? '/DeviceGray' : img.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
        object(imageIds[i], [
          `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
          img.jpeg,
          '\nendstream'
        ]);
      });

      const xobjects = images.length
        ? ` /XObject << ${images.map((img, i) => `/${img.name} ${imageIds[i]} 0 R`).join(' ')} >>`
        : '';
      pages.forEach((pageOps, i) => {
        const content = pageOps.join('\n');
        object(pageIds[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(A4.width)} ${num(A4.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects} >> /Contents ${pageIds[i] + 1} 0 R >>`);
        object(pageIds[i] + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      });

      const count = firstPage + pages.length * 2;
      const xref = length;
      push(`xref\n0 ${count}\n0000000000 65535 f \n`);
      for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
      push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

      const out = new Uint8Array(length);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out;
    }
  };

  return doc;
}
