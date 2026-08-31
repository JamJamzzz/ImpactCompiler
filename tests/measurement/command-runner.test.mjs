import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../../src/measurement/command-runner.mjs';

test('runs a command and captures stdout on success', async () => {
  const res = await runCommand({
    executable: process.execPath,
    args: ['-e', 'console.log(JSON.stringify({ok:true}))'],
    cwd: process.cwd(),
    timeoutMs: 10000,
  });
  assert.equal(res.ok, true);
  assert.match(res.stdout, /"ok":true/);
});

test('a non-zero exit code is reported, never silently ignored', async () => {
  const res = await runCommand({
    executable: process.execPath,
    args: ['-e', 'process.exit(3)'],
    cwd: process.cwd(),
    timeoutMs: 10000,
  });
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, 3);
  assert.equal(res.timedOut, false);
});

test('a timeout is reported distinctly from a normal failure', async () => {
  const res = await runCommand({
    executable: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 5000)'],
    cwd: process.cwd(),
    timeoutMs: 200,
  });
  assert.equal(res.ok, false);
  assert.equal(res.timedOut, true);
  assert.match(res.reason, /timed out/);
});

test('never uses a shell — an argument containing shell metacharacters is passed through literally, not interpreted', async () => {
  const dangerous = '$(echo pwned) && rm -rf / ; `touch injected`';
  const res = await runCommand({
    executable: process.execPath,
    args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', dangerous],
    cwd: process.cwd(),
    timeoutMs: 10000,
  });
  assert.equal(res.ok, true);
  const argv = JSON.parse(res.stdout);
  assert.ok(argv.includes(dangerous), `expected the literal dangerous string to survive as a single argv entry, got: ${res.stdout}`);
});

test('a spawn failure (unknown executable) resolves with ok:false, never rejects/throws', async () => {
  await assert.doesNotReject(async () => {
    const res = await runCommand({
      executable: 'this-executable-definitely-does-not-exist-xyz',
      args: [],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    assert.equal(res.ok, false);
  });
});
