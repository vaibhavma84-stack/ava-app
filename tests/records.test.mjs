/**
 * Unit tests for leave, earnings, sea service letters, the bio-data sheet,
 * spreadsheet import and the document pack. Pure logic, no browser needed.
 *   node tests/records.test.mjs
 */
import { leaveStatus, parseWage, contractEarnings, earningsThisTaxYear, letterStatus } from '../js/derive.js';
import { parseCsv, rowsToEntries, csvDate, templateCsv } from '../js/csv.js';
import { biodataModel, biodataText, buildBiodata } from '../js/cv.js';
import { createPdf } from '../js/pdf.js';
import { buildDocumentPack } from '../js/pack.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? ' -- ' + extra : ''}`); }
};

const TODAY = new Date('2026-10-01T00:00:00Z');
const v = (vessel, signOnDate, signOffDate, extra = {}) => ({ vessel, signOnDate, signOffDate, ...extra });

console.log('\nLeave');
const history = [
  v('A', '2024-01-01', '2024-06-29'),   // 181 days aboard
  v('B', '2024-09-28', '2025-03-26'),   // 90 days home before
  v('C', '2025-06-25', '2026-01-20'),   // 90 days home before
  v('D', '2026-11-01', '')               // planned
];
let l = leaveStatus(history, TODAY);
check('at home since the last sign-off', !l.onboard && l.daysHome === 254 && l.lastSignOff === '2026-01-20', JSON.stringify(l));
check('works out the usual leave between voyages', l.usualLeave === 90, String(l.usualLeave));
check('counts down to a planned joining', l.nextJoin === '2026-11-01' && l.daysToJoin === 31 && l.nextVessel === 'D');
l = leaveStatus(history.slice(0, 3), TODAY);
check('without a planned voyage, estimates from the usual leave', l.expectedJoin === '2026-04-21' && l.daysToJoin === null, JSON.stringify(l));
check('no leave panel while onboard', leaveStatus([v('Now', '2026-09-01', '')], TODAY).onboard);

console.log('\nEarnings');
check('reads "USD 4,200 / month"', JSON.stringify(parseWage('USD 4,200 / month')) === JSON.stringify({ amount: 4200, currency: 'USD', period: 'month' }));
check('reads "$150 per day"', parseWage('$150 per day').currency === 'USD' && parseWage('$150 per day').period === 'day');
check('reads "4.5k EUR pcm"', parseWage('4.5k EUR pcm').amount === 4500 && parseWage('4.5k EUR pcm').currency === 'EUR');
check('no amount, no wage', parseWage('as per CBA') === null);
const paid = [
  v('Paid', '2026-04-01', '2026-06-30', { contracts: [{ wage: 'USD 3650 / month' }] }),
  v('Now', '2026-09-01', '', { contracts: [{ wage: 'USD 3650 / month', endDate: '2026-12-30' }] })
];
const ce = contractEarnings(paid, TODAY);
check('works out pay for a finished contract', ce.find((c) => c.vessel === 'Paid').earned === Math.round(3650 * 12 / 365 * 91));
check('pay so far on the current contract', ce.find((c) => c.vessel === 'Now').earned === Math.round(3650 * 12 / 365 * 31));
const ey = earningsThisTaxYear(paid, { startMonth: 4 }, TODAY);
check('totals the tax year by currency', ey.totals.length === 1 && ey.totals[0].currency === 'USD'
  && ey.totals[0].earned === Math.round(3650 * 12 / 365 * 91) + Math.round(3650 * 12 / 365 * 31), JSON.stringify(ey));
check('expects the current contract to run to its end', ey.totals[0].expected > ey.totals[0].earned);

console.log('\nSea service letters');
const letters = letterStatus([
  v('Has', '2024-01-01', '2024-05-01', { letterStatus: 'Received' }),
  v('Asked', '2025-01-01', '2025-05-01', { letterStatus: 'Requested' }),
  v('None', '2025-07-01', '2025-11-01'),
  v('Aboard', '2026-09-01', '')
], TODAY);
check('counts completed voyages only', letters.total === 3 && letters.received === 1);
check('lists those still missing, newest first', letters.missing.map((x) => x.vessel).join(',') === 'None,Asked');

