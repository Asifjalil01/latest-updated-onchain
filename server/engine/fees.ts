import { isOptionEnabled } from '../config/defaults';
import type {
  AnalyticsSummary,
  BotSettings,
  FeeBreakdown,
  PositionExitSnapshot,
  TradeRecord,
} from '../types';
import type { JupiterQuoteResponse } from '../providers/jupiter';

export const SOLANA_BASE_FEE_SOL = 0.000005; // 5,000 lamports per signature
export const ATA_RENT_SOL = 0.00203928;
const WSOL_MINT_ADDR = 'So11111111111111111111111111111111111111112';

export function resolvePriorityFeeSol(
  settings: BotSettings,
  liveAutoPriorityFeeSol?: number | null
): number {
  if (!isOptionEnabled(settings, 'priorityFeePreset')) {
    return 0;
  }
  let raw = settings.customPriorityFeeSol;
  if (settings.priorityFeePreset === 'auto') {
    raw =
      typeof liveAutoPriorityFeeSol === 'number' && Number.isFinite(liveAutoPriorityFeeSol) && liveAutoPriorityFeeSol >= 0
        ? liveAutoPriorityFeeSol
        : 0.0001;
  } else if (settings.priorityFeePreset === 'standard') raw = 0.0001;
  else if (settings.priorityFeePreset === 'high') raw = 0.0005;
  else if (settings.priorityFeePreset === 'ultra') raw = 0.0015;
  return Math.min(Math.max(0, raw), settings.maxPriorityFeeSol);
}

export function extractRouteLabels(quote: JupiterQuoteResponse | null): string[] {
  if (!quote || !Array.isArray(quote.routePlan)) return [];
  const labels = quote.routePlan
    .map((step) => step.swapInfo?.label?.trim())
    .filter((l): l is string => Boolean(l));
  return Array.from(new Set(labels));
}

/**
 * Extracts actual DEX AMM pool fees from Jupiter's `routePlan[].swapInfo`.
 * Note: On Jupiter exact-in quotes, AMM pool fees are already deducted inside `quote.outAmount`.
 */
export function extractRouteDexFeeSol(quote: JupiterQuoteResponse | null, solAmount: number): number {
  if (!quote || !Array.isArray(quote.routePlan) || quote.routePlan.length === 0) {
    return solAmount * 0.0025;
  }

  let parsedFeeSol = 0;
  let parsedSteps = 0;

  for (const step of quote.routePlan) {
    const info = step.swapInfo;
    if (!info) continue;
    const rawFee = Number(info.feeAmount ?? 0);
    if (!Number.isFinite(rawFee) || rawFee <= 0) continue;

    const splitRatio = Math.max(0.01, Math.min(1, Number(step.percent ?? 100) / 100));
    const stepSolShare = solAmount * splitRatio;

    if (info.feeMint === WSOL_MINT_ADDR) {
      parsedFeeSol += rawFee / 1e9;
      parsedSteps += 1;
    } else if (info.feeMint && info.feeMint === info.inputMint && Number(info.inAmount) > 0) {
      const feeRatio = Math.min(0.2, rawFee / Number(info.inAmount));
      parsedFeeSol += stepSolShare * feeRatio;
      parsedSteps += 1;
    } else if (info.feeMint && info.feeMint === info.outputMint && Number(info.outAmount) > 0) {
      const outAmt = Number(info.outAmount);
      const feeRatio = Math.min(0.2, rawFee / (outAmt + rawFee));
      parsedFeeSol += stepSolShare * feeRatio;
      parsedSteps += 1;
    }
  }

  if (parsedSteps > 0) {
    return parsedFeeSol;
  }

  // Fallback when Jupiter route step omits numeric feeAmount (e.g. unit test mocks)
  const hops = Math.max(1, quote.routePlan.length);
  return solAmount * 0.0025 * Math.min(hops, 2);
}

