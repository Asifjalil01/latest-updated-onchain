import type { BotSettings, WalletFeeProfile } from '../types';

export const HARD_LIMITS = {
  minStopLossPct: 0.5,
  minTakeProfitPct: 1.5,
  maxSlippageBps: 1000,
  maxPriorityFeeSolCap: 0.05,
  minPoolAgeFloorMinutes: 30,
  minLiquidityFloorUsd: 0,
  customMinLiquidityFloorUsd: 0,
  maxTop10HoldersCeilingPct: 50,
  maxSingleHolderCeilingPct: 20,
  maxOpenPositionsCeiling: 10,
} as const;

export function isOptionEnabled(
  settings: Pick<BotSettings, 'optionToggles'> | null | undefined,
  key: string
): boolean {
  return settings?.optionToggles?.[key] !== false;
}

export const DEFAULT_SETTINGS: BotSettings = {
  // Sizing & Risk
  tradeSizeSol: 0.05,
  maxPositionSizeSol: 0.1,
  maxWalletExposureSol: 0.1,
  gasReserveSol: 0,
  dailyLossLimitSol: 0.15,
  maxOpenPositions: 3,
  cooldownMinutes: 60,
  allowSlotRotation: false,
  slotRotationMinScoreDelta: 15,
  autoReclaimRent: true,
  priorityFeePreset: 'auto',
  customPriorityFeeSol: 0.0001,
  maxPriorityFeeSol: 0.002,
  slippageBps: 150,

  // Hard Filters
  minPoolAgeMinutes: 30,
  maxPoolAgeDays: 365,
  customAgeWindowEnabled: false,
  customMinPoolAgeMinutes: 5,
  customMaxPoolAgeMinutes: 30,
  newLaunchOnlyEnabled: false,
  newLaunchMinAgeSeconds: 5,
  newLaunchMaxAgeSeconds: 300,
  minLiquidityUsd: 25000,
  minVolume24hUsd: 50000,
  minTx24h: 200,
  minUniqueTraders24h: 100,
  maxVolumeLiquidityRatio: 40,
  maxFdvLiquidityRatio: 100,
  minPriceChange1hPct: 0.5,
  minPriceChange24hPct: -2,
  maxPriceChange1hPct: 150,
  minBuyRatio: 0.5,
  maxPlannedPriceImpactPct: 1.0,

  // Security
  maxRugCheckRiskScore: 30,
  minLpLockedOrBurnedPct: 80,
  enforceMaxTop10Holders: true,
  maxTop10HoldersPct: 35,
  maxSingleHolderPct: 10,
  maxSellRouteImpactPct: 5,
  creatorHistoryEnabled: true,
  maxCreatorLaunches: 5,
  maxCreatorRuggedCoins: 0,
  creatorFastRugWindowMinutes: 60,

  // Scoring
  enforceMinScores: true,
  minQualityScore: 60,
  minTradeScore: 55,

  // Discovery
  enableDexScreenerBoosts: false,
  enablePumpPortalWs: true,
  scanIntervalSeconds: 30,

  // Exits (stored per-position at entry)
  stopLossEnabled: true,
  stopLossPct: 8,
  stopLossTiers: [
    { triggerDropPct: 4.0, sellPct: 50 },
    { triggerDropPct: 8.0, sellPct: 100 },
  ],
  takeProfitPct: 18,
  trailingEnabled: true,
  trailingLadder: [
    { peakGainPct: 1.2, allowedDropPct: 0.4 },
    { peakGainPct: 1.8, allowedDropPct: 0.35 },
    { peakGainPct: 2.5, allowedDropPct: 0.3 },
    { peakGainPct: 3.0, allowedDropPct: 0.28 },
    { peakGainPct: 4.0, allowedDropPct: 0.25 },
    { peakGainPct: 5.0, allowedDropPct: 0.22 },
    { peakGainPct: 6.0, allowedDropPct: 0.20 },
    { peakGainPct: 7.5, allowedDropPct: 0.18 },
    { peakGainPct: 9.0, allowedDropPct: 0.16 },
    { peakGainPct: 10.5, allowedDropPct: 0.15 },
    { peakGainPct: 12.0, allowedDropPct: 0.14 },
    { peakGainPct: 13.5, allowedDropPct: 0.13 },
    { peakGainPct: 15.0, allowedDropPct: 0.12 },
  ],
  breakEvenRecoveryEnabled: true,
  maxHoldMinutes: 240,
  maxHoldStagnationEnabled: true,
  stagnationMinGainPct: 2.0,
  emergencyLiquidityFloorUsd: 10000,
  emergencyLiquidityDrainPct: 40,
  emergencyMaxSellTaxPct: 15,

  // Paper Realism
  paperDelayMinSec: 0.5,
  paperDelayMaxSec: 2,
  paperDefaultDelaySec: 1,
  paperBuyFailChancePct: 2,
  paperSellFailChancePct: 3,
  paperCompetitionPenaltyPct: 0.25,
  applyMeasuredGapToPaper: false,
  paperInitialBalanceSol: 10,

  // Shadow Compare
  shadowCompareEnabled: false,
  shadowLiveSizeSol: 0.01,

  // Pro Desk — Group 1: Deeper Wallet & Scam Intelligence
  antiSybilEnabled: false,
  freshWalletMinutes: 30,
  maxSharedFunderCount: 3,
  smartMoneyEnabled: false,
  smartWallets: [],
  smartMoneyMinConfluence: 1,
  smartMoneySizeBoostPct: 35,
  smartMoneyAutoExitOnSell: true,
  reusedSocialsEnabled: false,
  maxSocialReuseCount: 2,

  // Pro Desk — Group 2: Zero-Lag Exits & MEV / Wallet Sweep
  wsExitStreamEnabled: false,
  jitoDontFrontEnabled: false,
  jitoTipSol: 0.0002,
  orphanSweepEnabled: false,

  // Pro Desk — Group 3: Market Structure & Entry Timing
  postMigrationPullbackEnabled: false,
  migrationMinDipPct: 15,
  migrationWaitSec: 45,
  preMigrationCurveEnabled: false,
  preMigrationCurveMinPct: 75,
  preMigrationCurveMaxPct: 92,
  washTradeFilterEnabled: false,
  minUniqueMakersRatio: 0.25,
  minUniqueTraders5m: 6,
  solRegimeFilterEnabled: false,
  solRegimeMaxDropPct: 2.0,
  solRegimeAction: 'pause',
  antiTopWickEnabled: false,
  maxShortSpikePct: 70,

  // Pro Desk — Group 4: Dynamic Sizing & Capital Efficiency
  convictionSizingEnabled: false,
  convictionMinMult: 0.5,
  convictionMaxMult: 1.5,
  streakThrottleEnabled: false,
  streakLossLimit: 3,
  streakCooldownMinutes: 20,
  streakAction: 'half_size',
  narrativeCapEnabled: false,
  maxSameNarrativePositions: 1,

  // Per-option enable/disable toggles (omitted or true = active)
  optionToggles: {},
};

