// tests/web/dashboard-assets.test.mjs — lightweight, dependency-free
// validation for the static review dashboard (web/) and its AWS Amplify
// Hosting build spec (amplify.yml). This is NOT a browser/DOM test suite
// (no jsdom, no headless browser) — it only checks the things that would
// silently break a static deployment: the files exist, index.html's asset
// references resolve on disk, app.js is syntactically valid, and the build
// spec points Amplify at the right directory. Runs as part of `npm test`,
// so it's already covered by the existing CI workflow with no separate
// deployment-pipeline step required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webDir = join(repoRoot, 'web');

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

test('web/index.html, app.js, and styles.css all exist and are non-empty', () => {
  for (const file of ['index.html', 'app.js', 'styles.css']) {
    const path = join(webDir, file);
    assert.ok(existsSync(path), `expected web/${file} to exist`);
    assert.ok(readFileSync(path, 'utf-8').trim().length > 0, `expected web/${file} to be non-empty`);
  }
});

test('index.html references app.js and styles.css as relative paths (no absolute/host-specific paths)', () => {
  const html = read('web/index.html');
  assert.match(html, /<script src="app\.js"/, 'index.html should load app.js via a relative src');
  assert.match(html, /<link rel="stylesheet" href="styles\.css"/, 'index.html should load styles.css via a relative href');
  assert.doesNotMatch(html, /src="\/app\.js"/, 'app.js reference must not be root-absolute');
  assert.doesNotMatch(html, /href="\/styles\.css"/, 'styles.css reference must not be root-absolute');
});

test('app.js is syntactically valid JavaScript', () => {
  const source = read('web/app.js');
  // Parses (but never executes) the script — app.js relies on browser
  // globals like `document`, so this checks syntax only, the same
  // property `node --check` would verify for a CommonJS/module file.
  assert.doesNotThrow(() => new Function(source), 'web/app.js must be syntactically valid JS');
});

test('the dashboard never fetches or uploads artifact data — no network calls to a backend', () => {
  const source = read('web/app.js');
  assert.doesNotMatch(source, /\bfetch\s*\(/, 'app.js must not make network requests');
  assert.doesNotMatch(source, /XMLHttpRequest/, 'app.js must not make network requests');
});

test('amplify.yml exists and publishes web/ as the static site directory', () => {
  assert.ok(existsSync(join(repoRoot, 'amplify.yml')), 'expected amplify.yml at the repository root');
  const spec = read('amplify.yml');
  assert.match(spec, /baseDirectory:\s*web/, 'amplify.yml must publish the web/ directory');
});