export function extractJupiterPlatformFeeSol(
  quote: JupiterQuoteResponse | null,
  solAmount: number
): number {
  if (!quote?.platformFee) return 0;
  const rawAmt = Number(quote.platformFee.amount ?? 0);
  if (Number.isFinite(rawAmt) && rawAmt > 0) {
    if (quote.inputMint === WSOL_MINT_ADDR || quote.outputMint === WSOL_MINT_ADDR) {
      // Jupiter platform fee is charged in outputMint (or inputMint for ExactOut); for SOL-out swaps it's lamports
      if (quote.outputMint === WSOL_MINT_ADDR) {
        return rawAmt / 1e9;
      }
    }
  }
  if (!quote.platformFee.feeBps) return 0;
  return solAmount * (quote.platformFee.feeBps / 10_000);
}

export function computeEntryFees(params: {
  solAmount: number;
  settings: BotSettings;
  quote: JupiterQuoteResponse | null;
  needsAtaRent: boolean;
  tokenTaxPct?: number;
  liveAutoPriorityFeeSol?: number | null;
  priorityFeeSource?: FeeBreakdown['priorityFeeSource'];
}): FeeBreakdown {
  const baseFeeSol = SOLANA_BASE_FEE_SOL;
  const priorityFeeSol = resolvePriorityFeeSol(params.settings, params.liveAutoPriorityFeeSol);
  const dexFeeSol = extractRouteDexFeeSol(params.quote, params.solAmount);
  const jupiterPlatformFeeSol = extractJupiterPlatformFeeSol(params.quote, params.solAmount);
  const ataRentSol = params.needsAtaRent ? ATA_RENT_SOL : 0;
  const tokenTaxSol = params.solAmount * ((params.tokenTaxPct ?? 0) / 100);
  const routeLabels = extractRouteLabels(params.quote);
  // Wallet fees paid directly in SOL (LP/DEX fees are already deducted inside Jupiter quote.outAmount when quote is present)
  const walletOutFeeSol =
    baseFeeSol +
    priorityFeeSol +
    tokenTaxSol +
    (params.quote ? 0 : dexFeeSol + jupiterPlatformFeeSol);
  const totalSol =
    baseFeeSol + priorityFeeSol + dexFeeSol + jupiterPlatformFeeSol + ataRentSol + tokenTaxSol;

  return {
    baseFeeSol,
    priorityFeeSol,
    dexFeeSol,
    jupiterPlatformFeeSol,
    ataRentSol,
    tokenTaxSol,
    walletOutFeeSol,
    routeLabels,
    priorityFeeSource:
      params.priorityFeeSource ??
      (params.settings.priorityFeePreset === 'auto'
        ? 'jupiter_auto'
        : params.settings.priorityFeePreset === 'custom'
          ? 'custom'
          : 'preset'),
    totalSol,
  };
}

export function computeExitFees(params: {
  estimatedSolOut: number;
  settings: BotSettings;
  quote: JupiterQuoteResponse | null;
  tokenTaxPct?: number;
  liveAutoPriorityFeeSol?: number | null;
  priorityFeeSource?: FeeBreakdown['priorityFeeSource'];
}): FeeBreakdown {
  const baseFeeSol = SOLANA_BASE_FEE_SOL;
  const priorityFeeSol = resolvePriorityFeeSol(params.settings, params.liveAutoPriorityFeeSol);
  const dexFeeSol = extractRouteDexFeeSol(params.quote, params.estimatedSolOut);
  const jupiterPlatformFeeSol = extractJupiterPlatformFeeSol(params.quote, params.estimatedSolOut);
  const tokenTaxSol = params.estimatedSolOut * ((params.tokenTaxPct ?? 0) / 100);
  const routeLabels = extractRouteLabels(params.quote);
  const walletOutFeeSol =
    baseFeeSol +
    priorityFeeSol +
    tokenTaxSol +
    (params.quote ? 0 : dexFeeSol + jupiterPlatformFeeSol);
  const totalSol = baseFeeSol + priorityFeeSol + dexFeeSol + jupiterPlatformFeeSol + tokenTaxSol;

  return {
    baseFeeSol,
    priorityFeeSol,
    dexFeeSol,
    jupiterPlatformFeeSol,
    ataRentSol: 0,
    tokenTaxSol,
    walletOutFeeSol,
    routeLabels,
    priorityFeeSource:
      params.priorityFeeSource ??
      (params.settings.priorityFeePreset === 'auto'
        ? 'jupiter_auto'
        : params.settings.priorityFeePreset === 'custom'
          ? 'custom'
          : 'preset'),
    totalSol,
  };
}

