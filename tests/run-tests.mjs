/**
 * Cross-platform test entry point.
 *
 * Shell glob expansion differs between Windows, POSIX shells, and Node 18.
 * Discovering test modules here keeps `npm test` identical on every supported
 * runner without changing any test semantics.
 */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsRoot = dirname(fileURLToPath(import.meta.url));

async function collectTestFiles(directory) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTestFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(path);
  }
  return files;
}

for (const file of await collectTestFiles(testsRoot)) {
  await import(pathToFileURL(file).href);
}