export const SETTINGS_PRESETS: Record<'safe' | 'balanced' | 'aggressive' | 'quick_profit', Partial<BotSettings>> = {
  safe: {
    tradeSizeSol: 0.025,
    maxPositionSizeSol: 0.05,
    maxWalletExposureSol: 0.1,
    dailyLossLimitSol: 0.08,
    maxOpenPositions: 2,
    minPoolAgeMinutes: 120,
    minLiquidityUsd: 50000,
    minVolume24hUsd: 100000,
    minQualityScore: 82,
    minTradeScore: 75,
    stopLossPct: 6,
    stopLossTiers: [
      { triggerDropPct: 3.0, sellPct: 50 },
      { triggerDropPct: 6.0, sellPct: 100 },
    ],
    takeProfitPct: 15,
    maxTop10HoldersPct: 30,
  },
  balanced: {
    ...DEFAULT_SETTINGS,
  },
  aggressive: {
    tradeSizeSol: 0.05,
    maxPositionSizeSol: 0.1,
    maxWalletExposureSol: 0.25,
    dailyLossLimitSol: 0.2,
    maxOpenPositions: 4,
    minPoolAgeMinutes: 30,
    minLiquidityUsd: 25000,
    minVolume24hUsd: 50000,
    minQualityScore: 75,
    minTradeScore: 70,
    stopLossPct: 12,
    stopLossTiers: [
      { triggerDropPct: 6.0, sellPct: 50 },
      { triggerDropPct: 12.0, sellPct: 100 },
    ],
    takeProfitPct: 24,
    maxTop10HoldersPct: 35,
  },
  quick_profit: {
    tradeSizeSol: 0.1,
    maxPositionSizeSol: 0.2,
    maxWalletExposureSol: 0.3,
    dailyLossLimitSol: 0.2,
    maxOpenPositions: 3,
    minPoolAgeMinutes: 30,
    customAgeWindowEnabled: true,
    customMinPoolAgeMinutes: 15,
    customMaxPoolAgeMinutes: 1440,
    newLaunchOnlyEnabled: false,
    autoReclaimRent: true,
    priorityFeePreset: 'auto',
    minLiquidityUsd: 25000,
    minVolume24hUsd: 75000,
    minPriceChange1hPct: 2.0,
    minBuyRatio: 0.58,
    enforceMaxTop10Holders: true,
    maxTop10HoldersPct: 30,
    enforceMinScores: true,
    minQualityScore: 75,
    minTradeScore: 68,
    stopLossEnabled: true,
    stopLossPct: 4,
    stopLossTiers: [
      { triggerDropPct: 2.0, sellPct: 50 },
      { triggerDropPct: 4.0, sellPct: 100 },
    ],
    takeProfitPct: 12,
    trailingEnabled: true,
    trailingLadder: [
      { peakGainPct: 3.0, allowedDropPct: 0.8 },
      { peakGainPct: 5.0, allowedDropPct: 1.0 },
      { peakGainPct: 8.0, allowedDropPct: 1.5 },
      { peakGainPct: 12.0, allowedDropPct: 2.0 },
    ],
    breakEvenRecoveryEnabled: true,
    paperDelayMinSec: 0.5,
    paperDelayMaxSec: 1.5,
    paperDefaultDelaySec: 1,
    paperBuyFailChancePct: 0,
    paperSellFailChancePct: 0,
    paperCompetitionPenaltyPct: 0.1,
  },
};

