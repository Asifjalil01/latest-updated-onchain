import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { evaluateHardFilters, validateCandidateData } from '../engine/filters';
import { scoreCandidate } from '../engine/scoring';
import { BotDatabase } from '../store/db';
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

test('filters, scoring & sizing: New Launches Only (5s-300s), unlimited $0/$1 liquidity, and optional Min Quality/Trade Score checkbox', async () => {
  const { calculatePositionSize } = await import('../engine/sizing');
  const now = 1_760_000_000_000;
  const newLaunchSettings = {
    ...DEFAULT_SETTINGS,
    newLaunchOnlyEnabled: true,
    newLaunchMinAgeSeconds: 5,
    newLaunchMaxAgeSeconds: 300,
    minLiquidityUsd: 0,
    enforceMinScores: false,
  };

  const brandNew10s: CandidateToken = {
    mint: 'NewLaunch10s1111111111111111111111111111111',
    symbol: 'NEW10S',
    name: 'Brand New 10s Launch',
    source: 'pumpportal_ws',
    dex: 'pumpfun',
    pairAddress: 'PairNew10s1111111111111111111111111111111',
    poolCreatedAtMs: now - 10_000, // 10s old
    priceUsd: 0.000012,
    priceSol: 0.00000016,
    liquidityUsd: 0, // $0 initial pre-migration / unindexed liquidity
    volume24hUsd: 0,
    fdvUsd: 4_500,
    txCount24h: 0,
    buys24h: 0,
    sells24h: 0,
    uniqueTraders24h: 0,
    priceChange1hPct: Number.NaN,
    priceChange24hPct: Number.NaN,
    rawUpdatedAtMs: now,
  };

  assert.equal(validateCandidateData(brandNew10s, newLaunchSettings).valid, true);
  const filter10s = evaluateHardFilters(brandNew10s, newLaunchSettings, 0.5, now);
  assert.equal(filter10s.passed, true, `Unexpected 10s rejection: ${filter10s.reasons.join('; ')}`);

  // 60s old with $1 liquidity also passes
  const brandNew60s: CandidateToken = {
    ...brandNew10s,
    mint: 'NewLaunch60s1111111111111111111111111111111',
    poolCreatedAtMs: now - 60_000,
    liquidityUsd: 1,
  };
  assert.equal(validateCandidateData(brandNew60s, { ...newLaunchSettings, minLiquidityUsd: 1 }).valid, true);
  assert.equal(
    evaluateHardFilters(brandNew60s, { ...newLaunchSettings, minLiquidityUsd: 1 }, 0.5, now).passed,
    true
  );

  // 360s (6m) old is rejected because max launch age is 300s
  const tooOld6m: CandidateToken = {
    ...brandNew10s,
    poolCreatedAtMs: now - 360_000,
  };
  const filter6m = evaluateHardFilters(tooOld6m, newLaunchSettings, 0.5, now);
  assert.equal(filter6m.passed, false);
  assert.ok(filter6m.reasons.some((r) => r.includes('New Launches Only')));

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
    sellRouteImpactPct: 0.5,
    sellTaxPct: 0,
    tradingEnabled: true,
  };

  // enforceMinScores: false approves even low-score brand-new coin
  const scoredBypass = scoreCandidate({
    token: brandNew10s,
    filterResult: filter10s,
    securityReport: cleanSec,
    settings: newLaunchSettings,
    nowMs: now,
  });
  assert.equal(scoredBypass.decision, 'BUY', `Expected BUY with enforceMinScores=false, got: ${scoredBypass.reasons.join('; ')}`);

  // enforceMinScores: true rejects when score thresholds are high
  const scoredEnforced = scoreCandidate({
    token: brandNew10s,
    filterResult: filter10s,
    securityReport: cleanSec,
    settings: { ...newLaunchSettings, enforceMinScores: true, minQualityScore: 95, minTradeScore: 95 },
    nowMs: now,
  });
  assert.equal(scoredEnforced.decision, 'REJECT');
  assert.ok(scoredEnforced.reasons.some((r) => r.includes('Quality score') || r.includes('Trade score')));

  // Sizing does not zero-cap when user explicitly sets minLiquidityUsd=$0 / $1
  const sizing = calculatePositionSize({
    settings: newLaunchSettings,
    availableBalanceSol: 5,
    currentExposureSol: 0,
    openPositionsCount: 0,
    dailyRealizedPnlSol: 0,
    poolLiquidityUsd: 1,
    solPriceUsd: 72,
    tokenClassMultiplier: scoredBypass.sizeMultiplier,
  });
  assert.equal(sizing.approved, true, `Unexpected sizing block: ${sizing.reason}`);
  assert.ok(sizing.solAmount > 0);
});

