import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { validateSettingsDraft } from '../../src/utils/settingsValidation';

test('settingsValidation: accepts 90% SL with 25% TP and highlights specific invalid boxes with range messages', () => {
  const validCase = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    stopLossPct: 90,
    stopLossTiers: [{ triggerDropPct: 90, sellPct: 100 }],
    takeProfitPct: 25,
  });
  assert.equal(validCase.valid, true);
  assert.deepEqual(validCase.fieldErrors, {});

  const invalidCase = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    maxOpenPositions: 25,
    minLiquidityUsd: 2000,
    minQualityScore: 30,
    trailingLadder: [{ peakGainPct: 5, allowedDropPct: 6 }],
    customAgeWindowEnabled: true,
    customMinPoolAgeMinutes: 30,
    customMaxPoolAgeMinutes: 10,
  });

  const customMicroLiquidity = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    customAgeWindowEnabled: true,
    customMinPoolAgeMinutes: 1,
    customMaxPoolAgeMinutes: 5,
    minLiquidityUsd: 300,
  });
  assert.equal(customMicroLiquidity.valid, true);

  const microLiquidityCases = [0, 1, 50, 2000, 1_000_000];
  for (const liq of microLiquidityCases) {
    const res = validateSettingsDraft({
      ...DEFAULT_SETTINGS,
      customAgeWindowEnabled: false,
      newLaunchOnlyEnabled: false,
      minLiquidityUsd: liq,
    });
    assert.equal(res.valid, true, `Expected minLiquidityUsd=$${liq} to be valid`);
  }

  const negativeLiq = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    minLiquidityUsd: -1,
  });
  assert.equal(negativeLiq.valid, false);
  assert.match(negativeLiq.fieldErrors.minLiquidityUsd, /\$0 or greater/);

  const newLaunchValid = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    newLaunchOnlyEnabled: true,
    newLaunchMinAgeSeconds: 5,
    newLaunchMaxAgeSeconds: 300,
    minLiquidityUsd: 0,
  });
  assert.equal(newLaunchValid.valid, true);

  const newLaunchInvalidBounds = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    newLaunchOnlyEnabled: true,
    newLaunchMinAgeSeconds: 120,
    newLaunchMaxAgeSeconds: 60,
  });
  assert.equal(newLaunchInvalidBounds.valid, false);
  assert.match(newLaunchInvalidBounds.fieldErrors.newLaunchMaxAgeSeconds, />= Min Launch Age/);

  const uncheckedRulesPass = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    enforceMaxTop10Holders: false,
    maxTop10HoldersPct: 99,
    enforceMinScores: false,
    minQualityScore: 10,
    minTradeScore: 10,
  });
  assert.equal(uncheckedRulesPass.valid, true);

  assert.equal(invalidCase.valid, false);
  assert.match(invalidCase.fieldErrors.maxOpenPositions, /between 1 and 10/);
  assert.match(invalidCase.fieldErrors.minQualityScore, /between 50 and 100/);
  assert.match(invalidCase.fieldErrors['trailingLadder.0.allowedDropPct'], /less than Peak %/);
  assert.match(invalidCase.fieldErrors.customMaxPoolAgeMinutes, />= Min Coin Age/);
});

test('v1.37.0: optionToggles skip validation for unchecked rules and validate creator history bounds when enabled', () => {
  const skippedWhenUnchecked = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    tradeSizeSol: 0,
    takeProfitPct: 0,
    maxOpenPositions: 0,
    dailyLossLimitSol: 0,
    minLiquidityUsd: -50,
    minPoolAgeMinutes: 0,
    maxCreatorLaunches: -5,
    optionToggles: {
      tradeSizeSol: false,
      takeProfitPct: false,
      maxOpenPositions: false,
      dailyLossLimitSol: false,
      minLiquidityUsd: false,
      minPoolAgeMinutes: false,
      maxCreatorLaunches: false,
    },
  });
  assert.equal(
    skippedWhenUnchecked.valid,
    true,
    `Expected disabled fields to skip validation, got: ${skippedWhenUnchecked.errors.join('; ')}`
  );

  const invalidCreatorBounds = validateSettingsDraft({
    ...DEFAULT_SETTINGS,
    creatorHistoryEnabled: true,
    maxCreatorLaunches: -1,
    maxCreatorRuggedCoins: 150,
    creatorFastRugWindowMinutes: -10,
  });
  assert.equal(invalidCreatorBounds.valid, false);
  assert.ok(invalidCreatorBounds.fieldErrors.maxCreatorLaunches);
  assert.ok(invalidCreatorBounds.fieldErrors.maxCreatorRuggedCoins);
  assert.ok(invalidCreatorBounds.fieldErrors.creatorFastRugWindowMinutes);
});

