// Writing a PDF of text: headings, paragraphs, small print.
//
// For the handover pack, which has to be a file a relief can open anywhere,
// print, and keep. Nothing is embedded: the text is set in Helvetica, which
// every PDF reader has built in, so a pack of a hundred highlights is a few
// kilobytes. Its widths are here so lines break where they will be drawn.
//
// Helvetica speaks WinAnsi: Western European letters, dashes, quotes, the
// degree sign. Anything beyond that -- Greek, Chinese, emoji -- is written
// as a question mark rather than as nothing, so a gap is visible.

const REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// The WinAnsi codes of characters outside plain ASCII, and their widths.
const WIN = new Map([
  ['•', [0x95, 350]], ['–', [0x96, 556]], ['—', [0x97, 1000]],
  ['‘', [0x91, 222]], ['’', [0x92, 222]], ['“', [0x93, 333]], ['”', [0x94, 333]],
  ['…', [0x85, 1000]], ['€', [0x80, 556]], ['™', [0x99, 1000]]
]);

function code(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c < 127) return c;
  if (WIN.has(ch)) return WIN.get(ch)[0];
  if (c >= 0xa0 && c <= 0xff) return c;       // Latin-1 is WinAnsi from here up
  if (ch === '\t') return 32;
  return 63;                                  // '?'
}

function widthOf(ch, bold) {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c < 127) return (bold ? BOLD : REGULAR)[c - 32];
  if (WIN.has(ch)) return WIN.get(ch)[1];
  if (c === 0xb0) return 400;
  if (c === 0xb7) return 278;
  return 556;
}

const measure = (text, size, bold) => [...text].reduce((w, ch) => w + widthOf(ch, bold), 0) * size / 1000;

function literal(text) {
  let out = '(';
  for (const ch of text) {
    const c = code(ch);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (c < 32 || c > 126) out += `\\${c.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(c);
  }
  return `${out})`;
}

/** Break a paragraph into lines no wider than `width` points. */
export function wrap(text, width, size, bold = false) {
  const lines = [];
  for (const para of String(text ?? '').replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (measure(tryLine, size, bold) <= width) { line = tryLine; continue; }
      if (line) lines.push(line);
      // A word longer than the line -- a URL, a part number -- is cut.
      let rest = word;
      while (measure(rest, size, bold) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut), size, bold) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * A document written top to bottom. Pages are A4 and turn by themselves;
 * every page is footed with its number and the title.
 */
export class PdfWriter {
  constructor({ title = '', margin = 50 } = {}) {
    this.title = title;
    this.W = 595.28;
    this.H = 841.89;
    this.margin = margin;
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.H - this.margin;
  }

  room(height) { if (this.y - height < this.margin + 24) this.newPage(); }

  space(points) { this.y -= points; }

  /** A paragraph. Options: size, bold, grey, indent, keep (lines kept on one page). */
  text(text, { size = 10.5, bold = false, grey = false, indent = 0, gap = 4, keep = false } = {}) {
    const lead = size * 1.32;
    const lines = wrap(text, this.W - this.margin * 2 - indent, size, bold);
    if (keep) this.room(lead * Math.min(lines.length, 12));
    for (const line of lines) {
      this.room(lead);
      this.y -= lead;
      if (line) {
        this.ops.push(`BT ${grey ? '0.4 0.4 0.4 rg ' : '0 0 0 rg '}/${bold ? 'F2' : 'F1'} ${size} Tf `
          + `${(this.margin + indent).toFixed(2)} ${(this.y + size * 0.28).toFixed(2)} Td ${literal(line)} Tj ET`);
      }
    }
    this.y -= gap;
  }

  heading(text, level = 1) {
    const size = level === 1 ? 17 : level === 2 ? 13.5 : 11.5;
    this.room(size * 4);
    this.space(level === 1 ? 6 : 10);
    this.text(text, { size, bold: true, gap: level === 1 ? 6 : 3 });
  }

  rule() {
    this.room(10);
    this.y -= 5;
    this.ops.push(`0.75 0.75 0.75 RG 0.6 w ${this.margin} ${this.y.toFixed(2)} m ${(this.W - this.margin).toFixed(2)} ${this.y.toFixed(2)} l S`);
    this.y -= 7;
  }

  /** The finished file. */
  toBlob() {
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    const catalog = add(null);
    const pagesRef = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    const total = this.pages.length;
    this.pages.forEach((ops, i) => {
      const foot = `${this.title ? `${this.title}  ·  ` : ''}page ${i + 1} of ${total}`;
      const footer = `BT 0.45 0.45 0.45 rg /F1 8 Tf ${this.margin} ${(this.margin - 18).toFixed(2)} Td ${literal(foot)} Tj ET`;
      const stream = [...ops, footer].join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${this.W} ${this.H}] `
        + `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRef} 0 R >>`;
    objects[pagesRef - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    // Every character written is one byte, so offsets are string lengths.
    let out = '%PDF-1.4\n%âãÏÓ\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}
