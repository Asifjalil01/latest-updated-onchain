import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHoldDuration, formatHoldMinutes } from '../../src/utils/formatters';

test('formatHoldDuration formats live hold timer cleanly across seconds, minutes, and hours', () => {
  assert.equal(formatHoldDuration(0), '0s');
  assert.equal(formatHoldDuration(-500), '0s');
  assert.equal(formatHoldDuration(42_900), '42s');
  assert.equal(formatHoldDuration(10 * 60_000 + 5_000), '10m 05s');
  assert.equal(formatHoldDuration(60 * 60_000), '1h 00m');
  assert.equal(formatHoldDuration(24 * 3600_000 + 5 * 60_000), '24h 05m');
  assert.equal(formatHoldDuration(48 * 3600_000 + 12 * 60_000), '48h 12m');
});

test('formatHoldMinutes displays closed trade hold time in minutes', () => {
  assert.equal(formatHoldMinutes(0), '0.0 min');
  assert.equal(formatHoldMinutes(30), '0.5 min');
  assert.equal(formatHoldMinutes(374), '6.2 min');
  assert.equal(formatHoldMinutes(3599), '60.0 min');
  assert.equal(formatHoldMinutes(3600), '60 min');
  assert.equal(formatHoldMinutes(7200), '120 min');
});
