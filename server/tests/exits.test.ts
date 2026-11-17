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

test('exits: enforces 20% hard maximum stop-loss', () => {
  const validation = validateSettingsUpdate(DEFAULT_SETTINGS, { stopLossPct: 25, takeProfitPct: 50 });
  assert.equal(validation.valid, false);

  // Even if exitParams somehow had 35%, evaluator enforces hard 20% cap
  const pos = makePosition({
    exitParams: { ...snapshotExitParams(DEFAULT_SETTINGS, 1.5), stopLossPct: 35 },
  });
  const res = evaluatePositionExit(pos, {
    currentPriceUsd: 0.79, // -21%
    currentLiquidityUsd: 100_000,
  });
  assert.equal(res.shouldExit, true);
  assert.equal(res.reason, 'STOP_LOSS');
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

test('exits: validateSettingsUpdate syncs stopLossPct from stopLossTiers and enforces TP >= 1.5x max SL', () => {
  const valid = validateSettingsUpdate(DEFAULT_SETTINGS, {
    stopLossTiers: [
      { triggerDropPct: 5, sellPct: 40 },
      { triggerDropPct: 10, sellPct: 100 },
    ],
    takeProfitPct: 18,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.merged.stopLossPct, 10);

  const invalidTp = validateSettingsUpdate(DEFAULT_SETTINGS, {
    stopLossTiers: [{ triggerDropPct: 15, sellPct: 100 }],
    takeProfitPct: 18,
  });
  assert.equal(invalidTp.valid, false);
  assert.ok(invalidTp.errors.some((e) => e.includes('Take-profit')));

  const invalidMaxCap = validateSettingsUpdate(DEFAULT_SETTINGS, {
    stopLossTiers: [{ triggerDropPct: 22, sellPct: 100 }],
    takeProfitPct: 40,
  });
  assert.equal(invalidMaxCap.valid, false);
});
