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
    <div style="page-break-before:always"></div>
    <h1>Section 2 — Lubrication</h1>
    <p>Sump oil temperature must remain between 40 and 55 degrees Celsius.</p>
    <p>Unique marker two: QUAYSIDEMARKER.</p>`, { waitUntil: 'load' });
  await maker.pdf({ path: PDF_PATH, format: 'A4' });
  await maker.close();
  console.log(`  generated test PDF: ${(fs.statSync(PDF_PATH).size / 1024).toFixed(0)} KB`);
}

const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
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

try {
  console.log('\nSetup');
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#setupForm:not([hidden])');
  await page.fill('#setupCode', 'quayside-lantern-44');
  await page.fill('#setupCode2', 'quayside-lantern-44');
  await page.click('#setupForm button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  check('creates the library', true);
  check('opens on the sections screen',
    (await page.locator('.section-card').count()) === 4);
  const names = await page.locator('.section-name').allTextContents();
  check('sections appear in the configured order',
    names.join(',') === 'Publications,Manuals,Synergy,Circulars', names.join(','));
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
  check('it did not fall back to "scanned"', !/scanned/i.test(detail));
  await shot('lib-02-detail');
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

  console.log('\nOther sections');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.locator('.section-card', { hasText: 'Circulars' }).click();
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

  console.log('\nPersistence and offline');
  await page.click('#lockBtn');
  await page.waitForSelector('#lock:not([hidden])');
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#unlockCode', 'quayside-lantern-44');
  await page.click('#unlockForm button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  // Address the card by name: the section order is configurable.
  const manualsCard = await page.locator('.section-card', { hasText: 'Manuals' }).innerText();
  check('data survives a reload', /3 entries/.test(manualsCard), manualsCard.replace(/\n/g, ' / '));

  await page.fill('#search', 'QUAYSIDEMARKER');
  await page.waitForSelector('.snippet', { timeout: 15000 });
  check('content search reloads its index after a lock without being asked',
    (await page.locator('.snippet').count()) > 0);
  await page.fill('#search', '');
  await page.waitForTimeout(200);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#unlockForm:not([hidden])', { timeout: 10000 });
  await page.fill('#unlockCode', 'quayside-lantern-44');
  await page.click('#unlockForm button[type="submit"]');
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
