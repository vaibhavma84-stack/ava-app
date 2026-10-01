// The CV and the sea service statement, drawn as PDFs from what is already in
// the vault. Pure layout: the caller passes plain data (and a JPEG for the
// photo), so this runs the same on the phone and in the tests.
//
// The CV follows the layout manning agencies ask of deck officers: personal
// particulars, competency and endorsements, travel documents, training,
// medical, then sea service newest first, with totals by rank and ship type.

import { createPdf, wrapText } from './pdf.js';
import { seaTimeSummary, entryDays, formatDuration, certificateCategory, isOnboard } from './derive.js';

const MARGIN = 40;
const INK = '#16202b';
const DIM = '#5b6773';
const ACCENT = '#8a6d12';
const RULE = '#c9ccd1';
const SHADE = '#eef0f3';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2024-03-05 -> 05-Mar-2024: the form sea service is written in, and never ambiguous. */
export function cvDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A cursor down the page that starts a new page when it runs out, and redraws
 * a table's header row when a table crosses onto the next page.
 */
function flow(doc, { footer }) {
  const bottom = doc.height - MARGIN - 18;
  const f = {
    y: MARGIN,
    left: MARGIN,
    width: doc.width - MARGIN * 2,
    newPage() {
      doc.addPage();
      f.y = MARGIN;
    },
    need(h) {
      if (f.y + h > bottom) { f.newPage(); return true; }
      return false;
    },
    gap(h) { f.y += h; },

    heading(text) {
      f.need(40);
      f.gap(8);
      doc.text(text.toUpperCase(), f.left, f.y, { size: 9.5, bold: true, color: ACCENT });
      f.y += 13;
      doc.line(f.left, f.y, f.left + f.width, f.y, { color: ACCENT, width: 0.8 });
      f.y += 6;
    },

    paragraph(text, { size = 9.5, color = INK, bold = false } = {}) {
      for (const line of wrapText(text, f.width, size, bold)) {
        f.need(size * 1.35);
        doc.text(line, f.left, f.y, { size, color, bold });
        f.y += size * 1.35;
      }
    },

    bullets(lines, { size = 9.5 } = {}) {
      for (const raw of lines) {
        const text = raw.replace(/^[-•*]\s*/, '').trim();
        if (!text) continue;
        const wrapped = wrapText(text, f.width - 12, size);
        wrapped.forEach((line, i) => {
          f.need(size * 1.35);
          if (i === 0) doc.text('•', f.left + 2, f.y, { size, color: ACCENT });
          doc.text(line, f.left + 12, f.y, { size, color: INK });
          f.y += size * 1.35;
        });
      }
    },

    /** Label/value pairs laid out in two columns. */
    pairs(items, { columns = 2, labelWidth = 82, size = 9 } = {}) {
      const rows = items.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
      const colWidth = f.width / columns;
      for (let i = 0; i < rows.length; i += columns) {
        const slice = rows.slice(i, i + columns);
        const heights = slice.map(([, v]) => wrapText(String(v), colWidth - labelWidth - 8, size).length);
        const h = Math.max(...heights) * size * 1.3 + 4;
        f.need(h);
        slice.forEach(([k, v], c) => {
          const x = f.left + c * colWidth;
          doc.text(k, x, f.y, { size: size - 0.5, color: DIM });
          wrapText(String(v), colWidth - labelWidth - 8, size).forEach((line, li) => {
            doc.text(line, x + labelWidth, f.y + li * size * 1.3, { size, color: INK });
          });
        });
        f.y += h;
      }
    },

    /**
     * columns: [{ label, width (fraction), align }]; rows: arrays of cell text,
     * where a cell may hold two lines separated by '\n' (the second dimmed).
     */
    table(columns, rows, { size = 8 } = {}) {
      const widths = columns.map((c) => c.width * f.width);
      const pad = 3.5;
      const lineH = size * 1.3;

      const drawHeader = () => {
        const lines = columns.map((c, i) => wrapText(c.label, widths[i] - pad * 2, size - 0.5, true));
        const h = Math.max(...lines.map((l) => l.length)) * lineH + pad * 2;
        doc.rect(f.left, f.y, f.width, h, { fill: SHADE });
        let x = f.left;
        lines.forEach((ls, i) => {
          ls.forEach((line, li) => {
            const tx = columns[i].align === 'right' ? x + widths[i] - pad : x + pad;
            doc.text(line, tx, f.y + pad + li * lineH, { size: size - 0.5, bold: true, color: INK, align: columns[i].align === 'right' ? 'right' : 'left' });
          });
          x += widths[i];
        });
        f.y += h;
      };

      f.need(40);
      drawHeader();
      for (const row of rows) {
        const cells = row.map((cell, i) => {
          const [main, sub] = String(cell ?? '').split('\n');
          return {
            main: wrapText(main || '', widths[i] - pad * 2, size, columns[i].bold),
            sub: sub ? wrapText(sub, widths[i] - pad * 2, size - 1) : []
          };
        });
        const h = Math.max(...cells.map((c) => c.main.length + c.sub.length)) * lineH + pad * 2;
        if (f.need(h)) drawHeader();
        let x = f.left;
        cells.forEach((c, i) => {
          const right = columns[i].align === 'right';
          const tx = right ? x + widths[i] - pad : x + pad;
          let ty = f.y + pad;
          for (const line of c.main) {
            doc.text(line, tx, ty, { size, color: INK, bold: columns[i].bold, align: right ? 'right' : 'left' });
            ty += lineH;
          }
          for (const line of c.sub) {
            doc.text(line, tx, ty, { size: size - 1, color: DIM, align: right ? 'right' : 'left' });
            ty += lineH;
          }
          x += widths[i];
        });
        f.y += h;
        doc.line(f.left, f.y, f.left + f.width, f.y, { color: RULE, width: 0.4 });
      }
      f.gap(4);
    },

    finish() {
      const total = doc.pageCount;
      for (let i = 0; i < total; i++) {
        doc.goToPage(i);
        const y = doc.height - MARGIN + 2;
        doc.line(MARGIN, y - 6, doc.width - MARGIN, y - 6, { color: RULE, width: 0.4 });
        doc.text(footer, MARGIN, y, { size: 7.5, color: DIM });
        doc.text(`Page ${i + 1} of ${total}`, doc.width - MARGIN, y, { size: 7.5, color: DIM, align: 'right' });
      }
    }
  };
  doc.addPage();
  return f;
}

