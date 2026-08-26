// The mirror runs on a server where nothing can be checked by eye, so its two
// readers are tested against fixtures shaped like what MPA actually serves.
//
// These readers exist because Node has no DOMParser and this project has no
// dependencies. They are blunt on purpose, which is exactly why they need
// pinning down: a regex over markup is easy to get subtly wrong.

import { readFeed, readLinks } from '../tools/mirror-notices.mjs';
import { singaporeRef, SG_TYPES, MPA } from '../library/js/updates.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
