// A document pack: the scans of chosen certificates joined into one PDF, with
// an index page, for the agency that asks for "all your documents".
//
// Uses pdf-lib (vendored for the Library) to copy the pages of PDF scans as
// they are, and to place photographs on A4 pages. Every page carries a small
// label saying which document it belongs to.

const A4 = [595.28, 841.89];
const MARGIN = 40;
const colour = (hex) => ({
  type: 'RGB',
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255
});
const INK = colour('#16202b');
const DIM = colour('#5b6773');
const ACCENT = colour('#8a6d12');
const WHITE = colour('#ffffff');
const RULE = colour('#c9ccd1');

let lib = null;
const pdfLib = async () => lib || (lib = await import('../vendor/pdf-lib.mjs'));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function packDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : '';
}

/** The standard fonts cannot show every character; swap what they cannot for '?'. */
function safe(text) {
  return String(text ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

function fit(font, text, size, width) {
  let t = safe(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > width) t = t.slice(0, -1);
  return t + '...';
}

/**
 * documents: [{ title, refNo, issuer, expiryDate,
 *               files: [{ name, kind: 'pdf' | 'jpeg' | 'png', bytes: Uint8Array }] }]
 * Returns the pack as PDF bytes.
 */
export async function buildDocumentPack({ name = '', documents = [], today = null } = {}) {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  out.setTitle(`Documents${name ? ' — ' + name : ''}`);
  out.setProducer('AVA');
  const font = await out.embedFont('Helvetica');
  const bold = await out.embedFont('Helvetica-Bold');

  // ── index page ──
  const cover = out.addPage(A4);
  let y = A4[1] - MARGIN - 20;
  cover.drawText('DOCUMENTS', { x: MARGIN, y, size: 20, font: bold, color: INK });
  y -= 22;
  if (name) { cover.drawText(safe(name), { x: MARGIN, y, size: 12, font: bold, color: ACCENT }); y -= 16; }
  cover.drawText(`Prepared ${packDate(today || new Date().toISOString().slice(0, 10))}`, { x: MARGIN, y, size: 9, font, color: DIM });
  y -= 26;

  const cols = [MARGIN, MARGIN + 22, MARGIN + 250, MARGIN + 360, MARGIN + 450];
  const head = ['#', 'Document', 'Number', 'Expires', 'Pages'];
  head.forEach((h, i) => cover.drawText(h, { x: cols[i], y, size: 8.5, font: bold, color: INK }));
  y -= 6;
  cover.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 0.6, color: ACCENT });
  y -= 14;
  const indexRows = [];

  // ── the documents ──
  const failures = [];
  let pageNo = 1;
  for (const [n, doc] of documents.entries()) {
    const label = `${n + 1}. ${doc.title || 'Document'}${doc.refNo ? ' · ' + doc.refNo : ''}`;
    const firstPage = pageNo + 1;
    for (const file of doc.files || []) {
      try {
        if (file.kind === 'pdf') {
          const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
          const pages = await out.copyPages(src, src.getPageIndices());
          for (const page of pages) {
            out.addPage(page);
            pageNo++;
            stamp(page, label, font);
          }
        } else {
          const image = file.kind === 'png' ? await out.embedPng(file.bytes) : await out.embedJpg(file.bytes);
          const landscape = image.width > image.height * 1.15;
          const size = landscape ? [A4[1], A4[0]] : A4;
          const page = out.addPage(size);
          pageNo++;
          page.drawText(fit(bold, label, 11, size[0] - MARGIN * 2), { x: MARGIN, y: size[1] - MARGIN, size: 11, font: bold, color: INK });
          const boxW = size[0] - MARGIN * 2, boxH = size[1] - MARGIN * 2 - 24;
          const scale = Math.min(boxW / image.width, boxH / image.height);
          const w = image.width * scale, h = image.height * scale;
          page.drawImage(image, { x: (size[0] - w) / 2, y: MARGIN + (boxH - h) / 2, width: w, height: h });
        }
      } catch (ex) {
        failures.push(`${doc.title}: ${file.name}`);
        const page = out.addPage(A4);
        pageNo++;
        page.drawText(fit(bold, label, 11, A4[0] - MARGIN * 2), { x: MARGIN, y: A4[1] - MARGIN, size: 11, font: bold, color: INK });
        page.drawText(fit(font, `${file.name} could not be included (${ex.message}).`, 10, A4[0] - MARGIN * 2), { x: MARGIN, y: A4[1] - MARGIN - 24, size: 10, font, color: DIM });
      }
    }
    const pages = pageNo >= firstPage ? (pageNo === firstPage ? `${firstPage}` : `${firstPage}–${pageNo}`) : 'no scan';
    indexRows.push([String(n + 1), doc.title || 'Document', doc.refNo || '', doc.expiryDate ? packDate(doc.expiryDate) : 'No expiry', pages]);
  }

  // Index rows, written once the page numbers are known.
  const widths = [20, 222, 104, 84, 60];
  for (const row of indexRows) {
    if (y < MARGIN + 30) break;   // a pack of more documents than fit is rare; the pages still follow
    row.forEach((cell, i) => cover.drawText(fit(i === 1 ? bold : font, safe(cell).replace('–', '-'), 9, widths[i]), {
      x: cols[i], y, size: 9, font: i === 1 ? bold : font, color: cell === 'no scan' ? DIM : INK
    }));
    y -= 6;
    cover.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 0.3, color: RULE });
    y -= 13;
  }
  cover.drawText(`${out.getPageCount()} pages`, { x: MARGIN, y: MARGIN, size: 8, font, color: DIM });

  return { bytes: await out.save(), failures, pages: out.getPageCount() };
}

/** A small label in the bottom-left corner of a copied page, on a white strip. */
function stamp(page, text, font) {
  const { width } = page.getSize();
  const t = fit(font, text, 7, width - 40);
  const w = font.widthOfTextAtSize(t, 7);
  page.drawRectangle({ x: 14, y: 8, width: w + 8, height: 12, color: WHITE, opacity: 0.85 });
  page.drawText(t, { x: 18, y: 11, size: 7, font, color: DIM });
}
