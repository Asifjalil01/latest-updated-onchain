import type { BotSettings } from '../types';

export interface SettingsValidationResult {
  valid: boolean;
  fieldErrors: Record<string, string>;
  errors: string[];
}

/**
 * Pure client-side settings validator matching all backend schema + domain limits.
 * Returns per-field error messages with exact valid ranges so the UI can highlight
 * invalid inputs/checkboxes and display an anchored popup explaining how to fix them.
 */
export function validateSettingsDraft(draft: BotSettings): SettingsValidationResult {
  const fieldErrors: Record<string, string> = {};
  const errors: string[] = [];
  const optOn = (key: string) => draft.optionToggles?.[key] !== false;

  const addError = (fieldKey: string, message: string) => {
    if (!fieldErrors[fieldKey]) {
      fieldErrors[fieldKey] = message;
    }
    if (!errors.includes(message)) {
      errors.push(message);
    }
  };

  // Position Sizing & Risk Caps
  if (
    optOn('maxWalletExposureSol') &&
    (!Number.isFinite(draft.maxWalletExposureSol) || draft.maxWalletExposureSol <= 0)
  ) {
    addError('maxWalletExposureSol', 'Must be greater than 0 SOL.');
  }
  if (
    optOn('tradeSizeSol') &&
    (!Number.isFinite(draft.tradeSizeSol) ||
      draft.tradeSizeSol <= 0 ||
      (optOn('maxWalletExposureSol') &&
        Number.isFinite(draft.maxWalletExposureSol) &&
        draft.maxWalletExposureSol > 0 &&
        draft.tradeSizeSol > draft.maxWalletExposureSol))
  ) {
    const cap = Number.isFinite(draft.maxWalletExposureSol) ? draft.maxWalletExposureSol : 0.1;
    addError(
      'tradeSizeSol',
      optOn('maxWalletExposureSol')
        ? `Must be greater than 0 and <= Max Wallet Exposure (${cap} SOL).`
        : 'Must be greater than 0 SOL.'
    );
  }
  if (
    optOn('dailyLossLimitSol') &&
    (!Number.isFinite(draft.dailyLossLimitSol) || draft.dailyLossLimitSol <= 0)
  ) {
    addError('dailyLossLimitSol', 'Must be greater than 0 SOL.');
  }
  if (!Number.isFinite(draft.gasReserveSol) || draft.gasReserveSol < 0) {
    addError('gasReserveSol', 'Must be 0 or greater.');
  }
  if (
    optOn('maxOpenPositions') &&
    (!Number.isFinite(draft.maxOpenPositions) ||
      !Number.isInteger(draft.maxOpenPositions) ||
      draft.maxOpenPositions < 1 ||
      draft.maxOpenPositions > 10)
  ) {
    addError('maxOpenPositions', 'Must be a whole number between 1 and 10.');
  }
  if (
    optOn('cooldownMinutes') &&
    (!Number.isFinite(draft.cooldownMinutes) ||
      !Number.isInteger(draft.cooldownMinutes) ||
      draft.cooldownMinutes < 0 ||
      draft.cooldownMinutes > 1440)
  ) {
    addError('cooldownMinutes', 'Must be a whole number between 0 and 1440 minutes.');
  }

  // Custom Stop-Loss Tiers
  if (draft.stopLossEnabled) {
    const tiers = draft.stopLossTiers || [];
    if (tiers.length === 0) {
      addError(
        'stopLossEnabled',
        'Add at least 1 Stop-Loss tier or uncheck "Enabled".'
      );
    }
    tiers.forEach((tier, idx) => {
      if (!Number.isFinite(tier.triggerDropPct) || tier.triggerDropPct < 0.5) {
        addError(
          `stopLossTiers.${idx}.triggerDropPct`,
          'Trigger Drop % must be at least 0.5% (no upper limit).'
        );
      }
      if (!Number.isFinite(tier.sellPct) || tier.sellPct < 1 || tier.sellPct > 100) {
        addError(
          `stopLossTiers.${idx}.sellPct`,
          'Sell % must be between 1% and 100%.'
        );
      }
    });
  }

  // Hard Filters & Security Thresholds
  if (draft.newLaunchOnlyEnabled) {
    if (!Number.isFinite(draft.newLaunchMinAgeSeconds) || draft.newLaunchMinAgeSeconds < 0) {
      addError('newLaunchMinAgeSeconds', 'Must be 0 seconds or greater.');
    }
    const minSec = Number.isFinite(draft.newLaunchMinAgeSeconds)
      ? draft.newLaunchMinAgeSeconds
      : 0;
    if (
      !Number.isFinite(draft.newLaunchMaxAgeSeconds) ||
      draft.newLaunchMaxAgeSeconds < 1 ||
      draft.newLaunchMaxAgeSeconds < minSec
    ) {
      addError(
        'newLaunchMaxAgeSeconds',
        `Must be at least 1s and >= Min Launch Age (${minSec}s).`
      );
    }
  } else if (draft.customAgeWindowEnabled) {
    if (!Number.isFinite(draft.customMinPoolAgeMinutes) || draft.customMinPoolAgeMinutes < 0) {
      addError('customMinPoolAgeMinutes', 'Must be 0 minutes or greater.');
    }
    const minAge = Number.isFinite(draft.customMinPoolAgeMinutes)
      ? draft.customMinPoolAgeMinutes
      : 0;
    if (
      !Number.isFinite(draft.customMaxPoolAgeMinutes) ||
      draft.customMaxPoolAgeMinutes <= 0 ||
      draft.customMaxPoolAgeMinutes < minAge
    ) {
      addError(
        'customMaxPoolAgeMinutes',
        `Must be greater than 0 and >= Min Coin Age (${minAge} min).`
      );
    }
  } else if (optOn('minPoolAgeMinutes')) {
    if (!Number.isFinite(draft.minPoolAgeMinutes) || draft.minPoolAgeMinutes < 30) {
      addError(
        'minPoolAgeMinutes',
        'Must be at least 30 minutes (or enable New Launches Only / Custom Pool Age Timeframe above, or uncheck to disable).'
      );
    }
  }

  if (optOn('minLiquidityUsd') && (!Number.isFinite(draft.minLiquidityUsd) || draft.minLiquidityUsd < 0)) {
    addError('minLiquidityUsd', 'Must be $0 or greater (no upper limit).');
  }
  if (
    draft.enforceMaxTop10Holders &&
    (!Number.isFinite(draft.maxTop10HoldersPct) ||
      draft.maxTop10HoldersPct < 1 ||
      draft.maxTop10HoldersPct > 50)
  ) {
    addError('maxTop10HoldersPct', 'Must be between 1% and 50%.');
  }
  if (
    draft.enforceMinScores &&
    (!Number.isFinite(draft.minQualityScore) ||
      draft.minQualityScore < 50 ||
      draft.minQualityScore > 100)
  ) {
    addError('minQualityScore', 'Quality Score must be between 50 and 100.');
  }
  if (
    draft.enforceMinScores &&
    (!Number.isFinite(draft.minTradeScore) ||
      draft.minTradeScore < 50 ||
      draft.minTradeScore > 100)
  ) {
    addError('minTradeScore', 'Trade Score must be between 50 and 100.');
  }

  // Owner / Creator History & Fast-Rug Check
  if (draft.creatorHistoryEnabled) {
    if (
      optOn('maxCreatorLaunches') &&
      (!Number.isFinite(draft.maxCreatorLaunches) ||
        draft.maxCreatorLaunches < 0 ||
        draft.maxCreatorLaunches > 500)
    ) {
      addError('maxCreatorLaunches', 'Must be between 0 and 500 prior coins.');
    }
    if (
      optOn('maxCreatorRuggedCoins') &&
      (!Number.isFinite(draft.maxCreatorRuggedCoins) ||
        draft.maxCreatorRuggedCoins < 0 ||
        draft.maxCreatorRuggedCoins > 100)
    ) {
      addError('maxCreatorRuggedCoins', 'Must be between 0 and 100 rugged coins.');
    }
    if (
      optOn('creatorFastRugWindowMinutes') &&
      (!Number.isFinite(draft.creatorFastRugWindowMinutes) ||
        draft.creatorFastRugWindowMinutes < 0 ||
        draft.creatorFastRugWindowMinutes > 10080)
    ) {
      addError('creatorFastRugWindowMinutes', 'Must be between 0 and 10080 minutes.');
    }
  }

  // Exit Rules
  if (optOn('takeProfitPct') && (!Number.isFinite(draft.takeProfitPct) || draft.takeProfitPct < 1.5)) {
    addError('takeProfitPct', 'Must be at least 1.5% (no upper limit).');
  }
  if (
    draft.maxHoldStagnationEnabled !== false &&
    optOn('maxHoldMinutes') &&
    (!Number.isFinite(draft.maxHoldMinutes) ||
      !Number.isInteger(draft.maxHoldMinutes) ||
      draft.maxHoldMinutes < 5 ||
      draft.maxHoldMinutes > 10080)
  ) {
    addError('maxHoldMinutes', 'Must be a whole number between 5 and 10080 minutes.');
  }
  if (
    optOn('emergencyLiquidityFloorUsd') &&
    (!Number.isFinite(draft.emergencyLiquidityFloorUsd) ||
      draft.emergencyLiquidityFloorUsd < 0)
  ) {
    addError('emergencyLiquidityFloorUsd', 'Must be $0 or greater.');
  }

  // Custom Stepped Trailing Exit Tiers
  if (draft.trailingEnabled) {
    const trailing = draft.trailingLadder || [];
    if (trailing.length === 0) {
      addError(
        'trailingEnabled',
        'Add at least 1 trailing tier or uncheck "Stepped Trailing Ladder".'
      );
    }
    trailing.forEach((tier, idx) => {
      if (!Number.isFinite(tier.peakGainPct) || tier.peakGainPct <= 0) {
        addError(
          `trailingLadder.${idx}.peakGainPct`,
          'Peak % must be greater than 0%.'
        );
      }
      if (
        !Number.isFinite(tier.allowedDropPct) ||
        tier.allowedDropPct <= 0 ||
        (Number.isFinite(tier.peakGainPct) && tier.allowedDropPct >= tier.peakGainPct)
      ) {
        const peak = Number.isFinite(tier.peakGainPct) ? tier.peakGainPct : 0;
        addError(
          `trailingLadder.${idx}.allowedDropPct`,
          `Allowed Drop % must be > 0 and less than Peak % (${peak}%).`
        );
      }
    });
  }

  // Paper Shadow Simulation Realism
  if (optOn('paperDelayWindow')) {
    if (
      !Number.isFinite(draft.paperDelayMinSec) ||
      draft.paperDelayMinSec < 0 ||
      draft.paperDelayMinSec > 30
    ) {
      addError('paperDelayMinSec', 'Min Delay must be between 0 and 30 seconds.');
    }
    const minDelay = Number.isFinite(draft.paperDelayMinSec) ? draft.paperDelayMinSec : 0;
    if (
      !Number.isFinite(draft.paperDelayMaxSec) ||
      draft.paperDelayMaxSec < 0 ||
      draft.paperDelayMaxSec > 60 ||
      draft.paperDelayMaxSec < minDelay
    ) {
      addError(
        'paperDelayMaxSec',
        `Max Delay must be between ${minDelay} and 60 seconds.`
      );
    }
  }
  if (optOn('paperFailChance')) {
    if (
      !Number.isFinite(draft.paperBuyFailChancePct) ||
      draft.paperBuyFailChancePct < 0 ||
      draft.paperBuyFailChancePct > 100
    ) {
      addError('paperBuyFailChancePct', 'Buy Failure % must be between 0% and 100%.');
    }
    if (
      !Number.isFinite(draft.paperSellFailChancePct) ||
      draft.paperSellFailChancePct < 0 ||
      draft.paperSellFailChancePct > 100
    ) {
      addError('paperSellFailChancePct', 'Sell Failure % must be between 0% and 100%.');
    }
  }
  if (
    optOn('paperCompetitionPenaltyPct') &&
    (!Number.isFinite(draft.paperCompetitionPenaltyPct) ||
      draft.paperCompetitionPenaltyPct < 0 ||
      draft.paperCompetitionPenaltyPct > 20)
  ) {
    addError('paperCompetitionPenaltyPct', 'Must be between 0% and 20%.');
  }

  // Pro Desk options (validated only when their checkbox/toggle is active)
  if (draft.antiSybilEnabled && optOn('antiSybilEnabled')) {
    if (!Number.isFinite(draft.freshWalletMinutes) || draft.freshWalletMinutes < 1 || draft.freshWalletMinutes > 1440) {
      addError('freshWalletMinutes', 'Fresh wallet window must be between 1 and 1440 minutes.');
    }
    if (!Number.isFinite(draft.maxSharedFunderCount) || draft.maxSharedFunderCount < 2 || draft.maxSharedFunderCount > 20) {
      addError('maxSharedFunderCount', 'Max shared-funder cluster count must be between 2 and 20.');
    }
  }
  if (draft.smartMoneyEnabled && optOn('smartMoneyEnabled')) {
    if (!Number.isFinite(draft.smartMoneyMinConfluence) || draft.smartMoneyMinConfluence < 1 || draft.smartMoneyMinConfluence > 10) {
      addError('smartMoneyMinConfluence', 'Min Smart Money confluence must be between 1 and 10 wallets.');
    }
    if (!Number.isFinite(draft.smartMoneySizeBoostPct) || draft.smartMoneySizeBoostPct < 0 || draft.smartMoneySizeBoostPct > 200) {
      addError('smartMoneySizeBoostPct', 'Smart Money size boost must be between 0% and 200%.');
    }
  }
  if (draft.reusedSocialsEnabled && optOn('reusedSocialsEnabled')) {
    if (!Number.isFinite(draft.maxSocialReuseCount) || draft.maxSocialReuseCount < 1 || draft.maxSocialReuseCount > 50) {
      addError('maxSocialReuseCount', 'Max allowed social link reuse must be between 1 and 50.');
    }
  }
  if (draft.jitoDontFrontEnabled && optOn('jitoDontFrontEnabled')) {
    if (!Number.isFinite(draft.jitoTipSol) || draft.jitoTipSol < 0 || draft.jitoTipSol > 0.05) {
      addError('jitoTipSol', 'Jito tip must be between 0 and 0.05 SOL.');
    }
  }
  if (draft.postMigrationPullbackEnabled && optOn('postMigrationPullbackEnabled')) {
    if (!Number.isFinite(draft.migrationMinDipPct) || draft.migrationMinDipPct < 1 || draft.migrationMinDipPct > 80) {
      addError('migrationMinDipPct', 'Post-migration min dip must be between 1% and 80%.');
    }
    if (!Number.isFinite(draft.migrationWaitSec) || draft.migrationWaitSec < 5 || draft.migrationWaitSec > 600) {
      addError('migrationWaitSec', 'Post-migration wait must be between 5 and 600 seconds.');
    }
  }
  if (draft.preMigrationCurveEnabled && optOn('preMigrationCurveEnabled')) {
    if (!Number.isFinite(draft.preMigrationCurveMinPct) || draft.preMigrationCurveMinPct < 10 || draft.preMigrationCurveMinPct > 99) {
      addError('preMigrationCurveMinPct', 'Bonding curve min % must be between 10% and 99%.');
    }
    if (!Number.isFinite(draft.preMigrationCurveMaxPct) || draft.preMigrationCurveMaxPct < draft.preMigrationCurveMinPct || draft.preMigrationCurveMaxPct > 100) {
      addError('preMigrationCurveMaxPct', 'Bonding curve max % must be >= min % and <= 100%.');
    }
  }
  if (draft.washTradeFilterEnabled && optOn('washTradeFilterEnabled')) {
    if (!Number.isFinite(draft.minUniqueMakersRatio) || draft.minUniqueMakersRatio < 0.05 || draft.minUniqueMakersRatio > 1) {
      addError('minUniqueMakersRatio', 'Min unique makers ratio must be between 0.05 and 1.0.');
    }
    if (!Number.isFinite(draft.minUniqueTraders5m) || draft.minUniqueTraders5m < 1 || draft.minUniqueTraders5m > 200) {
      addError('minUniqueTraders5m', 'Min 5m unique traders must be between 1 and 200.');
    }
  }
  if (draft.solRegimeFilterEnabled && optOn('solRegimeFilterEnabled')) {
    if (!Number.isFinite(draft.solRegimeMaxDropPct) || draft.solRegimeMaxDropPct < 0.2 || draft.solRegimeMaxDropPct > 25) {
      addError('solRegimeMaxDropPct', 'SOL 15m drop threshold must be between 0.2% and 25%.');
    }
  }
  if (draft.antiTopWickEnabled && optOn('antiTopWickEnabled')) {
    if (!Number.isFinite(draft.maxShortSpikePct) || draft.maxShortSpikePct < 5 || draft.maxShortSpikePct > 500) {
      addError('maxShortSpikePct', 'Anti-Top-Wick max short spike must be between 5% and 500%.');
    }
  }
  if (draft.convictionSizingEnabled && optOn('convictionSizingEnabled')) {
    if (!Number.isFinite(draft.convictionMinMult) || draft.convictionMinMult < 0.1 || draft.convictionMinMult > 1.5) {
      addError('convictionMinMult', 'Conviction min multiplier must be between 0.1x and 1.5x.');
    }
    if (!Number.isFinite(draft.convictionMaxMult) || draft.convictionMaxMult < draft.convictionMinMult || draft.convictionMaxMult > 3) {
      addError('convictionMaxMult', 'Conviction max multiplier must be >= min multiplier and <= 3.0x.');
    }
  }
  if (draft.streakThrottleEnabled && optOn('streakThrottleEnabled')) {
    if (!Number.isFinite(draft.streakLossLimit) || draft.streakLossLimit < 1 || draft.streakLossLimit > 20) {
      addError('streakLossLimit', 'Streak loss limit must be between 1 and 20 trades.');
    }
    if (!Number.isFinite(draft.streakCooldownMinutes) || draft.streakCooldownMinutes < 1 || draft.streakCooldownMinutes > 240) {
      addError('streakCooldownMinutes', 'Streak cooldown must be between 1 and 240 minutes.');
    }
  }
  if (draft.narrativeCapEnabled && optOn('narrativeCapEnabled')) {
    if (!Number.isFinite(draft.maxSameNarrativePositions) || draft.maxSameNarrativePositions < 1 || draft.maxSameNarrativePositions > 10) {
      addError('maxSameNarrativePositions', 'Max concurrent same-narrative positions must be between 1 and 10.');
    }
  }

  return {
    valid: errors.length === 0,
    fieldErrors,
    errors,
  };
}
