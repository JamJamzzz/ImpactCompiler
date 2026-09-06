// tests/web/dashboard-assets.test.mjs — lightweight, dependency-free
// validation for the React/Vite review dashboard and its AWS Amplify build
// spec. The production build itself is validated separately with `npm run
// build`; these checks catch missing entrypoints and deployment drift in the
// root test suite without requiring browser dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webDir = join(repoRoot, 'web');

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

test('the Vite entrypoint, package manifest, and React sources exist and are non-empty', () => {
  for (const file of [
    'index.html',
    'package.json',
    'vite.config.js',
    'src/main.jsx',
    'src/App.jsx',
    'src/index.css',
  ]) {
    const path = join(webDir, file);
    assert.ok(existsSync(path), `expected web/${file} to exist`);
    assert.ok(readFileSync(path, 'utf-8').trim().length > 0, `expected web/${file} to be non-empty`);
  }
});

test('index.html references the Vite module entrypoint and root mount', () => {
  const html = read('web/index.html');
  assert.match(html, /<div id="root"><\/div>/, 'index.html should provide the React root mount');
  assert.match(html, /<script type="module" src="\/src\/main\.jsx"><\/script>/, 'index.html should load the Vite module entrypoint');
  assert.doesNotMatch(html, /(?:app\.js|styles\.css)/, 'retired static-dashboard assets must not be referenced');
});

test('the package manifest exposes a Vite production build', () => {
  const manifest = JSON.parse(read('web/package.json'));
  assert.equal(manifest.scripts?.build, 'vite build');
  assert.ok(manifest.dependencies?.react, 'React must be a declared dependency');
  assert.ok(manifest.devDependencies?.vite, 'Vite must be a declared development dependency');
});

test('the dashboard never fetches or uploads artifact data through application source', () => {
  const applicationSource = sourceFiles(join(webDir, 'src'))
    .filter((path) => ['.js', '.jsx'].includes(extname(path)))
    .map((path) => `// ${relative(webDir, path)}\n${readFileSync(path, 'utf-8')}`)
    .join('\n');

  assert.doesNotMatch(applicationSource, /\bfetch\s*\(/, 'dashboard source must not make backend requests');
  assert.doesNotMatch(applicationSource, /XMLHttpRequest/, 'dashboard source must not make backend requests');
});

test('amplify.yml builds the Vite app and publishes web/dist', () => {
  assert.ok(existsSync(join(repoRoot, 'amplify.yml')), 'expected amplify.yml at the repository root');
  const spec = read('amplify.yml');
  assert.match(spec, /-\s+cd web[\s\S]*-\s+npm ci/, 'Amplify must install the locked web dependencies');
  assert.match(spec, /-\s+cd web[\s\S]*-\s+npm run build/, 'Amplify must build the Vite application');
  assert.match(spec, /baseDirectory:\s*web\/dist/, 'Amplify must publish web/dist');
});
