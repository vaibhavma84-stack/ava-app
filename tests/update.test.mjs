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
for (const entry of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons']) {
  fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
}

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
  await page.waitForTimeout(500);
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