function byCategory(certificates) {
  const groups = {};
  for (const c of certificates) {
    const cat = certificateCategory(c);
    (groups[cat] ||= []).push(c);
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }
  return groups;
}

function certificateRows(list) {
  return list.map((c) => [
    c.title || '',
    c.refNo || '',
    c.issuer || '',
    cvDate(c.issueDate),
    c.expiryDate ? cvDate(c.expiryDate) : 'Unlimited'
  ]);
}

export const CERT_COLUMNS = [
  { label: 'Certificate', width: 0.34, bold: true },
  { label: 'Number', width: 0.17 },
  { label: 'Issued by', width: 0.21 },
  { label: 'Issued', width: 0.14 },
  { label: 'Expires', width: 0.14 }
];

function seaServiceRows(voyages, today) {
  return [...voyages]
    .filter((v) => v.signOnDate)
    .sort((a, b) => (b.signOnDate || '').localeCompare(a.signOnDate || ''))
    .map((v) => {
      const onboard = isOnboard(v, today);
      return [
        `${v.vessel || ''}\n${[v.imo ? `IMO ${v.imo}` : '', v.flag].filter(Boolean).join(' · ')}`,
        v.vesselType || '',
        `${v.grt || '—'}\n${v.dwt ? `${v.dwt} DWT` : ''}`,
        `${v.kw || '—'}\n${v.engine || ''}`,
        v.company || '',
        v.rank || '',
        `${cvDate(v.signOnDate)}\n${v.signOnPort || ''}`,
        `${onboard ? 'Onboard' : cvDate(v.signOffDate)}\n${onboard ? '' : v.signOffPort || ''}`,
        formatDuration(entryDays(v, today))
      ];
    });
}

