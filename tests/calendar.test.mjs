/**
 * Unit tests for the iCalendar export. Pure logic, no browser needed.
 *   node tests/calendar.test.mjs
 */
import { certificateEvent, seaTimeEvent, icsForItem, icsForItems, datedCertificates } from '../js/calendar.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? ' -- ' + extra : ''}`); }
};

const cert = (data) => ({ id: 'c1', type: 'certificate', data });
const voyage = (data) => ({ id: 'v1', type: 'seatime', data });

console.log('\nCertificate events');
const ics = icsForItem(cert({
  title: 'STCW Basic Safety Training',
  issuer: 'DG Shipping',
  refNo: 'BST-2024-118',
  expiryDate: '2027-03-15'
}));

check('emits a VCALENDAR wrapper', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
check('uses CRLF line endings', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
check('sets the expiry as an all-day start', ics.includes('DTSTART;VALUE=DATE:20270315'), ics);
check('makes DTEND the following day (exclusive per spec)', ics.includes('DTEND;VALUE=DATE:20270316'), ics);
check('titles the event with the certificate name', ics.includes('SUMMARY:Expires: STCW Basic Safety Training'));
check('carries the issuer in the description', ics.includes('Issuer: DG Shipping'));
check('sets a 90-day reminder', ics.includes('TRIGGER:-P90D'));
check('sets a 30-day reminder', ics.includes('TRIGGER:-P30D'));
check('sets a day-of reminder', ics.includes('TRIGGER:PT9H'));
check('gives the event a stable UID', ics.includes('UID:cert-c1@ava'));

console.log('\nEscaping');
const tricky = icsForItem(cert({
  title: 'Medical; Fitness, Cert\\Renewal',
  notes: 'Line one\nLine two',
  expiryDate: '2026-12-01'
}));
check('escapes semicolons', tricky.includes('Medical\; Fitness'), tricky.split('\r\n').find(l => l.startsWith('SUMMARY')));
check('escapes commas', tricky.includes('Fitness\\, Cert'));
check('escapes backslashes', tricky.includes('Cert\\\\Renewal'));
check('escapes newlines into \\n', tricky.includes('Line one\\nLine two'));

console.log('\nCertificates without an expiry');
check('produces nothing when there is no expiry date',
  certificateEvent(cert({ title: 'No expiry' })) === null);
check('bulk export skips undated certificates',
  datedCertificates([cert({ title: 'a' }), cert({ title: 'b', expiryDate: '2027-01-01' })]).length === 1);

console.log('\nVoyages');
const completed = icsForItem(voyage({
  vessel: 'MV Northern Star', rank: 'Third Officer', company: 'Anglo-Eastern',
  imo: '9345678', signOnDate: '2024-01-10', signOnPort: 'Singapore',
  signOffDate: '2024-07-09', signOffPort: 'Rotterdam'
}));
check('spans sign-on to the day after sign-off',
  completed.includes('DTSTART;VALUE=DATE:20240110') && completed.includes('DTEND;VALUE=DATE:20240710'), completed);
check('names the vessel and rank', completed.includes('SUMMARY:MV Northern Star — Third Officer'));
check('sets the sign-on port as the location', completed.includes('LOCATION:Singapore'));
check('records the IMO number', completed.includes('IMO: 9345678'));
check('reminds 14 days before sign-off', completed.includes('TRIGGER:-P14D'));

const onboard = icsForItem(voyage({ vessel: 'MT Baltic Trader', rank: 'Second Officer', signOnDate: '2026-08-01' }));
check('an entry still onboard becomes a single-day marker',
  onboard.includes('DTSTART;VALUE=DATE:20260801') && onboard.includes('DTEND;VALUE=DATE:20260802'), onboard);
check('the onboard marker is labelled as a sign-on', onboard.includes('SUMMARY:Sign on: MT Baltic Trader'));
check('the onboard marker carries no sign-off reminder', !onboard.includes('TRIGGER:-P14D'));
check('a voyage with no sign-on date produces nothing',
  seaTimeEvent(voyage({ vessel: 'Unknown' })) === null);

console.log('\nBulk export');
const bundle = icsForItems([
  cert({ title: 'One', expiryDate: '2027-01-01' }),
  cert({ title: 'Two', expiryDate: '2027-02-01' }),
  cert({ title: 'Undated' })
]);
check('counts only the events it could build', bundle.count === 2, String(bundle.count));
check('emits one VCALENDAR holding both events',
  (bundle.ics.match(/BEGIN:VEVENT/g) || []).length === 2 &&
  (bundle.ics.match(/BEGIN:VCALENDAR/g) || []).length === 1);
check('returns null when nothing is datable', icsForItems([cert({ title: 'none' })]) === null);

console.log('\nLine folding');
const long = icsForItem(cert({
  title: 'A very long certificate title '.repeat(6).trim(),
  expiryDate: '2027-05-05'
}));
const overLong = long.split('\r\n').filter((l) => l.length > 75);
check('folds every line to 75 octets or fewer', overLong.length === 0, `${overLong.length} long lines`);
check('continuation lines begin with a space',
  long.split('\r\n').filter((l) => l.startsWith(' ')).length > 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
