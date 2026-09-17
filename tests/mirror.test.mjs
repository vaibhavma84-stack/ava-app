// The mirror runs on a server where nothing can be checked by eye, so its two
// readers are tested against fixtures shaped like what MPA actually serves.
//
// These readers exist because Node has no DOMParser and this project has no
// dependencies. They are blunt on purpose, which is exactly why they need
// pinning down: a regex over markup is easy to get subtly wrong.

import { readFeed, readLinks, readPanamaPage } from '../tools/mirror-notices.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { textFromHtml, listOnly, sweepUnreferenced } from '../tools/mirror-docs.mjs';
import { singaporeRef, singaporeLooseRef, SG_TYPES, MPA, panamaRef } from '../library/js/updates.js';
import { clauseAt } from '../library/js/search.js';
import { equipmentFrom } from '../library/js/outline.js';

let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ' -- ' + detail : ''}`); }
};

const shape = { refOf: singaporeRef, types: SG_TYPES };

console.log('\nReading a feed');

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>MPA Media Releases</title>
  <link>https://www.mpa.gov.sg/media-centre</link>
  <item>
    <title><![CDATA[PORT MARINE CIRCULAR NO. 05 OF 2026 - JOINT ADVISORY: COMPLIANCE WITH THE HARBOUR CRAFT REGULATIONS]]></title>
    <link>https://www.mpa.gov.sg/media-centre/details/port-marine-circular-no.-05-of-2026</link>
    <pubDate>Mon, 09 Feb 2026 09:00:00 +0800</pubDate>
  </item>
  <item>
    <title>Shipping Circular No. 9 of 2025 &amp; Ballast Water Management</title>
    <link>https://www.mpa.gov.sg/docs/mpalibraries/circulars-and-notices/sc25-09.pdf</link>
    <pubDate>Tue, 09 Sep 2025 09:00:00 +0800</pubDate>
  </item>
  <item>
    <title>MPA and partners sign agreement on green corridors</title>
    <link>https://www.mpa.gov.sg/media-centre/details/green-corridors</link>
    <pubDate>Wed, 01 Oct 2025 09:00:00 +0800</pubDate>
  </item>
</channel></rss>`;

const fromRss = readFeed(RSS, shape);
check('only the items carrying a reference are kept', fromRss.length === 2, JSON.stringify(fromRss.map((n) => n.refNo)));
check('a spelt-out reference is parsed', fromRss[0].refNo === 'PC 05/2026', fromRss[0].refNo);
check('and the channel title is not mistaken for an item',
  !fromRss.some((n) => /MPA Media Releases/.test(n.title)), JSON.stringify(fromRss.map((n) => n.title)));
check('CDATA is unwrapped', !/CDATA/.test(fromRss[0].title), fromRss[0].title);
check('entities are decoded', /&\s|&$|& Ballast/.test(fromRss[1].title) && !/&amp;/.test(fromRss[1].title), fromRss[1].title);
check('a reference in a filename is parsed', fromRss[1].refNo === 'SC 09/2025', fromRss[1].refNo);
check('the class follows the reference', fromRss[1].docType === 'Shipping Circular', fromRss[1].docType);
check('the date is normalised', fromRss[0].date === '2026-02-09', fromRss[0].date);
check('the link comes across', /port-marine-circular-no\.-05/.test(fromRss[0].sourceUrl), fromRss[0].sourceUrl);
check('a media release is left out',
  !fromRss.some((n) => /green corridors/i.test(n.title)), JSON.stringify(fromRss.map((n) => n.title)));

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Port Marine Notice No. 175 of 2025 Works at Tuas</title>
    <link rel="alternate" href="https://www.mpa.gov.sg/docs/mpalibraries/circulars-and-notices/pn25-175"/>
    <published>2025-11-03T01:00:00Z</published>
  </entry>