export const SEA_COLUMNS = [
  { label: 'Vessel', width: 0.16, bold: true },
  { label: 'Type', width: 0.105 },
  { label: 'GRT / DWT', width: 0.085, align: 'right' },
  { label: 'kW / Engine', width: 0.1, align: 'right' },
  { label: 'Company', width: 0.13 },
  { label: 'Rank', width: 0.1 },
  { label: 'Sign on', width: 0.11 },
  { label: 'Sign off', width: 0.11 },
  { label: 'Period', width: 0.1, align: 'right' }
];

function totalsPairs(summary) {
  const pairs = [['Total sea time', `${formatDuration(summary.totalDays)} (${summary.totalDays} days)`]];
  for (const r of summary.byRank.slice(0, 4)) pairs.push([r.rank, formatDuration(r.days)]);
  if (summary.tankerDays) pairs.push(['On tankers', formatDuration(summary.tankerDays)]);
  return pairs;
}

/** Documents that identify a seafarer on a sea service statement. */
function findDocument(certificates, pattern) {
  return certificates.find((c) => certificateCategory(c) === 'Travel document' && pattern.test(`${c.title} ${c.issuer || ''}`));
}

const CERT_SECTIONS = [
  ['Certificate of Competency', 'Certificates of competency'],
  ['Endorsement', 'Endorsements'],
  ['Travel document', 'Travel documents'],
  ['Training / STCW course', 'STCW & training courses'],
  ['Medical', 'Medical'],
  ['Other', 'Other certificates']
];

export const DECLARATION = 'I hereby declare that the information given above is true and correct to the best of my knowledge.';

/**
 * What goes on the CV, in order, independent of how it is drawn: the PDF and
 * the Word document are both made from this.
 *   profile       the profile entry's data
 *   certificates  certificate data objects
 *   voyages       sea time data objects
 */
export function cvModel({ profile = {}, certificates = [], voyages = [], today = null } = {}) {
  const now = today ? new Date(today + 'T00:00:00Z') : undefined;
  const summary = seaTimeSummary(voyages, now);
  const groups = byCategory(certificates);
  return {
    name: profile.fullName || 'Curriculum Vitae',
    position: profile.positionApplied ? `Position applied for: ${profile.positionApplied}` : '',
    available: profile.availableFrom ? `Available from ${cvDate(profile.availableFrom)}` : '',
    contact: [profile.phone, profile.email].filter(Boolean).join('   ·   '),
    personal: [
      ['Date of birth', cvDate(profile.dateOfBirth)],
      ['Place of birth', profile.placeOfBirth],
      ['Nationality', profile.nationality],
      ['Marital status', profile.maritalStatus],
      ['Nearest airport', profile.nearestAirport],
      ['Languages', profile.languages],
      ['Address', profile.address]
    ].filter(([, v]) => v && String(v).trim()),
    summary: profile.summary || '',
    totals: summary.totalDays ? totalsPairs(summary) : [],
    certSections: CERT_SECTIONS
      .filter(([cat]) => groups[cat]?.length)
      .map(([cat, title]) => ({ title, rows: certificateRows(groups[cat]) })),
    seaRows: seaServiceRows(voyages, now),
    skills: String(profile.skills || '').split(/\r?\n/).map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean),
    education: profile.education || '',
    references: profile.references || '',
    date: cvDate(today || todayIso())
  };
}

