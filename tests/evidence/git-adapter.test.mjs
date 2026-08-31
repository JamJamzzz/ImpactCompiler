import { test, before, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRepoIdentity, getHeadCommit, commitExists, buildCommitEvidencePacket,
} from '../../src/evidence/git-adapter.mjs';

let repoPath;
let shas = [];

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-git-'));
  const git = (args) => execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repoPath, 'a.txt'), 'one\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'first commit']);
  const sha1 = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  writeFileSync(join(repoPath, 'a.txt'), 'one\ntwo\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'second commit\n\nreplace O(n^2) matching logic']);
  const sha2 = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  shas = [sha1, sha2];
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
});

test('commitExists: real commits resolve, a fake sha does not', () => {
  assert.equal(commitExists(repoPath, shas[0]), true);
  assert.equal(commitExists(repoPath, shas[1]), true);
  assert.equal(commitExists(repoPath, 'deadbeef1234567890deadbeef1234567890dead'), false);
});

test('getHeadCommit resolves to the second commit', () => {
  assert.equal(getHeadCommit(repoPath), shas[1]);
});

test('getRepoIdentity falls back to a real local path when no remote is configured', () => {
  const identity = getRepoIdentity(repoPath);
  assert.equal(typeof identity, 'string');
  assert.ok(identity.length > 0);
});

test('buildCommitEvidencePacket returns a normalized packet for a real commit', () => {
  const packet = buildCommitEvidencePacket(repoPath, shas[1]);
  assert.equal(packet.sha, shas[1]);
  assert.match(packet.subject, /second commit/);
  assert.equal(packet.patch_truncated, false);
  assert.ok(packet.files_touched.includes('a.txt'));
});

test('buildCommitEvidencePacket returns null for a nonexistent commit', () => {
  const packet = buildCommitEvidencePacket(repoPath, 'deadbeef1234567890deadbeef1234567890dead');
  assert.equal(packet, null);
});

test('getCommitPatch truncation is recorded, never silent', () => {
  writeFileSync(join(repoPath, 'big.txt'), 'x'.repeat(20000));
  execFileSync('git', ['-C', repoPath, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'big commit'], { stdio: 'pipe' });
  const sha = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  const packet = buildCommitEvidencePacket(repoPath, sha, { patchMaxChars: 500 });
  assert.equal(packet.patch_truncated, true);
  assert.match(packet.patch, /truncated/);
});