export function computeBreakEvenPrices(params: {
  entryPriceUsd: number;
  entryPriceSol: number;
  solIn: number;
  entryFeesSol: number;
  entryRentSol: number;
  estimatedExitFeesSol: number;
}): { breakEvenPriceUsd: number; breakEvenPriceSol: number; roundTripCostPct: number } {
  const totalCostSol = params.entryFeesSol + params.entryRentSol + params.estimatedExitFeesSol;
  const multiplier = params.solIn > 0 ? 1 + totalCostSol / params.solIn : 1;
  return {
    breakEvenPriceUsd: params.entryPriceUsd * multiplier,
    breakEvenPriceSol: params.entryPriceSol * multiplier,
    roundTripCostPct: (multiplier - 1) * 100,
  };
}

export function snapshotExitParams(settings: BotSettings, roundTripCostPct: number): PositionExitSnapshot {
  const clampedSl = Math.max(0.5, settings.stopLossPct);
  const takeProfitEnabled = isOptionEnabled(settings, 'takeProfitPct');
  const clampedTp = takeProfitEnabled ? Math.max(1.5, settings.takeProfitPct) : 0;
  const emergencyLiquidityFloorEnabled = isOptionEnabled(settings, 'emergencyLiquidityFloorUsd');
  const minLiqEnabled = isOptionEnabled(settings, 'minLiquidityUsd');
  const effectiveEmergencyLiquidityFloorUsd = !emergencyLiquidityFloorEnabled
    ? 0
    : minLiqEnabled && settings.minLiquidityUsd < settings.emergencyLiquidityFloorUsd
      ? Math.min(settings.emergencyLiquidityFloorUsd, Math.max(0, settings.minLiquidityUsd * 0.5))
      : settings.emergencyLiquidityFloorUsd;
  return {
    stopLossEnabled: settings.stopLossEnabled,
    stopLossPct: clampedSl,
    stopLossTiers: (settings.stopLossTiers || []).map((t) => ({ ...t })),
    takeProfitEnabled,
    takeProfitPct: clampedTp,
    trailingEnabled: settings.trailingEnabled,
    trailingLadder: settings.trailingLadder.map((t) => ({ ...t })),
    breakEvenRecoveryEnabled: settings.breakEvenRecoveryEnabled,
    maxHoldMinutes: settings.maxHoldMinutes,
    maxHoldStagnationEnabled: settings.maxHoldStagnationEnabled,
    stagnationMinGainPct: settings.stagnationMinGainPct,
    emergencyLiquidityFloorEnabled,
    emergencyLiquidityFloorUsd: effectiveEmergencyLiquidityFloorUsd,
    emergencyLiquidityDrainPct: settings.emergencyLiquidityDrainPct,
    emergencyMaxSellTaxPct: settings.emergencyMaxSellTaxPct,
    roundTripCostPct,
  };
}

