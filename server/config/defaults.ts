import type { BotSettings, WalletFeeProfile } from '../types';

export const HARD_LIMITS = {
  minStopLossPct: 0.5,
  minTakeProfitToStopLossRatio: 1.5,
  maxSlippageBps: 1000,
  maxPriorityFeeSolCap: 0.05,
  minPoolAgeFloorMinutes: 30,
  minLiquidityFloorUsd: 10000,
  maxTop10HoldersCeilingPct: 50,
  maxSingleHolderCeilingPct: 20,
  maxOpenPositionsCeiling: 10,
} as const;

export const DEFAULT_SETTINGS: BotSettings = {
  // Sizing & Risk
  tradeSizeSol: 0.05,
  maxPositionSizeSol: 0.1,
  maxWalletExposureSol: 0.1,
  gasReserveSol: 0.02,
  dailyLossLimitSol: 0.15,
  maxOpenPositions: 3,
  cooldownMinutes: 60,
  allowSlotRotation: false,
  slotRotationMinScoreDelta: 15,
  autoReclaimRent: false,
  priorityFeePreset: 'standard',
  customPriorityFeeSol: 0.0001,
  maxPriorityFeeSol: 0.002,
  slippageBps: 150,

  // Hard Filters
  minPoolAgeMinutes: 30,
  maxPoolAgeDays: 365,
  customAgeWindowEnabled: false,
  customMinPoolAgeMinutes: 5,
  customMaxPoolAgeMinutes: 30,
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
  maxTop10HoldersPct: 35,
  maxSingleHolderPct: 10,
  maxSellRouteImpactPct: 5,

  // Scoring
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
  paperDelayMinSec: 2,
  paperDelayMaxSec: 8,
  paperDefaultDelaySec: 4,
  paperBuyFailChancePct: 5,
  paperSellFailChancePct: 8,
  paperCompetitionPenaltyPct: 1.0,
  applyMeasuredGapToPaper: false,
  paperInitialBalanceSol: 10,

  // Shadow Compare
  shadowCompareEnabled: false,
  shadowLiveSizeSol: 0.01,
};

