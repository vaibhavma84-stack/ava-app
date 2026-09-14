// The mirror runs on a server where nothing can be checked by eye, so its two
// readers are tested against fixtures shaped like what MPA actually serves.
//
// These readers exist because Node has no DOMParser and this project has no
// dependencies. They are blunt on purpose, which is exactly why they need
// pinning down: a regex over markup is easy to get subtly wrong.

import { readFeed, readLinks, readPanamaPage } from '../tools/mirror-notices.mjs';
import { textFromHtml, listOnly } from '../tools/mirror-docs.mjs';
import { singaporeRef, singaporeLooseRef, SG_TYPES, MPA, panamaRef } from '../library/js/updates.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
