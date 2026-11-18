import type { ExitReason, PositionRecord, TrailingTier } from '../types';

export interface LiveExitTelemetry {
  currentPriceUsd: number;
  currentLiquidityUsd: number;
  sellTaxPct?: number;
  tradingEnabled?: boolean;
  ownerTakeoverDetected?: boolean;
  nowMs?: number;
}

export interface ExitEvaluationResult {
  shouldExit: boolean;
  reason?: ExitReason;
  isEmergency: boolean;
  sellFraction?: number;
  triggeredStopLossTier?: number;
  updatedPeakPriceUsd: number;
  updatedPeakPnlPct: number;
  updatedTrailingArmed: boolean;
  updatedTrailingFloorPct: number | null;
  updatedGapDownTriggered: boolean;
  grossPnlPct: number;
  netPnlPctEstimate: number;
  message?: string;
}

export function resolveTrailingAllowedDrop(
  peakGainPct: number,
  ladder: TrailingTier[]
): number | null {
  if (!ladder || ladder.length === 0) return null;
  const sorted = [...ladder].sort((a, b) => a.peakGainPct - b.peakGainPct);
  let matched: TrailingTier | null = null;
  for (const tier of sorted) {
    if (peakGainPct >= tier.peakGainPct) {
      matched = tier;
    }
  }
  return matched ? matched.allowedDropPct : null;
}

/**
 * Pure 1-second exit evaluator.
 * Strictly reads exit parameters stored on `position.exitParams` at entry time.
 */