/** The CV as a PDF. photo is optional JPEG bytes, portrait. */
export function buildCv({ photo = null, ...input } = {}) {
  const m = cvModel(input);
  const doc = createPdf({ title: `${m.name} — CV`, author: input.profile?.fullName || '' });
  const f = flow(doc, { footer: `${m.name} — Curriculum Vitae` });

  // Header: name and position on the left, photo on the right.
  const photoW = 78, photoH = 100;
  const textW = f.width - (photo ? photoW + 16 : 0);
  const top = f.y;
  doc.text(m.name.toUpperCase(), f.left, f.y, { size: 20, bold: true, color: INK });
  f.y += 26;
  if (m.position) { doc.text(m.position, f.left, f.y, { size: 11, bold: true, color: ACCENT }); f.y += 16; }
  if (m.available) { doc.text(m.available, f.left, f.y, { size: 9.5, color: DIM }); f.y += 14; }
  for (const line of m.contact ? wrapText(m.contact, textW, 9.5) : []) { doc.text(line, f.left, f.y, { size: 9.5, color: INK }); f.y += 13; }
  if (photo) {
    doc.rect(f.left + f.width - photoW, top, photoW, photoH, { stroke: RULE, lineWidth: 0.6 });
    doc.image(photo, f.left + f.width - photoW, top, photoW, photoH);
  }
  f.y = Math.max(f.y, photo ? top + photoH : f.y) + 4;

  if (m.personal.length) {
    f.heading('Personal details');
    f.pairs(m.personal);
  }
  if (m.summary) {
    f.heading('Professional summary');
    f.paragraph(m.summary);
  }
  if (m.totals.length) {
    f.heading('Sea service summary');
    f.pairs(m.totals, { labelWidth: 96 });
  }
  for (const section of m.certSections) {
    f.heading(section.title);
    f.table(CERT_COLUMNS, section.rows);
  }
  if (m.seaRows.length) {
    f.heading('Sea service');
    f.table(SEA_COLUMNS, m.seaRows, { size: 7.5 });
  }
  if (m.skills.length) {
    f.heading('Cargo & operational experience');
    f.bullets(m.skills);
  }
  if (m.education) {
    f.heading('Education');
    f.paragraph(m.education);
  }
  if (m.references) {
    f.heading('References');
    f.paragraph(m.references);
  }

  f.need(70);
  f.gap(14);
  f.paragraph(DECLARATION, { size: 9, color: DIM });
  f.gap(22);
  doc.text(`Date: ${m.date}`, f.left, f.y, { size: 9, color: INK });
  doc.line(f.left + f.width - 170, f.y + 10, f.left + f.width, f.y + 10, { color: INK, width: 0.5 });
  doc.text('Signature', f.left + f.width, f.y + 14, { size: 8, color: DIM, align: 'right' });

  f.finish();
  return doc.output();
}

/**
 * A record of sea service: every voyage oldest first, with totals, for an
 * exam or CoC application. It is a working copy, not a verified document.
 */
