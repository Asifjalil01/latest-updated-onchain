import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, validateSettingsUpdate } from '../config/defaults';
import { evaluatePositionExit } from '../engine/exits';
import { snapshotExitParams } from '../engine/fees';
import { BotDatabase } from '../store/db';
import type { PositionRecord } from '../types';

function makePosition(overrides: Partial<PositionRecord> = {}): PositionRecord {
  const exitParams = snapshotExitParams(DEFAULT_SETTINGS, 1.5);
  return {
    id: 'pos_1',
    mode: 'paper',
    mint: 'Mint1111111111111111111111111111111111111111',
    symbol: 'TEST',
    name: 'Test Token',
    source: 'dexscreener',
    dex: 'raydium',
    tokenClass: 'early_stage',
    status: 'OPEN',
    openedAtMs: 1_760_000_000_000,
    updatedAtMs: 1_760_000_000_000,
    tokenAgeAtEntryMin: 120,
    decimals: 6,
    quantity: 1000,
    entryPriceUsd: 1.0,
    entryPriceSol: 0.005,
    currentPriceUsd: 1.0,
    currentPriceSol: 0.005,
    breakEvenPriceUsd: 1.015,
    breakEvenPriceSol: 0.005075,
    entryLiquidityUsd: 100_000,
    currentLiquidityUsd: 100_000,
    solIn: 0.05,
    entryFeesSol: 0.0003,
    entryRentSol: 0.00203928,
    solPriceUsdAtEntry: 200,
    peakPriceUsd: 1.0,
    peakPnlPct: 0,
    trailingFloorPct: null,
    trailingArmed: false,
    gapDownTriggered: false,
    exitParams,
    txBuy: 'sig1',
    confirmationLabel: 'simulated',
    qualityScore: 82,
    tradeScore: 78,
    explanationJson: '{}',
    sellAttempts: 0,
    firstSellFailureAtMs: null,
    lastSellError: null,
    consecutiveZeroBalanceReads: 0,
    reviewReason: null,
    isStaleData: false,
    priceHistory: [1.0],
    ...overrides,
  };
}

test('exits: allows custom stop-loss above 20% and unlimited take-profit while rejecting < 0.5% SL', () => {
  const invalidLowSl = validateSettingsUpdate(DEFAULT_SETTINGS, { stopLossPct: 0.2, takeProfitPct: 50 });
  assert.equal(invalidLowSl.valid, false);

  const highSlAndTp = validateSettingsUpdate(DEFAULT_SETTINGS, {
    stopLossTiers: [{ triggerDropPct: 35, sellPct: 100 }],
    takeProfitPct: 1000,
  });
  assert.equal(highSlAndTp.valid, true);
  assert.equal(highSlAndTp.merged.stopLossPct, 35);
  assert.equal(highSlAndTp.merged.takeProfitPct, 1000);

  // Position with 35% stop-loss should NOT stop out early at -21%, and SHOULD exit at -36%
  const customSettings = { ...DEFAULT_SETTINGS, stopLossPct: 35, stopLossTiers: [{ triggerDropPct: 35, sellPct: 100 }], takeProfitPct: 1000 };
  const pos = makePosition({
    exitParams: snapshotExitParams(customSettings, 1.5),
  });
  const evalTime = pos.openedAtMs + 60_000;
  const atMinus21 = evaluatePositionExit(pos, {
    currentPriceUsd: 0.79, // -21%
    currentLiquidityUsd: 100_000,
    nowMs: evalTime,
  });
  assert.equal(atMinus21.shouldExit, false);

  const atMinus36 = evaluatePositionExit(pos, {
    currentPriceUsd: 0.64, // -36%
    currentLiquidityUsd: 100_000,
    nowMs: evalTime + 5_000,
  });
  assert.equal(atMinus36.shouldExit, true);
  assert.equal(atMinus36.reason, 'STOP_LOSS');

  // Rising past all trailing tiers (+500%) holds while still climbing, then exits at +1000% TP
  const atPlus500 = evaluatePositionExit(pos, {
    currentPriceUsd: 6.0, // +500%
    currentLiquidityUsd: 100_000,
    nowMs: evalTime + 10_000,
  });
  assert.equal(atPlus500.shouldExit, false);

  const atPlus1000 = evaluatePositionExit(pos, {
    currentPriceUsd: 11.0, // +1000%
    currentLiquidityUsd: 100_000,
    nowMs: evalTime + 15_000,
  });
  assert.equal(atPlus1000.shouldExit, true);
  assert.equal(atPlus1000.reason, 'TAKE_PROFIT');
});

