/**
 * Unit tests for the sea time checks and the CV / sea service PDFs.
 * Pure logic, no browser needed.
 *   node tests/seatime.test.mjs
 */
import {
  entryDays, isOnboard, seaTimeSummary, findOverlaps, revalidationStatus, goalProgress,
  voyageProgress, validateSeaTime, expiriesDuringVoyages, certificateCategory
} from '../js/derive.js';
import { buildCv, buildSeaServiceStatement, cvDate } from '../js/cv.js';
import { wrapText, textWidth, jpegSize } from '../js/pdf.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? ' -- ' + extra : ''}`); }
};

const TODAY = new Date('2026-09-30T00:00:00Z');
const v = (vessel, signOnDate, signOffDate, extra = {}) => ({ vessel, signOnDate, signOffDate, ...extra });

console.log('\nServed days');
check('counts sign-on and sign-off days', entryDays(v('A', '2024-01-10', '2024-07-09'), TODAY) === 182);
check('an open entry counts to today', entryDays(v('A', '2026-09-01', ''), TODAY) === 30);
check('a future sign-off is planned, not served', entryDays(v('A', '2026-09-01', '2026-12-31'), TODAY) === 30);
check('a future sign-on counts nothing yet', entryDays(v('A', '2026-10-05', '2027-03-01'), TODAY) === 0);
check('a sign-off before sign-on counts nothing', entryDays(v('A', '2024-05-01', '2024-04-01'), TODAY) === 0);
check('onboard while the sign-off is still to come', isOnboard(v('A', '2026-09-01', '2026-12-31'), TODAY));
check('not onboard after sign-off', !isOnboard(v('A', '2026-01-01', '2026-03-01'), TODAY));

console.log('\nOverlaps');
const clash = [
  v('Northern Star', '2024-01-10', '2024-07-09', { rank: 'Third Officer', vesselType: 'Bulk Carrier' }),
  v('Typo Voyage', '2024-07-01', '2024-08-09', { rank: 'Third Officer', vesselType: 'Product Tanker' })
];
const s = seaTimeSummary(clash, TODAY);
check('overlapping days are counted once', s.totalDays === 182 + 31, `got ${s.totalDays}`);
check('the overlap is reported', s.overlapDays === 9, `got ${s.overlapDays}`);
const o = findOverlaps(clash, TODAY);
check('finds the pair that overlaps', o.length === 1 && o[0].days === 9, JSON.stringify(o.map((x) => x.days)));
check('a voyage inside another adds nothing',
  seaTimeSummary([v('Long', '2024-01-01', '2024-12-31'), v('Inner', '2024-03-01', '2024-03-31')], TODAY).totalDays === 366);
check('back-to-back voyages do not overlap',
  findOverlaps([v('A', '2024-01-01', '2024-01-31'), v('B', '2024-02-01', '2024-02-28')], TODAY).length === 0);

console.log('\nBy ship type');
check('breaks sea time down by ship type', s.byType.length === 2 && s.byType[0].type === 'Bulk Carrier');
check('totals tanker time', s.tankerDays === 31, `got ${s.tankerDays}`);

console.log('\nRevalidation');
const recent = [v('A', '2023-01-01', '2023-12-31')];
let r = revalidationStatus(recent, TODAY);
check('12 months in the last 5 years is met', r.met && r.last5y === 365, JSON.stringify(r));
r = revalidationStatus([v('A', '2021-01-01', '2022-01-01')], TODAY);
check('service more than 5 years ago only counts inside the window', r.last5y === 93 && !r.met, JSON.stringify(r));
r = revalidationStatus([v('A', '2026-06-01', '')], TODAY);
check('3 months in the last 6 months is met', r.met && r.last6m >= 90, JSON.stringify(r));

console.log('\nGoal');
const career = [
  v('A', '2022-01-01', '2022-06-30', { rank: 'Second Officer' }),
  v('B', '2023-01-01', '2023-06-30', { rank: 'Chief Officer' }),
  v('C', '2024-01-01', '2024-03-31', { rank: 'Chief Officer' })
];
const g = goalProgress(career, { goalRank: 'Chief Officer', goalMonths: '12' }, TODAY);
check('counts only service in the goal rank', g.served === 181 + 91, `got ${g.served}`);
check('reports what is left', g.remaining === 360 - 272 && !g.done);
const since = goalProgress(career, { goalRank: 'Chief Officer', goalMonths: '12', goalSince: '2024-01-01' }, TODAY);
check('counts only service since the chosen date', since.served === 91, `got ${since.served}`);
check('no months, no goal', goalProgress(career, { goalRank: 'Chief Officer' }, TODAY) === null);

