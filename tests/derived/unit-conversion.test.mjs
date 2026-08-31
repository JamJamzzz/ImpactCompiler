import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertUnit } from '../../src/derived/unit-conversion.mjs';

test('minutes/year -> hours/year: exact division by 60', () => {
  const result = convertUnit(15600, 'minutes/year', 'hours/year');
  assert.equal(result.ok, true);
  assert.equal(result.value, 260);
  assert.equal(result.unit, 'hours/year');
  assert.equal(result.operator, '/');
  assert.equal(result.factor, 60);
});

test('milliseconds -> seconds', () => {
  const result = convertUnit(2500, 'ms', 'sec');
  assert.equal(result.ok, true);
  assert.equal(result.value, 2.5);
});

test('seconds -> minutes', () => {
  const result = convertUnit(120, 'seconds', 'minutes');
  assert.equal(result.ok, true);
  assert.equal(result.value, 2);
});

test('minutes -> hours', () => {
  const result = convertUnit(90, 'minutes', 'hours');
  assert.equal(result.ok, true);
  assert.equal(result.value, 1.5);
});

test('hours -> days', () => {
  const result = convertUnit(48, 'hours', 'days');
  assert.equal(result.ok, true);
  assert.equal(result.value, 2);
});

test('a reverse conversion (hours -> minutes) multiplies', () => {
  const result = convertUnit(2, 'hours', 'minutes');
  assert.equal(result.ok, true);
  assert.equal(result.value, 120);
  assert.equal(result.operator, '×');
  assert.equal(result.factor, 60);
});

test('bytes <-> KB/MB/GB use a documented 1024-based convention', () => {
  const toKb = convertUnit(2048, 'bytes', 'kb');
  assert.equal(toKb.ok, true);
  assert.equal(toKb.value, 2);
  const toMb = convertUnit(1024 * 1024 * 3, 'bytes', 'mb');
  assert.equal(toMb.value, 3);
  const gbToMb = convertUnit(2, 'gb', 'mb');
  assert.equal(gbToMb.value, 2048);
});

test('the same unit on both sides is a trivial exact conversion', () => {
  const result = convertUnit(42, 'hours', 'hours');
  assert.equal(result.ok, true);
  assert.equal(result.value, 42);
  assert.equal(result.factor, 1);
});

test('incompatible unit families are rejected (e.g. time -> data size)', () => {
  const result = convertUnit(10, 'hours', 'mb');
  assert.equal(result.ok, false);
  assert.match(result.reason, /incompatible/);
});

test('a calendar-dependent period mismatch is rejected, never assumed', () => {
  const result = convertUnit(10, 'minutes/week', 'minutes/month');
  assert.equal(result.ok, false);
  assert.match(result.reason, /calendar-dependent/);
});

test('an unsupported/unknown unit is rejected outright', () => {
  const result = convertUnit(10, 'fortnights', 'seconds');
  assert.equal(result.ok, false);
});

test('implicit currency conversion is never supported (not in any whitelist family)', () => {
  const result = convertUnit(100, 'USD', 'EUR');
  assert.equal(result.ok, false);
});

test('a non-finite value is rejected', () => {
  const result = convertUnit(NaN, 'minutes', 'hours');
  assert.equal(result.ok, false);
});

test('a unit shape with more than one "/" is rejected as unsupported', () => {
  const result = convertUnit(1, 'minutes/run/week', 'hours/run/week');
  assert.equal(result.ok, false);
});
