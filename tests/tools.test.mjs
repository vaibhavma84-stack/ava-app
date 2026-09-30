/**
 * Unit tests for the tax year count, the ready-to-join checklist, reading a
 * scanned certificate, and the Word CV. Pure logic, no browser needed.
 *   node tests/tools.test.mjs
 */
import { taxYearDays } from '../js/derive.js';
import { requirementsFor, checkReadiness } from '../js/join.js';
import { parseCertificateText, findDates } from '../js/scan.js';
import { zip, crc32 } from '../js/zip.js';
import { buildCvDocx } from '../js/docx.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? ' -- ' + extra : ''}`); }
};

const TODAY = new Date('2026-09-30T00:00:00Z');
const v = (vessel, signOnDate, signOffDate, extra = {}) => ({ vessel, signOnDate, signOffDate, ...extra });

console.log('\nTax year');
const voyages = [
  v('Last year', '2026-01-01', '2026-03-31'),
  v('This year', '2026-05-01', '2026-07-29'),
  v('Now', '2026-09-21', '', { contracts: [{ endDate: '2027-01-18' }] })
];
let t = taxYearDays(voyages, { startMonth: 4, target: 183 }, TODAY);
check('an April tax year runs April to March', t.start === '2026-04-01' && t.end === '2027-03-31', `${t.start}..${t.end}`);
check('counts only days at sea inside the tax year', t.served === 90 + 10, `got ${t.served}`);
check('projects the current contract to its end', t.planned === 90 + 120, `got ${t.planned}`);
check('reports what is still needed', t.remaining === 83 && t.plannedShort === 0, JSON.stringify(t));
t = taxYearDays(voyages, { startMonth: 1 }, TODAY);
check('a calendar tax year counts from January', t.start === '2026-01-01' && t.served === 90 + 90 + 10, `got ${t.served}`);
check('no target, no shortfall', t.target === null && t.remaining === null);
const open = taxYearDays([v('Open', '2026-09-21', '')], { startMonth: 1 }, TODAY);
check('an open voyage with no end date is not projected', open.planned === open.served && open.served === 10, JSON.stringify(open));

console.log('\nReady to join');
const coReqs = requirementsFor('Chief Officer', 'Product Tanker').map((r) => r.id);
check('a chief officer on a tanker needs tanker training', coReqs.includes('tanker-basic') && coReqs.includes('tanker-adv'));
check('a chief officer needs medical care, not first aid', coReqs.includes('medcare') && !coReqs.includes('mfa'));
check('a deck officer needs GMDSS and ECDIS', coReqs.includes('gmdss') && coReqs.includes('ecdis'));
const eng = requirementsFor('Third Engineer', 'Bulk Carrier').map((r) => r.id);
check('an engineer needs neither GMDSS nor ECDIS', !eng.includes('gmdss') && !eng.includes('ecdis'));
check('a bulk carrier needs no tanker training', !eng.some((id) => id.startsWith('tanker')));

const certs = [
  { title: 'Certificate of Competency — Chief Mate', expiryDate: '2029-01-01' },
  { title: 'GMDSS GOC', expiryDate: '2026-11-15' },
  { title: 'STCW Basic Safety Training', expiryDate: '2026-08-01' },
  { title: 'STCW Basic Safety Training (renewed)', expiryDate: '2031-08-01' },
  { title: 'Proficiency in Survival Craft and Rescue Boats' },
  { title: 'Advanced Fire Fighting', expiryDate: '2030-01-01' },
  { title: 'Medical Care', expiryDate: '2030-01-01' },
  { title: 'Ship Security Officer' },
  { title: 'ECDIS Generic' },
  { title: 'Advanced Oil Tanker Training (DCE)', expiryDate: '2026-09-01' },
  { title: 'Medical Fitness Certificate', expiryDate: '2027-06-01' },
  { title: 'Passport', expiryDate: '2030-01-01' },
  { title: 'CDC', expiryDate: '2030-01-01' },
  { title: 'Company induction', expiryDate: '2026-12-01' }
];
const r = checkReadiness(certs, { rank: 'Chief Officer', vesselType: 'Product Tanker', joinDate: '2026-10-10', endDate: '2027-04-10' });
const status = (id) => r.results.find((x) => x.id === id)?.status;
check('a renewed certificate beats the expired one', status('bst') === 'ok');
check('flags one that expires mid-contract', status('gmdss') === 'lapses');
check('flags one already expired on joining', status('tanker-adv') === 'expired' && status('tanker-basic') === 'expired');
check('a certificate with no expiry is fine', status('pscrb') === 'ok' && status('ecdis') === 'ok');
check('an optional item missing is only a question', status('usvisa') === 'optional');
check('the medical course does not count as the medical', r.results.find((x) => x.id === 'medical').certificate.title === 'Medical Fitness Certificate');
check('not ready while anything required is short', !r.ready);
check('lists other certificates expiring during the contract', r.others.length === 1 && r.others[0].title === 'Company induction');

