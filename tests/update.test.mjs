/**
 * Regression test for the update path.
 *
 * The app was cache-first, so an installed copy kept serving the build it had
 * and pushed fixes never arrived however many times it was relaunched. This
 * serves the app from a temporary copy, installs the service worker, changes a
 * file on disk as a deploy would, and checks a relaunch picks the change up —
 * then cuts the network and checks it still starts.
 *
 *   node tests/update.test.mjs
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8095;
let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? ' -- ' + extra : ''}`); }
};

// A throwaway copy so the test can "deploy" over it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ava-update-'));
for (const entry of ['index.html', 'reset.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons', 'vendor']) {
  fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
}
// The Library too, for the reset check — but not the mirrored documents, which
// are 163 MB and have nothing to do with any of this.
fs.cpSync(path.join(ROOT, 'library'), path.join(dir, 'library'), {
  recursive: true,
  filter: (from) => !/[/\\]library[/\\](docs|data)([/\\]|$)/.test(from)
});

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: dir, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
const page = await context.newPage();

try {
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  check('service worker installs', true);

  const before = await page.title();

  // Stand in for a deploy: change both the document and a script it loads.
  // Markers must be things the app does not rewrite at runtime — an earlier
  // version of this test edited a string that boot() overwrites, and so
  // reported a failure that was not real.
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.html'),
    html.replace('<title>AVA</title>', '<title>AVA DEPLOYED</title>'));
  fs.appendFileSync(path.join(dir, 'js', 'app.js'),
    '\nwindow.__avaDeployMarker = "shipped";\n');

  await page.reload({ waitUntil: 'networkidle' });
  // Wait for the marker rather than sleeping at it: app.js is a module, and a
  // fixed pause sometimes ran before it had finished executing — a failure
  // that was the test's timing, not the app's.
  await page.waitForFunction(() => window.__avaDeployMarker !== undefined, null, { timeout: 10000 })
    .catch(() => {});
  const after = await page.title();
  const marker = await page.evaluate(() => window.__avaDeployMarker);

  check('a relaunch picks up a changed document',
    after.includes('DEPLOYED'), `before="${before}" after="${after}"`);
  check('a relaunch picks up changed application code',
    marker === 'shipped', `marker=${marker}`);

  // The cache must still have been refreshed, not bypassed.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lock:not([hidden])', { timeout: 10000 });
  const offlineTitle = await page.title();
  const offlineMarker = await page.evaluate(() => window.__avaDeployMarker);
  check('it still starts with the network cut', true);
  check('and serves the updated build offline, not the stale one',
    offlineTitle.includes('DEPLOYED') && offlineMarker === 'shipped',
    `title="${offlineTitle}" marker=${offlineMarker}`);
  await context.setOffline(false);

  // ── the way out of a copy that will not update ────────────────────────────
  //
  // Both apps can repair themselves, but that lives inside the app — so a copy
  // stale enough to be missing it cannot use it. reset.html sits at the root,
  // above /library/, deliberately out of the Library worker's scope.
  console.log('\nThe reset page');

  const lib = await context.newPage();
  await lib.goto(`http://localhost:${PORT}/library/index.html`, { waitUntil: 'networkidle' });
  await lib.evaluate(() => navigator.serviceWorker.ready);

  // Something in the database, to prove the reset leaves it alone. This is the
  // whole promise of the page: on a ship the sea time is the part that cannot
  // be fetched again.
  await lib.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('ava-reset-probe', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kept');
    open.onsuccess = () => {
      const tx = open.result.transaction('kept', 'readwrite');
      tx.objectStore('kept').put('sea time', 'entry');
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }));

  const installedBefore = await lib.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).length);
  const cachesBefore = await lib.evaluate(async () => (await caches.keys()).length);
  check('the apps are installed to begin with',
    installedBefore >= 1 && cachesBefore >= 1,
    `workers=${installedBefore} caches=${cachesBefore}`);

  // The Library's worker cannot answer for this page: it is at the root, above
  // /library/, so the request never enters that worker's scope at all.
  const reset = await context.newPage();
  await reset.goto(`http://localhost:${PORT}/reset.html`, { waitUntil: 'domcontentloaded' });
  const scope = await reset.evaluate(() =>
    navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : '');
  check('the Library worker is not the one serving it',
    !scope.startsWith('/library/'), `served under ${scope || 'no worker'}`);

  // And it arrives current rather than from a cache — which is the whole
  // point, since the copy that needs resetting is the one that is stale.
  fs.writeFileSync(path.join(dir, 'reset.html'),
    fs.readFileSync(path.join(dir, 'reset.html'), 'utf8')
      .replace('<title>Reset the apps</title>', '<title>Reset RESHIPPED</title>'));
  await reset.reload({ waitUntil: 'domcontentloaded' });
  check('and it arrives current, never from a cache',
    (await reset.title()).includes('RESHIPPED'), await reset.title());

  await reset.click('#go');
  await reset.waitForURL(/library\/index\.html\?fresh=/, { timeout: 15000 });
  check('it reopens the app afterwards', true);

  const installedAfter = await reset.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).length);
  const cachesAfter = await reset.evaluate(async () => (await caches.keys()).length);
  check('the downloaded code is gone',
    cachesAfter < cachesBefore, `before=${cachesBefore} after=${cachesAfter}`);

  const kept = await reset.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('ava-reset-probe', 1);
    open.onsuccess = () => {
      const get = open.result.transaction('kept', 'readonly').objectStore('kept').get('entry');
      get.onsuccess = () => { const v = get.result; open.result.close(); resolve(v); };
      get.onerror = () => resolve(null);
    };
    open.onerror = () => resolve(null);
  }));
  check('and the entries are kept', kept === 'sea time', `read back ${JSON.stringify(kept)}`);

  await lib.close();
  await reset.close();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  check('no script errors', errors.length === 0, errors.join('; '));
} catch (ex) {
  failed++;
  console.log('EXCEPTION: ' + (ex && ex.stack ? ex.stack : ex));
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  stop();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