console.log('\nVoyage countdown');
const onboard = v('Now', '2026-07-01', '', { contracts: [{ endDate: '2026-11-15' }] });
const p = voyageProgress(onboard, TODAY);
check('counts the day onboard', p.day === 92, `got ${p.day}`);
check('counts down to the contract end', p.daysLeft === 46 && p.endDate === '2026-11-15', JSON.stringify(p));
check('no countdown once signed off', voyageProgress(v('Past', '2025-01-01', '2025-06-01'), TODAY) === null);

console.log('\nValidation');
check('sign-off before sign-on is an error', validateSeaTime(v('A', '2024-05-01', '2024-04-01'), [], TODAY).errors.length === 1);
check('a contract ending before it starts is an error',
  validateSeaTime(v('A', '2024-01-01', '2024-02-01', { contracts: [{ startDate: '2024-03-01', endDate: '2024-02-01' }] }), [], TODAY).errors.length === 1);
const warn = validateSeaTime(clash[1], [clash[0]], TODAY);
check('an overlap with another voyage is a warning', warn.errors.length === 0 && /Northern Star by 9 days/.test(warn.warnings[0]), warn.warnings.join(' | '));

console.log('\nCertificates during a contract');
const certs = [
  { title: 'Medical', expiryDate: '2026-10-20' },
  { title: 'BST', expiryDate: '2027-06-01' },
  { title: 'Old', expiryDate: '2026-01-01' }
];
const hits = expiriesDuringVoyages(certs, [onboard], TODAY);
check('flags a certificate expiring before the contract ends', hits.length === 1 && hits[0].certificate.title === 'Medical', JSON.stringify(hits.map((h) => h.certificate.title)));
check('no clash for a voyage already over', expiriesDuringVoyages(certs, [v('Past', '2025-01-01', '2025-06-01')], TODAY).length === 0);

console.log('\nCertificate kinds');
check('the chosen kind wins', certificateCategory({ title: 'Passport', category: 'Other' }) === 'Other');
check('guesses a passport', certificateCategory({ title: 'Indian Passport' }) === 'Travel document');
check('guesses a CoC', certificateCategory({ title: 'Certificate of Competency — Chief Mate' }) === 'Certificate of Competency');
check('guesses a DCE as an endorsement', certificateCategory({ title: 'Oil Tanker DCE' }) === 'Endorsement');
check('guesses a medical', certificateCategory({ title: 'PEME medical fitness' }) === 'Medical');
check('anything else is training', certificateCategory({ title: 'STCW Basic Safety Training' }) === 'Training / STCW course');

console.log('\nPDF');
check('formats dates as dd-Mon-yyyy', cvDate('2024-03-05') === '05-Mar-2024');
check('measures text with the core font metrics', Math.abs(textWidth('Hello', 10) - 22.78) < 0.01, String(textWidth('Hello', 10)));
check('wraps to the width given', wrapText('one two three four five six', 40, 10).every((l) => textWidth(l, 10) <= 40));
check('reads a JPEG size', (() => {
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 20, 0, 10, 3]);
  const z = jpegSize(b);
  return z.width === 10 && z.height === 20 && z.components === 3;
})());

const text = (bytes) => new TextDecoder('latin1').decode(bytes);
const profile = { fullName: 'A. Seafarer', positionApplied: 'Chief Officer', nationality: 'Indian', skills: 'Crude oil\nSTS (40 ops)' };
const cv = buildCv({ profile, certificates: [...certs, { title: 'Passport', refNo: 'Z123' }], voyages: [...clash, onboard], today: '2026-09-30' });
const cvText = text(cv);
check('the CV is a PDF', cvText.startsWith('%PDF-1.4') && cvText.trimEnd().endsWith('%%EOF'));
check('the CV names the seafarer and position', cvText.includes('(A. SEAFARER)') && cvText.includes('Position applied for: Chief Officer'));
check('the CV lists sea service', cvText.includes('(Northern Star)') && cvText.includes('(Onboard)'));
check('the CV escapes brackets in text', cvText.includes('STS \\(40 ops\\)'));
check('the CV puts the passport under travel documents', cvText.includes('(TRAVEL DOCUMENTS)'));
const xrefAt = Number(/startxref\n(\d+)/.exec(cvText)[1]);
check('the cross-reference table is where the trailer says', cvText.slice(xrefAt, xrefAt + 4) === 'xref');
const offsets = [...cvText.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
check('every object offset points at its object', offsets.every((off, i) => cvText.slice(off).startsWith(`${i + 1} 0 obj`)));

const st = text(buildSeaServiceStatement({ profile, certificates: [], voyages: clash, today: '2026-09-30' }));
check('the statement totals every day once', st.includes('(213 days \\(7 mo 3 d\\))'));
check('the statement explains the overlap', st.includes('9 days where voyages overlap are counted once'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
