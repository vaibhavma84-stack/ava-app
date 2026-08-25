/**
 * End-to-end smoke test for AVA.
 *
 * Drives a real Chromium at iPhone dimensions through the whole flow: create a
 * vault, add one of each record type, verify the sea time arithmetic and the
 * certificate expiry flags, search across tabs, lock and unlock, then reload
 * with the network cut to prove the offline shell works.
 *
 *   node tests/smoke.mjs [--headed] [--shots]
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8099;
const BASE = `http://localhost:${PORT}`;
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

// PLAYWRIGHT_BROWSERS_PATH points at the preinstalled Chromium; honour an
// explicit override when one is set.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: !process.argv.includes('--headed'),
  args: ['--no-sandbox']
});
const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// Auto-accept confirms; answer prompts from a queue.
let promptQueue = [];
page.on('dialog', async (d) => {
  if (d.type() === 'prompt') await d.accept(promptQueue.shift() ?? '');
  else await d.accept();
});

/** Sheets animate in; measuring or screenshotting mid-rise gives false results. */
const settle = async () => {
  await page.evaluate(async () => {
    const panels = document.querySelectorAll('.sheet:not([hidden]) .sheet-panel');
    await Promise.all([...panels].flatMap((el) => el.getAnimations().map((a) => a.finished)));
  });
};

const shot = async (name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await settle();
  await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
};

const cardWith = (text) => page.locator('.card', { hasText: text }).first();

const openNew = async (tab) => {
  await page.click(`.nav-btn[data-tab="${tab}"]`);
  await page.click('#fab');
  await page.waitForSelector('#editor:not([hidden])');
};
const set = async (key, value) => page.fill(`#editorBody [data-field="${key}"]`, value);
const pick = async (key, value) => page.selectOption(`#editorBody [data-field="${key}"]`, value);
const save = async () => {
  await page.click('#editorSave');
  await page.waitForSelector('#editor', { state: 'hidden', timeout: 5000 });
};

