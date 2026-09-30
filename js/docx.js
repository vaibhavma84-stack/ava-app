// The CV as a Word document (.docx), for agencies that want to edit it.
//
// Built from the same content as the PDF (cvModel), written as the handful of
// XML parts Word needs and zipped. Plain tables and paragraphs only, so it
// opens the same in Word, Pages and Google Docs.

import { zip } from './zip.js';
import { jpegSize } from './pdf.js';
import { cvModel, CERT_COLUMNS, SEA_COLUMNS, DECLARATION } from './cv.js';

const INK = '16202B';
const DIM = '5B6773';
const ACCENT = '8A6D12';
const RULE = 'C9CCD1';
const SHADE = 'EEF0F3';

// A4 with 2 cm margins, in twentieths of a point.
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134;
const TEXT_W = PAGE_W - MARGIN * 2;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters; a pasted note can carry them.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** One run of text; halfPoints is Word's font size unit. */
function run(text, { bold = false, color = INK, size = 19, caps = false } = {}) {
  const props = [
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>',
    bold ? '<w:b/>' : '',
    caps ? '<w:caps/>' : '',
    `<w:color w:val="${color}"/>`,
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`
  ].join('');
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.map((line, i) => `<w:r><w:rPr>${props}</w:rPr>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
}

function para(content, { after = 60, before = 0, align = null, border = null, keepNext = false, indent = null, rightTab = false } = {}) {
  const props = [
    keepNext ? '<w:keepNext/>' : '',
    border ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${border}"/></w:pBdr>` : '',
    rightTab ? `<w:tabs><w:tab w:val="right" w:pos="${TEXT_W}"/></w:tabs>` : '',
    `<w:spacing w:before="${before}" w:after="${after}"/>`,
    indent ? `<w:ind w:left="${indent}" w:hanging="220"/>` : '',
    align ? `<w:jc w:val="${align}"/>` : ''
  ].join('');
  return `<w:p><w:pPr>${props}</w:pPr>${content}</w:p>`;
}

function heading(text) {
  return para(run(text, { bold: true, color: ACCENT, size: 20, caps: true }), { before: 220, after: 100, border: ACCENT, keepNext: true });
}

function cell(content, width, { shade = null, borders = true } = {}) {
  const b = borders
    ? `<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="${RULE}"/></w:tcBorders>`
    : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${b}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}<w:tcMar><w:top w:w="50" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc>`;
}

// Word merges two tables that touch, so each one is followed by an empty
// paragraph to keep them apart.
function table(widths, rows) {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const none = '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${none}<w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`
    + para('', { after: 0 });
}

/** A data table: shaded header row repeated on each page, then the rows. */
function dataTable(columns, rows, size = 16) {
  const widths = columns.map((c) => Math.round(c.width * TEXT_W));
  const align = (c) => (c.align === 'right' ? 'right' : null);
  const header = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${columns.map((c, i) =>
    cell(para(run(c.label, { bold: true, size: size - 1 }), { after: 0, align: align(c) }), widths[i], { shade: SHADE })).join('')}</w:tr>`;
  const body = rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((value, i) => {
    const [main, sub] = String(value ?? '').split('\n');
    const content = run(main, { bold: columns[i].bold, size })
      + (sub ? run(`\n${sub}`, { color: DIM, size: size - 2 }) : '');
    return cell(para(content, { after: 0, align: align(columns[i]) }), widths[i]);
  }).join('')}</w:tr>`);
  return table(widths, [header, ...body]);
}

/** Label/value pairs, two to a row. */
function pairsTable(pairs, labelTwips = 1700) {
  const half = TEXT_W / 2;
  const widths = [labelTwips, half - labelTwips, labelTwips, half - labelTwips].map(Math.round);
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const cells = [];
    for (const [k, v] of pairs.slice(i, i + 2)) {
      cells.push(cell(para(run(k, { color: DIM, size: 18 }), { after: 0 }), widths[cells.length], { borders: false }));
      cells.push(cell(para(run(v, { size: 19 }), { after: 0 }), widths[cells.length], { borders: false }));
    }
    while (cells.length < 4) cells.push(cell(para(''), widths[cells.length], { borders: false }));
    rows.push(`<w:tr>${cells.join('')}</w:tr>`);
  }
  return table(widths, rows);
}