</feed>`;

const fromAtom = readFeed(ATOM, shape);
check('an Atom entry is read too', fromAtom.length === 1, JSON.stringify(fromAtom));
check('and its link is taken from the href',
  fromAtom[0]?.sourceUrl === 'https://www.mpa.gov.sg/docs/mpalibraries/circulars-and-notices/pn25-175',
  fromAtom[0]?.sourceUrl);
check('a notice is classed as a notice', fromAtom[0]?.refNo === 'PN 175/2025', fromAtom[0]?.refNo);

check('a page that is not a feed yields nothing rather than throwing',
  readFeed('<html><body>Not a feed</body></html>', shape).length === 0);
check('and neither does an empty string', readFeed('', shape).length === 0);

console.log('\nReading a page of links');

const PAGE = `<!doctype html><html><body>
  <nav><a href="/about-us/careers">Careers at MPA</a></nav>
  <ul>
    <li><a class="tile"
           href="/media-centre/details/port-marine-circular-no.-01-of-2026-list-of-active-port-marine-circulars">
      <span>PORT MARINE CIRCULAR NO. 01 OF 2026</span> List of active port marine circulars
    </a></li>
    <li><a href="/docs/mpalibraries/circulars-and-notices/sc26-02.pdf?sfvrsn=3aa1">Shipping Circular No. 2 of 2026</a></li>
    <li><a href="https://www.mpa.gov.sg/media-centre/details/some-media-release">A media release with no reference</a></li>
  </ul>
</body></html>`;

const links = readLinks(PAGE, {
  base: MPA, match: /\/(media-centre\/details|docs\/mpalibraries)\//i, ...shape
});

check('only the linked documents are kept', links.length === 2, JSON.stringify(links.map((n) => n.refNo)));
check('navigation is skipped', !links.some((n) => /Careers/i.test(n.title)), JSON.stringify(links.map((n) => n.title)));
check('a release with no reference is skipped',
  !links.some((n) => /media release/i.test(n.title)), JSON.stringify(links.map((n) => n.title)));
check('markup inside the link is stripped from the title',
  !/[<>]/.test(links[0].title), links[0].title);
check('a relative href is made absolute',
  links[0].sourceUrl.startsWith('https://www.mpa.gov.sg/'), links[0].sourceUrl);
check('a query string does not defeat the filename', links[1].refNo === 'SC 02/2026', links[1].refNo);
check('an already-absolute href is left alone',
  readLinks('<a href="https://www.mpa.gov.sg/docs/mpalibraries/x/pc24-07.pdf">x</a>', {
    base: MPA, match: /docs\/mpalibraries/i, ...shape
  })[0]?.sourceUrl === 'https://www.mpa.gov.sg/docs/mpalibraries/x/pc24-07.pdf');
check('a page with no links at all yields nothing',
  readLinks('<html><body><p>Nothing here</p></body></html>', {
    base: MPA, match: /./, ...shape
  }).length === 0);

console.log('\nA reference with the class left off');

// MPA titles many of its circulars this way. Reading the class from the title
// alone wrote almost all of them off: 288 documents with one shipping circular
// among them. The list a document came from supplies what the title omits.
check('the number and year are read',
  singaporeLooseRef('No. 2 of 2023 - LIST OF ACTIVE SHIPPING CIRCULARS', 'SC')?.refNo === 'SC 02/2023',
  JSON.stringify(singaporeLooseRef('No. 2 of 2023 - LIST OF ACTIVE SHIPPING CIRCULARS', 'SC')));
check('the class comes from the list it was fetched from',
  singaporeLooseRef('No. 9 of 2025 Something', 'PC')?.refNo === 'PC 09/2025');
check('a number already padded is not padded twice',
  singaporeLooseRef('No. 07 of 2026 Works', 'PN')?.refNo === 'PN 07/2026');
check('a three-figure number survives',
  singaporeLooseRef('No. 175 of 2025 Works at Tuas', 'PN')?.refNo === 'PN 175/2025');
check('nothing without a number', singaporeLooseRef('A media release', 'SC') === null);
check('and nothing without a list to attribute it to',
  singaporeLooseRef('No. 9 of 2025 Something', '') === null);

// The spelt-out form still wins, so a list carrying another class is not
// silently relabelled by the list it happens to sit in.
check('a title that names its own class is read by the strict form first',
  singaporeRef('PORT MARINE CIRCULAR NO. 01 OF 2026')?.refNo === 'PC 01/2026');

// ── a notice published as a page rather than a file ─────────────────────────
//
// 179 of the 497 MCA notices have no PDF at all: GOV.UK publishes them as HTML
// attachments. They are not missing documents, they are documents that are not
// files — so the words are mirrored instead. This is the reader that turns the
// markup into them, and like the others here it is a regex over markup, which
// is exactly the kind of thing that is subtly wrong until it is pinned down.
console.log('\nReading a notice published as a page');

const NOTICE_HTML = `
<div class="govspeak">
  <h2 id="summary">Summary</h2>
  <p>This note gives guidance on <strong>infectious disease</strong> at sea.</p>
  <ul>
    <li>Masters should record symptoms.</li>
    <li>Report to the <a href="/maritime">port health authority</a>.</li>
  </ul>
  <p>Fees are &pound;50 &amp; rise annually.<br>See MSN 1905 &#40;M+F&#41;.</p>
  <style>.x{color:red}</style>
  <script>alert('no')</script>
