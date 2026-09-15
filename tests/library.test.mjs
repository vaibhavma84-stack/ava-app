/**
 * End-to-end test for Library.
 *
 * The point of this app is searching inside PDFs offline, so the test generates
 * a real multi-page PDF, attaches it through the UI, and checks the text was
 * extracted, indexed and is findable with a page-accurate snippet — then does
 * it again with the network cut.
 *
 *   node tests/library.test.mjs [--shots]
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8093;
const BASE = `http://localhost:${PORT}/library`;
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = path.join(ROOT, 'tests', 'screens');

// The mirrored catalogue is a real file on the site. The suite writes its own
// and puts back whatever was there, so a run never leaves the repo altered.
// The version file is generated from this, and drift between them would mean
// the app comparing itself against a number nothing is actually serving.
const APP_VERSION_IN_SOURCE =
  (fs.readFileSync(path.join(ROOT, 'library', 'js', 'app.js'), 'utf8')
    .match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];

const MIRROR_DIR = path.join(ROOT, 'library', 'data');
const MIRROR_FILE = path.join(MIRROR_DIR, 'singapore.json');
// Every mirrored file this suite writes over, snapshotted so the real ones
// come back. The index files were added to the suite without being added here,
// and a test run quietly replaced the real Singapore index — 552 documents'
// worth of addresses — with a fixture holding two. It was committed before
// anyone looked. Anything the suite writes into library/data belongs on this
// list.
const mirrorBefore = new Map([
  'mca.json', 'panama.json', 'singapore.json',
  'mca-files.json', 'panama-files.json', 'singapore-files.json'
].map((name) => {
  const file = path.join(MIRROR_DIR, name);
  return [file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
}));
// Emptied before anything syncs. Leaving the real indexes in place let live
// data into the fixture world — Panama's index grew to 404 documents and began
// matching a stubbed notice, turning a count this suite fixes at zero into
// one. Written here rather than beside the catalogues further down, because
// the flag syncs run before that point and read whatever is on disk at the
// time.
for (const admin of ['mca', 'panama', 'singapore']) {
  fs.writeFileSync(path.join(MIRROR_DIR, `${admin}-files.json`), JSON.stringify({
    administration: admin, urlPrefix: 'https://example.invalid/', filePrefix: 'docs/none/',
    held: 0, listed: 0, files: {}
  }));
}

// The catalogues too, and for the same reason. These were emptied further
// down, after the flag syncs had already run — which did no harm while Panama
// read its API first and reached the mirror only if that failed. The moment
// the mirror led, the real 373 circulars walked into a fixture expecting
// three, and the tests that walk WordPress's paging stopped exercising it at
// all. Singapore is written later with a catalogue of its own.
for (const admin of ['mca', 'panama']) {
  fs.writeFileSync(path.join(MIRROR_DIR, `${admin}.json`),
    JSON.stringify({ administration: admin, notices: [] }));
}

const restoreMirror = () => {
  for (const [file, content] of mirrorBefore) {
    if (content === null) { try { fs.rmSync(file); } catch {} }
    else fs.writeFileSync(file, content);
  }
};
process.on('exit', restoreMirror);

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? ' -- ' + extra : ''}`); }
};

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-pdf-'));
const PDF_PATH = path.join(tmp, 'main-engine-manual.pdf');

// A real PDF with a text layer, so extraction has something to find.
{
  const maker = await browser.newPage();
  await maker.setContent(`
    <style>@page{size:A4;margin:20mm} h1{font-family:sans-serif} p{font-family:serif;line-height:1.6}</style>
    <h1>Main Engine Operating Manual</h1>
    <p>Starting air pressure shall be a minimum of 25 bar before the first attempt.</p>
    <p>Unique marker one: ZEPHYRTESTONE.</p>
    <p>SWELLWORD conditions on page one. More SWELLWORD here. And SWELLWORD again.</p>
    <div style="page-break-before:always"></div>
    <h1>Section 2 — Lubrication</h1>
    <p>Sump oil temperature must remain between 40 and 55 degrees Celsius.</p>
    <p>Unique marker two: QUAYSIDEMARKER.</p>
    <p>SWELLWORD appears on page two as well. SWELLWORD once more.</p>`, { waitUntil: 'load' });
  await maker.pdf({ path: PDF_PATH, format: 'A4' });
  await maker.close();
  console.log(`  generated test PDF: ${(fs.statSync(PDF_PATH).size / 1024).toFixed(0)} KB`);
}

const PUB_PATH = path.join(tmp, 'NP281-1 Radio Signals.pdf');
{
  const maker = await browser.newPage();
  await maker.setContent(`
    <style>@page{size:A4;margin:20mm}
      h1{font-family:sans-serif;font-size:34pt}
      h2{font-family:sans-serif;font-size:16pt}
      p{font-family:serif;font-size:11pt}</style>
    <h1>Admiralty List of Radio Signals</h1>
    <h2>Volume 1 Part 1</h2>
    <p>Published by the United Kingdom Hydrographic Office</p>
    <p>Fifth edition, 2016</p>
    <p>NP281(1)</p>
    <p>Body text so the document is not treated as a scan and has something to index.</p>`,
    { waitUntil: 'load' });
  await maker.pdf({ path: PUB_PATH, format: 'A4' });
  await maker.close();
}

const FLAG_PATH = path.join(tmp, 'MMN-7-070.pdf');
{
  const maker = await browser.newPage();
  await maker.setContent(`
    <style>@page{size:A4;margin:20mm}
      h1{font-family:sans-serif;font-size:22pt} p{font-family:serif;font-size:11pt}</style>
    <h1>Merchant Marine Notice</h1>
    <p>Panama Maritime Authority</p>
    <p>MMN 7-070</p>
    <p>12 March 2026</p>
    <p>Subject: Implementation of amendments to MARPOL Annex VI for vessels
       registered under the Panamanian flag.</p>`, { waitUntil: 'load' });
  await maker.pdf({ path: FLAG_PATH, format: 'A4' });
  await maker.close();
}

// A fleet alert as a ship actually receives one: the kind of document in the
// largest type at the top, the subject and the reference on labelled lines
// below it. Reading the biggest text as the title gives "FLEET ALERT" every
// time, which says nothing about this particular alert.
const ALERT_PATH = path.join(tmp, 'FA-2026-05.pdf');
{
  const maker = await browser.newPage();
  await maker.setContent(`
    <style>@page{size:A4;margin:18mm}
      h1{font-family:sans-serif;font-size:26pt;margin:0 0 14pt}
      p{font-family:sans-serif;font-size:11pt;margin:2pt 0}</style>
    <h1>FLEET ALERT</h1>
    <p>Synergy Marine Group</p>
    <p>Ref: FA 05/2026</p>
    <p>Date: 14 August 2026</p>
    <p>To: All Vessels</p>
    <p>Subject: Failure of emergency fire pump during port state control
       inspection, and the checks now required before arrival.</p>
    <p>Body text so the document is not treated as a scan.</p>`, { waitUntil: 'load' });
  await maker.pdf({ path: ALERT_PATH, format: 'A4' });
  await maker.close();
}

// The same alert as the fleet actually numbers it: no "Ref", no "No.", just
// 045 / 2026 under the heading, meaning the 45th of 2026.
const BARE_ALERT_PATH = path.join(tmp, 'fleet-alert-045.pdf');
{
  const maker = await browser.newPage();
  await maker.setContent(`
    <style>@page{size:A4;margin:18mm}
      h1{font-family:sans-serif;font-size:26pt;margin:0 0 6pt}
      h2{font-family:sans-serif;font-size:14pt;margin:0 0 16pt;font-weight:normal}
      p{font-family:sans-serif;font-size:11pt;margin:2pt 0}</style>
    <h1>FLEET ALERT</h1>
    <h2>045 / 2026</h2>
    <p>Subject: Enclosed space entry without a permit to work.</p>
    <p>Body text so the document is not treated as a scan.</p>`, { waitUntil: 'load' });
  await maker.pdf({ path: BARE_ALERT_PATH, format: 'A4' });
  await maker.close();
}

// Numbered inside the subject rather than under the heading, which is how
// Synergy writes them as often as not.
const SUBJECT_ALERT_PATH = path.join(tmp, 'Mooring winch brake holding test.pdf');
{
  const maker = await browser.newPage();
  await maker.setContent(`
    <style>@page{size:A4;margin:18mm}
      h1{font-family:sans-serif;font-size:24pt;margin:0 0 16pt}
      p{font-family:sans-serif;font-size:11pt;margin:2pt 0}</style>
    <h1>SAFETY ALERT</h1>
    <p>Subject: Safety Alert 112 / 2026 - Mooring winch brake holding capacity.</p>
    <p>Body text so the document is not treated as a scan.</p>`, { waitUntil: 'load' });
  await maker.pdf({ path: SUBJECT_ALERT_PATH, format: 'A4' });
  await maker.close();
}

// No subject line at all: the filename is the only statement of what it is.
const NAMED_ALERT_PATH = path.join(tmp, 'Fleet Alert 077-2026 Gangway net rigging.pdf');
{
  const maker = await browser.newPage();
  await maker.setContent(`
    <style>@page{size:A4;margin:18mm}
      h1{font-family:sans-serif;font-size:24pt;margin:0 0 16pt}
      p{font-family:sans-serif;font-size:11pt}</style>
    <h1>FLEET ALERT</h1>
    <p>Body text so the document is not treated as a scan, with no subject line.</p>`,
    { waitUntil: 'load' });
  await maker.pdf({ path: NAMED_ALERT_PATH, format: 'A4' });
  await maker.close();
}

// A scan: the page drawn into a canvas and put back as an image, so the PDF
// holds a picture of the words and no text at all. This is what a photocopied
// manual actually is, and why nothing can be read out of one without OCR.
const SCAN_PATH = path.join(tmp, 'L-001 Operational Manual.pdf');
{
  // Four pages. The first is a cover sheet that says nothing useful, which is
  // exactly why the opening read is three pages and not one. Page four is
  // beyond that, so it only becomes findable once the whole thing is read.
  const sheets = [
    ['CONTROLLED COPY', 'Uncontrolled when printed.'],
    ['FLEET ALERT', 'Ref: FA 231 / 2026', 'Subject: Mooring rope condition', 'and inspection before arrival.'],
    ['Section 1 — Inspection', 'Check the winch brake holding capacity.'],
    ['Section 2 — Records', 'File the certificate in the chartroom cabinet.']
  ];
  const maker = await browser.newPage();
  const images = [];
  for (const lines of sheets) {
    await maker.setContent('<canvas id="c" width="1240" height="1754"></canvas>', { waitUntil: 'load' });
    images.push(await maker.evaluate((rows) => {
      const ctx = document.getElementById('c').getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1240, 1754);
      ctx.fillStyle = '#000';
      rows.forEach((line, i) => {
        ctx.font = i === 0 ? 'bold 64px Helvetica, Arial, sans-serif' : '40px Helvetica, Arial, sans-serif';
        ctx.fillText(line, 90, 180 + i * 90);
      });
      return document.getElementById('c').toDataURL('image/png');
    }, lines));
  }
  await maker.setContent(
    `<style>@page{size:A4;margin:0}img{width:100%;display:block;page-break-after:always}</style>`
    + images.map((src) => `<img src="${src}">`).join(''),
    { waitUntil: 'load' });
  await maker.pdf({ path: SCAN_PATH, format: 'A4' });
  await maker.close();
}

// A PDF that is not a scan: its text is real and selectable, and it also
// carries a diagram. The label on the diagram is drawn into the picture, so it
// is pixels — exactly like a P&ID or a general arrangement, where the words
// that matter most are the ones printed on the drawing. Extraction gets the
// prose and cannot get the label, which is the whole point of this fixture.
const DIAGRAM_PATH = path.join(tmp, 'Hydraulic System Overview.pdf');
{
  const maker = await browser.newPage();
  await maker.setContent('<canvas id="c" width="900" height="500"></canvas>', { waitUntil: 'load' });
  const drawing = await maker.evaluate(() => {
    const ctx = document.getElementById('c').getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 500);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
    ctx.strokeRect(60, 120, 780, 260);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 58px Helvetica, Arial, sans-serif';
    ctx.fillText('STARBOARD BILGE VALVE', 90, 230);
    ctx.font = 'bold 48px Helvetica, Arial, sans-serif';
    ctx.fillText('MANIFOLD 47B', 90, 320);
    return document.getElementById('c').toDataURL('image/png');
  });
  await maker.setContent(
    `<style>@page{size:A4;margin:24px}body{font:16px Helvetica,Arial,sans-serif}`
    + `img{width:100%;display:block;margin-top:18px}</style>`
    + `<h1>Hydraulic System Overview</h1>`
    + `<p>This section describes the hydraulic power pack and its distribution`
    + ` to the deck machinery. Isolation procedures are given in section four.</p>`
    + `<img src="${drawing}">`,
    { waitUntil: 'load' });
  await maker.pdf({ path: DIAGRAM_PATH, format: 'A4' });
  await maker.close();
}

// A photograph attached on its own — a nameplate, the sort of thing that gets
// taken on a phone and dropped into an entry. Not a PDF at all, so nothing was
// ever read out of it.
const PHOTO_PATH = path.join(tmp, 'Emergency generator plate.png');
{
  const maker = await browser.newPage();
  await maker.setContent('<canvas id="c" width="900" height="520"></canvas>', { waitUntil: 'load' });
  const png = await maker.evaluate(() => {
    const ctx = document.getElementById('c').getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 520);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 62px Helvetica, Arial, sans-serif';
    ctx.fillText('NAMEPLATE', 70, 160);
    ctx.font = 'bold 52px Helvetica, Arial, sans-serif';
    ctx.fillText('SERIAL 8842', 70, 270);
    ctx.fillText('RATING 440V', 70, 380);
    return document.getElementById('c').toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(PHOTO_PATH, Buffer.from(png, 'base64'));
  await maker.close();
}

const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
const page = await context.newPage();
const errors = [];
// Part of the suite refuses a source on purpose — a host cut off, the 400
// WordPress returns for a page past the end of its library, or the 404 of a
// mirrored catalogue that has not been written yet — to see how the app
// reports it. The browser logs those as resource errors; they are the
// point of the test, not a defect, so they are ignored while that is set up.
// The window covers the flag-sync section only, where every host is stubbed.
let blockingOnPurpose = false;
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // Any network error, not one spelling of it. A sandbox refuses a blocked
  // host with ERR_TUNNEL_CONNECTION_FAILED rather than ERR_FAILED, so adding a
  // source to a flag turned "the host is cut off on purpose" into four test
  // failures that were nothing of the sort.
  if (blockingOnPurpose && /net::ERR_|status of (400|404)/.test(text)) return;
  errors.push(text);
});
page.on('dialog', async (d) => { await d.accept(''); });

const shot = async (name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.evaluate(async () => {
    const panels = document.querySelectorAll('.sheet:not([hidden]) .sheet-panel');
    await Promise.all([...panels].flatMap((el) => el.getAnimations().map((a) => a.finished)));
  });
  await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
};

const set = (key, value) => page.fill(`#editorBody [data-field="${key}"]`, value);
const pick = (key, value) => page.selectOption(`#editorBody [data-field="${key}"]`, value);
const save = async (timeout = 30000) => {
  await page.click('#editorSave');
  await page.waitForSelector('#editor', { state: 'hidden', timeout });
};

/** Editing from the detail view reopens it on save; dismiss it before going on. */
// Flag Circulars folds its four panels behind one line so the circulars are
// what the section opens on. Everything the suite does with those panels needs
// them unfolded first.
const openTools = async () => {
  const head = page.locator('.tools-head');
  if (await head.count() === 0) return;
  if ((await head.getAttribute('aria-expanded')) === 'true') return;
  await head.click();
  await page.waitForSelector('.tools-body', { timeout: 5000 });
};