export const SETTINGS_PRESETS: Record<'safe' | 'balanced' | 'aggressive', Partial<BotSettings>> = {
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
): { valid: boolean; errors: string[]; merged: BotSettings } {
  const merged: BotSettings = { ...current, ...patch };
  const errors: string[] = [];

  if (!Array.isArray(merged.stopLossTiers)) {
    errors.push('Stop-loss tiers must be an array.');
  } else {
    if (merged.stopLossEnabled && merged.stopLossTiers.length === 0) {
      errors.push('At least one Stop-Loss tier is required when Stop-Loss is enabled.');
    }
    for (const tier of merged.stopLossTiers) {
      if (!Number.isFinite(tier.triggerDropPct) || tier.triggerDropPct < HARD_LIMITS.minStopLossPct) {
        errors.push(
          `Every Stop-Loss tier trigger drop must be at least ${HARD_LIMITS.minStopLossPct}%.`
        );
        break;
      }
      if (!Number.isFinite(tier.sellPct) || tier.sellPct < 1 || tier.sellPct > 100) {
        errors.push('Every Stop-Loss tier Sell % must be between 1% and 100%.');
        break;
      }
    }
    if (
      patch.stopLossTiers &&
      merged.stopLossTiers.length > 0 &&
      (patch.stopLossPct === undefined || patch.stopLossPct === current.stopLossPct)
    ) {
      const maxTierDrop = Math.max(...merged.stopLossTiers.map((t) => t.triggerDropPct));
      merged.stopLossPct = Math.max(HARD_LIMITS.minStopLossPct, maxTierDrop);
    }
  }

  if (!Number.isFinite(merged.stopLossPct) || merged.stopLossPct < HARD_LIMITS.minStopLossPct) {
    errors.push(`Stop-loss must be at least ${HARD_LIMITS.minStopLossPct}%.`);
  }
  if (!Number.isFinite(merged.takeProfitPct) || merged.takeProfitPct < merged.stopLossPct * HARD_LIMITS.minTakeProfitToStopLossRatio) {
    errors.push(
      `Take-profit (${merged.takeProfitPct}%) must be at least ${HARD_LIMITS.minTakeProfitToStopLossRatio}x the max stop-loss (${(merged.stopLossPct * HARD_LIMITS.minTakeProfitToStopLossRatio).toFixed(1)}%).`
    );
  }
  if (merged.minPoolAgeMinutes < HARD_LIMITS.minPoolAgeFloorMinutes) {
    errors.push(`Minimum pool age cannot be lower than ${HARD_LIMITS.minPoolAgeFloorMinutes} minutes.`);
  }
  if (!Number.isFinite(merged.customMinPoolAgeMinutes) || merged.customMinPoolAgeMinutes < 0) {
    errors.push('Custom timeframe min age must be >= 0 minutes.');
  }
  if (
    !Number.isFinite(merged.customMaxPoolAgeMinutes) ||
    merged.customMaxPoolAgeMinutes <= 0 ||
    merged.customMaxPoolAgeMinutes < merged.customMinPoolAgeMinutes
  ) {
    errors.push('Custom timeframe max age must be > 0 and >= min age.');
  }
  if (merged.minLiquidityUsd < HARD_LIMITS.minLiquidityFloorUsd) {
    errors.push(`Minimum liquidity cannot be lower than $${HARD_LIMITS.minLiquidityFloorUsd}.`);
  }
  if (merged.maxTop10HoldersPct > HARD_LIMITS.maxTop10HoldersCeilingPct) {
    errors.push(`Top 10 holders limit cannot exceed ${HARD_LIMITS.maxTop10HoldersCeilingPct}%.`);
  }
  if (merged.maxSingleHolderPct > HARD_LIMITS.maxSingleHolderCeilingPct) {
    errors.push(`Single holder limit cannot exceed ${HARD_LIMITS.maxSingleHolderCeilingPct}%.`);
  }
  if (merged.maxOpenPositions < 1 || merged.maxOpenPositions > HARD_LIMITS.maxOpenPositionsCeiling) {
    errors.push(`Max open positions must be between 1 and ${HARD_LIMITS.maxOpenPositionsCeiling}.`);
  }
  if (merged.tradeSizeSol <= 0 || merged.tradeSizeSol > merged.maxPositionSizeSol) {
    errors.push('Trade size must be > 0 and <= max position size.');
  }
  if (merged.maxPositionSizeSol > merged.maxWalletExposureSol) {
    errors.push('Max position size cannot exceed max wallet exposure.');
  }
  if (merged.gasReserveSol < 0.01) {
    errors.push('Gas reserve must be at least 0.01 SOL to prevent trapped exits.');
  }
  if (merged.slippageBps < 10 || merged.slippageBps > HARD_LIMITS.maxSlippageBps) {
    errors.push(`Slippage must be between 10 and ${HARD_LIMITS.maxSlippageBps} bps.`);
  }
  if (merged.maxPriorityFeeSol > HARD_LIMITS.maxPriorityFeeSolCap) {
    errors.push(`Priority fee cap cannot exceed ${HARD_LIMITS.maxPriorityFeeSolCap} SOL.`);
  }
  if (merged.paperDelayMinSec < 0 || merged.paperDelayMaxSec < merged.paperDelayMinSec) {
    errors.push('Paper delay max must be >= paper delay min >= 0.');
  }
  if (merged.minQualityScore < 50 || merged.minQualityScore > 100) {
    errors.push('Minimum Quality score must be between 50 and 100.');
  }
  if (merged.minTradeScore < 50 || merged.minTradeScore > 100) {
    errors.push('Minimum Trade score must be between 50 and 100.');
  }
  if (!Array.isArray(merged.trailingLadder) || merged.trailingLadder.length === 0) {
    errors.push('Stepped trailing ladder must contain at least one tier.');
  } else {
    for (const tier of merged.trailingLadder) {
      if (
        !Number.isFinite(tier.peakGainPct) ||
        tier.peakGainPct <= 0 ||
        !Number.isFinite(tier.allowedDropPct) ||
        tier.allowedDropPct <= 0 ||
        tier.allowedDropPct >= tier.peakGainPct
      ) {
        errors.push('Every trailing tier must have Peak % > Allowed Drop % > 0.');
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors, merged };
}