/** An inline picture, sized in points. */
function picture(relId, widthPt, heightPt) {
  const cx = Math.round(widthPt * 12700), cy = Math.round(heightPt * 12700);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Photo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="photo.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** The CV as .docx bytes. photo is optional JPEG bytes, portrait. */
export function buildCvDocx({ photo = null, ...input } = {}) {
  const m = cvModel(input);
  const body = [];

  // Header: name block on the left, photo on the right, in a borderless table.
  const headLines = [
    para(run(m.name.toUpperCase(), { bold: true, size: 40 }), { after: 80 }),
    m.position ? para(run(m.position, { bold: true, color: ACCENT, size: 22 }), { after: 40 }) : '',
    m.available ? para(run(m.available, { color: DIM, size: 19 }), { after: 40 }) : '',
    m.contact ? para(run(m.contact, { size: 19 }), { after: 40 }) : ''
  ].join('') || para('');
  if (photo) {
    jpegSize(photo);   // throws on anything that is not a JPEG
    const photoW = 1560;
    body.push(table([TEXT_W - photoW, photoW], [
      `<w:tr>${cell(headLines, TEXT_W - photoW, { borders: false })}${cell(para(picture('rIdPhoto', 78, 100), { after: 0, align: 'right' }), photoW, { borders: false })}</w:tr>`
    ]));
  } else {
    body.push(headLines);
  }

  if (m.personal.length) body.push(heading('Personal details'), pairsTable(m.personal));
  if (m.summary) body.push(heading('Professional summary'), para(run(m.summary), { after: 60 }));
  if (m.totals.length) body.push(heading('Sea service summary'), pairsTable(m.totals, 1900));
  for (const section of m.certSections) body.push(heading(section.title), dataTable(CERT_COLUMNS, section.rows));
  if (m.seaRows.length) body.push(heading('Sea service'), dataTable(SEA_COLUMNS, m.seaRows, 14));
  if (m.skills.length) {
    body.push(heading('Cargo & operational experience'));
    for (const s of m.skills) body.push(para(run('•\t', { color: ACCENT }) + run(s), { after: 30, indent: 220 }));
  }
  if (m.education) body.push(heading('Education'), para(run(m.education)));
  if (m.references) body.push(heading('References'), para(run(m.references)));

  body.push(
    para(run(DECLARATION, { color: DIM, size: 18 }), { before: 300, after: 400 }),
    para(run(`Date: ${m.date}`) + run('\t') + run('Signature: ____________________'), { after: 0, rightTab: true })
  );

  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  // A right tab stop for the signature line, set on the document defaults.
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;

  const pageField = (instr) => `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="${DIM}"/><w:sz w:val="15"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS}>${para(
    run(`${m.name} — Curriculum Vitae`, { color: DIM, size: 15 }) + run('\tPage ', { color: DIM, size: 15 }) + pageField('PAGE') + run(' of ', { color: DIM, size: 15 }) + pageField('NUMPAGES'),
    { after: 0, border: null }
  ).replace('<w:pPr>', `<w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="${RULE}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${TEXT_W}"/></w:tabs>`)}</w:ftr>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="19"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:tabs><w:tab w:val="right" w:pos="${TEXT_W}"/></w:tabs></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

  const rels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    photo ? '<Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.jpeg"/>' : ''
  ].join('');

  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(m.name)} — CV</dc:title><dc:creator>${esc(input.profile?.fullName || '')}</dc:creator></cp:coreProperties>` },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/footer1.xml', data: footer },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>` }
  ];
  if (photo) files.push({ name: 'word/media/photo.jpeg', data: photo });
  return zip(files);
}
