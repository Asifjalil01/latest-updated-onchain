import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { evaluateHardFilters, validateCandidateData } from '../engine/filters';
import { scoreCandidate } from '../engine/scoring';
import type { CandidateToken, SecurityReport } from '../types';

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

test('filters: custom pool age timeframe filters strictly between min and max minutes when checked, and falls back when unchecked', () => {
  const now = 1_760_000_000_000;
  const customSettings = {
    ...DEFAULT_SETTINGS,
    customAgeWindowEnabled: true,
    customMinPoolAgeMinutes: 5,
    customMaxPoolAgeMinutes: 30,
  };

  const tooNew = { ...makeMatureCleanToken(now), poolCreatedAtMs: now - 3 * 60_000 };
  const inWindow = { ...makeMatureCleanToken(now), poolCreatedAtMs: now - 15 * 60_000 };
  const tooOld = { ...makeMatureCleanToken(now), poolCreatedAtMs: now - 45 * 60_000 };

  assert.equal(evaluateHardFilters(tooNew, customSettings, 0.3, now).passed, false);
  const inWindowFilter = evaluateHardFilters(inWindow, customSettings, 0.3, now);
  assert.equal(inWindowFilter.passed, true);
  assert.equal(evaluateHardFilters(tooOld, customSettings, 0.3, now).passed, false);

  // Scoring should not reject 15m token as high_risk_micro when custom window is enabled
  const cleanSec: SecurityReport = {
    passed: true,
    reasons: [],
    warnings: [],
    criticalFlags: [],
    sourcesAgreed: 2,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    token2022DisallowedExtensions: [],
    rugCheckScore: 10,
    rugCheckRisks: [],
    lpLockedOrBurnedPct: 95,
    top10HoldersPct: 20,
    singleMaxHolderPct: 5,
    holders: [],
    deployerFlagged: false,
    sellRouteExists: true,
    sellRouteImpactPct: 0.4,
    sellTaxPct: 0,
    tradingEnabled: true,
  };
  const scored = scoreCandidate({
    token: inWindow,
    filterResult: inWindowFilter,
    securityReport: cleanSec,
    settings: customSettings,
    nowMs: now,
  });
  assert.notEqual(scored.tokenClass, 'high_risk_micro');

  // Unchecked -> uses default 30m minimum and rejects the 15m token
  const defaultSettings = { ...customSettings, customAgeWindowEnabled: false };
  assert.equal(evaluateHardFilters(inWindow, defaultSettings, 0.3, now).passed, false);
});

test('filters: 1-5m custom pool age with $300 minLiquidityUsd passes filter, scoring, and scales emergency floor', async () => {
  const { snapshotExitParams } = await import('../engine/fees');
  const now = 1_760_000_000_000;
  const microSettings = {
    ...DEFAULT_SETTINGS,
    customAgeWindowEnabled: true,
    customMinPoolAgeMinutes: 1,
    customMaxPoolAgeMinutes: 5,
    minLiquidityUsd: 300,
    minQualityScore: 50,
    minTradeScore: 50,
  };

  const youngMicroPool: CandidateToken = {
    ...makeMatureCleanToken(now),
    poolCreatedAtMs: now - 3 * 60_000, // 3m old
    liquidityUsd: 400,
    fdvUsd: 6_000,
    volume24hUsd: 1200,
    txCount24h: 20,
    buys24h: 14,
    sells24h: 6,
    uniqueTraders24h: 10,
  };

  const filterRes = evaluateHardFilters(youngMicroPool, microSettings, 0.4, now);
  assert.equal(filterRes.passed, true, `Unexpected rejection: ${filterRes.reasons.join('; ')}`);

  const cleanSec: SecurityReport = {
    passed: true,
    reasons: [],
    warnings: [],
    criticalFlags: [],
    sourcesAgreed: 2,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    token2022DisallowedExtensions: [],
    rugCheckScore: 10,
    rugCheckRisks: [],
    lpLockedOrBurnedPct: 95,
    top10HoldersPct: 20,
    singleMaxHolderPct: 5,
    holders: [],
    deployerFlagged: false,
    sellRouteExists: true,
    sellRouteImpactPct: 0.4,
    sellTaxPct: 0,
    tradingEnabled: true,
  };

  const scored = scoreCandidate({
    token: youngMicroPool,
    filterResult: filterRes,
    securityReport: cleanSec,
    settings: microSettings,
    nowMs: now,
  });
  assert.equal(scored.tokenClass, 'meme');
  assert.equal(scored.decision, 'BUY');

  const snap = snapshotExitParams(microSettings, 1.5);
  assert.ok(
    snap.emergencyLiquidityFloorUsd <= 150,
    `Expected scaled emergency floor <= $150, got ${snap.emergencyLiquidityFloorUsd}`
  );
});

test('filters & scoring: 5-30m custom timeframe + $300 minLiquidity accepts volatile young pools with 0.05 SOL price impact while default mode rejects', () => {
  const now = 1_760_000_000_000;
  const userSettings = {
    ...DEFAULT_SETTINGS,
    tradeSizeSol: 0.05,
    customAgeWindowEnabled: true,
    customMinPoolAgeMinutes: 5,
    customMaxPoolAgeMinutes: 30,
    minLiquidityUsd: 300,
    minQualityScore: 75,
    minTradeScore: 70,
  };

  const volatile5to30mPool: CandidateToken = {
    ...makeMatureCleanToken(now),
    poolCreatedAtMs: now - 14 * 60_000, // 14m old
    liquidityUsd: 1_200,
    fdvUsd: 180_000, // 150x FDV/liq (common on new micro-pools)
    volume24hUsd: 8_500,
    txCount24h: 95,
    buys24h: 62,
    sells24h: 33,
    uniqueTraders24h: 72,
    priceChange1hPct: 240, // +240% since launch
    priceChange24hPct: 240,
  };

  // Simulated ~2.4% price impact from 0.05 SOL (~$3.62) in a $1,200 pool
  const filterRes = evaluateHardFilters(volatile5to30mPool, userSettings, 2.4, now);
  assert.equal(filterRes.passed, true, `Unexpected rejection: ${filterRes.reasons.join('; ')}`);

  const cleanSec: SecurityReport = {
    passed: true,
    reasons: [],
    warnings: [],
    criticalFlags: [],
    sourcesAgreed: 2,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    token2022DisallowedExtensions: [],
    rugCheckScore: 0,
    rugCheckRisks: [],
    lpLockedOrBurnedPct: 98,
    top10HoldersPct: 16,
    singleMaxHolderPct: 4,
    holders: [],
    deployerFlagged: false,
    sellRouteExists: true,
    sellRouteImpactPct: 2.5,
    sellTaxPct: 0,
    tradingEnabled: true,
  };

  const scored = scoreCandidate({
    token: volatile5to30mPool,
    filterResult: filterRes,
    securityReport: cleanSec,
    settings: userSettings,
    nowMs: now,
  });
  assert.equal(scored.tokenClass, 'meme');
  assert.ok(scored.qualityScore >= 75, `Expected qualityScore >= 75, got ${scored.qualityScore}`);
  assert.ok(scored.tradeScore >= 70, `Expected tradeScore >= 70, got ${scored.tradeScore}`);
  assert.equal(scored.decision, 'BUY', `Expected BUY, got rejection: ${scored.reasons.join('; ')}`);

  // Default settings (checkbox unchecked) must still reject this volatile micro-pool
  const strictDefault = evaluateHardFilters(
    volatile5to30mPool,
    { ...userSettings, customAgeWindowEnabled: false },
    2.4,
    now
  );
  assert.equal(strictDefault.passed, false);
});