// "It has a file" and "you can find it again" are different things, and the
// card is where the second one has to be legible without opening anything.
const cardPill = async (title) =>
  (await page.locator('.card', { hasText: title }).first().locator('.pill').allInnerTexts()).join(' ');

// And the circulars themselves are a tree, shut by default -- a flag opens to
// its classes of notice, a class opens to the notices. Assertions about cards
// have to open it first.
const openBranches = async () => {
  for (let i = 0; i < 60; i++) {
    const shut = page.locator('.group-head-btn[aria-expanded="false"]').first();
    if (await shut.count() === 0) return;
    await shut.click();
    await page.waitForTimeout(40);
  }
};

const closeDetail = async () => {
  if (await page.locator('#detail').isVisible()) {
    await page.click('#detailClose');
    await page.waitForSelector('#detail', { state: 'hidden' });
  }
};

try {
  console.log('\nOpening');
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  check('opens straight away, with no passcode', true);
  check('no lock screen is shown', await page.locator('#lock').isHidden());
  check('opens on the sections screen',
    (await page.locator('.section-card').count()) === 5);
  const names = await page.locator('.section-name').allTextContents();
  check('sections appear in the configured order',
    names.join(',') === 'Publications,Manuals,Synergy,Flag Circulars,Circulars', names.join(','));
  await shot('lib-01-home');

  console.log('\nAdding a manual with a PDF');
  await page.locator('.section-card', { hasText: 'Manuals' }).click();
  await page.waitForSelector('#fab:not([hidden])');
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Main Engine Operating Manual');
  await pick('category', 'Engine');
  await set('vessel', 'MV Northern Star');
  await set('location', 'ECR shelf 3');
  await page.setInputFiles('#filePicker', PDF_PATH);
  await page.waitForTimeout(300);
  check('the picked PDF is staged before saving',
    (await page.locator('#editorBody .attach').count()) === 1);
  await save();
  check('saves with the PDF attached', (await page.locator('.card').count()) === 1);

  await page.locator('.card').first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const detail = await page.locator('#detailBody').innerText();
  check('the PDF was read and its pages indexed', /pages indexed/i.test(detail), detail.replace(/\n/g, ' / '));
  check('it was not misreported as a scan', !/no text layer/i.test(detail));
  check('a readable PDF offers no re-read prompt', !/reading the text again/i.test(detail));
  // A PDF whose text was extracted is already searchable. Offering to read it
  // as pictures invites a 6 MB download on a ship for text the app already
  // has, and worse text than it already has.
  check('and is not offered the reader it does not need',
    !/Read the whole document|Read the scan|Read the rest/i.test(detail),
    detail.replace(/\n/g, ' / ').slice(0, 240));

  // Extracting text must not alter the stored file. Diagrams and photographs
  // only survive if the original bytes come back exactly as they went in.
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(PDF_PATH)).digest('hex');
  const stored = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const item = store.itemsOfType('manual')[0];
    const att = item.data.attachments[0];
    const blob = await store.readFile(att);
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return {
      size: buf.byteLength,
      type: blob.type,
      hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    };
  });
  check('the stored PDF is byte-for-byte the file that went in',
    stored.hash === sourceHash, `${stored.hash.slice(0, 16)} vs ${sourceHash.slice(0, 16)}`);
  check('its size is unchanged', stored.size === fs.statSync(PDF_PATH).size,
    `${stored.size} vs ${fs.statSync(PDF_PATH).size}`);
  check('it comes back as a PDF, openable as the original',
    stored.type === 'application/pdf', stored.type);

  // The engine self-test must agree that reading works on this device.
  const self = await page.evaluate(async () => (await import('./js/pdftext.js')).selfTest());
  check('the built-in PDF self-test passes', self.ok === true, JSON.stringify(self));
  check('the self-test reads real characters', self.chars > 10, String(self.chars));

  // Reproduce an older iOS properly: the built-ins must be missing before any
  // module loads, so this runs in its own page with an init script. Deleting
  // them on a live page does not work — the polyfill module has already been
  // evaluated and will not run again — and it poisons everything after it.
  {
    const oldPage = await context.newPage();
    await oldPage.addInitScript(() => {
      delete Promise.withResolvers;
      delete Math.sumPrecise;
      delete Object.hasOwn;
      // The one that actually broke a real device: PDF.js reads text with
      // "for await (const chunk of stream)".
      delete ReadableStream.prototype[Symbol.asyncIterator];
      delete ReadableStream.prototype.values;
    });
    await oldPage.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    const missing = await oldPage.evaluate(() => ({
      withResolvers: typeof Promise.withResolvers,
      sumPrecise: typeof Math.sumPrecise,
      streamIterator: typeof ReadableStream.prototype[Symbol.asyncIterator]
    }));
    check('the simulated device really lacks those built-ins',
      missing.withResolvers === 'undefined' && missing.sumPrecise === 'undefined'
      && missing.streamIterator === 'undefined', JSON.stringify(missing));

    const result = await oldPage.evaluate(async () => {
      const { selfTest } = await import('./js/pdftext.js');
      return selfTest();
    });
    check('extraction works on a device without Promise.withResolvers',
      result.ok === true, JSON.stringify(result));

    const drew = await oldPage.evaluate(async () => {
      try {
        const { renderInto } = await import('./js/viewer.js');
        const raw = atob((await import('./js/pdftext.js')).SELF_TEST_PDF_B64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const host = document.createElement('div');
        host.style.width = '400px';
        document.body.append(host);
        await renderInto(host, new Blob([bytes], { type: 'application/pdf' }), 'test.pdf');
        const c = host.querySelector('canvas');
        return { ok: Boolean(c && c.width > 0), width: c?.width || 0 };
      } catch (ex) {
        return { ok: false, error: String(ex?.message || ex) };
      }
    });
    check('the viewer also renders on that device', drew.ok === true, JSON.stringify(drew));
    await oldPage.close();
  }

  // A file that is not a PDF at all must report failure, not silently "scan".
  const bogus = await page.evaluate(async () => {
    const { extract, STATUS } = await import('./js/pdftext.js');
    const bytes = new TextEncoder().encode('this is not a pdf at all');
    const r = await extract(bytes.buffer);
    return { status: r.status, failed: r.status === STATUS.FAILED, error: r.error };
  });
  check('an unreadable file reports failure rather than "scan"', bogus.failed, JSON.stringify(bogus));
  check('and carries a reason', Boolean(bogus.error), String(bogus.error));
  await shot('lib-02-detail');
  await page.click('#detailClose');

  console.log('\nOpening a document in the app');
  await page.locator('.card').first().click();
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detailBody button:has-text("Open")');
  await page.waitForSelector('#viewer:not([hidden])');
  await page.waitForSelector('#viewerBody canvas', { timeout: 20000 });

  // The canvas is in the document before PDF.js has painted into it, so
  // counting pixels the moment it appears reads a blank one. Wait for the ink.
  const inkOnPage = () => {
    const c = document.querySelector('#viewerBody canvas');
    if (!c || !c.width) return null;
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, Math.min(c.height, 400));
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 200) ink++;
    return { ink, width: c.width, height: c.height, pages: document.querySelectorAll('#viewerBody canvas').length };
  };
  await page.waitForFunction(
    (fn) => { const r = new Function(`return (${fn})()`)(); return Boolean(r && r.ink > 50); },
    inkOnPage.toString(), { timeout: 20000 }
  ).catch(() => {});
  const measured = await page.evaluate((fn) => new Function(`return (${fn})()`)(), inkOnPage.toString());
  const drawn = { ok: Boolean(measured && measured.ink > 50), ...(measured || { reason: 'no canvas' }) };
  check('the document renders inside the app', drawn.ok, JSON.stringify(drawn));
  check('every page gets a slot', drawn.pages === 2, String(drawn.pages));
  check('the viewer reports the page count',
    /2 pages/i.test(await page.locator('#viewerTitle').textContent()));
  await page.click('#viewerClose');
  await page.waitForSelector('#viewer', { state: 'hidden' });
  check('closing the viewer tears it down',
    (await page.locator('#viewerBody canvas').count()) === 0);
  await page.click('#detailClose');

  console.log('\nSearching inside the PDF');
  await page.fill('#search', 'ZEPHYRTESTONE');
  await page.waitForTimeout(600);
  check('a word from inside the PDF finds the record',
    (await page.locator('.card').count()) === 1);
  const snippet = await page.locator('.snippet').first().innerText();
  check('the result shows a snippet from the document', /ZEPHYRTESTONE/i.test(snippet), snippet);
  check('the snippet names the file and page', /page 1/i.test(snippet), snippet);
  check('the matched term is highlighted',
    (await page.locator('.snippet mark').count()) > 0);
  await shot('lib-03-search');

  await page.fill('#search', 'QUAYSIDEMARKER');
  await page.waitForTimeout(400);
  const page2 = await page.locator('.snippet').first().innerText();
  check('a term on page two reports page two', /page 2/i.test(page2), page2);

  // A term repeated across pages must report every hit, not a sample of three.
  await page.fill('#search', 'SWELLWORD');
  await page.waitForTimeout(700);
  const counted = await page.evaluate(async () => {
    const { search } = await import('./js/search.js');
    const store = await import('./js/store.js');
    const texts = await store.loadTexts();
    const [top] = search('SWELLWORD', store.allItems(), texts);
    return { matches: top.matchCount, pages: top.pagesWithHits, snippets: top.snippets.length };
  });
  check('every occurrence is counted, not just the first few',
    counted.matches === 5, JSON.stringify(counted));
  check('hits are counted across both pages', counted.pages === 2, JSON.stringify(counted));
  check('the card reports the real total',
    /5 matches on 2 pages/i.test(await page.locator('.card').first().innerText()),
    (await page.locator('.card').first().innerText()).replace(/\n/g, ' / '));

  const shownFirst = await page.locator('.snippet').count();
  check('only the first few are shown at once', shownFirst === 3, String(shownFirst));
  check('the rest are offered', await page.locator('button:has-text("Show all")').isVisible());
  await page.click('button:has-text("Show all")');
  await page.waitForTimeout(200);
  check('showing all reveals every snippet',
    (await page.locator('.snippet').count()) === counted.snippets,
    `${await page.locator('.snippet').count()} vs ${counted.snippets}`);

  // A hit on page two must open the document there, not at the front.
  const pageTwo = page.locator('.snippet', { hasText: 'page 2' }).first();
  await pageTwo.click();
  await page.waitForSelector('#viewer:not([hidden])');
  await page.waitForSelector('#viewerBody canvas', { timeout: 20000 });
  check('opening a hit jumps to its page',
    /page 2/i.test(await page.locator('#viewerTitle').textContent()),
    await page.locator('#viewerTitle').textContent());
  await page.click('#viewerClose');
  await page.waitForSelector('#viewer', { state: 'hidden' });

  await page.fill('#search', 'sump oil temperature');
  await page.waitForTimeout(400);
  check('a multi-word phrase from the document matches',
    (await page.locator('.card').count()) === 1);

  await page.fill('#search', 'ZEPHYRTESTONE nonexistentword');
  await page.waitForTimeout(400);
  check('every term must be present, not just one',
    (await page.locator('.card').count()) === 0);

  await page.fill('#search', 'Northern Star');
  await page.waitForTimeout(400);
  check('metadata still matches alongside content',
    (await page.locator('.card').count()) === 1);
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  console.log('\nGrouping by vessel');
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Boiler Manual');
  await pick('category', 'Engine');
  await set('vessel', 'MT Baltic Trader');
  await save();
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Crane Manual');
  await pick('category', 'Deck');
  await set('vessel', 'MV Northern Star');
  await save();

  const heads = await page.locator('.group-head').allTextContents();
  check('manuals are grouped under each ship', heads.length === 2, heads.join(' | '));
  check('groups are the vessel names',
    heads.some((h) => h.includes('MV Northern Star')) && heads.some((h) => h.includes('MT Baltic Trader')),
    heads.join(' | '));

  const chips = await page.locator('.scope-btn').allTextContents();
  check('a type filter is offered', chips.includes('Engine') && chips.includes('Deck'), chips.join(','));
  await page.locator('.scope-btn', { hasText: 'Deck' }).click();
  await page.waitForTimeout(200);
  check('filtering by type narrows the list', (await page.locator('.card').count()) === 1);
  await page.locator('.scope-btn', { hasText: 'All' }).click();
  await page.waitForTimeout(200);
  check('clearing the filter restores it', (await page.locator('.card').count()) === 3);
  await shot('lib-04-grouped');

  console.log('\nIMO conventions');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card', { hasText: 'Publications' }).click();
  await page.waitForTimeout(200);

  // The conventions are a closed set that ships with the app. Adding them must
  // cost nothing on a metered connection, so watch for any fetch at all.
  const imoOutbound = [];
  const imoWatch = (req) => {
    const url = req.url();
    if (!url.startsWith(`http://localhost:${PORT}`)) imoOutbound.push(url);
  };
  page.on('request', imoWatch);

  const imoPanel = '.imo-panel';
  check('publications offers the convention list',
    await page.locator(imoPanel).count() === 1);
  const offer = await page.locator(`${imoPanel} button`).first().innerText();
  check('and says how many are not yet filed', /Add from the IMO list \(\d+\)/i.test(offer), offer);

  await page.locator(`${imoPanel} button`).first().click();
  await page.waitForTimeout(200);
  const listed = await page.locator(`${imoPanel} .stat`).count();
  check('the conventions are listed to choose from', listed > 20, String(listed));
  const solasRow = page.locator(`${imoPanel} .stat`, { hasText: 'SOLAS 1974' }).first();
  check('SOLAS is among them', await solasRow.count() === 1);
  check('and reads with its full name and status',
    /Safety of Life at Sea/.test(await solasRow.innerText())
    && /in force 1980/.test(await solasRow.innerText()),
    await solasRow.innerText());

  await solasRow.locator('button').click();
  await page.waitForTimeout(400);
  check('adding one files it', await page.locator('.card', { hasText: 'Safety of Life at Sea' }).count() === 1);
  check('under its own heading',
    (await page.locator('.group-head').allTextContents()).some((h) => h.includes('IMO Convention')),
    (await page.locator('.group-head').allTextContents()).join(' | '));
  check('and it is not offered a second time',
    await page.locator(`${imoPanel} .stat`, { hasText: 'SOLAS 1974' }).count() === 0);
  // Nothing has been added to it yet, so there is nothing to be searchable or
  // not. A verdict here would be a verdict about a document that is not there.
  check('an entry with no document is not labelled either way',
    (await cardPill('Safety of Life at Sea')).trim() === '',
    await cardPill('Safety of Life at Sea'));

  await page.locator('.card', { hasText: 'Safety of Life at Sea' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const conventionDetail = await page.locator('#detailBody').innerText();
  check('the reference is how it is spoken about', /SOLAS 1974/.test(conventionDetail), conventionDetail.slice(0, 300));
  check('adoption and entry into force are both recorded',
    /Adopted 1974/.test(conventionDetail) && /in force 1980/.test(conventionDetail),
    conventionDetail.slice(0, 300));
  check('nothing was downloaded to do any of it', imoOutbound.length === 0, imoOutbound.join(', '));
  page.off('request', imoWatch);
  await closeDetail();

  // A convention still awaiting ratification must not read as if it were law.
  await page.locator(`${imoPanel} button`).first().click();
  await page.waitForTimeout(200);
  const hns = page.locator(`${imoPanel} .stat`, { hasText: 'HNS 2010' }).first();
  check('one not yet in force says so', /not yet in force/.test(await hns.innerText()), await hns.innerText());
  await page.locator(`${imoPanel} button`).first().click();
  await page.waitForTimeout(200);

  console.log('\nFilling an entry from the PDF');
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await page.setInputFiles('#filePicker', PUB_PATH);
  await page.waitForSelector('#editorBody .panel:has-text("Filled in from the PDF")', { timeout: 25000 });

  const guessed = await page.evaluate(() => {
    const read = (k) => document.querySelector(`#editorBody [data-field="${k}"]`)?.value || '';
    return { title: read('title'), edition: read('edition'), publisher: read('publisher'), refNo: read('refNo') };
  });
  check('the title comes from the document, not the filename',
    /Admiralty List of Radio Signals/i.test(guessed.title), JSON.stringify(guessed));
  check('the edition and year are picked up',
    /2016/.test(guessed.edition), JSON.stringify(guessed));
  check('the publisher is recognised', guessed.publisher === 'UKHO', JSON.stringify(guessed));
  check('the reference number is found', /NP281/i.test(guessed.refNo), JSON.stringify(guessed));

  // What the user typed must survive; only empty fields are filled.
  await set('vessel', 'MV Northern Star');
  await save();
  const savedPub = await page.locator('.card', { hasText: 'Radio Signals' }).first().innerText();
  check('a filled entry saves', /Radio Signals/i.test(savedPub), savedPub.replace(/\n/g, ' / '));

  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'My own title');
  await page.setInputFiles('#filePicker', PUB_PATH);
  await page.waitForSelector('#editorBody .panel:has-text("Filled in from the PDF")', { timeout: 25000 });
  const kept = await page.evaluate(() =>
    document.querySelector('#editorBody [data-field="title"]')?.value);
  // Capitalisation is applied to what was typed; the words themselves must be
  // exactly what the writer put there, not the PDF's.
  check('a title already typed is never overwritten',
    String(kept).toLowerCase() === 'my own title', String(kept));
  await page.click('#editorCancel');
  await page.waitForSelector('#editor', { state: 'hidden' });

  console.log('\nFlag circulars');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card', { hasText: 'Flag Circulars' }).click();
  await page.waitForTimeout(200);
  await openTools();
  await page.waitForTimeout(200);

  const sourceHrefs = await page.locator('.body a.link-btn').evaluateAll((as) =>
    as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));
  // Counted from the schema rather than written down here: the number changed
  // the moment Panama went from one source to five, and a magic number in a
  // test only ever records what was true the day it was written.
  const { FLAG_SOURCES: SOURCES } = await import('../library/js/schema.js');
  const expected = Object.values(SOURCES).reduce((n, links) => n + links.length, 0);
  check('the section links to where the notices are published',
    sourceHrefs.length === expected,
    `${sourceHrefs.length} shown, ${expected} in the schema`);
  check('the MSN collection is the one supplied',
    sourceHrefs.some((l) => l.href === 'https://www.gov.uk/government/collections/merchant-shipping-notices-msns'),
    JSON.stringify(sourceHrefs));
  check('the MGN collection is the one supplied',
    sourceHrefs.some((l) => l.href === 'https://www.gov.uk/government/collections/active-marine-guidance-notes-mgns'),
    JSON.stringify(sourceHrefs));
  check('MSN, MGN and MIN are all offered',
    ['MSN', 'MGN', 'MIN'].every((k) => sourceHrefs.some((l) => l.text.includes(k))),
    JSON.stringify(sourceHrefs.map((l) => l.text)));
  check('all three administrations are linked',
    ['MCA', 'Panama', 'Singapore'].every((k) => sourceHrefs.some((l) => l.text.includes(k))),
    JSON.stringify(sourceHrefs.map((l) => l.text)));
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await page.setInputFiles('#filePicker', FLAG_PATH);
  await page.waitForSelector('#editorBody .panel:has-text("Filled in from the PDF")', { timeout: 25000 });
  const flagGuess = await page.evaluate(() => {
    const read = (k) => document.querySelector(`#editorBody [data-field="${k}"]`)?.value || '';
    return { title: read('title'), flagState: read('flagState'), refNo: read('refNo'),
             date: read('date'), issuer: read('issuer') };
  });
  check('the flag is recognised from the document',
    flagGuess.flagState === 'Panama', JSON.stringify(flagGuess));
  check('the administration is named', /Panama Maritime Authority/i.test(flagGuess.issuer), JSON.stringify(flagGuess));
  check('the notice number is picked up', /MMN\s?7-070/i.test(flagGuess.refNo), JSON.stringify(flagGuess));
  check('the date issued is picked up', flagGuess.date === '2026-03-12', JSON.stringify(flagGuess));

  check('the document class is recognised from its prefix',
    (await page.evaluate(() =>
      document.querySelector('#editorBody [data-field="docType"]')?.value)) === 'MMN (Merchant Marine Notice)');

  // The Type list must follow the administration, not offer everyone's terms.
  const panamaTypes = await page.evaluate(() =>
    [...document.querySelector('#editorBody [data-field="docType"]').options].map((o) => o.value).filter(Boolean));
  check('Panama offers its own document classes',
    panamaTypes.some((t) => t.startsWith('MMN')) && !panamaTypes.some((t) => t.startsWith('MSN')),
    panamaTypes.join(' | '));

  await pick('flagState', 'MCA');
  await page.waitForTimeout(200);
  const mcaTypes = await page.evaluate(() =>
    [...document.querySelector('#editorBody [data-field="docType"]').options].map((o) => o.value).filter(Boolean));
  check('MCA offers MSN, MGN and MIN',
    ['MSN', 'MGN', 'MIN'].every((k) => mcaTypes.some((t) => t.startsWith(k))), mcaTypes.join(' | '));
  check('a type from the previous administration is cleared, not left stale',
    (await page.evaluate(() =>
      document.querySelector('#editorBody [data-field="docType"]').value)) === '');

  await pick('flagState', 'Panama');
  await page.waitForTimeout(200);
  await pick('docType', 'MMN (Merchant Marine Notice)');
  await save();
  await openBranches();
  check('saves a flag circular', (await page.locator('.card').count()) === 1);

  const flagOptions = await page.evaluate(() => {
    const sel = document.querySelector('#editorBody [data-field="flagState"]');
    return sel ? [...sel.options].map((o) => o.value).filter(Boolean) : [];
  });
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  const opts = await page.evaluate(() =>
    [...document.querySelector('#editorBody [data-field="flagState"]').options]
      .map((o) => o.value).filter(Boolean));
  check('only the administrations in use are offered',
    opts.join(',') === 'MCA,Panama,Singapore,Other', opts.join(','));
  await page.click('#editorCancel');
  await page.waitForSelector('#editor', { state: 'hidden' });
  void flagOptions;

  const flagHeads = await page.locator('.group-head').allTextContents();
  check('flag circulars are filed under their administration',
    flagHeads.some((h) => h.includes('Panama')), flagHeads.join(' | '));

  // None of these administrations is reachable from the test machine, so each
  // response is stubbed. What is being tested is the parsing, the fallback
  // between routes, and the merge: that a repeat sync updates rather than
  // duplicates, and never overwrites what was typed by hand.
  console.log('\nUpdating from the administrations');
  // Data on a ship is limited, so the app must never fetch on its own. Watch
  // every outbound request while simply using the app.
  const outbound = [];
  const watch = (req) => {
    const url = req.url();
    if (!url.startsWith(`http://localhost:${PORT}`)) outbound.push(url);
  };
  page.on('request', watch);
  await page.click('#backBtn');
  await page.waitForTimeout(300);
  await page.locator('.section-card', { hasText: 'Flag Circulars' }).click();
  await page.waitForTimeout(200);
  await openTools();
  await page.waitForTimeout(300);
  await page.fill('#search', 'notice');
  await page.waitForTimeout(600);
  await page.fill('#search', '');
  await page.waitForTimeout(300);
  check('nothing is fetched until asked for', outbound.length === 0, outbound.join(', '));
  page.off('request', watch);

  check('no documents are offered before a list has been fetched',
    await page.locator('.doc-panel button').count() === 0,
    await page.locator('.doc-panel').innerText().catch(() => '(no panel)'));

  const panel = '.panel:has-text("Update from the administration")';
  for (const admin of ['MCA', 'Panama', 'Singapore']) {
    check(`there is an update button for ${admin}`,
      await page.locator(`${panel} button:text-is("${admin}")`).count() === 1);
  }

  // ---- MCA: a public JSON API, with the collection path having moved -------
  // Each collection lists only its own class, so a class that failed to load
  // shows up as a missing entry rather than being covered by another's reply.
  const DOCS = {
    msns: { title: 'MSN 1871 (M) Amendment 1', base_path: '/government/publications/msn-1871', public_updated_at: '2026-02-10T09:00:00Z' },
    mgns: { title: 'MGN 654 (M+F) Safe movement on board', base_path: '/government/publications/mgn-654', public_updated_at: '2026-01-05T09:00:00Z' },
    mins: { title: 'MIN 700 (M) Training berths', base_path: '/government/publications/min-700', public_updated_at: '2025-11-20T09:00:00Z' }
  };
  const feedFor = (url) => {
    const key = Object.keys(DOCS).find((k) => url.endsWith(k));
    return JSON.stringify(key ? { links: { documents: [DOCS[key]] } } : { links: {} });
  };
  // GOV.UK answers a moved collection with a redirect document that lists
  // nothing. Standing in for that proves the app falls through to the next
  // known path instead of reporting the class as unavailable.
  const mgnTried = [];
  await page.route('**/api/content/government/collections/**', (route) => {
    const url = route.request().url();
    if (/mgns$/.test(url)) {
      mgnTried.push(url);
      if (!/active-marine-guidance-notes/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"links":{}}' });
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: feedFor(url) });
  });

  await page.click(`${panel} button:text-is("MCA")`);
  await page.waitForSelector('.hint:has-text("new")', { timeout: 20000 });
  const firstRun = await page.locator(`${panel} .sync-result`).innerText();
  check('a first sync files every notice', /MCA: 3 new/.test(firstRun), firstRun);
  check('the collection the user gave is the one used',
    mgnTried.some((u) => /active-marine-guidance-notes-mgns/.test(u)), mgnTried.join(', '));

  await openBranches();
  const cards = await page.locator('.card').allInnerTexts();
  check('the reference is parsed from the title',
    cards.some((c) => /MSN 1871 \(M\)/.test(c)), cards.join(' | '));
  check('the document class follows the prefix',
    cards.some((c) => /MGN \(Marine Guidance Note\)/.test(c))
    || cards.some((c) => /MGN 654/.test(c)), cards.join(' | '));
  check('all three are filed under MCA',
    (await page.locator('.group-head').allTextContents()).some((h) => h.includes('MCA')));

  // Add a note by hand, then sync again: the note must survive.
  await page.locator('.card', { hasText: 'MSN 1871' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detailEdit');
  await page.waitForSelector('#editor:not([hidden])');
  await set('notes', 'Checked against the ship copy on 2 March.');
  await save();
  await closeDetail();

  await page.click(`${panel} button:text-is("MCA")`);
  await page.waitForSelector('.hint:has-text("already held")', { timeout: 20000 });
  const secondRun = await page.locator(`${panel} .sync-result`).innerText();
  check('a repeat sync does not duplicate', /0 new/.test(secondRun), secondRun);
  check('and recognises what is already held', /3 already held/.test(secondRun), secondRun);

  await page.locator('.card', { hasText: 'MSN 1871' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  check('the hand-typed note survives a resync',
    /Checked against the ship copy/.test(await page.locator('#detailBody').innerText()));
  await closeDetail();

  // ---- Panama: no API of its own, but WordPress serves one ----------------
  // A search per class, each walked page by page. A full page means there is
  // another behind it; a short one is the end of the catalogue.
  const filler = (n) => Array.from({ length: n }, (_, i) => ({
    title: { rendered: `Registry-brochure-${i}` }, date: '2025-02-01T10:00:00',
    source_url: `https://www.panamashipregistry.com/wp-content/uploads/2025/02/brochure-${i}.pdf`
  }));
  const MMC_PAGE_1 = [
    { title: { rendered: 'MMC-230-Recognised-Organisations' }, date: '2025-10-15T10:00:00',
      source_url: 'https://www.panamashipregistry.com/wp-content/uploads/2025/10/MMC-230-15-10-2025.pdf' },
    // A search returns everything it matched, most of it not a circular, so a
    // full page is mostly uploads that have to be dropped.
    ...filler(99)
  ];
  const MMC_PAGE_2 = [
    { title: { rendered: 'MMC-388-January-2024' }, date: '2024-01-11T10:00:00',
      source_url: 'https://www.panamashipregistry.com/wp-content/uploads/2024/01/MMC-388-January-2024.pdf' }
  ];
  const MMN_PAGE_1 = [
    { title: { rendered: 'MMN-7-070-Ballast-water-record-book' }, date: '2025-06-02T10:00:00',
      source_url: 'https://www.panamashipregistry.com/wp-content/uploads/2025/06/MMN-7-070.pdf' }
  ];
  const panamaPages = [];
  const panamaStub = (route) => {
    const url = route.request().url();
    panamaPages.push(url);
    const q = new URL(url).searchParams;
    const n = Number(q.get('page') || 1);
    const notices = /MMN/.test(q.get('search') || '');
    const body = notices
      ? (n === 1 ? MMN_PAGE_1 : null)
      : (n === 1 ? MMC_PAGE_1 : n === 2 ? MMC_PAGE_2 : null);
    if (!body) {
      // What WordPress answers for a page past the end: an error, not a list.
      return route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"rest_post_invalid_page_number"}' });
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  };
  await page.route('**/wp-json/wp/v2/media**', panamaStub);

  blockingOnPurpose = true;
  await page.click(`${panel} button:text-is("Panama")`);
  await page.waitForSelector('.hint:has-text("Panama:")', { timeout: 20000 });
  const panamaRun = await page.locator(`${panel} .sync-result`).innerText();
  // MMN 7-070 is already held: it was typed in from a PDF earlier in this run.
  // A fetched notice has to merge into it rather than sit beside it.
  check('Panama files its circulars and notices',
    /Panama: 2 new, 1 updated/.test(panamaRun), panamaRun);

  const asked = (re) => panamaPages.filter((u) => re.test(u));
  check('the search term is kept — it is what finds the older circulars',
    panamaPages.every((u) => /search=MM[CN]/.test(u)), panamaPages.join(' | '));
  check('and only the uploaded files are asked for',
    panamaPages.every((u) => /media_type=application/.test(u)), panamaPages.join(' | '));
  check('a full page is followed by the next one',
    asked(/search=MMC-&?.*page=2|page=2.*search=MMC-/).length === 1, panamaPages.join(' | '));
  check('a short page ends the walk there',
    asked(/search=MMN/).length === 1, panamaPages.join(' | '));
  check('and the walk stops rather than running on past the end',
    asked(/page=4/).length === 0, panamaPages.join(' | '));
  await openBranches();
  check('what the filler uploads carry is not filed',
    !(await page.locator('.card').allInnerTexts()).some((c) => /brochure/i.test(c)));

  check('and does not duplicate one already entered by hand',
    await page.locator('.card', { hasText: 'MMN 7-070' }).count() === 1);
  await page.locator('.card', { hasText: 'MMN 7-070' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  check('an entry made by hand keeps the subject its owner gave it',
    !/MMN 7 070 Ballast water record book/i.test(await page.locator('#detailBody').innerText()),
    (await page.locator('#detailBody').innerText()).slice(0, 200));
  await closeDetail();

  await openBranches();
  const panamaCards = await page.locator('.card').allInnerTexts();
  check('a Panama circular reference is parsed',
    panamaCards.some((c) => /MMC 230/.test(c)), panamaCards.join(' | '));
  check('a hyphenated notice reference survives',
    panamaCards.some((c) => /MMN 7-070/.test(c)), panamaCards.join(' | '));
  check('uploads that are not circulars are ignored',
    !panamaCards.some((c) => /brochure/i.test(c)), panamaCards.join(' | '));
  check('Panama entries are filed under Panama',
    (await page.locator('.group-head').allTextContents()).some((h) => h.includes('Panama')));

  // Panama titles come from filenames, so they get rewritten by hand. A later
  // sync must not put the filename back.
  await page.locator('.card', { hasText: 'MMC 230' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detailEdit');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Recognised organisations acting for Panama');
  await save();
  await closeDetail();

  await page.click(`${panel} button:text-is("Panama")`);
  await page.waitForSelector('.hint:has-text("Panama: 0 new")', { timeout: 20000 });
  const panamaAgain = await page.locator(`${panel} .sync-result`).innerText();
  check('a repeat Panama sync adds nothing', /Panama: 0 new/.test(panamaAgain), panamaAgain);
  await openBranches();
  check('a title rewritten by hand is kept',
    (await page.locator('.card').allInnerTexts())
      .some((c) => /Recognised [Oo]rganisations [Aa]cting for Panama/.test(c)));

  // ---- Singapore: an index page, read for the links it lists --------------
  // MPA refuses the app outright, so the catalogue is fetched by a scheduled
  // job and served from this site. That file is what Singapore reads.
  const SG_MIRROR = {
    administration: 'Singapore',
    fetched: '2026-02-10',
    notices: [
      { title: 'PORT MARINE CIRCULAR NO. 01 OF 2026 List of active port marine circulars',
        refNo: 'PC 01/2026', docType: 'Port Marine Circular', date: '2026-01-05',
        // No file path here on purpose: a list says what exists, never what
        // this site keeps. Where the documents are is published separately.
        sourceUrl: 'https://www.mpa.gov.sg/media-centre/details/port-marine-circular-no.-01-of-2026' },
      { title: 'Shipping Circular No. 9 of 2025 Ballast water management',
        refNo: 'SC 09/2025', docType: 'Shipping Circular', date: '2025-09-09',
        sourceUrl: 'https://www.mpa.gov.sg/docs/mpalibraries/circulars-and-notices/sc25-09.pdf' },
      // Published as a page rather than a file — which is what 179 of the 497
      // MCA notices are. The mirror holds its words instead, and the phone has
      // to take them, read them and show them like anything else.
      { title: 'Port Marine Notice No. 44 of 2026 Bunkering in the western anchorage',
        refNo: 'PN 44/2026', docType: 'Port Marine Notice', date: '2026-03-02',
        sourceUrl: 'https://www.mpa.gov.sg/media-centre/details/port-marine-notice-no.-44-of-2026' }
    ]
  };
  // Served as a real file rather than stubbed: the mirror is same-origin, so
  // the service worker fetches it and route interception never sees it. The
  // suite writes it, then puts back whatever was there before.
  fs.mkdirSync(MIRROR_DIR, { recursive: true });
  fs.writeFileSync(MIRROR_FILE, JSON.stringify(SG_MIRROR));
  // What the site holds, published apart from the list. This is the only
  // thing that knows: the notice lists come from the administrations, which
  // have no idea what this site keeps a copy of.
  fs.writeFileSync(path.join(MIRROR_DIR, 'singapore-files.json'), JSON.stringify({
    administration: 'Singapore',
    urlPrefix: 'https://www.mpa.gov.sg/',
    filePrefix: 'docs/singapore/',
    held: 2, listed: 3,
    // Named so they cannot collide with a real mirrored document. They did:
    // the fixture wrote PC-01-2026.pdf, which is exactly what the mirror calls
    // Singapore's own PC 01/2026, and the cleanup then deleted the real one.
    files: {
      'media-centre/details/port-marine-circular-no.-01-of-2026': 'TEST-FIXTURE-PC-01-2026.pdf',
      'media-centre/details/port-marine-notice-no.-44-of-2026': 'TEST-FIXTURE-PN-44-2026.txt'
    }
  }));

  // Left in place behind the mirror, and it must stay behind it: trying MPA
  // first would spend data to be refused before falling back here anyway.
  const MPA_FEED = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0"><channel>
    <item>
      <title>PORT MARINE CIRCULAR NO. 01 OF 2026 List of active port marine circulars</title>
      <link>https://www.mpa.gov.sg/media-centre/details/port-marine-circular-no.-01-of-2026</link>
      <pubDate>Mon, 05 Jan 2026 09:00:00 +0800</pubDate>
    </item>
    <item>
      <title>Shipping Circular No. 9 of 2025 Ballast water management</title>
      <link>https://www.mpa.gov.sg/docs/mpalibraries/circulars-and-notices/sc25-09.pdf</link>
      <pubDate>Tue, 09 Sep 2025 09:00:00 +0800</pubDate>
    </item>
    <item>
      <title>MPA and partners sign agreement on green corridors</title>
      <link>https://www.mpa.gov.sg/media-centre/details/green-corridors</link>
      <pubDate>Wed, 01 Oct 2025 09:00:00 +0800</pubDate>
    </item>
  </channel></rss>`;
  await page.route('**/feeds/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/rss+xml', body: MPA_FEED }));
  // The endpoint behind MPA's listings. Stubbed so a refusal case cannot
  // quietly reach the real one.
  await page.route('**/api/items/**', (route) => route.abort('failed'));

  const sgOutbound = [];
  const sgWatch = (req) => {
    const url = req.url();
    if (!url.startsWith(`http://localhost:${PORT}`)) sgOutbound.push(url);
  };
  page.on('request', sgWatch);
  await page.click(`${panel} button:text-is("Singapore")`);
  await page.waitForSelector('.hint:has-text("Singapore:")', { timeout: 20000 });
  page.off('request', sgWatch);
  const sgRun = await page.locator(`${panel} .sync-result`).innerText();
  check('Singapore files what its listing names', /Singapore: 3 new/.test(sgRun), sgRun);
  // The fault this fixes: a list read from the administration knows nothing
  // about what this site holds, so without this step not one notice could ever
  // be told to fetch its document — and updating the list again would not have
  // helped, because the list was never the thing that knew.
  check('and the notices are told where their documents are',
    /2 now know where their document is/.test(sgRun), sgRun);

  await openBranches();
  const sgCards = await page.locator('.card').allInnerTexts();
  check('a spelt-out Singapore reference is parsed',
    sgCards.some((c) => /PC 01\/2026/.test(c)), sgCards.join(' | '));
  check('a reference in a filename is parsed too',
    sgCards.some((c) => /SC 09\/2025/.test(c)), sgCards.join(' | '));
  check('the date comes across', sgCards.some((c) => /2026/.test(c)), sgCards.join(' | '));
  // Reading this site rather than MPA is the whole point, so prove nothing
  // left the device for it — not the feed, not any of the three listings.
  check('Singapore is read from this site, not from MPA',
    sgOutbound.length === 0, sgOutbound.join(', '));

  // ---- All three at once, without losing sight of which did what ---------
  check('there is a button for all three together',
    await page.locator(`${panel} button:text-is("Update all three")`).count() === 1);
  await page.click(`${panel} button:text-is("Update all three")`);
  await page.waitForSelector(`${panel} .sync-result:has-text("already held")`, { timeout: 30000 });
  const allRun = await page.locator(`${panel} .sync-result`).innerText();
  check('every administration is named in the result',
    ['MCA', 'Panama', 'Singapore'].every((a) => allRun.includes(a)), allRun);
  check('and the totals are added up across them',
    /\d+ new, \d+ updated, \d+ already held/.test(allRun), allRun);
  check('nothing is duplicated by running them together',
    /^0 new/.test(allRun), allRun);

  // ---- The documents themselves -----------------------------------------
  // Served as real files, like the catalogue: same origin, so the service
  // worker fetches them and route interception never sees it.
  // Only what this suite creates is removed afterwards. library/docs now holds
  // the real mirrored catalogue — 163 MB of it — and a cleanup that deletes
  // the whole directory would take that with it every time the tests run.
  const docsRoot = path.join(ROOT, 'library', 'docs');
  const docsDir = path.join(docsRoot, 'singapore');
  const docFile = path.join(docsDir, 'TEST-FIXTURE-PC-01-2026.pdf');
  const docText = path.join(docsDir, 'TEST-FIXTURE-PN-44-2026.txt');
  const madeRoot = !fs.existsSync(docsRoot);
  const madeDir = !fs.existsSync(docsDir);
  fs.mkdirSync(docsDir, { recursive: true });
  fs.copyFileSync(FLAG_PATH, docFile);
  fs.writeFileSync(docText,
    'PN 44/2026 Port Marine Notice No. 44 of 2026\n2026-03-02\n\n'
    + 'Bunkering operations in the western anchorage are suspended during the '
    + 'dredging works. Masters are to contact the duty officer before entering '
    + 'the sunken barge exclusion zone.\n');

  const docsCleanup = () => {
    try { fs.rmSync(docFile); } catch {}
    try { fs.rmSync(docText); } catch {}
    // Only if they were not there to begin with, and only if still empty.
    if (madeDir) { try { fs.rmdirSync(docsDir); } catch {} }
    if (madeRoot) { try { fs.rmdirSync(docsRoot); } catch {} }
  };
  process.on('exit', docsCleanup);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.locator('.section-card', { hasText: 'Flag Circulars' }).click();
  await page.waitForTimeout(200);

  // ---- the circulars as a tree, shut ------------------------------------
  // Fourteen hundred notices in one list is not something anyone browses.
  // The page has just been reloaded, so nothing is open: this is what the
  // section looks like when it is first reached.
  const shutHeads = await page.locator('.group-head-btn').allInnerTexts();
  check('the flags are lines that open, not headings over a long list',
    shutHeads.length >= 3 && shutHeads.every((h) => /\+$/.test(h.trim())),
    shutHeads.join(' | '));
  check('and nothing is unfolded until it is asked for',
    (await page.locator('.card').count()) === 0,
    String(await page.locator('.card').count()));
  check('each says how many it holds',
    shutHeads.some((h) => /MCA[\s\S]*\d/.test(h)), shutHeads.join(' | '));

  await page.locator('.group-head-btn', { hasText: 'MCA' }).first().click();
  await page.waitForTimeout(250);
  const mcaOpen = await page.locator('.group-head-btn.depth-2').allInnerTexts();
  check('opening a flag shows its classes of notice, not its notices',
    mcaOpen.some((h) => /MGN/.test(h)) && (await page.locator('.card').count()) === 0,
    mcaOpen.join(' | '));
  check('and only that flag opened',
    (await page.locator('.group-head-btn[aria-expanded="true"]').count()) === 1);

  await page.locator('.group-head-btn.depth-2', { hasText: 'MGN' }).first().click();
  await page.waitForTimeout(250);
  const mgnCards = await page.locator('.card').allInnerTexts();
  check('opening a class shows the notices in it',
    mgnCards.length > 0 && mgnCards.every((c) => /MGN/.test(c)), mgnCards.join(' | '));

  // Two levels down and back: coming out of a circular must not fold the
  // list up again, or every read costs two taps to get back to where you were.
  await page.locator('.card').first().click();
  await page.waitForSelector('#detail:not([hidden])');
  await closeDetail();
  await page.waitForTimeout(250);
  check('and reading one and coming back leaves the list where it was',
    (await page.locator('.card').count()) === mgnCards.length,
    String(await page.locator('.card').count()));

  // A pill has already narrowed the list to one class. Making the reader open
  // the branches again to see the few left would be asking twice.
  await page.locator('.scope-btn', { hasText: 'MSN' }).first().click();
  await page.waitForTimeout(300);
  const filtered = await page.locator('.card').allInnerTexts();
  check('filtering by a class shows them without opening anything',
    filtered.length > 0 && filtered.every((c) => /MSN/.test(c)), filtered.join(' | '));
  await page.locator('.scope-btn', { hasText: 'All' }).first().click();
  await page.waitForTimeout(300);

  await openTools();
  await page.waitForTimeout(300);

  // ---- the circulars first, the buttons folded away --------------------
  // Four panels and about twenty buttons used to stand between the top of this
  // section and the first circular. What the section is for is the circulars.
  // Folded again first: it stays open once opened, and an earlier part of this
  // run opened it. Asserting the default here without closing it would have
  // been asserting whatever the previous test left behind.
  if ((await page.locator('.tools-head').getAttribute('aria-expanded')) === 'true') {
    await page.locator('.tools-head').click();
    await page.waitForTimeout(250);
  }
  // The branches of the tree are buttons too, and they belong above the
  // circulars -- they are how you reach them. What is being counted is what
  // stands in the way.
  await openBranches();
  const folded = await page.evaluate(() => {
    const head = document.querySelector('.tools-head');
    const firstCard = document.querySelector('.card');
    const body = document.querySelector('.tools-body');
    return {
      hasLine: Boolean(head),
      open: head?.getAttribute('aria-expanded'),
      bodyShown: Boolean(body),
      buttonsAboveTheFirstCard: firstCard
        ? [...document.querySelectorAll('.body button:not(.group-head-btn)')]
          .filter((b) => b.getBoundingClientRect().top < firstCard.getBoundingClientRect().top).length
        : -1
    };
  });
  check('the section opens on one line, not four panels', folded.hasLine && folded.bodyShown === false,
    JSON.stringify(folded));
  check('and at most that one button stands above the first circular',
    folded.buttonsAboveTheFirstCard === 1, JSON.stringify(folded));

  await openTools();
  const unfolded = await page.evaluate(() => ({
    open: document.querySelector('.tools-head')?.getAttribute('aria-expanded'),
    panels: document.querySelectorAll('.tools-body .panel').length,
    // Opened, it must not be clipped: the body is a flex column and a flex
    // item shrinks before its container scrolls, which cut it to a third.
    clipped: document.querySelector('.tools-panel').getBoundingClientRect().height
      < document.querySelector('.tools-body').getBoundingClientRect().height
  }));
  check('opening it brings every panel back', unfolded.open === 'true' && unfolded.panels >= 3,
    JSON.stringify(unfolded));
  check('and none of it is clipped away', !unfolded.clipped, JSON.stringify(unfolded));

  const docPanel = '.doc-panel';
  check('the documents are offered separately from the list',
    await page.locator(docPanel).count() === 1);
  const perFlag = await page.locator(`${docPanel} .fieldrow button`).allInnerTexts();
  check('each flag says how many it is missing',
    perFlag.some((t) => /SINGAPORE \(2\)/i.test(t)), perFlag.join(' | '));
  check('only documents the site actually holds are counted',
    !perFlag.some((t) => /MCA \(|PANAMA \(/i.test(t)), perFlag.join(' | '));
  check('and there is one for all of them',
    await page.locator(`${docPanel} button:has-text("Fetch all")`).count() === 1);

  const docOutbound = [];
  const docWatch = (req) => {
    if (!req.url().startsWith(`http://localhost:${PORT}`)) docOutbound.push(req.url());
  };
  page.on('request', docWatch);
  await page.locator(`${docPanel} .fieldrow button`, { hasText: /Singapore/i }).click();
  await page.waitForSelector(`${panel} .sync-result:has-text("fetched")`, { timeout: 60000 });
  page.off('request', docWatch);

  const docRun = await page.locator(`${panel} .sync-result`).innerText();
  check('the documents that are held get fetched', /2 documents fetched/.test(docRun), docRun);
  check('nothing is fetched from the administration itself',
    !docOutbound.some((u) => /mpa\.gov\.sg/.test(u)), docOutbound.join(', '));

  await openBranches();
  await page.locator('.card', { hasText: 'PC 01/2026' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const withDoc = await page.locator('#detailBody').innerText();
  check('the document is attached to its notice', /\.pdf/i.test(withDoc), withDoc.slice(0, 200));
  // The fixture's own file, not a real mirrored one that happens to share a name.
  check('and it is the fixture\u2019s own file',
    /TEST-FIXTURE/.test(withDoc), withDoc.slice(0, 240).replace(/\n/g, ' / '));
  await closeDetail();

  // The text is the point: a document held but unread cannot be found again.
  await page.fill('#search', 'Panama Maritime Authority');
  await page.waitForTimeout(900);
  check('its contents joined the search',
    (await page.locator('.card').count()) > 0,
    String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  // A notice its administration publishes as a page, not a file. There is no
  // PDF to hold, so holding its words is the only way it reaches the phone.
  await openBranches();
  await page.locator('.card', { hasText: 'PN 44/2026' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const asText = await page.locator('#detailBody').innerText();
  check('a notice published as a page arrives as its words',
    /\.txt/i.test(asText), asText.slice(0, 200).replace(/\n/g, ' / '));
  check('and is indexed without needing anything read',
    /1 pages indexed/i.test(asText), asText.slice(0, 300).replace(/\n/g, ' / '));
  check('with no reader offered, there being no picture in it',
    !/Read the scan|Read the whole document|Read the pictures|Try reading the text again/i.test(asText),
    asText.slice(0, 400).replace(/\n/g, ' / '));

  // Readable, not merely searchable.
  await page.click('#detailBody button:has-text("Open")');
  await page.waitForSelector('#viewer:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(600);
  const shown = await page.locator('#viewerBody').innerText();
  check('and it can actually be read on the phone',
    /sunken barge exclusion zone/i.test(shown), shown.slice(0, 200).replace(/\n/g, ' / '));
  check('rather than refused as a file that cannot be shown',
    !/Cannot show this file/i.test(shown), shown.slice(0, 160));
  await page.click('#viewerClose');
  await page.waitForTimeout(300);
  await closeDetail();

  await page.fill('#search', 'dredging works');
  await page.waitForTimeout(900);
  check('its words are searchable like any document',
    (await page.locator('.card').count()) > 0, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  // A notice with nothing held must say why rather than just ending at a link.
  // "Where is the circular?" is the right question to ask of an entry that
  // stops at Open link with no explanation.
  await openBranches();
  await page.locator('.card', { hasText: 'SC 09/2025' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const nothingHeld = await page.locator('#detailBody').innerText();
  check('a notice with no document says so',
    /No document held/i.test(nothingHeld), nothingHeld.slice(0, 300).replace(/\n/g, ' / '));
  // Singapore used to get a line of its own saying MPA published pages rather
  // than files. It never did, and all 552 with a document are held now.
  check('and is not told Singapore publishes pages rather than files',
    !/publishes its circulars as pages/i.test(nothingHeld),
    nothingHeld.slice(0, 300).replace(/\n/g, ' / '));
  check('and says it needs a connection to reach it',
    /needs a connection/i.test(nothingHeld), nothingHeld.slice(0, 400).replace(/\n/g, ' / '));
  await closeDetail();

  // One that does hold its document must not carry the notice.
  await openBranches();
  await page.locator('.card', { hasText: 'PC 01/2026' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  check('a notice that has its document does not',
    !/No document held/i.test(await page.locator('#detailBody').innerText()),
    (await page.locator('#detailBody').innerText()).slice(0, 200).replace(/\n/g, ' / '));
  await closeDetail();

  // Only the ones whose documents are actually held drop off the count. The
  // other has nothing to fetch, so it stays outstanding — accurately.
  check('with nothing left outstanding, the panel says so and offers nothing',
    /Every notice whose document is held has it/.test(await page.locator(docPanel).innerText()),
    await page.locator(docPanel).innerText());

  // ---- Ordered by number, not by date ------------------------------------
  // A shelf of notices is looked along for the one you want. MGN 656 sitting
  // above MGN 652 above MGN 718 above MGN 381 is no order at all.
  const flagOrder = await page.evaluate(async () => {
    const [{ TYPES }, store] = await Promise.all([
      import('./js/schema.js'), import('./js/store.js')
    ]);
    return store.itemsOfType('flag')
      .filter((i) => i.data.flagState === 'Singapore')
      .map((i) => i.data)
      .sort(TYPES.flag.sort)
      .map((d) => d.refNo);
  });
  check('notices are ordered by their number',
    flagOrder.join(' | ').includes('PC 01/2026'), flagOrder.join(' | '));

  // The ordering itself, on the shapes that actually caused this. Highest
  // number first, and the number compared as a number: as text, MGN 1905
  // lands between MGN 100 and MGN 370 because '1' sorts before '3'.
  const sorted = await page.evaluate(async () => {
    const { TYPES } = await import('./js/schema.js');
    return ['MGN 656', 'MGN 652 (M+F)', 'MGN 718 (M+F)', 'MGN 381', 'MGN 1905', 'MGN 100']
      .map((refNo) => ({ refNo, docType: 'MGN (Marine Guidance Note)' }))
      .sort(TYPES.flag.sort)
      .map((r) => r.refNo);
  });
  check('and by the number as a number, highest first',
    sorted.join(' ') === 'MGN 1905 MGN 718 (M+F) MGN 656 MGN 652 (M+F) MGN 381 MGN 100',
    sorted.join(' '));

  // The types still stay together rather than interleaving by number.
  const mixed = await page.evaluate(async () => {
    const { TYPES } = await import('./js/schema.js');
    return [
      { refNo: 'MSN 1905 (M+F)', docType: 'MSN (Merchant Shipping Notice)' },
      { refNo: 'MGN 100', docType: 'MGN (Marine Guidance Note)' },
      { refNo: 'MIN 738 (M+F)', docType: 'MIN (Marine Information Note)' },
      { refNo: 'MGN 718 (M+F)', docType: 'MGN (Marine Guidance Note)' }
    ].sort(TYPES.flag.sort).map((r) => r.refNo);
  });
  check('with each class kept together',
    mixed.join(' ') === 'MGN 718 (M+F) MGN 100 MIN 738 (M+F) MSN 1905 (M+F)', mixed.join(' '));

  // ---- A notice the administration has stopped listing -------------------
  // The sync never deletes: an entry may hold your own notes and files. But a
  // withdrawn notice sitting among the current ones, looking exactly like
  // them, is the thing this app exists to prevent.
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.saveItem({
      type: 'flag',
      data: { title: 'Shipping Circular No. 3 of 2019 Withdrawn practice',
              flagState: 'Singapore', refNo: 'SC 03/2019',
              docType: 'Shipping Circular',
              sourceUrl: 'https://www.mpa.gov.sg/media-centre/details/shipping-circular-no.-03-of-2019',
              notes: 'My own note on this one.', attachments: [] }
    });
    // Typed in by hand, with no source: never touched by any of this.
    await store.saveItem({
      type: 'flag',
      data: { title: 'Master\u2019s own standing order', flagState: 'Singapore',
              refNo: 'OWN-1', attachments: [] }
    });
  });
  await page.waitForTimeout(400);

  await page.click(`${panel} button:text-is("Singapore")`);
  await page.waitForSelector('.hint:has-text("Singapore:")', { timeout: 20000 });
  await page.waitForTimeout(600);
  const withdrawnRun = await page.locator(`${panel} .sync-result`).innerText();
  check('a notice no longer on the list is reported',
    /1 no longer on the administration's list/.test(withdrawnRun), withdrawnRun);

  await openBranches();
  const withdrawnCard = page.locator('.card', { hasText: 'SC 03/2019' }).first();
  check('and marked on the card',
    /withdrawn/i.test(await withdrawnCard.innerText()),
    (await withdrawnCard.innerText()).replace(/\n/g, ' / '));

  await withdrawnCard.click();
  await page.waitForSelector('#detail:not([hidden])');
  const withdrawnDetail = await page.locator('#detailBody').innerText();
  check('the entry says what that means',
    /No longer on the administration/i.test(withdrawnDetail),
    withdrawnDetail.slice(0, 260).replace(/\n/g, ' / '));
  check('and it is kept, with what was written on it',
    /My own note on this one/.test(withdrawnDetail),
    withdrawnDetail.slice(0, 300).replace(/\n/g, ' / '));
  await closeDetail();

  // An entry that was never synced has no business being judged by a list.
  const ownCard = page.locator('.card', { hasText: 'Standing Order' }).first();
  check('an entry of your own is never marked',
    !/withdrawn/i.test(await ownCard.innerText()),
    (await ownCard.innerText()).replace(/\n/g, ' / '));

  // A notice still on the list must not be marked.
  check('and a notice still listed is not marked',
    !/withdrawn/i.test(await page.locator('.card', { hasText: 'PC 01/2026' }).first().innerText()),
    (await page.locator('.card', { hasText: 'PC 01/2026' }).first().innerText()).replace(/\n/g, ' / '));

  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    for (const ref of ['SC 03/2019', 'OWN-1']) {
      const made = store.itemsOfType('flag').find((i) => i.data.refNo === ref);
      if (made) await store.deleteItem(made.id);
    }
  });
  await page.waitForTimeout(300);

  // ---- The case that actually bit ---------------------------------------
  // A notice filed before its document existed carries no file path, so the
  // app cannot find a document the site is holding — and from the phone that
  // is indistinguishable from the site holding nothing. The note must send the
  // reader to update the list rather than assert what the administration
  // publishes, which the app has no way to check and which is wrong for every
  // notice filed before the mirror ran.
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.saveItem({
      type: 'flag',
      data: { title: 'MGN 718 (M+F): 2026 IMO amendment to PSSR', flagState: 'MCA',
              docType: 'MGN (Marine Guidance Note)', refNo: 'MGN 718 (M+F)',
              fileLink: 'https://www.gov.uk/government/publications/mgn-718-mf-2026-imo-amendment-to-pssr',
              attachments: [] }
    });
  });
  await page.waitForTimeout(400);
  await openBranches();
  await page.locator('.card', { hasText: 'MGN 718' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const staleNote = await page.locator('#detailBody').innerText();
  check('a notice the site holds nothing for says so plainly',
    /Nothing is held on the site for this one/i.test(staleNote),
    staleNote.slice(0, 400).replace(/\n/g, ' / '));
  await closeDetail();
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const made = store.itemsOfType('flag').find((i) => /MGN 718/.test(i.data.refNo || ''));
    if (made) await store.deleteItem(made.id);
  });
  await page.waitForTimeout(300);

  docsCleanup();

  // ---- A source that refuses the read has to say so, not fail silently ----
  // An empty mirror stands for one that has not run yet, or a week the job
  // read nothing. Emptying the file rather than deleting it keeps the service
  // worker from answering out of its cache.
  fs.writeFileSync(MIRROR_FILE, JSON.stringify({ administration: 'Singapore', notices: [] }));
  await page.unroute('**/feeds/**');
  await page.route('**/feeds/**', (route) => route.abort('failed'));
  await page.route('**/media-centre**', (route) => route.abort('failed'));
  await page.click(`${panel} button:text-is("Singapore")`);
  await page.waitForSelector('.hint:has-text("could not be read")', { timeout: 20000 });
  const refused = await page.locator(`${panel} .sync-result`).innerText();
  check('a blocked administration reports what happened',
    /Singapore could not be read/.test(refused), refused);
  check('and says a connection is needed', /needs a connection/.test(refused), refused);
  check('naming every route it tried, this site included',
    /This site/.test(refused) && /MPA feed/.test(refused) && /Media centre/.test(refused), refused);
  check('MPA own endpoint among them',
    /MPA Shipping Circulars/.test(refused), refused);

  // One class failing while the other answers still files what came back, and
  // says which one it could not read.
  await page.unroute('**/wp-json/wp/v2/media**');
  await page.route('**/wp-json/wp/v2/media**', (route) => {
    if (/MMC/.test(new URL(route.request().url()).searchParams.get('search') || '')) {
      return route.abort('failed');
    }
    panamaStub(route);
  });
  await page.route('**/circulars/**', (route) => route.abort('failed'));
  await page.click(`${panel} button:text-is("Panama")`);
  await page.waitForSelector('.hint:has-text("Panama:")', { timeout: 20000 });
  const partial = await page.locator(`${panel} .sync-result`).innerText();
  check('a partial result is still filed', /Panama: 0 new/.test(partial), partial);
  check('and names the class it could not read',
    /Could not read: Merchant Marine Circulars/.test(partial), partial);
  check('naming both hosts it tried for it',
    /Registry API/.test(partial) && /Authority API/.test(partial), partial);

  await page.unroute('**/api/content/government/collections/**');
  await page.unroute('**/wp-json/wp/v2/media**');
  await page.unroute('**/media-centre**');
  await page.unroute('**/feeds/**');
  await page.unroute('**/circulars/**');
  await page.unroute('**/api/items/**');
  restoreMirror();
  blockingOnPurpose = false;

  // Filed where a Synergy circular is actually filed: under Circulars. The
  // four kinds were put on the Synergy section by mistake, so on the dropdown
  // in front of the user nothing had changed and nothing was ever detected —
  // a circular has no docType for the detection to fill.
  console.log('\nA fleet alert filling itself in');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card:has(.section-name:text-is("Circulars"))').click();
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await page.setInputFiles('#filePicker', ALERT_PATH);
  await page.waitForSelector('#editorBody .panel:has-text("Filled in from the PDF")', { timeout: 25000 });

  const alert = await page.evaluate(() => {
    const read = (k) => document.querySelector(`#editorBody [data-field="${k}"]`)?.value || '';
    return { title: read('title'), refNo: read('refNo'), date: read('date'), category: read('category') };
  });
  // The heading that is useless as a title is exactly what names the type.
  check('the kind of document fills in the type', alert.category === 'Fleet Alert', JSON.stringify(alert));
  check('the subject is taken as the title, not the kind of document',
    /emergency fire pump/i.test(alert.title), JSON.stringify(alert));
  check('and the kind of document is not offered as the title',
    !/^fleet alert$/i.test(alert.title.trim()), alert.title);
  check('a wrapped subject line is kept whole',
    /before arrival/i.test(alert.title), alert.title);
  check('the reference comes off its labelled line',
    /FA\s*05\/2026/i.test(alert.refNo), JSON.stringify(alert));
  check('the date is read too', alert.date === '2026-08-14', JSON.stringify(alert));
  const offered = await page.locator('#editorBody [data-field="category"] option').allInnerTexts();
  check('the circular categories are the ones the fleet issues',
    ['Manager\u2019s Instructions', 'QHSE', 'Fleet Alert', 'Safety Alert']
      .every((t) => offered.includes(t)), offered.join(' | '));
  check('and the generic list it replaced is gone',
    !offered.some((t) => /Technical|Crewing|HSEQ|Security|Environmental|Commercial/.test(t)),
    offered.join(' | '));
  await page.click('#editorCancel');
  await page.waitForTimeout(200);

  // The number as the fleet writes it: bare, spaced around the slash.
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await page.setInputFiles('#filePicker', BARE_ALERT_PATH);
  await page.waitForSelector('#editorBody .panel:has-text("Filled in from the PDF")', { timeout: 25000 });
  const bare = await page.evaluate(() => {
    const read = (k) => document.querySelector(`#editorBody [data-field="${k}"]`)?.value || '';
    return { title: read('title'), refNo: read('refNo'), category: read('category') };
  });
  check('an unlabelled 045 / 2026 is read as the number',
    bare.refNo === '045/2026', JSON.stringify(bare));
  check('and it is still typed as a fleet alert',
    bare.category === 'Fleet Alert', JSON.stringify(bare));
  check('with the subject as the title',
    /enclosed space entry/i.test(bare.title), JSON.stringify(bare));
  await page.click('#editorCancel');
  await page.waitForTimeout(200);

  // The number written into the subject, not under the heading.
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await page.setInputFiles('#filePicker', SUBJECT_ALERT_PATH);
  await page.waitForSelector('#editorBody .panel:has-text("Filled in from the PDF")', { timeout: 25000 });
  const inSubject = await page.evaluate(() => {
    const read = (k) => document.querySelector(`#editorBody [data-field="${k}"]`)?.value || '';
    return { title: read('title'), refNo: read('refNo'), category: read('category') };
  });
  check('a number written into the subject is found',
    inSubject.refNo === '112/2026', JSON.stringify(inSubject));
  check('and is not left duplicated in the title',
    !/112/.test(inSubject.title), JSON.stringify(inSubject));
  check('the subject keeps what it is actually about',
    /mooring winch brake/i.test(inSubject.title), JSON.stringify(inSubject));
  check('the type still follows the heading',
    inSubject.category === 'Safety Alert', JSON.stringify(inSubject));
  await page.click('#editorCancel');
  await page.waitForTimeout(200);

  // No subject line: the filename is all there is to go on.
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await page.setInputFiles('#filePicker', NAMED_ALERT_PATH);
  await page.waitForSelector('#editorBody .panel:has-text("Filled in from the PDF")', { timeout: 25000 });
  const fromName = await page.evaluate(() => {
    const read = (k) => document.querySelector(`#editorBody [data-field="${k}"]`)?.value || '';
    return { title: read('title'), refNo: read('refNo'), category: read('category') };
  });
  check('the filename stands in when there is no subject line',
    /gangway net/i.test(fromName.title), JSON.stringify(fromName));
  check('and its number is read from there too',
    fromName.refNo === '077/2026', JSON.stringify(fromName));
  await page.click('#editorCancel');
  await page.waitForTimeout(200);

  // ── words that were drawn rather than typed ──────────────────────────────
  console.log('\nPictures and diagrams');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card', { hasText: 'Manuals' }).click();
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await page.setInputFiles('#filePicker', DIAGRAM_PATH);
  await page.waitForSelector('#editorBody .attach', { timeout: 25000 });
  await set('title', 'Hydraulic System Overview');
  await save();

  await page.locator('.card', { hasText: 'Hydraulic System Overview' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const diagramDetail = await page.locator('#detailBody').innerText();
  check('a PDF with real text is indexed as usual',
    /pages indexed/i.test(diagramDetail), diagramDetail.replace(/\n/g, ' / ').slice(0, 160));
  check('and is offered the reading of its pictures',
    /Read the pictures and diagrams too/i.test(diagramDetail),
    diagramDetail.replace(/\n/g, ' / ').slice(0, 300));
  check('with nothing yet claiming its pictures have been read',
    !/Pictures read/i.test(diagramDetail),
    diagramDetail.replace(/\n/g, ' / ').slice(0, 300));
  check('a PDF whose text was extracted says searchable on its card',
    /^searchable$/i.test((await cardPill('Hydraulic System Overview')).trim()),
    await cardPill('Hydraulic System Overview'));
  await closeDetail();

  // The prose is findable from the start; the label on the drawing is not,
  // because it is pixels.
  await page.fill('#search', 'deck machinery');
  await page.waitForTimeout(900);
  check('its typed text is searchable straight away',
    await page.locator('.card').count() >= 1, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  await page.fill('#search', 'bilge');
  await page.waitForTimeout(900);
  check('but a word printed on the diagram is not found yet',
    await page.locator('.card').count() === 0, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  await page.locator('.card', { hasText: 'Hydraulic System Overview' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detailBody button:has-text("Read the pictures and diagrams too")');
  await page.locator('.toast', { hasText: /Read the pictures on|Stopped at|Could not/ })
    .waitFor({ timeout: 240000 });
  const pictureRead = await page.locator('.toast', { hasText: /Read the pictures on|Stopped at|Could not/ }).innerText();
  check('the pictures are read', /Read the pictures on all/.test(pictureRead), pictureRead);
  await page.waitForTimeout(800);
  // The button simply stopped being offered before this. Absence is not an
  // answer to "have the pictures been read?".
  check('and the document says so afterwards rather than going quiet',
    /Pictures read/i.test(await page.locator('#detailBody').innerText()),
    (await page.locator('#detailBody').innerText()).replace(/\n/g, ' / ').slice(0, 300));
  await closeDetail();

  await page.fill('#search', 'bilge');
  await page.waitForTimeout(900);
  check('now the word on the diagram finds the document',
    await page.locator('.card').count() >= 1, String(await page.locator('.card').count()));
  const pictureHit = await page.locator('.snippet-page').first().innerText();
  check('and the result says it came from a picture',
    /in a picture/i.test(pictureHit), pictureHit);
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  // Reading the pictures must not cost the text that was already there.
  await page.fill('#search', 'deck machinery');
  await page.waitForTimeout(900);
  check('the document text still matches afterwards',
    await page.locator('.card').count() >= 1, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  // Reading the whole page reads the prose too, but the prose is already
  // indexed — counting both would report every ordinary word twice.
  const doubleCounted = await page.evaluate(async () => {
    const [{ search }, store] = await Promise.all([
      import('./js/search.js'), import('./js/store.js')
    ]);
    const texts = await store.loadTexts();
    const hits = search('hydraulic', store.allItems(), texts);
    const found = hits.find((h) => /Hydraulic System Overview/.test(h.item.data.title));
    return found ? found.snippets.filter((s) => s.inPicture).length : -1;
  });
  check('a word already in the text is not counted again from the picture',
    doubleCounted === 0, `picture snippets for a word in the text: ${doubleCounted}`);

  // A photograph attached on its own.
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Emergency Generator');
  await page.setInputFiles('#filePicker', PHOTO_PATH);
  await page.waitForTimeout(1200);
  await save();
  await page.locator('.card', { hasText: 'Emergency Generator' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const photoDetail = await page.locator('#detailBody').innerText();
  check('a photograph is offered its own reading',
    /Read the words in this picture/i.test(photoDetail),
    photoDetail.replace(/\n/g, ' / ').slice(0, 300));
  check('and is not offered the PDF readers',
    !/Read the scan|Try reading the text again|whole document/i.test(photoDetail),
    photoDetail.replace(/\n/g, ' / ').slice(0, 300));

  await page.click('#detailBody button:has-text("Read the words in this picture")');
  await page.locator('.toast', { hasText: /searchable now|No words|Could not/ }).waitFor({ timeout: 180000 });
  const photoSaid = await page.locator('.toast', { hasText: /searchable now|No words|Could not/ }).innerText();
  check('the photograph is read', /searchable now/.test(photoSaid), photoSaid);
  await page.waitForTimeout(800);
  await closeDetail();

  await page.fill('#search', 'nameplate');
  await page.waitForTimeout(900);
  check('and the words in it are findable',
    await page.locator('.card').count() >= 1, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  console.log('\nOther sections');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card:has(.section-name:text-is("Circulars"))').click();
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Revised bunkering procedure');
  await set('refNo', 'FC-2026-014');
  await set('date', '2026-05-12');
  await set('issuer', 'Fleet Technical');
  await set('relatedTo', 'Bunkering operations');
  await pick('category', 'QHSE');
  await save();
  check('saves a circular', (await page.locator('.card').count()) === 1);

  // The card as it is read on the ship: what kind of circular and its number
  // first, then the subject, then the date and who sent it.
  const circularCard = await page.locator('.card').first();
  check('the kind and number head the card',
    /QHSE\s+\u2014\s+FC-2026-014/i.test(await circularCard.locator('.card-kind').innerText()),
    await circularCard.locator('.card-kind').innerText());
  check('the subject is the title under it',
    /Revised Bunkering Procedure/i.test(await circularCard.locator('.card-title').innerText()),
    await circularCard.locator('.card-title').innerText());
  const cardCells = (await circularCard.locator('.dcell').allInnerTexts()).join(' | ').replace(/\n/g, ' ');
  check('the date and what it relates to are the row beneath',
    /Date/i.test(cardCells) && /Related to/i.test(cardCells)
      && /Bunkering Operations/i.test(cardCells), cardCells);
  // On a list of circulars the issuer is nearly always the same name, so it
  // takes a line and tells you nothing. It belongs on the entry, not the card.
  check('who issued it is not on the card',
    !/Issued by|Fleet Technical/i.test(cardCells), cardCells);
  check('and the number is not repeated underneath',
    (await circularCard.locator('.card-sub').count()) === 0,
    String(await circularCard.locator('.card-sub').count()));

  // Off the card, but not lost: it is still on the entry itself.
  await circularCard.click();
  await page.waitForSelector('#detail:not([hidden])');
  const circularDetail = await page.locator('#detailBody').innerText();
  check('but it is still there inside the entry',
    /Issued by/i.test(circularDetail) && /Fleet Technical/i.test(circularDetail),
    circularDetail.replace(/\n/g, ' / ').slice(0, 260));
  check('and so is what it relates to',
    /Related to/i.test(circularDetail) && /Bunkering Operations/i.test(circularDetail),
    circularDetail.replace(/\n/g, ' / ').slice(0, 260));
  await closeDetail();

  // Circulars filed before the list changed are the ones already on the
  // phone, so replacing the list must not strand them. The stored value is
  // put back as an option and stays selected, and the filter chips are built
  // from the entries rather than from the list, so it is still findable.
  await page.evaluate(async () => {
    // The module is already loaded, so this is the same live store the app is
    // using — not a second copy with its own state.
    const store = await import('./js/store.js');
    await store.saveItem({
      type: 'circular',
      data: { title: 'Discontinuation of Shipconrep', issuer: 'ICS',
              category: 'Commercial', date: '2026-08-21' }
    });
  });
  await page.waitForTimeout(400);
  await page.locator('.card', { hasText: 'Discontinuation of Shipconrep' }).click();
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detailEdit');
  await page.waitForSelector('#editor:not([hidden])');
  const keptCategory = await page.evaluate(() =>
    document.querySelector('#editorBody [data-field="category"]').value);
  check('a circular filed under an old category keeps it',
    keptCategory === 'Commercial', keptCategory);
  await page.click('#editorCancel');
  await page.waitForTimeout(200);
  await closeDetail();
  await page.waitForTimeout(200);
  const keptChips = await page.locator('#scope .scope-btn').allInnerTexts();
  check('and is still one of the filters',
    keptChips.includes('Commercial'), keptChips.join(' | '));

  await page.click('#backBtn');
  await page.locator('.section-card', { hasText: 'Synergy' }).click();
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Shipboard Safety Management Manual');
  await pick('docType', 'SMS Manual');
  await set('refNo', 'SMS-04');
  await set('revision', 'Rev 7');
  await save();
  check('saves a Synergy document', (await page.locator('.card').count()) === 1);

  // A controlled document is only trustworthy while its revision is verified.
  const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const firstCard = await page.locator('.card').first().innerText();
  check('an unchecked document is flagged as unverified',
    /unverified/i.test(firstCard), firstCard.replace(/\n/g, ' / '));

  await page.locator('.card').first().click();
  await page.waitForSelector('#detail:not([hidden])');
  check('the detail view explains what to do about it',
    /confirm against the company system/i.test(await page.locator('#detailBody').innerText()));
  await page.click('#detailEdit');
  await page.waitForSelector('#editor:not([hidden])');
  await set('revisionChecked', iso(-200));
  await save();
  await closeDetail();
  check('a check older than 90 days asks to be redone',
    /check/i.test(await page.locator('.card').first().innerText()));

  await page.locator('.card').first().click();
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detailEdit');
  await page.waitForSelector('#editor:not([hidden])');
  await set('revisionChecked', iso(-10));
  await save();
  await closeDetail();
  const fresh = await page.locator('.card').first().innerText();
  check('a recent check reads as current', /current/i.test(fresh), fresh.replace(/\n/g, ' / '));
  check('and reports how long ago', /10 days ago/i.test(fresh), fresh.replace(/\n/g, ' / '));

  await page.click('#backBtn');
  await page.waitForTimeout(200);
  const synergyCard = await page.locator('.section-card', { hasText: 'Synergy' }).innerText();
  check('the sections screen does not nag once everything is current',
    !/to check/i.test(synergyCard), synergyCard.replace(/\n/g, ' / '));
  await page.locator('.section-card', { hasText: 'Synergy' }).click();
  await page.waitForTimeout(200);

  console.log('\nReading a scan');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card', { hasText: 'Manuals' }).click();
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'L-001 Operational Manual');
  await page.setInputFiles('#filePicker', SCAN_PATH);
  await page.waitForTimeout(2500);
  await save();

  check('a scan says on its card that it cannot be searched',
    /not searchable/i.test(await cardPill('L-001 Operational Manual')),
    await cardPill('L-001 Operational Manual'));

  await page.locator('.card', { hasText: 'L-001 Operational Manual' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const asScan = await page.locator('#detailBody').innerText();
  check('a scan is named as one rather than left unexplained',
    /no text layer|scan/i.test(asScan), asScan.slice(0, 200).replace(/\n/g, ' / '));
  check('and reading it is offered',
    await page.locator('#detailBody button:has-text("Read the scan")').count() === 1);

  check('and it says it reads the opening pages, not just one',
    /first 3 pages/i.test(await page.locator('#detailBody').innerText()),
    (await page.locator('#detailBody').innerText()).slice(0, 300));
  await page.click('#detailBody button:has-text("Read the scan")');
  // The engine is megabytes and the page is a picture: this is not quick.
  await page.locator('.toast', { hasText: /Read the page|could not/ }).waitFor({ timeout: 180000 });
  const readSaid = await page.locator('.toast', { hasText: /Read the page|could not/ }).innerText();
  check('the scan is read', /Read the page/.test(readSaid), readSaid);
  await page.waitForTimeout(800);

  const afterRead = await page.locator('#detailBody').innerText();
  check('and its words are searchable now',
    !/no text layer/i.test(afterRead), afterRead.slice(0, 200).replace(/\n/g, ' / '));
  await closeDetail();

  // Three pages of four. Calling that searchable would be a lie the reader
  // only finds out about when the thing they are looking for is not found.
  check('a scan read part way says so rather than claiming to be searchable',
    /part read/i.test(await cardPill('L-001 Operational Manual')),
    await cardPill('L-001 Operational Manual'));

  // The point of reading it: findable by what is printed on the page. This
  // phrase is on page two, behind a cover sheet — which one page would miss.
  await page.fill('#search', 'mooring rope');
  await page.waitForTimeout(900);
  check('a phrase behind the cover sheet finds it',
    await page.locator('.card').count() >= 1, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  // Page four is past the opening read, so it is the proof that the whole
  // document read did something the quick one could not.
  await page.fill('#search', 'chartroom cabinet');
  await page.waitForTimeout(900);
  check('a phrase past the opening pages is not found yet',
    await page.locator('.card').count() === 0, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  await page.locator('.card', { hasText: 'L-001 Operational Manual' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  // Wait for the button rather than reading the pane while it is still the
  // pane from before the opening read was stored. Matched without regard to
  // case: the button is styled uppercase, and innerText reports what is on
  // the screen rather than what is in the markup.
  const rest = page.locator('#detailBody button:has-text("Read the rest")');
  await rest.waitFor({ timeout: 15000 });
  check('reading the rest is offered, from where it left off',
    /Read the rest — from page 4/i.test(await rest.innerText()), await rest.innerText());

  await rest.click();
  await page.locator('.toast', { hasText: /Read all|Stopped at|Could not/ }).waitFor({ timeout: 240000 });
  const whole = await page.locator('.toast', { hasText: /Read all|Stopped at|Could not/ }).innerText();
  check('the whole document is read', /Read all 4 pages/.test(whole), whole);
  await page.waitForTimeout(800);
  await closeDetail();

  check('and once every page is read the card says it is searchable',
    /^searchable$/i.test((await cardPill('L-001 Operational Manual')).trim()),
    await cardPill('L-001 Operational Manual'));

  await page.fill('#search', 'chartroom cabinet');
  await page.waitForTimeout(900);
  check('and now the last page is findable too',
    await page.locator('.card').count() >= 1, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  // What was read earlier must survive the later read rather than be replaced.
  await page.fill('#search', 'mooring rope');
  await page.waitForTimeout(900);
  check('the opening pages are still there afterwards',
    await page.locator('.card').count() >= 1, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  console.log('\nImporting a stack at once');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card', { hasText: 'Synergy' }).click();
  await page.waitForTimeout(200);
  const before = await page.locator('.card').count();

  check('every section offers an import', await page.locator('.import-panel').count() === 1);
  await page.setInputFiles('#importPicker', [ALERT_PATH, SUBJECT_ALERT_PATH, NAMED_ALERT_PATH]);
  // Waited for by its words, not merely by being a toast: an older one is
  // still on screen, and matching that reads the result before it exists.
  const done = page.locator('.toast', { hasText: 'imported' });
  await done.waitFor({ timeout: 60000 });
  const said = await done.innerText();
  check('it says how many came in', /3 imported/.test(said), said);
  await page.waitForTimeout(600);

  const now = await page.locator('.card').allInnerTexts();
  check('one entry per file', now.length === before + 3, `${before} then ${now.length}`);
  check('each is filled in from its own document',
    now.some((c) => /emergency fire pump/i.test(c))
    && now.some((c) => /mooring winch brake/i.test(c))
    && now.some((c) => /gangway net/i.test(c)), now.join(' | '));
  check('with the numbers read from wherever they were written',
    ['FA 05/2026', '112/2026', '077/2026'].every((r) => now.some((c) => c.includes(r))),
    now.join(' | '));

  // The point of reading them: findable by what is inside rather than only by
  // the title, so the phrase searched for is one that appears in the body and
  // in no title.
  await page.fill('#search', 'Synergy Marine Group');
  await page.waitForTimeout(900);
  check('and their contents joined the search',
    await page.locator('.card').count() >= 1, String(await page.locator('.card').count()));
  await page.fill('#search', '');
  await page.waitForTimeout(300);

  // A circular often travels with its annexes, so one entry has to hold more
  // than one document — the circular and everything that came with it.
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Circular with its annexes');
  await page.setInputFiles('#filePicker', [SUBJECT_ALERT_PATH, NAMED_ALERT_PATH]);
  await page.waitForTimeout(1500);
  await save();
  await page.locator('.card', { hasText: 'Circular With Its Annexes' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  const held = (await page.locator('#detailBody').innerText()).match(/\.pdf/gi) || [];
  check('an entry can carry a circular and the documents that came with it',
    held.length >= 2, `${held.length} files listed`);
  await closeDetail();

  console.log('\nCapitalising what is typed');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card', { hasText: 'Synergy' }).click();
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');

  const typeAndLeave = async (key, text) => {
    const field = page.locator(`#editorBody [data-field="${key}"]`);
    await field.fill(text);
    await field.blur();
    await page.waitForTimeout(120);
    return field.inputValue();
  };

  check('each word is capitalised',
    await typeAndLeave('title', 'enclosed space entry procedure') === 'Enclosed Space Entry Procedure');
  check('but not the small words in the middle',
    await typeAndLeave('title', 'failure of the emergency fire pump') === 'Failure of the Emergency Fire Pump');
  check('a small word first or last is still capitalised',
    await typeAndLeave('title', 'the master and the officer of the watch')
      === 'The Master and the Officer of the Watch');
  check('what was typed in capitals is left as it was',
    await typeAndLeave('title', 'MARPOL annex vi compliance') === 'MARPOL Annex VI Compliance');
  check('and a reference keeps its own case exactly',
    await typeAndLeave('refNo', 'MSN 1905 (M+F)') === 'MSN 1905 (M+F)');
  check('a lower-case reference is not turned into a title either',
    await typeAndLeave('refNo', 'sms-04 rev b') === 'sms-04 rev b');
  await page.click('#editorCancel');
  await page.waitForTimeout(200);

  console.log('\nNoticing a version left behind');
  // The worker being wedged is exactly the case worth catching, so the check
  // has to reach the site past every cache. Standing in an older version here
  // proves the app notices and offers a way out rather than looking fine.
  // Served as a real file, like the catalogues: the request goes through the
  // service worker, which is where route interception does not reach.
  const versionFile = path.join(ROOT, 'library', 'version.json');
  const versionBefore = fs.readFileSync(versionFile, 'utf8');
  fs.writeFileSync(versionFile, JSON.stringify({ version: '2099.01.01' }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#staleBar', { timeout: 20000 });
  const stale = await page.locator('#staleBar').innerText();
  check('a version left behind is announced', /2099\.01\.01/.test(stale), stale.replace(/\n/g, ' / '));
  check('and it says the entries are kept', /entries are kept/i.test(stale), stale.replace(/\n/g, ' / '));
  fs.writeFileSync(versionFile, versionBefore);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check('and it stays out of the way once the versions agree',
    await page.locator('#staleBar').count() === 0);

  check('the stamped version matches the app it ships with',
    JSON.parse(versionBefore).version === APP_VERSION_IN_SOURCE,
    `${JSON.parse(versionBefore).version} vs ${APP_VERSION_IN_SOURCE}`);

  console.log('\nSaying whether there is an update');
  // Back only if there is somewhere to go back to: the checks above end on the
  // home screen, where the button is hidden.
  if (await page.locator('#backBtn').isVisible()) {
    await page.click('#backBtn');
    await page.waitForTimeout(200);
  }
  await page.click('#settingsBtn');
  await page.waitForSelector('#settings:not([hidden])');
  await page.click('#settingsBody button:has-text("Check for updates")');
  await page.waitForSelector('#settingsBody .panel:has-text("Build") .hint', { timeout: 20000 });
  const versionSaid = await page.locator('#settingsBody .panel:has-text("Build")').innerText();
  check('it says whether the site has anything newer',
    /Up to date/i.test(versionSaid), versionSaid.replace(/\n/g, ' / '));
  check('and names the version it compared against',
    /2026\.\d\d\.\d\d/.test(versionSaid), versionSaid.replace(/\n/g, ' / '));
  await page.click('#settingsClose');
  await page.waitForTimeout(200);

  console.log('\nPersistence and offline');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  // Address the card by name: the section order is configurable.
  const manualsCard = await page.locator('.section-card', { hasText: 'Manuals' }).innerText();
  // Counted, not pinned to a number: later sections add manuals of their own,
  // and a reload test should be about what survived rather than about how many
  // entries the suite happened to make before it.
  const manualsHeld = Number((manualsCard.match(/(\d+) entr/) || [])[1] || 0);
  check('data survives a reload', manualsHeld >= 3, manualsCard.replace(/\n/g, ' / '));

  await page.fill('#search', 'QUAYSIDEMARKER');
  await page.waitForSelector('.snippet', { timeout: 15000 });
  check('content search rebuilds its index after a reload without being asked',
    (await page.locator('.snippet').count()) > 0);
  await page.fill('#search', '');
  await page.waitForTimeout(200);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  check('the library opens with the network cut', true);

  await page.fill('#search', 'ZEPHYRTESTONE');
  // The text index is decrypted lazily, so allow for that first-search load.
  await page.waitForSelector('.snippet', { timeout: 15000 });
  check('PDF content search works offline',
    (await page.locator('.snippet').count()) > 0);
  check('and still reports the right page',
    /page 1/i.test(await page.locator('.snippet').first().innerText()));
  await shot('lib-05-offline');
  await context.setOffline(false);

  console.log('\nJavaScript errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  if (errors.length) failed += errors.length;
} catch (ex) {
  failed++;
  console.log('\nEXCEPTION: ' + (ex && ex.stack ? ex.stack : ex));
  await shot('lib-99-failure');
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