export function buildSeaServiceStatement({ profile = {}, certificates = [], voyages = [], today = null } = {}) {
  const now = today ? new Date(today + 'T00:00:00Z') : undefined;
  const name = profile.fullName || '';
  const doc = createPdf({ title: `Record of sea service${name ? ' — ' + name : ''}`, author: name });
  const f = flow(doc, { footer: `Record of sea service${name ? ' — ' + name : ''} · generated ${cvDate(today || todayIso())}` });

  doc.text('RECORD OF SEA SERVICE', f.left, f.y, { size: 16, bold: true, color: INK });
  f.y += 24;

  const cdc = findDocument(certificates, /cdc|discharge|seaman|seafarer/i);
  const passport = findDocument(certificates, /passport/i);
  f.pairs([
    ['Name', name],
    ['Date of birth', cvDate(profile.dateOfBirth)],
    ['Nationality', profile.nationality],
    ['CDC / Seaman\'s book', cdc ? cdc.refNo || cdc.title : ''],
    ['Passport', passport ? passport.refNo || '' : '']
  ], { labelWidth: 96 });

  const rows = [...voyages]
    .filter((v) => v.signOnDate)
    .sort((a, b) => (a.signOnDate || '').localeCompare(b.signOnDate || ''))
    .map((v, i) => {
      const onboard = isOnboard(v, now);
      return [
        String(i + 1),
        `${v.vessel || ''}\n${[v.imo ? `IMO ${v.imo}` : '', v.officialNumber ? `ON ${v.officialNumber}` : ''].filter(Boolean).join(' · ')}`,
        `${v.flag || ''}\n${v.vesselType || ''}`,
        `${v.grt || '—'}\n${v.kw ? `${v.kw} kW` : ''}`,
        `${v.rank || ''}\n${v.company || ''}`,
        `${cvDate(v.signOnDate)}\n${v.signOnPort || ''}`,
        `${onboard ? 'Onboard' : cvDate(v.signOffDate)}\n${onboard ? '' : v.signOffPort || ''}`,
        `${entryDays(v, now)}\n${formatDuration(entryDays(v, now))}`
      ];
    });

  f.heading('Service');
  if (rows.length) {
    f.table([
      { label: '#', width: 0.04 },
      { label: 'Vessel', width: 0.18, bold: true },
      { label: 'Flag / Type', width: 0.13 },
      { label: 'GRT / kW', width: 0.09, align: 'right' },
      { label: 'Rank / Company', width: 0.17 },
      { label: 'Signed on', width: 0.13 },
      { label: 'Signed off', width: 0.13 },
      { label: 'Days', width: 0.13, align: 'right' }
    ], rows, { size: 7.5 });
  } else {
    f.paragraph('No sea service recorded.', { color: DIM });
  }

  const summary = seaTimeSummary(voyages, now);
  f.heading('Totals');
  f.pairs([['Total sea service', `${summary.totalDays} days (${formatDuration(summary.totalDays)})`]], { columns: 1, labelWidth: 120 });
  if (summary.byRank.length) {
    f.gap(4);
    f.table([
      { label: 'By rank', width: 0.5, bold: true },
      { label: 'Days', width: 0.2, align: 'right' },
      { label: 'Months and days', width: 0.3, align: 'right' }
    ], summary.byRank.map((r) => [r.rank, String(r.days), formatDuration(r.days)]), { size: 8.5 });
  }
  if (summary.byType.length) {
    const typeRows = summary.byType.map((t) => [t.type, String(t.days), formatDuration(t.days)]);
    if (summary.tankerDays) typeRows.push(['All tankers', String(summary.tankerDays), formatDuration(summary.tankerDays)]);
    f.table([
      { label: 'By ship type', width: 0.5, bold: true },
      { label: 'Days', width: 0.2, align: 'right' },
      { label: 'Months and days', width: 0.3, align: 'right' }
    ], typeRows, { size: 8.5 });
  }

  f.gap(8);
  const notes = [
    'Days are counted inclusive of the sign-on and sign-off days. Months are of 30 days.'
  ];
  if (summary.overlapDays) {
    notes.push(`${summary.overlapDays} day${summary.overlapDays === 1 ? '' : 's'} where voyages overlap ${summary.overlapDays === 1 ? 'is' : 'are'} counted once, against the earlier voyage.`);
  }
  if (rows.some((r) => r[6].startsWith('Onboard'))) notes.push('A voyage marked Onboard is counted up to the date of this record.');
  notes.push('Prepared from the seafarer\'s own records. Verify against the discharge book and company testimonials before submission.');
  for (const n of notes) f.paragraph(n, { size: 8, color: DIM });

  f.finish();
  return doc.output();
}

/** The one document of a kind that lasts longest, for the bio-data's document table. */
function latestOf(certificates, test) {
  return certificates.filter(test).sort((a, b) => (b.expiryDate || '9999').localeCompare(a.expiryDate || '9999'))[0] || null;
}

/**
 * Everything a manning agency's bio-data form asks for, gathered in one place:
 * particulars, next of kin, sizes, documents and a short sea service summary.
 * Returned as sections of label/value pairs, so the same content can be drawn
 * as a PDF or copied as text into the agency's own form.
 */