console.log('\nSpreadsheet import');
const csv = parseCsv('Vessel,Rank,"Sign on",Sign off,Remarks\r\n"MV One, Ltd",2/O,05/01/2024,30/06/2024,"said ""ok"""\r\nMV Two,C/O,2025-01-10,,\r\n');
check('reads quoted fields with commas and quotes', csv[1][0] === 'MV One, Ltd' && csv[1][4] === 'said "ok"');
check('reads semicolon sheets from European Excel', parseCsv('Vessel;Sign on\nA;01/02/2024')[1][1] === '01/02/2024');
check('reads an Excel serial date', csvDate('45306') === '2024-01-15', csvDate('45306'));
const sea = rowsToEntries(csv, { existing: [v('MV Two', '2025-01-10', '')] });
check('recognises a sea service sheet', sea.kind === 'seatime');
check('maps columns by name and reads dates day-first', sea.entries[0].vessel === 'MV One, Ltd' && sea.entries[0].signOnDate === '2024-01-05' && sea.entries[0].signOffDate === '2024-06-30', JSON.stringify(sea.entries[0]));
check('turns "2/O" into a rank', sea.entries[0].rank === 'Second Officer', sea.entries[0].rank);
check('skips what is already in the vault', sea.entries.length === 1 && sea.skipped.length === 1);
check('keeps remarks as notes', sea.entries[0].notes === 'said "ok"');
const certs = rowsToEntries(parseCsv('Certificate,Cert No,Issued by,Date of issue,Valid until\nBasic Safety,BST-1,MASSA,10 Jun 2021,09 Jun 2026\nNo date course,X-1,MASSA,soon,\n'));
check('recognises a certificates sheet', certs.kind === 'certificate' && certs.entries.length === 2);
check('reads written-out dates', certs.entries[0].expiryDate === '2026-06-09');
check('reports a date it cannot read', certs.problems.some((p) => p.includes('"soon"')));
check('the templates read back in', rowsToEntries(parseCsv(templateCsv('seatime'))).entries[0].vessel === 'MV Example'
  && rowsToEntries(parseCsv(templateCsv('certificate'))).entries[0].expiryDate === '2026-06-09');
check('says when it cannot tell what a sheet is', rowsToEntries(parseCsv('a,b\n1,2')).kind === null);

console.log('\nBio-data');
const profile = { fullName: 'A. Seafarer', nationality: 'Indian', nokName: 'B. Seafarer', nokRelation: 'Spouse', height: '178', boilerSuit: 'L' };
const bioCerts = [
  { title: 'Passport', refNo: 'Z1234567', expiryDate: '2030-01-31' },
  { title: 'Old passport', refNo: 'K000', expiryDate: '2020-01-31' },
  { title: 'Certificate of Competency — Chief Mate', refNo: 'COC-1', expiryDate: '2029-01-01' }
];
const model = biodataModel({ profile, certificates: bioCerts, voyages: history, today: '2026-10-01' });
const pairs = Object.fromEntries(model.flatMap((s) => s.pairs));
check('gathers next of kin and sizes', pairs.Relationship === 'Spouse' && pairs.Height === '178 cm' && pairs['Boiler suit'] === 'L');
check('uses the passport that lasts longest', pairs.Passport.startsWith('Z1234567'), pairs.Passport);
check('leaves out sections with nothing in them', !model.some((s) => s.pairs.length === 0));
const text = biodataText({ profile, certificates: bioCerts, voyages: history, today: '2026-10-01' });
check('copies as plain text with headings', text.includes('NEXT OF KIN\nName: B. Seafarer') && text.includes('Certificate of Competency: COC-1'));
const bio = new TextDecoder('latin1').decode(buildBiodata({ profile, certificates: bioCerts, voyages: history, today: '2026-10-01' }));
check('draws the bio-data as a PDF', bio.startsWith('%PDF') && bio.includes('(SEAFARER BIO-DATA)'));

console.log('\nDocument pack');
const scan = createPdf();
scan.addPage().text('PASSPORT SCAN', 40, 40, { size: 20 });
scan.addPage().text('PASSPORT PAGE 2', 40, 40, { size: 20 });
const pack = await buildDocumentPack({
  name: 'A. Seafarer',
  documents: [
    { title: 'Passport', refNo: 'Z1234567', expiryDate: '2030-01-31', files: [{ name: 'passport.pdf', kind: 'pdf', bytes: scan.output() }] },
    { title: 'Broken', files: [{ name: 'bad.pdf', kind: 'pdf', bytes: new Uint8Array([1, 2, 3]) }] },
    { title: 'No scan', files: [] }
  ],
  today: '2026-10-01'
});
check('joins the scans after an index page', pack.pages === 1 + 2 + 1, String(pack.pages));
check('names a file it could not include, and carries on', pack.failures.length === 1 && pack.failures[0].includes('bad.pdf'));
const { PDFDocument } = await import('../vendor/pdf-lib.mjs');
const reread = await PDFDocument.load(pack.bytes);
check('the pack is a readable PDF', reread.getPageCount() === 4 && reread.getTitle().includes('A. Seafarer'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
