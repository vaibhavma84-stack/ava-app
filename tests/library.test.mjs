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

const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
const page = await context.newPage();
const errors = [];
// Part of the suite cuts a source off on purpose, to see how the app reports a
// refusal. The browser logs those as resource errors; they are the point of
// the test, not a defect, so they are ignored only while that is set up.
let blockingOnPurpose = false;
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (blockingOnPurpose && /net::ERR_FAILED/.test(text)) return;
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
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('#viewerBody canvas');
    if (!c || !c.width) return { ok: false, reason: 'no canvas' };
    // A blank canvas means nothing was painted; look for non-white pixels.
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, Math.min(c.height, 400));
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 200) ink++;
    return { ok: ink > 50, ink, width: c.width, height: c.height, pages: document.querySelectorAll('#viewerBody canvas').length };
  });
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
  check('a title already typed is never overwritten', kept === 'My own title', String(kept));
  await page.click('#editorCancel');
  await page.waitForSelector('#editor', { state: 'hidden' });

  console.log('\nFlag circulars');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card', { hasText: 'Flag Circulars' }).click();
  await page.waitForTimeout(200);

  const sourceHrefs = await page.locator('.body a.link-btn').evaluateAll((as) =>
    as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));
  check('the section links to where the notices are published',
    sourceHrefs.length === 7, JSON.stringify(sourceHrefs));
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
  await page.waitForTimeout(300);
  await page.fill('#search', 'notice');
  await page.waitForTimeout(600);
  await page.fill('#search', '');
  await page.waitForTimeout(300);
  check('nothing is fetched until asked for', outbound.length === 0, outbound.join(', '));
  page.off('request', watch);

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
  const firstRun = await page.locator(`${panel} .hint`).innerText();
  check('a first sync files every notice', /MCA: 3 new/.test(firstRun), firstRun);
  check('the collection the user gave is the one used',
    mgnTried.some((u) => /active-marine-guidance-notes-mgns/.test(u)), mgnTried.join(', '));

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
  const secondRun = await page.locator(`${panel} .hint`).innerText();
  check('a repeat sync does not duplicate', /0 new/.test(secondRun), secondRun);
  check('and recognises what is already held', /3 already held/.test(secondRun), secondRun);

  await page.locator('.card', { hasText: 'MSN 1871' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  check('the hand-typed note survives a resync',
    /Checked against the ship copy/.test(await page.locator('#detailBody').innerText()));
  await closeDetail();

  // ---- Panama: no API of its own, but WordPress serves one ----------------
  const PANAMA_MEDIA = {
    'MMC-': [
      { title: { rendered: 'MMC-230-Recognised-Organisations' }, date: '2025-10-15T10:00:00',
        source_url: 'https://panamashipregistry.com/wp-content/uploads/2025/10/MMC-230-15-10-2025.pdf' },
      { title: { rendered: 'MMC-388-January-2024' }, date: '2024-01-11T10:00:00',
        source_url: 'https://panamashipregistry.com/wp-content/uploads/2024/01/MMC-388-January-2024.pdf' },
      // Everything the site has ever uploaded comes back from this endpoint,
      // so anything without a reference has to be dropped.
      { title: { rendered: 'Registry-brochure-2025' }, date: '2025-02-01T10:00:00',
        source_url: 'https://panamashipregistry.com/wp-content/uploads/2025/02/brochure.pdf' }
    ],
    'MMN-': [
      { title: { rendered: 'MMN-7-070-Ballast-water-record-book' }, date: '2025-06-02T10:00:00',
        source_url: 'https://panamashipregistry.com/wp-content/uploads/2025/06/MMN-7-070.pdf' }
    ]
  };
  await page.route('**/wp-json/wp/v2/media**', (route) => {
    const url = route.request().url();
    const key = /MMN/.test(url) ? 'MMN-' : 'MMC-';
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PANAMA_MEDIA[key]) });
  });

  await page.click(`${panel} button:text-is("Panama")`);
  await page.waitForSelector('.hint:has-text("Panama:")', { timeout: 20000 });
  const panamaRun = await page.locator(`${panel} .hint`).innerText();
  // MMN 7-070 is already held: it was typed in from a PDF earlier in this run.
  // A fetched notice has to merge into it rather than sit beside it.
  check('Panama files its circulars and notices',
    /Panama: 2 new, 1 updated/.test(panamaRun), panamaRun);
  check('and does not duplicate one already entered by hand',
    await page.locator('.card', { hasText: 'MMN 7-070' }).count() === 1);
  await page.locator('.card', { hasText: 'MMN 7-070' }).first().click();
  await page.waitForSelector('#detail:not([hidden])');
  check('an entry made by hand keeps the subject its owner gave it',
    !/MMN 7 070 Ballast water record book/i.test(await page.locator('#detailBody').innerText()),
    (await page.locator('#detailBody').innerText()).slice(0, 200));
  await closeDetail();

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
  const panamaAgain = await page.locator(`${panel} .hint`).innerText();
  check('a repeat Panama sync adds nothing', /Panama: 0 new/.test(panamaAgain), panamaAgain);
  check('a title rewritten by hand is kept',
    (await page.locator('.card').allInnerTexts())
      .some((c) => /Recognised organisations acting for Panama/.test(c)));

  // ---- Singapore: an index page, read for the links it lists --------------
  const MPA_PAGE = `<!doctype html><html><body>
    <a href="/media-centre/details/port-marine-circular-no.-01-of-2026">PORT MARINE CIRCULAR NO. 01 OF 2026 List of active port marine circulars</a>
    <a href="/docs/mpalibraries/circulars-and-notices/sc25-09.pdf">Shipping Circular No. 9 of 2025 Ballast water management</a>
    <a href="/about-us/careers">Careers at MPA</a>
  </body></html>`;
  await page.route('**/media-centre**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: MPA_PAGE }));

  await page.click(`${panel} button:text-is("Singapore")`);
  await page.waitForSelector('.hint:has-text("Singapore:")', { timeout: 20000 });
  const sgRun = await page.locator(`${panel} .hint`).innerText();
  check('Singapore files what its listing names', /Singapore: 2 new/.test(sgRun), sgRun);

  const sgCards = await page.locator('.card').allInnerTexts();
  check('a spelt-out Singapore reference is parsed',
    sgCards.some((c) => /PC 01\/2026/.test(c)), sgCards.join(' | '));
  check('a reference in a filename is parsed too',
    sgCards.some((c) => /SC 09\/2025/.test(c)), sgCards.join(' | '));
  check('unrelated links on the page are ignored',
    !sgCards.some((c) => /Careers/i.test(c)), sgCards.join(' | '));

  // ---- A source that refuses the read has to say so, not fail silently ----
  blockingOnPurpose = true;
  await page.unroute('**/media-centre**');
  await page.route('**/media-centre**', (route) => route.abort('failed'));
  await page.click(`${panel} button:text-is("Singapore")`);
  await page.waitForSelector('.hint:has-text("could not be read")', { timeout: 20000 });
  const refused = await page.locator(`${panel} .hint`).innerText();
  check('a blocked administration reports what happened',
    /Singapore could not be read/.test(refused), refused);
  check('and says a connection is needed', /needs a connection/.test(refused), refused);

  // A class that fails while others succeed still files the ones that worked.
  await page.unroute('**/wp-json/wp/v2/media**');
  await page.route('**/wp-json/wp/v2/media**', (route) => {
    const url = route.request().url();
    if (/MMN/.test(url)) return route.abort('failed');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PANAMA_MEDIA['MMC-']) });
  });
  await page.route('**/circulars/**', (route) => route.abort('failed'));
  await page.click(`${panel} button:text-is("Panama")`);
  await page.waitForSelector('.hint:has-text("Panama:")', { timeout: 20000 });
  const partial = await page.locator(`${panel} .hint`).innerText();
  check('a partial result is still filed', /Panama: 0 new/.test(partial), partial);
  check('and names the class it could not read',
    /Could not read: Merchant Marine Notices/.test(partial), partial);

  await page.unroute('**/api/content/government/collections/**');
  await page.unroute('**/wp-json/wp/v2/media**');
  await page.unroute('**/media-centre**');
  await page.unroute('**/circulars/**');
  blockingOnPurpose = false;

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
  await pick('category', 'Technical');
  await save();
  check('saves a circular', (await page.locator('.card').count()) === 1);

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

  console.log('\nPersistence and offline');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  // Address the card by name: the section order is configurable.
  const manualsCard = await page.locator('.section-card', { hasText: 'Manuals' }).innerText();
  check('data survives a reload', /3 entries/.test(manualsCard), manualsCard.replace(/\n/g, ' / '));

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