export function computeAnalyticsSummary(trades: TradeRecord[]): AnalyticsSummary {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRatePct: 0,
      grossPnlSol: 0,
      netPnlSol: 0,
      netPnlUsd: 0,
      totalFeesSol: 0,
      totalRentSol: 0,
      profitFactor: 0,
      avgWinSol: 0,
      avgLossSol: 0,
      maxDrawdownSol: 0,
      expectancySol: 0,
      byExitReason: [],
      bySource: [],
      byHour: [],
      equityCurve: [],
    };
  }

  let wins = 0;
  let losses = 0;
  let grossWinSol = 0;
  let grossLossAbsSol = 0;
  let grossPnlSol = 0;
  let netPnlSol = 0;
  let netPnlUsd = 0;
  let totalFeesSol = 0;
  let totalRentSol = 0;

  const byReasonMap = new Map<string, { count: number; netPnlSol: number }>();
  const bySourceMap = new Map<string, { count: number; wins: number; netPnlSol: number }>();
  const byHourMap = new Map<number, { count: number; netPnlSol: number }>();

  const chronological = [...trades].sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  let cumulative = 0;
  let peakEquity = 0;
  let maxDrawdownSol = 0;
  const equityCurve: AnalyticsSummary['equityCurve'] = [];

  for (const t of chronological) {
    const isWin = t.pnlSol > 0 && t.exitReason !== 'WRITE_OFF_UNSELLABLE';
    if (isWin) {
      wins += 1;
      grossWinSol += t.pnlSol;
    } else {
      losses += 1;
      grossLossAbsSol += Math.abs(Math.min(0, t.pnlSol));
    }

    grossPnlSol += t.grossPnlSol;
    netPnlSol += t.pnlSol;
    netPnlUsd += t.pnlUsd;
    totalFeesSol += t.feesSol;
    totalRentSol += t.rentSol;

    cumulative += t.pnlSol;
    if (cumulative > peakEquity) peakEquity = cumulative;
    const dd = peakEquity - cumulative;
    if (dd > maxDrawdownSol) maxDrawdownSol = dd;

    equityCurve.push({
      timestamp: t.closedAt,
      cumulativeNetSol: Number(cumulative.toFixed(6)),
      drawdownSol: Number(dd.toFixed(6)),
    });

    const rEntry = byReasonMap.get(t.exitReason) ?? { count: 0, netPnlSol: 0 };
    rEntry.count += 1;
    rEntry.netPnlSol += t.pnlSol;
    byReasonMap.set(t.exitReason, rEntry);

    const sEntry = bySourceMap.get(t.source) ?? { count: 0, wins: 0, netPnlSol: 0 };
    sEntry.count += 1;
    if (isWin) sEntry.wins += 1;
    sEntry.netPnlSol += t.pnlSol;
    bySourceMap.set(t.source, sEntry);

    const hour = new Date(t.closedAt).getUTCHours();
    const hEntry = byHourMap.get(hour) ?? { count: 0, netPnlSol: 0 };
    hEntry.count += 1;
    hEntry.netPnlSol += t.pnlSol;
    byHourMap.set(hour, hEntry);
  }

  const winRatePct = (wins / totalTrades) * 100;
  const avgWinSol = wins > 0 ? grossWinSol / wins : 0;
  const avgLossSol = losses > 0 ? -(grossLossAbsSol / losses) : 0;
  const profitFactor =
    grossLossAbsSol > 0 ? grossWinSol / grossLossAbsSol : grossWinSol > 0 ? Infinity : 0;
  const expectancySol = netPnlSol / totalTrades;

  return {
    totalTrades,
    wins,
    losses,
    winRatePct,
    grossPnlSol,
    netPnlSol,
    netPnlUsd,
    totalFeesSol,
    totalRentSol,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 99.9,
    avgWinSol,
    avgLossSol,
    maxDrawdownSol,
    expectancySol,
    byExitReason: Array.from(byReasonMap.entries()).map(([reason, v]) => ({
      reason,
      count: v.count,
      netPnlSol: v.netPnlSol,
    })),
    bySource: Array.from(bySourceMap.entries()).map(([source, v]) => ({
      source,
      count: v.count,
      winRatePct: (v.wins / v.count) * 100,
      netPnlSol: v.netPnlSol,
    })),
    byHour: Array.from(byHourMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hour, v]) => ({
        hour,
        count: v.count,
        netPnlSol: v.netPnlSol,
      })),
    equityCurve,
  };
}