export const WALLET_FEE_PROFILES: WalletFeeProfile[] = [
  {
    id: 'paper',
    name: 'Paper Shadow Ledger',
    network: 'Solana',
    tradingSupported: true,
    displaySwapFeePct: '0.00% (Route DEX fees simulated)',
    typicalPrioritySol: '0.0001 - 0.002 SOL',
    notes: 'Display profile only. Simulates base fee, priority fee, ATA rent, DEX fees, delay window, and failures.',
  },
  {
    id: 'phantom',
    name: 'Phantom',
    network: 'Solana',
    tradingSupported: true,
    displaySwapFeePct: '0.85% (in-wallet) / 0% via Jupiter',
    typicalPrioritySol: '0.0001 - 0.001 SOL',
    notes: 'Manual browser signing ONLY. Automated exits cannot use Phantom popup mode.',
  },
  {
    id: 'solflare',
    name: 'Solflare',
    network: 'Solana',
    tradingSupported: true,
    displaySwapFeePct: '0.00% via Jupiter',
    typicalPrioritySol: '0.0001 - 0.001 SOL',
    notes: 'Manual browser signing ONLY. Use server-side encrypted signer for automated bots.',
  },
  {
    id: 'ledger',
    name: 'Ledger (via Solflare/Phantom)',
    network: 'Solana',
    tradingSupported: true,
    displaySwapFeePct: '0.00% via Jupiter',
    typicalPrioritySol: '0.0001 - 0.001 SOL',
    notes: 'Hardware cold signing for manual trades only. Never automated.',
  },
  {
    id: 'metamask',
    name: 'MetaMask',
    network: 'EVM (View Only)',
    tradingSupported: false,
    displaySwapFeePct: '0.875% (EVM)',
    typicalPrioritySol: 'N/A (EVM gas)',
    notes: 'Not supported for Solana spot trading yet. Balance viewing only.',
  },
  {
    id: 'trust',
    name: 'Trust Wallet',
    network: 'EVM (View Only)',
    tradingSupported: false,
    displaySwapFeePct: 'Varies by DEX',
    typicalPrioritySol: 'N/A (EVM gas)',
    notes: 'Not supported for Solana spot trading yet. Balance viewing only.',
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    network: 'EVM (View Only)',
    tradingSupported: false,
    displaySwapFeePct: '1.00% (EVM)',
    typicalPrioritySol: 'N/A (EVM gas)',
    notes: 'Not supported for Solana spot trading yet. Balance viewing only.',
  },
];

