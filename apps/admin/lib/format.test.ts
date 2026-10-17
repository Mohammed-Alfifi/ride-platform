import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBps, formatSaudiPhone } from './format.ts';

test('formats Saudi mobiles the local way', () => {
  assert.equal(formatSaudiPhone('+966501234567'), '050 123 4567');
  assert.equal(formatSaudiPhone('+201001234567'), '+201001234567');
});

test('formats commission basis points', () => {
  assert.equal(formatBps(1500), '15%');
  assert.equal(formatBps(1250), '12.5%');
  assert.equal(formatBps(0), '0%');
});