try {
  // ── setup ───────────────────────────────────────────────────────────────
  console.log('\nVault setup');
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#setupForm:not([hidden])');
  await shot('01-setup');

  await page.fill('#setupCode', 'short');
  await page.fill('#setupCode2', 'short');
  await page.click('#setupForm button[type="submit"]');
  check('rejects a passcode under 6 characters',
    await page.locator('#setupError').isVisible());

  await page.fill('#setupCode', 'kestrel-harbour-92');
  await page.fill('#setupCode2', 'kestrel-harbour-different');
  await page.click('#setupForm button[type="submit"]');
  check('rejects mismatched confirmation',
    (await page.locator('#setupError').textContent() || '').includes('do not match'));

  await page.fill('#setupCode', 'kestrel-harbour-92');
  await page.fill('#setupCode2', 'kestrel-harbour-92');
  await page.click('#setupForm button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  check('creates the vault and enters the app', true);
  check('opens on the Ship Manuals tab',
    (await page.locator('#screenTitle').textContent()) === 'Ship Manuals');
  check('bottom nav shows every section',
    (await page.locator('.nav-btn').count()) === 5);

  // ── manuals ─────────────────────────────────────────────────────────────
  console.log('\nPasscode keyboard');
  // The vault above was created with the default passphrase style.
  check('unlock field defaults to the full keyboard',
    (await page.locator('#unlockCode').getAttribute('inputmode')) === null);
  check('a keyboard toggle is offered',
    (await page.locator('#kbToggle').textContent()).includes('number pad'));

  await page.click('#lockBtn');
  await page.waitForSelector('#lock:not([hidden])');
  await page.click('#kbToggle');
  check('toggling switches the unlock field to the number pad',
    (await page.locator('#unlockCode').getAttribute('inputmode')) === 'numeric');
  check('the numeric fallback pattern is set for older WebKit',
    (await page.locator('#unlockCode').getAttribute('pattern')) === '[0-9]*');
  check('the toggle label flips back',
    (await page.locator('#kbToggle').textContent()).includes('full keyboard'));
  await page.click('#kbToggle');
  check('toggling again restores the full keyboard',
    (await page.locator('#unlockCode').getAttribute('inputmode')) === null);

  // A letter passcode must still work after the keyboard has been switched.
  await page.fill('#unlockCode', 'kestrel-harbour-92');
  await page.click('#unlockForm button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  check('a letter passcode still unlocks after switching keyboards', true);

  console.log('\nShip Manuals');
  await openNew('manual');
  await set('title', 'Main Engine Operating Manual');
  await pick('category', 'Engine');
  await set('vessel', 'MV Northern Star');
  await set('location', 'ECR bookshelf, folder 3');
  await set('notes', 'Starting air pressure minimum 25 bar before first attempt.');
  await save();
  check('saves a manual', (await page.locator('.card').count()) === 1);
  check('manual row shows category and vessel',
    (await page.locator('.card-sub').first().textContent() || '').includes('Engine'));

  // ── certificates ────────────────────────────────────────────────────────
  console.log('\nCertificates');
  const iso = (offsetDays) => {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return d.toISOString().slice(0, 10);
  };

  await openNew('certificate');
  await set('title', 'STCW Basic Safety Training');
  await set('issuer', 'DG Shipping');
  await set('refNo', 'BST-2024-118');
  await set('expiryDate', iso(400));
  await save();

  await openNew('certificate');
  await set('title', 'Medical Fitness Certificate');
  await set('issuer', 'Port Health Authority');
  await set('expiryDate', iso(45));
  await save();

  await openNew('certificate');
  await set('title', 'GMDSS Radio Operator');
  await set('issuer', 'DG Shipping');
  await set('expiryDate', iso(-20));
  await save();

  const pills = await page.locator('.card .pill').allTextContents();
  check('flags an expired certificate red', pills.includes('Expired'), pills.join(','));
  check('flags one expiring within 90 days amber', pills.includes('Expiring'), pills.join(','));
  check('leaves a distant expiry valid', pills.includes('Valid'), pills.join(','));
  check('sorts soonest expiry first',
    (await page.locator('.card-title').first().textContent()) === 'GMDSS Radio Operator');
  check('nav badge counts the two certificates needing attention',
    (await page.locator('.nav-btn[data-tab="certificate"] .nav-badge').textContent()) === '2');
  await shot('02-certificates');

  await cardWith('Medical Fitness Certificate').click();
  await page.waitForSelector('#detail:not([hidden])');
  check('certificate detail offers an Add to Calendar action',
    await page.locator('#detailBody button:has-text("Add expiry to Calendar")').isVisible());
  await page.click('#detailClose');

  // ── sea time ────────────────────────────────────────────────────────────
  console.log('\nSea Time');
  await openNew('seatime');
  await set('vessel', 'MV Northern Star');
  await set('company', 'Anglo-Eastern');
  await pick('vesselType', 'Bulk Carrier');
  await pick('rank', 'Third Officer');
  await set('grt', '38500');
  await set('nrt', '22400');
  await set('kw', '9480');
  await set('flag', 'Panama');
  await set('officialNumber', '4412899');
  await set('imo', '9345678');
  await set('callSign', '3FKQ7');
  await set('signOnDate', '2024-01-10');
  await set('signOnPort', 'Singapore');
  await set('signOffDate', '2024-07-09');   // 182 days inclusive
  await set('signOffPort', 'Rotterdam');

  // Regression: the registry row used to pack four fields across, which pushed
  // the official-number field onto its own line and wrapped its label.
  const rowOf = (key) => page.evaluate((k) => {
    const input = document.querySelector(`#editorBody [data-field="${k}"]`);
    const row = input.closest('.fieldrow');
    return row ? row.querySelectorAll('.field').length : 1;
  }, key);
  check('registry fields sit two to a row', (await rowOf('officialNumber')) === 2,
    `got ${await rowOf('officialNumber')}`);
  check('IMO and call sign share their own row', (await rowOf('imo')) === 2);

  const offBox = await page.locator('#editorBody [data-field="officialNumber"]').boundingBox();
  const flagBox = await page.locator('#editorBody [data-field="flag"]').boundingBox();
  check('official number sits beside the flag, not below it',
    Math.abs(offBox.y - flagBox.y) < 2 && offBox.x > flagBox.x,
    `flag y=${Math.round(flagBox.y)} off y=${Math.round(offBox.y)}`);

  const offLabel = await page.evaluate(() => {
    const input = document.querySelector('#editorBody [data-field="officialNumber"]');
    const label = input.closest('div').querySelector('label.label');
    return { text: label.textContent, lines: Math.round(label.getBoundingClientRect().height) };
  });
  check('its label is abbreviated', offLabel.text === 'Off. No.', offLabel.text);
  check('its label fits on one line', offLabel.lines < 24, `${offLabel.lines}px tall`);

  // General guard: no two inputs in a form may overlap. A date input that
  // refuses to shrink inside a flex row was spilling over its neighbour.
  const overlaps = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#editorBody .field')]
      .map((el) => ({ key: el.dataset.field || el.type, r: el.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0 && b.r.height > 0);
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        const overlap = a.left < b.right - 1 && b.left < a.right - 1
                     && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        if (overlap) hits.push(`${boxes[i].key}/${boxes[j].key}`);
      }
    }
    return hits;
  });
  check('no two fields overlap in the sea time form', overlaps.length === 0, overlaps.join(', '));

  const wider = await page.evaluate(() => {
    const el = document.querySelector('#editorBody [data-field="signOnDate"]');
    const parent = el.parentElement.getBoundingClientRect();
    return { field: Math.round(el.getBoundingClientRect().width), parent: Math.round(parent.width) };
  });
  check('the sign-on date fills its row rather than overflowing it',
    wider.field <= wider.parent + 1, `field=${wider.field} parent=${wider.parent}`);

  await page.click('#editorBody button:has-text("Add contract")');
  await page.fill('#editorBody [data-contract-field="company"]', 'Anglo-Eastern Crew Management');
  await page.fill('#editorBody [data-contract-field="position"]', 'Third Officer');
  await page.fill('#editorBody [data-contract-field="wage"]', 'USD 3,900 / month');
  await save();

  await openNew('seatime');
  await set('vessel', 'MT Baltic Trader');
  await pick('rank', 'Second Officer');
  await pick('vesselType', 'Product Tanker');
  await set('grt', '29100');
  await set('signOnDate', '2024-09-01');
  await set('signOffDate', '2024-12-30');   // 121 days inclusive
  await save();

  const summary = await page.locator('.summary-total').first().textContent();
  check('totals sea time as months and days', summary.trim() === '10 mo 3 d', `got ${summary}`);
  check('shows the raw day count',
    (await page.locator('.summary-days').first().textContent() || '').includes('303 days'));
  const ranks = await page.locator('.rank-row').allTextContents();
  check('breaks sea time down by rank', ranks.length === 2, ranks.join(' | '));
  check('third officer time is 6 mo 2 d',
    ranks.some((r) => r.includes('Third Officer') && r.includes('6 mo 2 d')), ranks.join(' | '));
  check('second officer time is 4 mo 1 d',
    ranks.some((r) => r.includes('Second Officer') && r.includes('4 mo 1 d')), ranks.join(' | '));

  check('newest voyage sorts first',
    (await page.locator('.card-title').first().textContent()) === 'MT Baltic Trader');
  const starRow = await cardWith('Northern Star').innerText();
  check('list row shows vessel, rank and type', /Northern Star/.test(starRow) && /Third Officer/.test(starRow) && /Bulk Carrier/.test(starRow), starRow.replace(/\n/g, ' / '));
  check('list row shows GRT, NRT and KW', /38500/.test(starRow) && /22400/.test(starRow) && /9480/.test(starRow), starRow.replace(/\n/g, ' / '));
  check('list row hides IMO and call sign', !/9345678/.test(starRow) && !/3FKQ7/.test(starRow));
  check('list row dates carry a four-digit year',
    /2024/.test(starRow) && !/\b24\b(?!\d)/.test(starRow.replace(/2024/g, '')), starRow.replace(/\n/g, ' / '));
  await shot('03-seatime');

  // detail opens on tap
  await cardWith('Northern Star').click();
  await page.waitForSelector('#detail:not([hidden])');
  const detail = await page.locator('#detailBody').innerText();
  check('detail view reveals IMO and call sign', /9345678/.test(detail) && /3FKQ7/.test(detail));
  check('detail view shows the embedded contract', /Anglo-Eastern Crew Management/.test(detail));
  check('detail view shows this voyage as 6 mo 2 d', /6 mo 2 d/.test(detail));
  check('voyage detail offers an Add to Calendar action',
    await page.locator('#detailBody button:has-text("Add voyage to Calendar")').isVisible());
  await shot('04-detail');
  await page.click('#detailClose');

  // ── remaining types ─────────────────────────────────────────────────────
  console.log('\nPublications and notes');
  await openNew('publication');
  await set('title', 'Admiralty List of Radio Signals Vol 1');
  await set('refNo', 'NP281(1)');
  await set('edition', '2026');
  await pick('category', 'List of Radio Signals');
  await set('publisher', 'UKHO');
  await set('correctedTo', 'NtM 12/2026');
  await set('vessel', 'MV Northern Star');
  await set('location', 'Chart room');
  await save();
  check('saves a publication', (await page.locator('.card').count()) === 1);
  const pubRow = await page.locator('.card').first().innerText();
  check('publication row shows the correction state', /NtM 12\/2026/.test(pubRow), pubRow.replace(/\n/g, ' / '));
  check('publication row shows the edition', /2026/.test(pubRow));
  check('publication row shows the number and vessel',
    /NP281\(1\)/.test(pubRow) && /Northern Star/.test(pubRow), pubRow.replace(/\n/g, ' / '));

  await openNew('publication');
  await set('title', 'Mariner\'s Handbook');
  await set('refNo', 'NP100');
  await save();
  check('a publication with no correction shows a placeholder',
    (await cardWith('Mariner').innerText()).includes('—'));

  await openNew('note');
  await set('title', 'Rotterdam agent contact');
  await set('body', 'Agent: Van der Berg Shipping. Ask for Pieter on the night line.');
  await page.click('#editorBody button:has-text("Pin to top")');
  await save();
  check('pins a note', (await page.locator('.card.pinned').count()) === 1);

  await openNew('note');
  await set('title', 'Shore leave paperwork');
  await set('body', 'Carry the discharge book photocopy.');
  await save();
  check('pinned note sorts above the unpinned one',
    (await page.locator('.card-title').first().textContent()) === 'Rotterdam agent contact');

  await cardWith('Rotterdam agent contact').click();
  await page.waitForSelector('#detail:not([hidden])');
  check('a note offers no calendar action, having no date',
    (await page.locator('#detailBody button:has-text("Calendar")').count()) === 0);
  await page.click('#detailClose');

  const icsProbe = await page.evaluate(async () => {
    const cal = await import('./js/calendar.js');
    const store = await import('./js/store.js');
    const certs = store.itemsOfType('certificate');
    const bundle = cal.icsForItems(cal.datedCertificates(certs));
    return { count: bundle ? bundle.count : 0, head: bundle ? bundle.ics.slice(0, 15) : '' };
  });
  check('builds a calendar file from stored certificates',
    icsProbe.count === 3 && icsProbe.head === 'BEGIN:VCALENDAR', JSON.stringify(icsProbe));

  console.log('\nRemoved sections');
  check('only five tabs remain', (await page.locator('.nav-btn').count()) === 5);
  const tabs = await page.locator('.nav-btn').evaluateAll((ns) => ns.map((n) => n.dataset.tab));
  check('salary and letters are gone',
    !tabs.includes('salary') && !tabs.includes('letter'), tabs.join(','));
  check('publications sits after sea time',
    tabs.join(',') === 'manual,certificate,seatime,publication,note', tabs.join(','));

  // ── global search ───────────────────────────────────────────────────────
  console.log('\nGlobal search');
  await page.fill('#search', 'northern star');
  await page.waitForTimeout(250);
  const heads = await page.locator('.group-head').allTextContents();
  check('search groups results by section', heads.length >= 3, heads.join(' | '));
  check('search reaches manuals', heads.some((h) => h.includes('Ship Manuals')));
  check('search reaches sea time', heads.some((h) => h.includes('Sea Time')));
  check('search reaches publications', heads.some((h) => h.includes('Publications')));
  check('search title switches to results',
    (await page.locator('#screenTitle').textContent()) === 'Search results');
  await shot('05-search');

  await page.fill('#search', 'Pieter');
  await page.waitForTimeout(250);
  check('search matches free-text note bodies',
    (await page.locator('.card').count()) === 1);

  await page.fill('#search', 'zzzznothing');
  await page.waitForTimeout(250);
  check('search reports an empty result',
    (await page.locator('.empty h3').textContent()) === 'Nothing found');
  await page.fill('#search', '');
  await page.waitForTimeout(200);

  // Regression: the Save action used to sit in the sheet's top bar, where iOS
  // draws the status bar over it in fullscreen. It must live at the bottom.
  console.log('\nSheet action placement');
  await openNew('manual');
  await set('title', 'Placement check');
  await set('notes', 'Long body. '.repeat(400));   // force the sheet to full height
  await settle();
  const vp = page.viewportSize();
  const box = await page.locator('#editorSave').boundingBox();
  const cancelBox = await page.locator('#editorCancel').boundingBox();
  check('Save sits in the lower half of the screen', box.y > vp.height / 2,
    `save y=${Math.round(box.y)} of ${vp.height}`);
  check('Save is fully on screen', box.y + box.height <= vp.height && box.x + box.width <= vp.width,
    `y=${Math.round(box.y)} h=${Math.round(box.height)} vh=${vp.height}`);
  check('Save clears the status bar area', box.y > 60, `save y=${Math.round(box.y)}`);
  check('Cancel is bottom-left of Save', cancelBox.x < box.x && Math.abs(cancelBox.y - box.y) < 2);
  check('both actions are comfortably tappable', box.height >= 44 && cancelBox.height >= 44,
    `save h=${Math.round(box.height)} cancel h=${Math.round(cancelBox.height)}`);
  check('the form still scrolls behind them',
    await page.locator('#editorBody').evaluate((n) => n.scrollHeight > n.clientHeight));
  await shot('07-editor-actions');
  await page.click('#editorCancel');
  await page.waitForSelector('#editor', { state: 'hidden' });

  console.log('\nCalendar export');
  await page.click('#settingsBtn');
  await page.waitForSelector('#settings:not([hidden])');
  check('settings offers a bulk certificate expiry export',
    await page.locator('#settingsBody button:has-text("Export all certificate expiries")').isVisible());
  check('settings offers a bulk voyage export',
    await page.locator('#settingsBody button:has-text("Export all voyages")').isVisible());
  await page.click('#settingsClose');
  await page.waitForSelector('#settings', { state: 'hidden' });

  // ── persistence across a lock ───────────────────────────────────────────
  console.log('\nLock, reload and persistence');
  await page.click('#lockBtn');
  await page.waitForSelector('#lock:not([hidden])');
  check('locking hides the app', await page.locator('#app').isHidden());

  await page.fill('#unlockCode', 'wrong-passcode');
  await page.click('#unlockForm button[type="submit"]');
  await page.waitForSelector('#unlockError:not([hidden])');
  check('rejects the wrong passcode',
    (await page.locator('#unlockError').textContent() || '').includes('Incorrect'));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#unlockForm:not([hidden])');
  check('a reload comes back locked', await page.locator('#app').isHidden());

  await page.fill('#unlockCode', 'kestrel-harbour-92');
  await page.click('#unlockForm button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  await page.click('.nav-btn[data-tab="seatime"]');
  check('data survives a reload',
    (await page.locator('.summary-total').first().textContent()).trim() === '10 mo 3 d');

  // ── offline ─────────────────────────────────────────────────────────────
  console.log('\nOffline');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#unlockForm:not([hidden])', { timeout: 10000 });
  check('the shell loads with the network cut', true);

  await page.fill('#unlockCode', 'kestrel-harbour-92');
  await page.click('#unlockForm button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  await page.click('.nav-btn[data-tab="seatime"]');
  check('sea time reads correctly while offline',
    (await page.locator('.summary-total').first().textContent()).trim() === '10 mo 3 d');

  await openNew('note');
  await set('title', 'Written mid-ocean');
  await set('body', 'Created with no connection at all.');
  await save();
  check('creating a record works while offline',
    await cardWith('Written mid-ocean').isVisible());
  await shot('06-offline');
  await context.setOffline(false);

  // ── editing in place ────────────────────────────────────────────────────
  console.log('\nEditing');
  const notesBefore = await page.locator('.card').count();
  await cardWith('Written mid-ocean').click();
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detailEdit');
  await page.waitForSelector('#editor:not([hidden])');
  await set('title', 'Written mid-ocean (revised)');
  await save();
  check('edits save in place', await cardWith('Written mid-ocean (revised)').isVisible());
  check('editing does not duplicate the entry',
    (await page.locator('.card').count()) === notesBefore,
    `${await page.locator('.card').count()} cards, expected ${notesBefore}`);
  check('the pinned note is untouched by that edit',
    await cardWith('Rotterdam agent contact').isVisible());

  console.log('\nJavaScript errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  if (errors.length) failed += errors.length;

} catch (ex) {
  failed++;
  console.log('\nEXCEPTION: ' + (ex && ex.stack ? ex.stack : ex));
  await shot('99-failure');
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  stop();
  process.exit(failed ? 1 : 0);
}