</div>`;

const read = textFromHtml(NOTICE_HTML);
check('the words come through', /guidance on infectious disease at sea/.test(read), read);
check('list items stay apart rather than running together',
  /Masters should record symptoms\.[\s\S]*Report to the port health authority\./.test(read), read);
check('a link keeps its words and loses its markup',
  /port health authority/.test(read) && !/href|<a/.test(read), read);
check('entities come back as characters', /£50 & rise/.test(read), read);
// An entity nobody listed must not silently remove what it stood for.
check('an unlisted entity is left visible rather than dropped',
  /&zwnj;/.test(textFromHtml('<p>a&zwnj;b</p>')), textFromHtml('<p>a&zwnj;b</p>'));
check('a degree sign survives, since notices give temperatures',
  textFromHtml('<p>60&deg;C</p>') === '60°C', textFromHtml('<p>60&deg;C</p>'));
check('a line break is a line break', /\n\s*See MSN 1905/.test(read), read);
check('script and style are gone',
  !/alert|color:red/.test(read), read);
check('no markup survives at all', !/[<>]/.test(read), read);
check('it does not end up as one long line', read.split('\n').length >= 4, JSON.stringify(read));

// Numbers are what a notice is asked for by, so they must survive intact.
// A bullet belongs with its words, not on a line above them.
check('a bullet stays with the words it introduces',
  textFromHtml('<ul><li><p>Annex 1: references</p></li></ul>') === '\u2022 Annex 1: references',
  JSON.stringify(textFromHtml('<ul><li><p>Annex 1: references</p></li></ul>')));

check('a notice number is left exactly as written',
  textFromHtml('<p>MGN 652 (M+F) Amendment 1</p>') === 'MGN 652 (M+F) Amendment 1',
  textFromHtml('<p>MGN 652 (M+F) Amendment 1</p>'));


// ── listed, but never fetched ───────────────────────────────────────────────
//
// MINs are information notes rather than requirements and are not wanted on
// the phone. They stay in the catalogue with their numbers; no document is
// fetched for them. Getting this wrong in either direction is expensive: too
// broad and the MGNs stop arriving, too narrow and 15 MB nobody asked for
// keeps being downloaded.
console.log('\nListed but not fetched');

const mca = (docType, refNo) => listOnly('MCA', { docType, refNo });

check('a MIN is listed only', mca('MIN (Marine Information Note)', 'MIN 738 (M+F)'));
check('recognised from the reference alone', mca('', 'MIN 700'));
check('recognised from the type alone', mca('MIN (Marine Information Note)', ''));
check('an MGN is still fetched', !mca('MGN (Marine Guidance Note)', 'MGN 652 (M+F)'));
check('an MSN is still fetched', !mca('MSN (Merchant Shipping Notice)', 'MSN 1905 (M+F)'));
// The word appears inside other notices' subjects; only the class counts.
check('a notice merely mentioning MIN is still fetched',
  !mca('MGN (Marine Guidance Note)', 'MGN 400'));
check('and another administration is untouched',
  !listOnly('Panama', { docType: 'MIN (Marine Information Note)', refNo: 'MIN 738' }));

// ── reading a Panama reference ──────────────────────────────────────────────
//
// Panama writes the date into the file name, so MMC-270-03-09-2026 has a 03 in
// it that is the third of the month and not part of the number. Reading it as
// part of the number filed the same circular twice — once as MMC 270 from the
// media library and once as "MMC 270-03", a circular that does not exist.
// Only the notices genuinely carry a hyphenated reference.
console.log('\nReading a Panama reference');

const refCases = [
  ['MMC-270-03-09-2026.pdf', 'MMC 270', 'a date in the file name is not the number'],
  ['MMC-359-18-08-2025.pdf', 'MMC 359', 'nor is the day when it is two digits'],
  ['MMC 270 \u2013 03 09 2026', 'MMC 270', 'nor when the title spells it out'],
  ['MMN 7-070', 'MMN 7-070', 'a notice keeps its hyphenated reference'],
  ['MMN-15-2026.pdf', 'MMN 15-2026', 'including the number-year form'],
  ['MMC-331SeafarersDocumentationDec16-2020.pdf', 'MMC 331', 'a number running into words is still read'],
  ['MMC 405', 'MMC 405', 'and a plain one is left alone'],
  ['brochure.pdf', null, 'something that is not a circular is not one']
];
for (const [input, want, why] of refCases) {
  const got = panamaRef(input);
  check(why, (got ? got.refNo : null) === want, `${input} -> ${got ? got.refNo : null}`);
}

// ── Panama's own pages ──────────────────────────────────────────────────────
//
// The media library reaches back only to August 2025; the back catalogue is on
// these pages, linked as ordinary uploads. Another regex over markup, and the
// one carrying MMC 1 to 405, so it is worth pinning properly.
console.log('\nReading a Panama circulars page');

const PANAMA_PAGE = `
<div class="entry">
  <ul>
    <li><a href="/wp-content/uploads/2020/12/MMC-331SeafarersDocumentationDec16-2020.pdf">
      MMC-331 Seafarers Documentation</a></li>
    <li><a href="https://www.panamashipregistry.com/wp-content/uploads/2026/04/MMC-230-8-09-2026.pdf">
      <strong>MMC-230</strong> Safe Manning</a></li>
    <li><a href="/wp-content/uploads/2019/06/MMN-07-070-rev.pdf">Download</a></li>
    <li><a href="/wp-content/uploads/2026/01/brochure.pdf">Our brochure</a></li>
    <li><a href="/segumar/something/">Not a document at all</a></li>
  </ul>