export function evaluatePositionExit(
  position: PositionRecord,
  telemetry: LiveExitTelemetry
): ExitEvaluationResult {
  const nowMs = telemetry.nowMs ?? Date.now();
  const params = position.exitParams;
  const entryPrice = position.entryPriceUsd;
  const currentPrice = telemetry.currentPriceUsd;

  const grossPnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  const netPnlPctEstimate = grossPnlPct - params.roundTripCostPct;

  const updatedPeakPriceUsd = Math.max(position.peakPriceUsd, currentPrice);
  const updatedPeakPnlPct = Math.max(position.peakPnlPct, grossPnlPct);

  // Gap-down tracking for break-even recovery watch
  let updatedGapDownTriggered = position.gapDownTriggered;
  if (grossPnlPct <= -Math.max(0.5, params.stopLossPct) * 0.75) {
    updatedGapDownTriggered = true;
  }

  // Trailing arming: armed as soon as peak gain reaches the first ladder tier configured by user
  let updatedTrailingArmed = position.trailingArmed;
  let updatedTrailingFloorPct = position.trailingFloorPct;

  if (params.trailingEnabled) {
    const allowedDrop = resolveTrailingAllowedDrop(updatedPeakPnlPct, params.trailingLadder);
    if (allowedDrop !== null) {
      updatedTrailingArmed = true;
      const candidateFloor = updatedPeakPnlPct - allowedDrop;
      updatedTrailingFloorPct =
        updatedTrailingFloorPct === null ? candidateFloor : Math.max(updatedTrailingFloorPct, candidateFloor);
    }
  }

  const baseResult = {
    updatedPeakPriceUsd,
    updatedPeakPnlPct,
    updatedTrailingArmed,
    updatedTrailingFloorPct,
    updatedGapDownTriggered,
    grossPnlPct,
    netPnlPctEstimate,
  };

  // 1. Emergency exits (highest priority)
  if (telemetry.ownerTakeoverDetected) {
    return {
      ...baseResult,
      shouldExit: true,
      reason: 'EMERGENCY_OWNER_TAKEOVER',
      isEmergency: true,
      message: 'Emergency exit: owner takeover detected on token contract',
    };
  }
  if (telemetry.tradingEnabled === false) {
    return {
      ...baseResult,
      shouldExit: true,
      reason: 'EMERGENCY_TRADING_DISABLED',
      isEmergency: true,
      message: 'Emergency exit: trading disabled on token',
    };
  }
  if (
    typeof telemetry.sellTaxPct === 'number' &&
    telemetry.sellTaxPct > params.emergencyMaxSellTaxPct
  ) {
    return {
      ...baseResult,
      shouldExit: true,
      reason: 'EMERGENCY_TAX_SPIKE',
      isEmergency: true,
      message: `Emergency exit: sell tax spiked to ${telemetry.sellTaxPct.toFixed(1)}%`,
    };
  }
  if (
    telemetry.currentLiquidityUsd > 0 &&
    telemetry.currentLiquidityUsd < params.emergencyLiquidityFloorUsd
  ) {
    return {
      ...baseResult,
      shouldExit: true,
      reason: 'EMERGENCY_LIQUIDITY_FLOOR',
      isEmergency: true,
      message: `Emergency exit: liquidity $${telemetry.currentLiquidityUsd.toFixed(0)} < $${params.emergencyLiquidityFloorUsd} floor`,
    };
  }
  if (position.entryLiquidityUsd > 0 && telemetry.currentLiquidityUsd > 0) {
    const liqDrainPct =
      ((position.entryLiquidityUsd - telemetry.currentLiquidityUsd) / position.entryLiquidityUsd) *
      100;
    if (liqDrainPct >= params.emergencyLiquidityDrainPct) {
      return {
        ...baseResult,
        shouldExit: true,
        reason: 'EMERGENCY_LIQUIDITY_DRAIN',
        isEmergency: true,
        message: `Emergency exit: pool liquidity drained by ${liqDrainPct.toFixed(1)}%`,
      };
    }
  }

  // 2. Hard stop-loss & tiered stop-loss rules
  if (params.stopLossEnabled) {
    const hardClampedStop = Math.max(0.5, params.stopLossPct);
    if (grossPnlPct <= -hardClampedStop) {
      return {
        ...baseResult,
        shouldExit: true,
        reason: 'STOP_LOSS',
        isEmergency: false,
        sellFraction: 1,
        message: `Stop-loss triggered at ${grossPnlPct.toFixed(2)}% (limit -${hardClampedStop}%)`,
      };
    }

    const tiers = [...(params.stopLossTiers ?? [])].sort(
      (a, b) => a.triggerDropPct - b.triggerDropPct
    );
    const alreadyTriggered = new Set(position.triggeredStopLossTiers ?? []);
    for (const tier of tiers) {
      if (alreadyTriggered.has(tier.triggerDropPct)) continue;
      const clampedTierDrop = Math.max(0.5, tier.triggerDropPct);
      if (grossPnlPct <= -clampedTierDrop) {
        const sellFraction = Math.min(1, Math.max(0.01, tier.sellPct / 100));
        return {
          ...baseResult,
          shouldExit: true,
          reason: 'STOP_LOSS',
          isEmergency: false,
          sellFraction,
          triggeredStopLossTier: tier.triggerDropPct,
          message: `Stop-loss tier triggered at ${grossPnlPct.toFixed(2)}% (-${clampedTierDrop}% tier, selling ${tier.sellPct}%)`,
        };
      }
    }
  }

  // 3. Take-profit
  if (grossPnlPct >= params.takeProfitPct) {
    return {
      ...baseResult,
      shouldExit: true,
      reason: 'TAKE_PROFIT',
      isEmergency: false,
      message: `Take-profit target reached at +${grossPnlPct.toFixed(2)}%`,
    };
  }

  // 4. Stepped trailing ladder
  if (
    params.trailingEnabled &&
    updatedTrailingArmed &&
    updatedTrailingFloorPct !== null &&
    grossPnlPct <= updatedTrailingFloorPct
  ) {
    return {
      ...baseResult,
      shouldExit: true,
      reason: 'TRAILING_STOP',
      isEmergency: false,
      message: `Trailing stop hit at ${grossPnlPct.toFixed(2)}% (floor +${updatedTrailingFloorPct.toFixed(2)}%, peak +${updatedPeakPnlPct.toFixed(2)}%)`,
    };
  }

  // 5. Break-even recovery watch after gap-down
  if (
    params.breakEvenRecoveryEnabled &&
    updatedGapDownTriggered &&
    currentPrice >= position.breakEvenPriceUsd
  ) {
    return {
      ...baseResult,
      shouldExit: true,
      reason: 'BREAK_EVEN_RECOVERY',
      isEmergency: false,
      message: `Break-even recovery exit after prior gap-down at ${grossPnlPct.toFixed(2)}%`,
    };
  }

  // 6. Max hold time with stagnation rule
  if (params.maxHoldStagnationEnabled) {
    const holdMinutes = (nowMs - position.openedAtMs) / 60_000;
    if (holdMinutes >= params.maxHoldMinutes && updatedPeakPnlPct < params.stagnationMinGainPct) {
      return {
        ...baseResult,
        shouldExit: true,
        reason: 'MAX_HOLD_STAGNATION',
        isEmergency: false,
        message: `Max hold ${holdMinutes.toFixed(0)}m reached with peak gain ${updatedPeakPnlPct.toFixed(2)}% < ${params.stagnationMinGainPct}%`,
      };
    }
  }

  return {
    ...baseResult,
    shouldExit: false,
    isEmergency: false,
  };
}

export function findSlotRotationCandidate(
  positions: PositionRecord[],
  newCandidateCombinedScore: number,
  minScoreDelta: number,
  nowMs = Date.now()
): PositionRecord | null {
  const stagnant = positions.filter((p) => {
    if (p.status !== 'OPEN') return false;
    const holdMin = (nowMs - p.openedAtMs) / 60_000;
    const score = (p.qualityScore + p.tradeScore) / 2;
    return holdMin >= 30 && p.peakPnlPct < 3 && newCandidateCombinedScore - score >= minScoreDelta;
  });

  if (stagnant.length === 0) return null;
  stagnant.sort((a, b) => a.qualityScore + a.tradeScore - (b.qualityScore + b.tradeScore));
  return stagnant[0];
}