test('exits: settings update does not alter an open position exit parameters', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-exits-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  try {
    const pos = makePosition();
    db.upsertPosition(pos);

    // Change global settings stopLossPct from 8 to 15 and takeProfitPct to 30
    const upd = db.updateSettings({ stopLossPct: 15, takeProfitPct: 30 });
    assert.equal(upd.valid, true);

    const loaded = db.getPositionById(pos.id);
    assert.ok(loaded);
    assert.equal(loaded.exitParams.stopLossPct, 8);
    assert.equal(loaded.exitParams.takeProfitPct, 18);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exits: stepped trailing ladder arms after clearing costs and exits on pullback', () => {
  let pos = makePosition();
  // Peak reaches +14% -> tier peakGainPct=12 allows 3.0% drop -> floor = +11%
  const step1 = evaluatePositionExit(pos, {
    currentPriceUsd: 1.14,
    currentLiquidityUsd: 100_000,
  });
  assert.equal(step1.shouldExit, false);
  assert.equal(step1.updatedTrailingArmed, true);
  assert.ok(step1.updatedTrailingFloorPct !== null && step1.updatedTrailingFloorPct >= 10.9);

  pos = {
    ...pos,
    peakPriceUsd: step1.updatedPeakPriceUsd,
    peakPnlPct: step1.updatedPeakPnlPct,
    trailingArmed: step1.updatedTrailingArmed,
    trailingFloorPct: step1.updatedTrailingFloorPct,
  };

  // Price drops back to +10.5% (below +11% floor) -> triggers TRAILING_STOP
  const step2 = evaluatePositionExit(pos, {
    currentPriceUsd: 1.105,
    currentLiquidityUsd: 100_000,
  });
  assert.equal(step2.shouldExit, true);
  assert.equal(step2.reason, 'TRAILING_STOP');
});

test('exits: break-even recovery watch exits after prior gap-down recovers to break-even', () => {
  let pos = makePosition({
    exitParams: {
      ...snapshotExitParams(DEFAULT_SETTINGS, 1.5),
      stopLossTiers: [{ triggerDropPct: 8, sellPct: 100 }],
    },
  });
  const evalTime = pos.openedAtMs + 10 * 60_000;
  // Drop to -6.5% (75% of 8% SL = 6% -> arms gapDownTriggered without hitting -8% SL)
  const down = evaluatePositionExit(pos, {
    currentPriceUsd: 0.935,
    currentLiquidityUsd: 100_000,
    nowMs: evalTime,
  });
  assert.equal(down.shouldExit, false);
  assert.equal(down.updatedGapDownTriggered, true);

  pos = { ...pos, gapDownTriggered: down.updatedGapDownTriggered };

  // Recovers back to break-even ($1.016 >= $1.015 break-even)
  const rec = evaluatePositionExit(pos, {
    currentPriceUsd: 1.016,
    currentLiquidityUsd: 100_000,
    nowMs: evalTime + 60_000,
  });
  assert.equal(rec.shouldExit, true);
  assert.equal(rec.reason, 'BREAK_EVEN_RECOVERY');
});

test('exits: custom stop-loss tiers trigger partial sell then skip triggered tier before final stop', () => {
  let pos = makePosition();
  const evalTime = pos.openedAtMs + 60_000;

  // Drop to -4.2% -> hits 4.0% tier (50% sell)
  const tier1 = evaluatePositionExit(pos, {
    currentPriceUsd: 0.958,
    currentLiquidityUsd: 100_000,
    nowMs: evalTime,
  });
  assert.equal(tier1.shouldExit, true);
  assert.equal(tier1.reason, 'STOP_LOSS');
  assert.equal(tier1.sellFraction, 0.5);
  assert.equal(tier1.triggeredStopLossTier, 4.0);

  // Mark 4.0% tier triggered; holding at -5.0% should not re-trigger 4.0%
  pos = {
    ...pos,
    quantity: 500,
    triggeredStopLossTiers: [4.0],
  };
  const mid = evaluatePositionExit(pos, {
    currentPriceUsd: 0.95,
    currentLiquidityUsd: 100_000,
    nowMs: evalTime + 10_000,
  });
  assert.equal(mid.shouldExit, false);

  // Drop to -8.1% -> hits final 8.0% hard stop (100% sell)
  const finalStop = evaluatePositionExit(pos, {
    currentPriceUsd: 0.919,
    currentLiquidityUsd: 100_000,
    nowMs: evalTime + 20_000,
  });
  assert.equal(finalStop.shouldExit, true);
  assert.equal(finalStop.reason, 'STOP_LOSS');
  assert.equal(finalStop.sellFraction, 1);
});

