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

  assert.equal(invalidCase.valid, false);
  assert.match(invalidCase.fieldErrors.maxOpenPositions, /between 1 and 10/);
  assert.match(invalidCase.fieldErrors.minLiquidityUsd, /\$10,000/);
  assert.match(invalidCase.fieldErrors.minQualityScore, /between 50 and 100/);
  assert.match(invalidCase.fieldErrors['trailingLadder.0.allowedDropPct'], /less than Peak %/);
  assert.match(invalidCase.fieldErrors.customMaxPoolAgeMinutes, />= Min Coin Age/);
});