export function validateSettingsUpdate(
  current: BotSettings,
  patch: Partial<BotSettings>
): { valid: boolean; errors: string[]; fieldErrors: Record<string, string>; merged: BotSettings } {
  const mergedOptionToggles: Record<string, boolean> = {
    ...(current.optionToggles ?? {}),
    ...(patch.optionToggles ?? {}),
  };
  const merged: BotSettings = {
    ...current,
    ...patch,
    optionToggles: mergedOptionToggles,
  };
  const errors: string[] = [];
  const fieldErrors: Record<string, string> = {};
  const optOn = (key: string) => isOptionEnabled(merged, key);

  const pushErr = (fieldKey: string, msg: string) => {
    if (!errors.includes(msg)) errors.push(msg);
    if (!fieldErrors[fieldKey]) fieldErrors[fieldKey] = msg;
  };

  if (!Array.isArray(merged.stopLossTiers)) {
    pushErr('stopLossEnabled', 'Stop-loss tiers must be an array.');
  } else if (merged.stopLossEnabled) {
    if (merged.stopLossTiers.length === 0) {
      pushErr('stopLossEnabled', 'At least 1 Stop-Loss tier is required when Stop-Loss is enabled.');
    }
    merged.stopLossTiers.forEach((tier, idx) => {
      if (!Number.isFinite(tier.triggerDropPct) || tier.triggerDropPct < HARD_LIMITS.minStopLossPct) {
        pushErr(
          `stopLossTiers.${idx}.triggerDropPct`,
          `Trigger Drop % must be at least ${HARD_LIMITS.minStopLossPct}% (no upper limit).`
        );
      }
      if (!Number.isFinite(tier.sellPct) || tier.sellPct < 1 || tier.sellPct > 100) {
        pushErr(`stopLossTiers.${idx}.sellPct`, 'Sell % must be between 1% and 100%.');
      }
    });
    if (
      patch.stopLossTiers &&
      merged.stopLossTiers.length > 0 &&
      (patch.stopLossPct === undefined || patch.stopLossPct === current.stopLossPct)
    ) {
      const validDrops = merged.stopLossTiers
        .map((t) => t.triggerDropPct)
        .filter((d) => Number.isFinite(d));
      if (validDrops.length > 0) {
        merged.stopLossPct = Math.max(HARD_LIMITS.minStopLossPct, Math.max(...validDrops));
      }
    }
  }

  if (
    merged.stopLossEnabled &&
    (!Number.isFinite(merged.stopLossPct) || merged.stopLossPct < HARD_LIMITS.minStopLossPct)
  ) {
    pushErr('stopLossEnabled', `Stop-loss must be at least ${HARD_LIMITS.minStopLossPct}%.`);
  }
  if (
    optOn('takeProfitPct') &&
    (!Number.isFinite(merged.takeProfitPct) || merged.takeProfitPct < HARD_LIMITS.minTakeProfitPct)
  ) {
    pushErr(
      'takeProfitPct',
      `Take-Profit (%) must be at least ${HARD_LIMITS.minTakeProfitPct}% (no upper limit).`
    );
  }
  if (
    optOn('minPoolAgeMinutes') &&
    !merged.customAgeWindowEnabled &&
    !merged.newLaunchOnlyEnabled &&
    (!Number.isFinite(merged.minPoolAgeMinutes) || merged.minPoolAgeMinutes < HARD_LIMITS.minPoolAgeFloorMinutes)
  ) {
    pushErr(
      'minPoolAgeMinutes',
      `Default Min Pool Age must be at least ${HARD_LIMITS.minPoolAgeFloorMinutes} minutes (or enable Custom Pool Age Timeframe above).`
    );
  }
  if (merged.customAgeWindowEnabled) {
    if (!Number.isFinite(merged.customMinPoolAgeMinutes) || merged.customMinPoolAgeMinutes < 0) {
      pushErr('customMinPoolAgeMinutes', 'Min Coin Age must be 0 minutes or greater.');
    }
    if (
      !Number.isFinite(merged.customMaxPoolAgeMinutes) ||
      merged.customMaxPoolAgeMinutes <= 0 ||
      merged.customMaxPoolAgeMinutes < merged.customMinPoolAgeMinutes
    ) {
      pushErr(
        'customMaxPoolAgeMinutes',
        `Max Coin Age must be > 0 and at least ${Number.isFinite(merged.customMinPoolAgeMinutes) ? merged.customMinPoolAgeMinutes : 0} minutes.`
      );
    }
  }
  if (merged.newLaunchOnlyEnabled) {
    if (!Number.isFinite(merged.newLaunchMinAgeSeconds) || merged.newLaunchMinAgeSeconds < 0) {
      pushErr('newLaunchMinAgeSeconds', 'Min Launch Age must be 0 seconds or greater.');
    }
    if (
      !Number.isFinite(merged.newLaunchMaxAgeSeconds) ||
      merged.newLaunchMaxAgeSeconds < 1 ||
      merged.newLaunchMaxAgeSeconds < merged.newLaunchMinAgeSeconds
    ) {
      pushErr(
        'newLaunchMaxAgeSeconds',
        `Max Launch Age must be >= 1s and >= ${Number.isFinite(merged.newLaunchMinAgeSeconds) ? merged.newLaunchMinAgeSeconds : 0}s.`
      );
    }
  }
  if (optOn('minLiquidityUsd') && (!Number.isFinite(merged.minLiquidityUsd) || merged.minLiquidityUsd < 0)) {
    pushErr('minLiquidityUsd', 'Min Liquidity ($) must be $0 or greater (no upper limit).');
  }
  if (
    merged.enforceMaxTop10Holders &&
    (!Number.isFinite(merged.maxTop10HoldersPct) ||
      merged.maxTop10HoldersPct < 1 ||
      merged.maxTop10HoldersPct > HARD_LIMITS.maxTop10HoldersCeilingPct)
  ) {
    pushErr(
      'maxTop10HoldersPct',
      `Max Top-10 Non-Pool Holders (%) must be between 1% and ${HARD_LIMITS.maxTop10HoldersCeilingPct}%.`
    );
  }
  if (
    optOn('maxSingleHolderPct') &&
    (!Number.isFinite(merged.maxSingleHolderPct) ||
      merged.maxSingleHolderPct < 1 ||
      merged.maxSingleHolderPct > HARD_LIMITS.maxSingleHolderCeilingPct)
  ) {
    pushErr(
      'maxSingleHolderPct',
      `Single holder limit must be between 1% and ${HARD_LIMITS.maxSingleHolderCeilingPct}%.`
    );
  }
  if (
    optOn('maxOpenPositions') &&
    (!Number.isFinite(merged.maxOpenPositions) ||
      !Number.isInteger(merged.maxOpenPositions) ||
      merged.maxOpenPositions < 1 ||
      merged.maxOpenPositions > HARD_LIMITS.maxOpenPositionsCeiling)
  ) {
    pushErr(
      'maxOpenPositions',
      `Max Open Positions must be a whole number between 1 and ${HARD_LIMITS.maxOpenPositionsCeiling}.`
    );
  }
  if (
    optOn('cooldownMinutes') &&
    (!Number.isFinite(merged.cooldownMinutes) || merged.cooldownMinutes < 0 || merged.cooldownMinutes > 1440)
  ) {
    pushErr('cooldownMinutes', 'Re-entry Cooldown must be between 0 and 1440 minutes.');
  }
  if (
    optOn('tradeSizeSol') &&
    (!Number.isFinite(merged.tradeSizeSol) || merged.tradeSizeSol <= 0 || merged.tradeSizeSol > merged.maxPositionSizeSol)
  ) {
    pushErr(
      'tradeSizeSol',
      `Trade Size (SOL) must be > 0 and <= ${merged.maxPositionSizeSol} SOL.`
    );
  }
  if (
    optOn('maxWalletExposureSol') &&
    (!Number.isFinite(merged.maxWalletExposureSol) ||
      merged.maxWalletExposureSol <= 0 ||
      merged.maxPositionSizeSol > merged.maxWalletExposureSol)
  ) {
    pushErr(
      'maxWalletExposureSol',
      `Max Wallet Exposure (SOL) must be > 0 and >= ${merged.maxPositionSizeSol} SOL.`
    );
  }
  if (optOn('dailyLossLimitSol') && (!Number.isFinite(merged.dailyLossLimitSol) || merged.dailyLossLimitSol <= 0)) {
    pushErr('dailyLossLimitSol', 'Daily Loss Limit (SOL) must be greater than 0.');
  }
  if (!Number.isFinite(merged.gasReserveSol) || merged.gasReserveSol < 0) {
    pushErr('gasReserveSol', 'Gas Reserve (SOL) must be 0 or greater.');
  }
  if (
    merged.maxHoldStagnationEnabled &&
    (!Number.isFinite(merged.maxHoldMinutes) || merged.maxHoldMinutes < 5 || merged.maxHoldMinutes > 10080)
  ) {
    pushErr('maxHoldMinutes', 'Max Hold Time must be between 5 and 10080 minutes.');
  }
  if (
    optOn('emergencyLiquidityFloorUsd') &&
    (!Number.isFinite(merged.emergencyLiquidityFloorUsd) || merged.emergencyLiquidityFloorUsd < 0)
  ) {
    pushErr('emergencyLiquidityFloorUsd', 'Emergency Liquidity Floor ($) must be $0 or greater.');
  }
  if (
    optOn('slippageBps') &&
    (!Number.isFinite(merged.slippageBps) || merged.slippageBps < 10 || merged.slippageBps > HARD_LIMITS.maxSlippageBps)
  ) {
    pushErr('slippageBps', `Slippage must be between 10 and ${HARD_LIMITS.maxSlippageBps} bps.`);
  }
  if (!Number.isFinite(merged.maxPriorityFeeSol) || merged.maxPriorityFeeSol > HARD_LIMITS.maxPriorityFeeSolCap) {
    pushErr('maxPriorityFeeSol', `Priority fee cap cannot exceed ${HARD_LIMITS.maxPriorityFeeSolCap} SOL.`);
  }
  if (optOn('paperDelayWindow')) {
    if (!Number.isFinite(merged.paperDelayMinSec) || merged.paperDelayMinSec < 0 || merged.paperDelayMinSec > 30) {
      pushErr('paperDelayMinSec', 'Min Delay must be between 0 and 30 seconds.');
    }
    if (
      !Number.isFinite(merged.paperDelayMaxSec) ||
      merged.paperDelayMaxSec < 0 ||
      merged.paperDelayMaxSec > 60 ||
      merged.paperDelayMaxSec < merged.paperDelayMinSec
    ) {
      pushErr(
        'paperDelayMaxSec',
        `Max Delay must be between ${Number.isFinite(merged.paperDelayMinSec) ? merged.paperDelayMinSec : 0} and 60 seconds.`
      );
    }
  }
  if (optOn('paperFailChance')) {
    if (!Number.isFinite(merged.paperBuyFailChancePct) || merged.paperBuyFailChancePct < 0 || merged.paperBuyFailChancePct > 100) {
      pushErr('paperBuyFailChancePct', 'Buy Failure Chance (%) must be between 0% and 100%.');
    }
    if (!Number.isFinite(merged.paperSellFailChancePct) || merged.paperSellFailChancePct < 0 || merged.paperSellFailChancePct > 100) {
      pushErr('paperSellFailChancePct', 'Sell Failure Chance (%) must be between 0% and 100%.');
    }
  }
  if (
    optOn('paperCompetitionPenaltyPct') &&
    (!Number.isFinite(merged.paperCompetitionPenaltyPct) ||
      merged.paperCompetitionPenaltyPct < 0 ||
      merged.paperCompetitionPenaltyPct > 20)
  ) {
    pushErr('paperCompetitionPenaltyPct', '<24h Competition Penalty (%) must be between 0% and 20%.');
  }
  if (merged.creatorHistoryEnabled) {
    if (
      optOn('maxCreatorLaunches') &&
      (!Number.isFinite(merged.maxCreatorLaunches) || merged.maxCreatorLaunches < 0 || merged.maxCreatorLaunches > 500)
    ) {
      pushErr('maxCreatorLaunches', 'Max Owner Prior Launches must be between 0 and 500.');
    }
    if (
      optOn('maxCreatorRuggedCoins') &&
      (!Number.isFinite(merged.maxCreatorRuggedCoins) || merged.maxCreatorRuggedCoins < 0 || merged.maxCreatorRuggedCoins > 100)
    ) {
      pushErr('maxCreatorRuggedCoins', 'Max Owner Rugged Coins must be between 0 and 100.');
    }
    if (
      optOn('creatorFastRugWindowMinutes') &&
      (!Number.isFinite(merged.creatorFastRugWindowMinutes) ||
        merged.creatorFastRugWindowMinutes < 0 ||
        merged.creatorFastRugWindowMinutes > 10080)
    ) {
      pushErr('creatorFastRugWindowMinutes', 'Fast-Rug Speed Block Window must be between 0 and 10080 minutes.');
    }
  }
  if (
    merged.enforceMinScores &&
    (!Number.isFinite(merged.minQualityScore) || merged.minQualityScore < 50 || merged.minQualityScore > 100)
  ) {
    pushErr('minQualityScore', 'Min Quality Score must be between 50 and 100.');
  }
  if (
    merged.enforceMinScores &&
    (!Number.isFinite(merged.minTradeScore) || merged.minTradeScore < 50 || merged.minTradeScore > 100)
  ) {
    pushErr('minTradeScore', 'Min Trade Score must be between 50 and 100.');
  }
  if (merged.trailingEnabled) {
    if (!Array.isArray(merged.trailingLadder) || merged.trailingLadder.length === 0) {
      pushErr('trailingEnabled', 'Stepped trailing ladder must contain at least one tier.');
    } else {
      merged.trailingLadder.forEach((tier, idx) => {
        if (!Number.isFinite(tier.peakGainPct) || tier.peakGainPct <= 0) {
          pushErr(`trailingLadder.${idx}.peakGainPct`, 'Peak % must be greater than 0%.');
        }
        if (
          !Number.isFinite(tier.allowedDropPct) ||
          tier.allowedDropPct <= 0 ||
          (Number.isFinite(tier.peakGainPct) && tier.allowedDropPct >= tier.peakGainPct)
        ) {
          pushErr(
            `trailingLadder.${idx}.allowedDropPct`,
            `Allowed Drop % must be > 0 and less than Peak % (${Number.isFinite(tier.peakGainPct) ? tier.peakGainPct : 0}%).`
          );
        }
      });
    }
  }

  // Pro Desk validations (guarded by both feature bool and optionToggles)
  if (merged.antiSybilEnabled && optOn('antiSybilEnabled')) {
    if (!Number.isFinite(merged.freshWalletMinutes) || merged.freshWalletMinutes < 1 || merged.freshWalletMinutes > 1440) {
      pushErr('freshWalletMinutes', 'Fresh wallet window must be between 1 and 1440 minutes.');
    }
    if (!Number.isFinite(merged.maxSharedFunderCount) || merged.maxSharedFunderCount < 2 || merged.maxSharedFunderCount > 20) {
      pushErr('maxSharedFunderCount', 'Max shared-funder cluster count must be between 2 and 20.');
    }
  }
  if (merged.smartMoneyEnabled && optOn('smartMoneyEnabled')) {
    if (!Number.isFinite(merged.smartMoneyMinConfluence) || merged.smartMoneyMinConfluence < 1 || merged.smartMoneyMinConfluence > 10) {
      pushErr('smartMoneyMinConfluence', 'Min Smart Money confluence must be between 1 and 10.');
    }
    if (!Number.isFinite(merged.smartMoneySizeBoostPct) || merged.smartMoneySizeBoostPct < 0 || merged.smartMoneySizeBoostPct > 200) {
      pushErr('smartMoneySizeBoostPct', 'Smart Money size boost must be between 0% and 200%.');
    }
  }
  if (merged.reusedSocialsEnabled && optOn('reusedSocialsEnabled')) {
    if (!Number.isFinite(merged.maxSocialReuseCount) || merged.maxSocialReuseCount < 1 || merged.maxSocialReuseCount > 50) {
      pushErr('maxSocialReuseCount', 'Max allowed social reuse count must be between 1 and 50.');
    }
  }
  if (merged.jitoDontFrontEnabled && optOn('jitoDontFrontEnabled')) {
    if (!Number.isFinite(merged.jitoTipSol) || merged.jitoTipSol < 0 || merged.jitoTipSol > 0.05) {
      pushErr('jitoTipSol', 'Jito tip must be between 0 and 0.05 SOL.');
    }
  }
  if (merged.postMigrationPullbackEnabled && optOn('postMigrationPullbackEnabled')) {
    if (!Number.isFinite(merged.migrationMinDipPct) || merged.migrationMinDipPct < 1 || merged.migrationMinDipPct > 80) {
      pushErr('migrationMinDipPct', 'Post-migration min dip must be between 1% and 80%.');
    }
    if (!Number.isFinite(merged.migrationWaitSec) || merged.migrationWaitSec < 5 || merged.migrationWaitSec > 600) {
      pushErr('migrationWaitSec', 'Post-migration wait must be between 5 and 600 seconds.');
    }
  }
  if (merged.preMigrationCurveEnabled && optOn('preMigrationCurveEnabled')) {
    if (!Number.isFinite(merged.preMigrationCurveMinPct) || merged.preMigrationCurveMinPct < 10 || merged.preMigrationCurveMinPct > 99) {
      pushErr('preMigrationCurveMinPct', 'Bonding curve min % must be between 10% and 99%.');
    }
    if (!Number.isFinite(merged.preMigrationCurveMaxPct) || merged.preMigrationCurveMaxPct < merged.preMigrationCurveMinPct || merged.preMigrationCurveMaxPct > 100) {
      pushErr('preMigrationCurveMaxPct', 'Bonding curve max % must be >= min % and <= 100%.');
    }
  }
  if (merged.washTradeFilterEnabled && optOn('washTradeFilterEnabled')) {
    if (!Number.isFinite(merged.minUniqueMakersRatio) || merged.minUniqueMakersRatio < 0.05 || merged.minUniqueMakersRatio > 1) {
      pushErr('minUniqueMakersRatio', 'Min unique makers ratio must be between 0.05 and 1.0.');
    }
    if (!Number.isFinite(merged.minUniqueTraders5m) || merged.minUniqueTraders5m < 1 || merged.minUniqueTraders5m > 200) {
      pushErr('minUniqueTraders5m', 'Min 5m unique traders must be between 1 and 200.');
    }
  }
  if (merged.solRegimeFilterEnabled && optOn('solRegimeFilterEnabled')) {
    if (!Number.isFinite(merged.solRegimeMaxDropPct) || merged.solRegimeMaxDropPct < 0.2 || merged.solRegimeMaxDropPct > 25) {
      pushErr('solRegimeMaxDropPct', 'SOL 15m drop threshold must be between 0.2% and 25%.');
    }
  }
  if (merged.antiTopWickEnabled && optOn('antiTopWickEnabled')) {
    if (!Number.isFinite(merged.maxShortSpikePct) || merged.maxShortSpikePct < 5 || merged.maxShortSpikePct > 500) {
      pushErr('maxShortSpikePct', 'Anti-Top-Wick max spike must be between 5% and 500%.');
    }
  }
  if (merged.convictionSizingEnabled && optOn('convictionSizingEnabled')) {
    if (!Number.isFinite(merged.convictionMinMult) || merged.convictionMinMult < 0.1 || merged.convictionMinMult > 1.5) {
      pushErr('convictionMinMult', 'Conviction min multiplier must be between 0.1x and 1.5x.');
    }
    if (!Number.isFinite(merged.convictionMaxMult) || merged.convictionMaxMult < merged.convictionMinMult || merged.convictionMaxMult > 3) {
      pushErr('convictionMaxMult', 'Conviction max multiplier must be >= min multiplier and <= 3.0x.');
    }
  }
  if (merged.streakThrottleEnabled && optOn('streakThrottleEnabled')) {
    if (!Number.isFinite(merged.streakLossLimit) || merged.streakLossLimit < 1 || merged.streakLossLimit > 20) {
      pushErr('streakLossLimit', 'Streak loss limit must be between 1 and 20.');
    }
    if (!Number.isFinite(merged.streakCooldownMinutes) || merged.streakCooldownMinutes < 1 || merged.streakCooldownMinutes > 240) {
      pushErr('streakCooldownMinutes', 'Streak cooldown must be between 1 and 240 minutes.');
    }
  }
  if (merged.narrativeCapEnabled && optOn('narrativeCapEnabled')) {
    if (!Number.isFinite(merged.maxSameNarrativePositions) || merged.maxSameNarrativePositions < 1 || merged.maxSameNarrativePositions > 10) {
      pushErr('maxSameNarrativePositions', 'Max concurrent same-narrative positions must be between 1 and 10.');
    }
  }

  return { valid: errors.length === 0, errors, fieldErrors, merged };
}