export function biodataModel({ profile = {}, certificates = [], voyages = [], today = null } = {}) {
  const now = today ? new Date(today + 'T00:00:00Z') : undefined;
  const doc = (re) => latestOf(certificates, (c) => re.test(`${c.title} ${c.issuer || ''}`));
  const coc = latestOf(certificates, (c) => certificateCategory(c) === 'Certificate of Competency');
  const docRow = (label, c) => (c ? [label, [c.refNo, c.expiryDate ? `valid to ${cvDate(c.expiryDate)}` : '', c.issuer].filter(Boolean).join(' · ') || c.title] : [label, '']);
  const summary = seaTimeSummary(voyages, now);
  const recent = [...voyages].filter((v) => v.signOnDate).sort((a, b) => b.signOnDate.localeCompare(a.signOnDate)).slice(0, 3);

  return [
    { title: 'Personal', pairs: [
      ['Full name', profile.fullName], ['Position applied for', profile.positionApplied],
      ['Available from', cvDate(profile.availableFrom)], ['Date of birth', cvDate(profile.dateOfBirth)],
      ['Place of birth', profile.placeOfBirth], ['Nationality', profile.nationality],
      ['Marital status', profile.maritalStatus], ['Religion / diet', profile.religion],
      ['National seafarer ID', profile.seafarerId], ['Languages', profile.languages]
    ] },
    { title: 'Contact', pairs: [
      ['Phone', profile.phone], ['Email', profile.email], ['Address', profile.address], ['Nearest airport', profile.nearestAirport]
    ] },
    { title: 'Next of kin', pairs: [
      ['Name', profile.nokName], ['Relationship', profile.nokRelation], ['Phone', profile.nokPhone], ['Address', profile.nokAddress]
    ] },
    { title: 'Physical & kit', pairs: [
      ['Height', profile.height ? `${profile.height} cm` : ''], ['Weight', profile.weight ? `${profile.weight} kg` : ''],
      ['Boiler suit', profile.boilerSuit], ['Shoe size', profile.shoeSize], ['Blood group', profile.bloodGroup]
    ] },
    { title: 'Documents', pairs: [
      docRow('Passport', doc(/passport/i)),
      docRow('CDC / Seaman\'s book', doc(/\bcdc\b|continuous discharge|seaman|seafarer'?s (identity|record)|discharge book/i)),
      docRow('US visa', doc(/c1 ?\/ ?d|\bus visa|united states/i)),
      docRow('Certificate of Competency', coc),
      docRow('GMDSS GOC', doc(/gmdss|\bgoc\b/i)),
      docRow('Medical', latestOf(certificates, (c) => certificateCategory(c) === 'Medical')),
      docRow('Yellow fever', doc(/yellow fever/i))
    ] },
    { title: 'Sea service', pairs: [
      ['Total sea time', summary.totalDays ? `${formatDuration(summary.totalDays)} (${summary.totalDays} days)` : ''],
      ...summary.byRank.slice(0, 3).map((r) => [`As ${r.rank}`, formatDuration(r.days)]),
      ...recent.map((v, i) => [i === 0 ? 'Last vessels' : '', `${v.vessel || ''} · ${v.rank || ''} · ${v.vesselType || ''} · ${cvDate(v.signOnDate)} to ${isOnboard(v, now) ? 'onboard' : cvDate(v.signOffDate)}`])
    ] }
  ].map((s) => ({ ...s, pairs: s.pairs.filter(([, v]) => v && String(v).trim()) }))
    .filter((s) => s.pairs.length);
}

/** The bio-data as plain text, for pasting into an agency's form or an email. */
export function biodataText(input) {
  return biodataModel(input).map((s) =>
    `${s.title.toUpperCase()}\n${s.pairs.map(([k, v]) => `${k ? k + ': ' : '    '}${String(v).replace(/\n/g, ', ')}`).join('\n')}`
  ).join('\n\n') + '\n';
}

/** The bio-data as a one- or two-page PDF, with the photo if there is one. */
export function buildBiodata({ photo = null, ...input } = {}) {
  const sections = biodataModel(input);
  const name = input.profile?.fullName || '';
  const doc = createPdf({ title: `Bio-data${name ? ' — ' + name : ''}`, author: name });
  const f = flow(doc, { footer: `Bio-data${name ? ' — ' + name : ''}` });
  const top = f.y;
  doc.text('SEAFARER BIO-DATA', f.left, f.y, { size: 16, bold: true, color: INK });
  f.y += 22;
  if (name) { doc.text(name, f.left, f.y, { size: 12, bold: true, color: ACCENT }); f.y += 16; }
  if (photo) {
    doc.rect(f.left + f.width - 66, top, 66, 85, { stroke: RULE, lineWidth: 0.6 });
    doc.image(photo, f.left + f.width - 66, top, 66, 85);
    f.y = Math.max(f.y, top + 85);
  }
  for (const s of sections) {
    f.heading(s.title);
    f.pairs(s.pairs, { columns: 1, labelWidth: 150 });
  }
  f.finish();
  return doc.output();
}