test('exits: validateSettingsUpdate syncs stopLossPct from stopLossTiers and allows independent wide SL with lower TP', () => {
  const valid = validateSettingsUpdate(DEFAULT_SETTINGS, {
    stopLossTiers: [
      { triggerDropPct: 5, sellPct: 40 },
      { triggerDropPct: 10, sellPct: 100 },
    ],
    takeProfitPct: 18,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.merged.stopLossPct, 10);

  // User case: wide 90% stop-loss paired with 25% take-profit should save & execute TP at +25%
  const wideSlLowTp = validateSettingsUpdate(DEFAULT_SETTINGS, {
    stopLossTiers: [{ triggerDropPct: 90, sellPct: 100 }],
    takeProfitPct: 25,
  });
  assert.equal(wideSlLowTp.valid, true);
  assert.equal(wideSlLowTp.merged.stopLossPct, 90);
  assert.equal(wideSlLowTp.merged.takeProfitPct, 25);

  const snap = snapshotExitParams(wideSlLowTp.merged, 1.5);
  assert.equal(snap.takeProfitPct, 25);
  const pos = makePosition({ exitParams: snap });
  const atTp = evaluatePositionExit(pos, {
    currentPriceUsd: 1.25, // +25%
    currentLiquidityUsd: 100_000,
    nowMs: pos.openedAtMs + 60_000,
  });
  assert.equal(atTp.shouldExit, true);
  assert.equal(atTp.reason, 'TAKE_PROFIT');

  const validUnlimited = validateSettingsUpdate(DEFAULT_SETTINGS, {
    stopLossTiers: [{ triggerDropPct: 45, sellPct: 100 }],
    takeProfitPct: 1000,
    trailingLadder: Array.from({ length: 20 }, (_, i) => ({
      peakGainPct: (i + 1) * 5,
      allowedDropPct: 2,
    })),
  });
  assert.equal(validUnlimited.valid, true);
  assert.equal(validUnlimited.merged.stopLossPct, 45);
  assert.equal(validUnlimited.merged.trailingLadder.length, 20);

  const invalidBelowMin = validateSettingsUpdate(DEFAULT_SETTINGS, {
    stopLossTiers: [{ triggerDropPct: 0.2, sellPct: 100 }],
    takeProfitPct: 40,
  });
  assert.equal(invalidBelowMin.valid, false);
  assert.ok(invalidBelowMin.fieldErrors['stopLossTiers.0.triggerDropPct']);
});

test('exits: trailing stop never arms or locks floor below round-trip break-even costs', () => {
  // Simulate 0.045 SOL trade with 5.51% round-trip cost (fees + ATA rent + est exit fees)
  let pos = makePosition({
    solIn: 0.045,
    exitParams: {
      ...snapshotExitParams(DEFAULT_SETTINGS, 5.51),
      trailingLadder: [
        { peakGainPct: 4, allowedDropPct: 2.5 },
        { peakGainPct: 8, allowedDropPct: 3.0 },
      ],
    },
  });

  // Peak at +5.8% exceeds roundTripCostPct (5.51%) slightly, but is below +6.51% arm threshold
  const tooEarly = evaluatePositionExit(pos, {
    currentPriceUsd: 1.058,
    currentLiquidityUsd: 100_000,
    nowMs: pos.openedAtMs + 60_000,
  });
  assert.equal(tooEarly.updatedTrailingArmed, false);
  assert.equal(tooEarly.updatedTrailingFloorPct, null);
  assert.equal(tooEarly.shouldExit, false);

  // Peak reaches +6.6% (>= 5.51 + 1.0 = 6.51%) -> arms and locks floor >= 5.51 + 0.5 = 6.01%
  const armed = evaluatePositionExit(pos, {
    currentPriceUsd: 1.066,
    currentLiquidityUsd: 100_000,
    nowMs: pos.openedAtMs + 70_000,
  });
  assert.equal(armed.updatedTrailingArmed, true);
  assert.ok(
    armed.updatedTrailingFloorPct !== null && armed.updatedTrailingFloorPct >= 6.0,
    `Expected trailing floor >= 6.01%, got ${armed.updatedTrailingFloorPct}`
  );
  assert.equal(armed.shouldExit, false);

  // Pullback to +5.9% triggers TRAILING_STOP above true round-trip break-even (5.51%)
  pos = {
    ...pos,
    peakPriceUsd: armed.updatedPeakPriceUsd,
    peakPnlPct: armed.updatedPeakPnlPct,
    trailingArmed: armed.updatedTrailingArmed,
    trailingFloorPct: armed.updatedTrailingFloorPct,
  };
  const exitRes = evaluatePositionExit(pos, {
    currentPriceUsd: 1.059,
    currentLiquidityUsd: 100_000,
    nowMs: pos.openedAtMs + 80_000,
  });
  assert.equal(exitRes.shouldExit, true);
  assert.equal(exitRes.reason, 'TRAILING_STOP');
  assert.ok(exitRes.netPnlPctEstimate > 0);
});
