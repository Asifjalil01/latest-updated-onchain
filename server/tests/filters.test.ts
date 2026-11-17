import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { evaluateHardFilters, validateCandidateData } from '../engine/filters';
import type { CandidateToken } from '../types';

function makeMatureCleanToken(nowMs: number): CandidateToken {
  return {
    mint: 'So11111111111111111111111111111111111111113',
    symbol: 'MATURE',
    name: 'Mature Token',
    source: 'dexscreener',
    dex: 'raydium',
    pairAddress: 'Pair111111111111111111111111111111111111111',
    poolCreatedAtMs: nowMs - 120 * 60_000, // 2 hours old
    priceUsd: 0.25,
    priceSol: 0.00125,
    liquidityUsd: 85_000,
    volume24hUsd: 240_000,
    fdvUsd: 1_200_000,
    txCount24h: 850,
    buys24h: 520,
    sells24h: 330,
    uniqueTraders24h: 390,
    priceChange1hPct: 4.2,
    priceChange24hPct: 12.5,
    rawUpdatedAtMs: nowMs,
  };
}

test('filters: rejects coin at age 60 seconds', () => {
  const now = 1_760_000_000_000;
  const youngToken: CandidateToken = {
    ...makeMatureCleanToken(now),
    poolCreatedAtMs: now - 60_000, // 60 seconds old
  };
  const res = evaluateHardFilters(youngToken, DEFAULT_SETTINGS, 0.3, now);
  assert.equal(res.passed, false);
  assert.ok(res.reasons.some((r) => r.toLowerCase().includes('pool age')));
});

test('filters: rejects low liquidity', () => {
  const now = 1_760_000_000_000;
  const lowLiqToken: CandidateToken = {
    ...makeMatureCleanToken(now),
    liquidityUsd: 12_000, // below $25,000 floor
  };
  const res = evaluateHardFilters(lowLiqToken, DEFAULT_SETTINGS, 0.3, now);
  assert.equal(res.passed, false);
  assert.ok(res.reasons.some((r) => r.toLowerCase().includes('liquidity')));
});

test('filters: accepts a clean mature coin', () => {
  const now = 1_760_000_000_000;
  const clean = makeMatureCleanToken(now);
  assert.equal(validateCandidateData(clean).valid, true);
  const res = evaluateHardFilters(clean, DEFAULT_SETTINGS, 0.35, now);
  assert.equal(res.passed, true, `Unexpected rejection: ${res.reasons.join('; ')}`);
});