console.log('\nReading a scan');
check('reads day-first numeric dates', findDates('Issued 05/03/2024')[0].iso === '2024-03-05');
check('reads a date that can only be month-first', findDates('on 03/25/2024')[0].iso === '2024-03-25');
check('reads written-out dates', findDates('valid until 14 March 2029')[0].iso === '2029-03-14');
check('reads month-day-year', findDates('Expires Mar 14, 2029')[0].iso === '2029-03-14');
check('ignores impossible dates', findDates('31/02/2024').length === 0);
check('reads O as 0 inside a date', findDates('Date of issue: 1O/06/2021')[0]?.iso === '2021-06-10');

const bst = parseCertificateText(`GOVERNMENT OF INDIA
DIRECTORATE GENERAL OF SHIPPING
CERTIFICATE OF PROFICIENCY
Basic Safety Training
Certificate No: BST/2021/004512
Name: A SEAFARER    Date of Birth: 12/04/1988
Date of Issue: 10/06/2021
Valid until: 09/06/2026`);
check('recognises the course', bst.title === 'STCW Basic Safety Training', bst.title);
check('reads the certificate number', bst.refNo === 'BST/2021/004512', bst.refNo);
check('reads the issuer', bst.issuer === 'Directorate General of Shipping', bst.issuer);
check('reads the labelled issue date', bst.issueDate === '2021-06-10', bst.issueDate);
check('reads the labelled expiry date', bst.expiryDate === '2026-06-09', bst.expiryDate);

const below = parseCertificateText(`MEDICAL FITNESS CERTIFICATE
Date of examination
Date of expiry
15 Jan 2026
14 Jan 2028`);
check('takes a value from the line under its label', below.expiryDate === '2028-01-14', JSON.stringify(below));

const passport = parseCertificateText(`REPUBLIC OF INDIA PASSPORT
Date of Birth 12/04/1988
01/02/2020
31/01/2030
P<INDSEAFARER<<A<<<<<<<<<<<<<<<<<<<<<<<<<<<<
Z1234567<8IND8804126M3001315<<<<<<<<<<<<<<04`);
check('never takes a birth date as the issue date', passport.issueDate === '2020-02-01' && passport.expiryDate === '2030-01-31', JSON.stringify(passport));
check('reads a passport number from the machine-readable lines', passport.refNo === 'Z1234567', passport.refNo);
check('recognises a passport', passport.title === 'Passport');

check('nothing readable, nothing filled', Object.keys(parseCertificateText('blurred')).length === 0);

console.log('\nWord CV');
check('CRC-32 matches the standard check value', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
const z = zip([{ name: 'a.txt', data: 'hello' }]);
check('a zip starts with a local header and ends with the directory end', z[0] === 0x50 && z[1] === 0x4b && z[2] === 3 && z[z.length - 22] === 0x50 && z[z.length - 21] === 0x4b && z[z.length - 20] === 5);

const docx = buildCvDocx({
  profile: { fullName: 'A. Seafarer & Sons <test>', positionApplied: 'Chief Officer', skills: 'STS\nCrude oil' },
  certificates: certs,
  voyages,
  today: '2026-09-30'
});
const raw = new TextDecoder('latin1').decode(docx);
check('the Word CV holds the parts Word needs',
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels'].every((n) => raw.includes(n)));
check('escapes text for XML', raw.includes('A. SEAFARER &amp; SONS &lt;TEST&gt;') && !raw.includes('<test>'));
check('lists sea service in the Word CV', raw.includes('>This year<') || raw.includes('This year'));
check('no photo, no image part', !raw.includes('word/media/photo.jpeg'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