</div>`;

const panamaPage = readPanamaPage(PANAMA_PAGE, '/segumar/merchant-marine-circulars/');
const byRef = Object.fromEntries(panamaPage.map((n) => [n.refNo, n]));

check('every circular on the page is read', panamaPage.length === 3,
  panamaPage.map((n) => n.refNo).join(' | '));
check('and nothing that is not one',
  !panamaPage.some((n) => /brochure/i.test(n.title)), JSON.stringify(panamaPage.map((n) => n.title)));
check('a relative upload is made absolute',
  byRef['MMC 331'].sourceUrl.startsWith('https://www.panamashipregistry.com/wp-content/'),
  byRef['MMC 331'].sourceUrl);
check('an absolute one is left alone',
  byRef['MMC 230'].sourceUrl === 'https://www.panamashipregistry.com/wp-content/uploads/2026/04/MMC-230-8-09-2026.pdf',
  byRef['MMC 230'].sourceUrl);
check('markup inside the link text is stripped',
  byRef['MMC 230'].title === 'MMC-230 Safe Manning', JSON.stringify(byRef['MMC 230'].title));
// A link that says only "Download" is why the file name is a fallback.
check('a link with no title falls back to the file name',
  byRef['MMN 07-070'] && /MMN/.test(byRef['MMN 07-070'].title),
  JSON.stringify(byRef['MMN 07-070'] || null));
// WordPress hands its titles back with the entities still in them.
check('an entity in the title is turned back into the character it stands for',
  !readPanamaPage('<a href="/wp-content/uploads/2026/09/MMC-270.pdf">MMC 270 &#8211; Bunkering</a>')[0]
    .title.includes('&#'),
  readPanamaPage('<a href="/wp-content/uploads/2026/09/MMC-270.pdf">MMC 270 &#8211; Bunkering</a>')[0].title);

check('the type follows the prefix',
  byRef['MMC 331'].docType === 'Merchant Marine Circular'
  && byRef['MMN 07-070'].docType === 'MMN (Merchant Marine Notice)',
  `${byRef['MMC 331'].docType} · ${byRef['MMN 07-070'].docType}`);
check('the date comes from the upload path',
  byRef['MMC 331'].date === '2020-12-01', byRef['MMC 331'].date);
check('and the document is the link itself',
  byRef['MMC 331'].docUrl === byRef['MMC 331'].sourceUrl, byRef['MMC 331'].docUrl);

// The same circular appears more than once on some of these pages.
const twice = readPanamaPage(`
  <a href="/wp-content/uploads/2021/03/MMC-100.pdf">Download</a>
  <a href="/wp-content/uploads/2021/03/MMC-100.pdf">MMC-100 Tonnage Measurement</a>`);
check('a circular linked twice is filed once', twice.length === 1, JSON.stringify(twice));
check('and keeps the better of the two titles',
  twice[0].title === 'MMC-100 Tonnage Measurement', twice[0].title);

// ── what a run of fetching says when it finishes ────────────────────────────
//
// "1 could not be fetched" out of 373 is a number with nothing to act on: it
// does not say whether the connection dropped for a moment or a document is
// gone for good, and those want different things done. Tested here rather than
// in the app because the documents are same-origin, so the service worker
// fetches them and nothing in a browser test can make one fail.
console.log('\nWhat a run of fetching says');

const { fetchSummary } = await import('../library/js/summary.js');

check('a clean run says what came down',
  fetchSummary({ held: 372, bytes: 128234567 }) === '372 documents fetched, 122.3 MB',
  fetchSummary({ held: 372, bytes: 128234567 }));
check('one document is not "1 documents"',
  /^1 document fetched/.test(fetchSummary({ held: 1, bytes: 1048576 })),
  fetchSummary({ held: 1, bytes: 1048576 }));
check('a document that would not come is named',
  /could not fetch MMC 270/.test(fetchSummary({ held: 372, bytes: 1, failures: ['MMC 270 (network)'] })),
  fetchSummary({ held: 372, bytes: 1, failures: ['MMC 270 (network)'] }));
check('and says what to do about it',
  /tap again to retry/.test(fetchSummary({ held: 1, bytes: 1, failures: ['MMC 270 (network)'] })),
  fetchSummary({ held: 1, bytes: 1, failures: ['MMC 270 (network)'] }));

// Named, but not all of them: a run that fails a hundred times must not put a
// hundred references into one line.
const many = fetchSummary({ held: 0, bytes: 0, failures: ['A', 'B', 'C', 'D', 'E'] });
check('a few are named and the rest counted', /A, B, C and 2 more/.test(many), many);

check('nothing held on the site is said separately',
  /72 not held on the site/.test(fetchSummary({ held: 424, bytes: 1, missing: 72 })),
  fetchSummary({ held: 424, bytes: 1, missing: 72 }));
check('and being stopped is said too',
  / · stopped$/.test(fetchSummary({ held: 40, bytes: 1, stopped: true })),
  fetchSummary({ held: 40, bytes: 1, stopped: true }));
check('a clean run says nothing it does not need to',
  fetchSummary({ held: 10, bytes: 1048576 }) === '10 documents fetched, 1.0 MB',
  fetchSummary({ held: 10, bytes: 1048576 }));

// ── which source each flag reads first ──────────────────────────────────────
//
// The first alternative that yields wins, so the order is the whole behaviour.
// Panama read its registry's API first, that API holds only what was uploaded
// since August 2025, and the app filed 53 circulars and stopped — with the
// mirror holding all 373 sitting behind it, never reached. A source that
// answers is not the same as a source that answers fully.
console.log('\nWhich source each flag reads first');

const { FEEDS } = await import('../library/js/updates.js');

for (const admin of ['Panama', 'Singapore']) {
  for (const group of FEEDS[admin].groups) {
    check(`${admin} · ${group.name} reads this site first`,
      group.alternatives[0]?.label === 'This site',
      group.alternatives.map((a) => a.label).join(' | '));
  }
}

// MCA is the other way round on purpose: GOV.UK lists all of its notices, so
// the live read is both complete and fresher than a weekly mirror.
for (const group of FEEDS.MCA.groups) {
  check(`MCA · ${group.name} reads GOV.UK first`,
    /GOV\.UK/.test(group.alternatives[0]?.label || ''),
    group.alternatives.map((a) => a.label).join(' | '));
  check(`MCA · ${group.name} still falls back to this site`,
    group.alternatives.some((a) => a.label === 'This site'),
    group.alternatives.map((a) => a.label).join(' | '));
}

// A source listed twice is a source someone forgot they had already put there.
for (const [admin, feed] of Object.entries(FEEDS)) {
  for (const group of feed.groups) {
    const labels = group.alternatives.map((a) => a.label);
    check(`${admin} · ${group.name} lists no source twice`,
      new Set(labels).size === labels.length, labels.join(' | '));
  }
}

// ── the links the app sends you to check against ────────────────────────────
//
// Panama's /circulars/ was a 404 for some time and nothing noticed: not the
// reader, which fell through to its next alternative, and not the button,
// which just opened a missing page. Nothing here can tell whether a URL is
// alive — that needs the network — but it can hold the shape, so that a path
// nobody has opened in months is at least a path someone wrote on purpose.
console.log('\nWhere the app sends you to check');

const { FLAG_SOURCES } = await import('../library/js/schema.js');

for (const [admin, links] of Object.entries(FLAG_SOURCES)) {
  check(`${admin} offers somewhere to check`, links.length > 0, String(links.length));
  for (const { label, url } of links) {
    check(`${admin} · ${label} is a full https address`,
      /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(url), url);
    check(`${admin} · ${label} names a page, not just a host`,
      new URL(url).pathname.replace(/\/+$/, '').length > 1, url);
  }
}

// The one that was wrong, named so a revert cannot pass quietly.
const panama = FLAG_SOURCES.Panama.map((l) => l.url).join(' ');
check('Panama no longer points at the page that 404s',
  !/panamashipregistry\.com\/circulars\/?$/m.test(panama)
  && !FLAG_SOURCES.Panama.some((l) => l.url.endsWith('.com/circulars/')),
  panama);
check('and points into the section Panama actually uses',
  FLAG_SOURCES.Panama.every((l) => /\/segumar\//.test(l.url)), panama);

// ── sweeping the documents nothing points at ────────────────────────────────
//
// This exists because a reference read wrongly left 87 files filed under
// circular numbers that do not exist, and the fetcher only ever adds. It is
// tested here rather than only in a mirror run because the first version of it
// shipped with a line that had never once executed — it read fine, passed a
// syntax check, and failed the moment it ran.
console.log('\nSweeping documents nothing points at');

const sweepDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ava-sweep-'));
const docs = path.join(sweepDir, 'library', 'docs', 'panama');
fs.mkdirSync(docs, { recursive: true });
const write = (name, size) => fs.writeFileSync(path.join(docs, name), Buffer.alloc(size, 1));

for (let i = 1; i <= 10; i++) write(`MMC-${i}.pdf`, 1024);
write('MMC-270-03.pdf', 2048);          // the shape that caused this
write('brochure.pdf', 512);

const catalogue = {
  notices: Array.from({ length: 10 }, (_, i) => ({ refNo: `MMC ${i + 1}`, file: `docs/panama/MMC-${i + 1}.pdf` }))
};
const sweptResult = sweepUnreferenced(path.join(sweepDir, 'library', 'docs', 'panama'), catalogue);
check('it removes what nothing points at', sweptResult.swept === 2, JSON.stringify(sweptResult));
check('and counts the space it gave back', sweptResult.bytes === 2560, String(sweptResult.bytes));
check('the documents in the catalogue are left alone',
  fs.readdirSync(docs).length === 10, fs.readdirSync(docs).join(' '));
check('and the phantom one is gone',
  !fs.existsSync(path.join(docs, 'MMC-270-03.pdf')));

// The guard: a catalogue that came back thin must never empty the directory.
const thin = sweepUnreferenced(path.join(sweepDir, 'library', 'docs', 'panama'),
  { notices: [{ refNo: 'MMC 1', file: 'docs/panama/MMC-1.pdf' }] });
check('a thin catalogue sweeps nothing at all', thin.swept === 0 && thin.skipped, JSON.stringify(thin));
check('and the documents are still there',
  fs.readdirSync(docs).length === 10, String(fs.readdirSync(docs).length));

const empty = sweepUnreferenced(path.join(sweepDir, 'library', 'docs', 'panama'), { notices: [] });
check('an empty catalogue sweeps nothing either', empty.swept === 0 && empty.skipped, JSON.stringify(empty));
check('and the documents survive that too',
  fs.readdirSync(docs).length === 10, String(fs.readdirSync(docs).length));

fs.rmSync(sweepDir, { recursive: true, force: true });

// ── which clause a hit is in ───────────────────────────────────────────────
//
// "Page 84" is not what anyone cites, and a page number changes with every
// revision of the manual. The clause is what an inspector is told.
//
// The text here is exactly what pdf.js produces from a page of a manual: ONE
// unbroken line. There are no paragraph breaks in extracted text -- they are
// in the layout, not in the characters -- and the first version of this looked
// for clause numbers at the start of a line, so it found the first number on
// the page and reported it for every hit on it.
console.log('\nWhich clause a search hit is in');
const CLAUSE_PAGE = '5 CERTIFICATION AND DOCUMENTATION 5.3 Maintenance of statutory certificates '
  + '5.3.1 The Master shall ensure that all statutory certificates and documents required by '
  + 'the flag Administration are maintained valid at all times, and that surveys falling due '
  + 'are requested through the Technical Superintendent not less than sixty days before expiry. '
  + '5.3.2 A register of statutory certificates shall be kept in the ship\u2019s office.';
const clauseIn = (needle) => clauseAt(CLAUSE_PAGE, CLAUSE_PAGE.indexOf(needle));

check('a hit inside a clause is given that clause',
  clauseIn('maintained valid')?.ref === '5.3.1', JSON.stringify(clauseIn('maintained valid')));
check('and the heading it sits under, which is what the question is about',
  clauseIn('maintained valid')?.label === 'Maintenance of statutory certificates',
  JSON.stringify(clauseIn('maintained valid')));
// The clause number is matched by the capital that follows it, so a window
// ending at the hit cannot see the clause the hit is the first word of.
check('a hit on the first word of a clause belongs to that clause, not the one before',
  clauseIn('A register of statutory')?.ref === '5.3.2', JSON.stringify(clauseIn('A register of statutory')));
check('a chapter heading is a clause of its own',
  clauseIn('CERTIFICATION')?.ref === '5' && /CERTIFICATION AND DOCUMENTATION/.test(clauseIn('CERTIFICATION').label),
  JSON.stringify(clauseIn('CERTIFICATION')));

// A heading that does not cover the clause is not its title.
const twoBranches = '5.2 Drills and training 5.2.1 Drills shall be held monthly. '
  + '5.3 Maintenance of statutory certificates 5.3.1 The Master shall keep them valid.';
const under = clauseAt(twoBranches, twoBranches.indexOf('keep them valid'));
check('a heading from a different branch is never used as the title',
  under.ref === '5.3.1' && under.label === 'Maintenance of statutory certificates',
  JSON.stringify(under));

// Silence beats invention. A wrong clause reference given to an inspector is
// worse than a page number.
const unnumbered = 'This manual describes how statutory certificates are maintained on board.';
check('a document with no numbering is not given an invented clause',
  clauseAt(unnumbered, unnumbered.indexOf('certificates')) === null);
const noisy = 'The fleet carried 3.4 million tonnes and page 5 of 9 lists the certificates for 2019.';
check('and a decimal in a sentence is not mistaken for one',
  clauseAt(noisy, noisy.indexOf('certificates')) === null,
  JSON.stringify(clauseAt(noisy, noisy.indexOf('certificates'))));

// A numbered paragraph and a heading are the same shape. Showing the opening
// words of a paragraph as if they were a title tells the reader nothing.
const para = '7.1 The Company shall ensure that each ship is manned with qualified seafarers '
  + 'in accordance with national and international requirements at all material times.';
check('the opening words of a paragraph are not offered as a heading',
  clauseAt(para, para.indexOf('qualified')).label === null,
  JSON.stringify(clauseAt(para, para.indexOf('qualified'))));

// ── a document's contents, and the machinery it names ──────────────────────
//
// These lines are what readLayout produces from a real printed PDF: a size per
// line, and tabs where the column gaps were. The flattened text the search
// uses has neither, which is why this is a second pass -- "Equipment Maker
// Model Mooring Winch Rolls-Royce MW-250" cannot be read by anyone.
console.log('\nReading the machinery a document names');
const L = (page, size, text) => ({ page, size, text });
const MANUAL = [
  [L(1, 14, '1 INTRODUCTION'), L(1, 11, '1.1 This manual covers the engine room machinery.')],
  [L(2, 14, '3 MACHINERY PARTICULARS'),
   L(2, 12, '3.1 Main Air Compressor'),
   L(2, 11, 'Maker: Hatlapa Model: W110 Serial No: 884-2019'),
   L(2, 11, '3.1.1 The compressor shall be run up in accordance with the maker\u2019s instructions.'),
   L(2, 12, '3.2 Oily Water Separator'),
   L(2, 11, 'Manufacturer: Victor Marine Type: VM-15 Capacity: 1.0 m3/h')],
  [L(3, 14, '4 DECK MACHINERY'),
   L(3, 12, 'Equipment\tMaker\tModel'),
   L(3, 12, 'Mooring Winch\tRolls-Royce\tMW-250'),
   L(3, 12, 'Windlass\tMacGregor\tWL-90'),
   L(3, 12, '4.3 Provision Crane'),
   L(3, 11, 'Make - TTS Marine. SWL 3.2 t.')]
];

const kit = equipmentFrom(MANUAL);
const maker = (name) => kit.find((e) => e.name === name);
check('a labelled maker is read, with the heading as the name of the thing',
  maker('Main Air Compressor')?.maker === 'Hatlapa', JSON.stringify(kit));
check('and the model beside it, stopping before the next label',
  maker('Main Air Compressor')?.model === 'W110', JSON.stringify(maker('Main Air Compressor')));
check('Manufacturer is read as well as Maker',
  maker('Oily Water Separator')?.maker === 'Victor Marine', JSON.stringify(maker('Oily Water Separator')));
// The whole reason for reading the layout: flattened, this row is
// "Mooring Winch Rolls-Royce MW-250" and nothing says where the maker starts.
check('a table is read by its own header row, whatever order its columns are in',
  maker('Mooring Winch')?.maker === 'Rolls-Royce' && maker('Windlass')?.maker === 'MacGregor',
  JSON.stringify(kit.map((e) => `${e.name}=${e.maker}`)));
check('and a value is not run on into the sentence after it',
  maker('Provision Crane')?.maker === 'TTS Marine', JSON.stringify(maker('Provision Crane')));
check('every maker named is found and no more than that',
  kit.length === 5, JSON.stringify(kit.map((e) => e.name)));

// Silence beats invention: a wrong maker sends someone to order the wrong part.
const prose = [[L(1, 11, 'The compressor was supplied new by Hatlapa in 2019 and has run well since.')]];
check('a maker mentioned in a sentence is not guessed at',
  equipmentFrom(prose).length === 0, JSON.stringify(equipmentFrom(prose)));
// A table of readings has no maker column and is not a list of equipment.
const readings = [[L(1, 11, 'Date\tPressure\tTemperature'), L(1, 11, '01/05\t7.2 bar\t38 C')]];
check('a table with no maker column is not read as equipment',
  equipmentFrom(readings).length === 0, JSON.stringify(equipmentFrom(readings)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