test('scoring & db: disabled enforceMinScores promotes high_risk_micro to meme and clearScoreStageRejections removes stale [SCORE] rows', () => {
  const now = 1_760_000_000_000;
  const settingsNoScoreGate = {
    ...DEFAULT_SETTINGS,
    minLiquidityUsd: 1_000,
    customAgeWindowEnabled: false,
    newLaunchOnlyEnabled: false,
    enforceMinScores: false,
    minQualityScore: 95,
    minTradeScore: 95,
  };

  // Mature enough (>= 30m) and passes liquidity floor ($1k) with low volume (would fail score thresholds if enabled)
  const lowScoreToken: CandidateToken = {
    ...makeMatureCleanToken(now),
    mint: 'LowScore111111111111111111111111111111111111',
    symbol: 'LOWSC',
    poolCreatedAtMs: now - 45 * 60_000,
    liquidityUsd: 1_500,
    fdvUsd: 15_000,
    volume24hUsd: 2_000,
    txCount24h: 25,
    buys24h: 15,
    sells24h: 10,
    uniqueTraders24h: 12,
    priceChange1hPct: 1,
    priceChange24hPct: 1,
  };

  // Force high_risk_micro path by testing a young candidate that cleared custom/hard filter or passed filterResult directly
  const passedFilter = evaluateHardFilters(lowScoreToken, settingsNoScoreGate, 0.4, now);
  assert.equal(passedFilter.passed, true);

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

  const youngButFilteredToken: CandidateToken = {
    ...lowScoreToken,
    poolCreatedAtMs: now - 20 * 60_000, // 20m old: classifyToken marks high_risk_micro when customAgeWindowEnabled is false
  };
  const scored = scoreCandidate({
    token: youngButFilteredToken,
    filterResult: { ...passedFilter, computed: { ...passedFilter.computed, poolAgeMinutes: 20 } },
    securityReport: cleanSec,
    settings: settingsNoScoreGate,
    nowMs: now,
  });

  assert.equal(scored.tokenClass, 'meme');
  assert.equal(scored.decision, 'BUY');
  assert.ok(scored.warnings.some((w) => w.includes('score check bypassed')));

  // Verify DB clears stale [SCORE] rejections while keeping HARD_FILTER rejections
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-score-db-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  try {
    db.upsertSeenToken({
      mint: 'ScoreRej11111111111111111111111111111111111',
      symbol: 'SCOREREJ',
      name: 'Score Rejected',
      source: 'dexscreener',
      dex: 'raydium',
      lastScannedMs: now,
      lastQualityScore: 52,
      lastTradeScore: 48,
      lastDecision: 'REJECT',
      lastReason: '[SCORE] Trade score 48 < 55 threshold',
      liquidityUsd: 20000,
      priceUsd: 0.01,
      explanationJson: '{}',
      nowMs: now,
    });
    db.upsertSeenToken({
      mint: 'FilterRej1111111111111111111111111111111111',
      symbol: 'FILTREJ',
      name: 'Filter Rejected',
      source: 'dexscreener',
      dex: 'raydium',
      lastScannedMs: now,
      lastQualityScore: 0,
      lastTradeScore: 0,
      lastDecision: 'REJECT',
      lastReason: '[HARD_FILTER] Liquidity $500 < $25000',
      liquidityUsd: 500,
      priceUsd: 0.01,
      explanationJson: '{}',
      nowMs: now,
    });
    db.insertRejection({
      mint: 'ScoreRej11111111111111111111111111111111111',
      symbol: 'SCOREREJ',
      source: 'dexscreener',
      stage: 'SCORE',
      reason: 'Trade score 48 < 55 threshold',
      qualityScore: 52,
      tradeScore: 48,
      createdAtMs: now,
      detailsJson: '{}',
    });

    const cleared = db.clearScoreStageRejections();
    assert.equal(cleared, 2);
    const remainingSeen = db.getSeenTokens(50);
    assert.equal(remainingSeen.length, 1);
    assert.equal(remainingSeen[0].symbol, 'FILTREJ');
    assert.equal(db.getRejections(50).length, 0);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('filters: rejects active 5m dump, parabolic 5m blow-off spike, and 5m/1h sell pressure while accepting steady 5m continuation', () => {
  const now = 1_760_000_000_000;

  // Token looks great on 1h/24h, but is dumping -4.2% in the last 5m
  const dumping5m: CandidateToken = {
    ...makeMatureCleanToken(now),
    priceChange5mPct: -4.2,
    buys5m: 12,
    sells5m: 12,
    buys1h: 60,
    sells1h: 40,
  };
  const dumpRes = evaluateHardFilters(dumping5m, DEFAULT_SETTINGS, 0.3, now);
  assert.equal(dumpRes.passed, false);
  assert.ok(dumpRes.reasons.some((r) => r.includes('5m price change')));

  // Parabolic +32% 5m blow-off spike
  const spike5m: CandidateToken = {
    ...makeMatureCleanToken(now),
    priceChange5mPct: 32.0,
    buys5m: 20,
    sells5m: 5,
  };
  const spikeRes = evaluateHardFilters(spike5m, DEFAULT_SETTINGS, 0.3, now);
  assert.equal(spikeRes.passed, false);
  assert.ok(spikeRes.reasons.some((r) => r.includes('Parabolic 5m spike')));

  // Heavy 5m sell pressure (4 buys vs 16 sells = 20% buy ratio across 20 txns)
  const sellFlow5m: CandidateToken = {
    ...makeMatureCleanToken(now),
    priceChange5mPct: 0.4,
    buys5m: 4,
    sells5m: 16,
  };
  const sellFlow5mRes = evaluateHardFilters(sellFlow5m, DEFAULT_SETTINGS, 0.3, now);
  assert.equal(sellFlow5mRes.passed, false);
  assert.ok(sellFlow5mRes.reasons.some((r) => r.includes('5m sell pressure dominant')));

  // Heavy 1h sell pressure (15 buys vs 35 sells = 30% buy ratio across 50 txns)
  const sellFlow1h: CandidateToken = {
    ...makeMatureCleanToken(now),
    priceChange5mPct: 0.5,
    buys5m: 6,
    sells5m: 2,
    buys1h: 15,
    sells1h: 35,
  };
  const sellFlow1hRes = evaluateHardFilters(sellFlow1h, DEFAULT_SETTINGS, 0.3, now);
  assert.equal(sellFlow1hRes.passed, false);
  assert.ok(sellFlow1hRes.reasons.some((r) => r.includes('1h sell pressure dominant')));

  // Healthy +2.1% 5m continuation with strong 5m/1h buy flow passes
  const healthy5m: CandidateToken = {
    ...makeMatureCleanToken(now),
    priceChange5mPct: 2.1,
    buys5m: 18,
    sells5m: 6,
    buys1h: 90,
    sells1h: 40,
  };
  const healthyRes = evaluateHardFilters(healthy5m, DEFAULT_SETTINGS, 0.3, now);
  assert.equal(healthyRes.passed, true, `Unexpected rejection: ${healthyRes.reasons.join('; ')}`);
});

test('v1.37.0: optionToggles false disables minLiquidityUsd, minPoolAgeMinutes, and sizing caps', async () => {
  const { calculatePositionSize } = await import('../engine/sizing');
  const now = 1_760_000_000_000;
  const youngZeroLiq: CandidateToken = {
    ...makeMatureCleanToken(now),
    poolCreatedAtMs: now - 4 * 60_000, // 4m old (< 30m default)
    liquidityUsd: 0, // $0 (< $25k default)
    priceChange1hPct: Number.NaN,
    priceChange24hPct: Number.NaN,
    volume24hUsd: 100,
    txCount24h: 10,
    uniqueTraders24h: 5,
  };

  // Enabled -> rejects
  assert.equal(validateCandidateData(youngZeroLiq, DEFAULT_SETTINGS).valid, false);

  // Unchecked minLiquidityUsd & minPoolAgeMinutes -> bot ignores both rules completely
  const togglesOffSettings = {
    ...DEFAULT_SETTINGS,
    minLiquidityUsd: 50_000,
    minPoolAgeMinutes: 120,
    optionToggles: {
      minLiquidityUsd: false,
      minPoolAgeMinutes: false,
      maxOpenPositions: false,
      dailyLossLimitSol: false,
      maxWalletExposureSol: false,
    },
  };
  assert.equal(validateCandidateData(youngZeroLiq, togglesOffSettings).valid, true);
  const res = evaluateHardFilters(youngZeroLiq, togglesOffSettings, 0.5, now);
  assert.equal(res.passed, true, `Expected disabled liq/age rules to pass, got: ${res.reasons.join('; ')}`);

  // Sizing ignores maxOpenPositions, dailyLossLimitSol, and maxWalletExposureSol when unchecked
  const sizingBypassed = calculatePositionSize({
    settings: togglesOffSettings,
    availableBalanceSol: 2,
    currentExposureSol: 10, // > 0.1 maxWalletExposureSol
    openPositionsCount: 10, // > 3 maxOpenPositions
    dailyRealizedPnlSol: -5, // worse than -0.15 dailyLossLimitSol
    poolLiquidityUsd: 50_000,
    solPriceUsd: 100,
    tokenClassMultiplier: 1,
  });
  assert.equal(sizingBypassed.approved, true, `Unexpected sizing block: ${sizingBypassed.reason}`);

  // Unchecking tradeSizeSol pauses new buys explicitly
  const sizingPaused = calculatePositionSize({
    settings: {
      ...togglesOffSettings,
      optionToggles: { ...togglesOffSettings.optionToggles, tradeSizeSol: false },
    },
    availableBalanceSol: 2,
    currentExposureSol: 0,
    openPositionsCount: 0,
    dailyRealizedPnlSol: 0,
    poolLiquidityUsd: 50_000,
    solPriceUsd: 100,
    tokenClassMultiplier: 1,
  });
  assert.equal(sizingPaused.approved, false);
  assert.equal(sizingPaused.cappedBy, 'TRADE_SIZE_DISABLED');
});

