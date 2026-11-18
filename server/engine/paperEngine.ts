import type {
  BotSettings,
  CandidateToken,
  ExecutionMode,
  ExitReason,
  ExplanationRecord,
  FeeBreakdown,
  PositionRecord,
  TradeRecord,
} from '../types';
import type { JupiterProvider, JupiterQuoteResponse } from '../providers/jupiter';
import { WSOL_MINT } from '../providers/jupiter';
import {
  computeBreakEvenPrices,
  computeEntryFees,
  computeExitFees,
  snapshotExitParams,
} from './fees';

export interface PaperBuySample {
  priceUsd: number;
  liquidityUsd: number;
  quote: JupiterQuoteResponse | null;
}

export interface PaperSellSample {
  priceUsd: number;
  liquidityUsd: number;
  quote: JupiterQuoteResponse | null;
}

export interface PaperSimulationHooks {
  random?: () => number;
  sleepMs?: (ms: number) => Promise<void>;
  sampleBuyWindow?: (token: CandidateToken, solAmount: number) => Promise<PaperBuySample>;
  sampleSellWindow?: (position: PositionRecord) => Promise<PaperSellSample>;
}

export interface PaperBuyExecutionResult {
  executed: boolean;
  cancelledReason?: string;
  position?: PositionRecord;
  quotedPriceUsd: number;
  worstWindowPriceUsd: number;
  effectiveFillPriceUsd: number;
  totalSpentSol: number;
}

export interface PaperSellExecutionResult {
  executed: boolean;
  failureReason?: string;
  trade?: TradeRecord;
  solReturnedNet: number;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeRealisticPaperBuy(params: {
  mode: 'paper' | 'testnet';
  token: CandidateToken;
  solAmount: number;
  solPriceUsd: number;
  settings: BotSettings;
  explanation: ExplanationRecord;
  initialQuote: JupiterQuoteResponse;
  measuredLiveGapPct: number;
  jupiterProvider?: JupiterProvider;
  hooks?: PaperSimulationHooks;
  liveAutoPriorityFeeSol?: number | null;
  priorityFeeSource?: FeeBreakdown['priorityFeeSource'];
  nowMs?: number;
}): Promise<PaperBuyExecutionResult> {
  const {
    mode,
    token,
    solAmount,
    solPriceUsd,
    settings,
    explanation,
    initialQuote,
    measuredLiveGapPct,
    jupiterProvider,
    hooks,
  } = params;

  const rng = hooks?.random ?? Math.random;
  const sleep = hooks?.sleepMs ?? defaultSleep;
  const nowMs = params.nowMs ?? Date.now();

  const decimals = token.tokenDecimals ?? 6;
  const initialTokensOut = Number(initialQuote.outAmount) / 10 ** decimals;
  if (initialTokensOut <= 0 || !Number.isFinite(initialTokensOut)) {
    return {
      executed: false,
      cancelledReason: 'Paper buy cancelled: Jupiter quote returned zero output tokens',
      quotedPriceUsd: token.priceUsd,
      worstWindowPriceUsd: token.priceUsd,
      effectiveFillPriceUsd: token.priceUsd,
      totalSpentSol: 0,
    };
  }

  // Quoted executable price from Jupiter quote
  const quotedPriceSol = solAmount / initialTokensOut;
  const quotedPriceUsd = quotedPriceSol * solPriceUsd;

  // Simulated failure check (buy failed / missed block)
  if (rng() * 100 < settings.paperBuyFailChancePct) {
    return {
      executed: false,
      cancelledReason: 'Simulated paper buy execution failure (block miss / slippage exceed)',
      quotedPriceUsd,
      worstWindowPriceUsd: quotedPriceUsd,
      effectiveFillPriceUsd: quotedPriceUsd,
      totalSpentSol: 0,
    };
  }

  // Decision-to-fill delay window: sample multiple times and take WORST (highest) price
  const minSec = Math.max(0, settings.paperDelayMinSec);
  const maxSec = Math.max(minSec, settings.paperDelayMaxSec);
  const delaySec = minSec + rng() * (maxSec - minSec);
  const steps = delaySec <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(delaySec)));
  const stepMs = steps > 0 ? (delaySec * 1000) / steps : 0;

  let worstPriceUsd = quotedPriceUsd;
  let latestLiquidityUsd = token.liquidityUsd;
  let finalQuote: JupiterQuoteResponse = initialQuote;

  for (let i = 0; i < steps; i++) {
    await sleep(stepMs);
    if (hooks?.sampleBuyWindow) {
      const sample = await hooks.sampleBuyWindow(token, solAmount);
      latestLiquidityUsd = sample.liquidityUsd;
      if (sample.priceUsd > worstPriceUsd) {
        worstPriceUsd = sample.priceUsd;
      }
      if (sample.quote) {
        finalQuote = sample.quote;
        const qTokens = Number(sample.quote.outAmount) / 10 ** decimals;
        if (qTokens > 0) {
          const qUsd = (solAmount / qTokens) * solPriceUsd;
          if (qUsd > worstPriceUsd) worstPriceUsd = qUsd;
        }
      }
    } else if (jupiterProvider) {
      const lamports = String(Math.floor(solAmount * 1e9));
      const q = await jupiterProvider.getQuote({
        inputMint: WSOL_MINT,
        outputMint: token.mint,
        amountRaw: lamports,
        slippageBps: settings.slippageBps,
      });
      if (q) {
        finalQuote = q;
        const qTokens = Number(q.outAmount) / 10 ** decimals;
        if (qTokens > 0) {
          const qUsd = (solAmount / qTokens) * solPriceUsd;
          if (qUsd > worstPriceUsd) worstPriceUsd = qUsd;
        }
      }
    }
  }

  // Re-check liquidity at fill time: cancel if liquidity fell below floor during delay
  if (latestLiquidityUsd < settings.minLiquidityUsd) {
    return {
      executed: false,
      cancelledReason: `Paper buy cancelled at fill time: liquidity dropped to $${latestLiquidityUsd.toFixed(0)} < $${settings.minLiquidityUsd} floor during ${delaySec.toFixed(1)}s delay`,
      quotedPriceUsd,
      worstWindowPriceUsd: worstPriceUsd,
      effectiveFillPriceUsd: worstPriceUsd,
      totalSpentSol: 0,
    };
  }

  // Competition penalty on coins < 24h old
  const poolAgeMinutes = (nowMs - token.poolCreatedAtMs) / 60_000;
  const competitionPenaltyPct =
    poolAgeMinutes < 24 * 60 ? settings.paperCompetitionPenaltyPct : 0;

  // Optional measured Live vs Paper reality gap
  const measuredGapPenaltyPct =
    settings.applyMeasuredGapToPaper && measuredLiveGapPct > 0 ? measuredLiveGapPct : 0;

  const totalAdverseMultiplier = 1 + (competitionPenaltyPct + measuredGapPenaltyPct) / 100;
  const effectiveFillPriceUsd = worstPriceUsd * totalAdverseMultiplier;
  const effectiveFillPriceSol = effectiveFillPriceUsd / solPriceUsd;

  const resolvedAutoPriority =
    params.liveAutoPriorityFeeSol === undefined &&
    jupiterProvider &&
    settings.priorityFeePreset === 'auto' &&
    typeof jupiterProvider.estimateLivePriorityFeeSol === 'function'
      ? await jupiterProvider.estimateLivePriorityFeeSol(undefined, settings.maxPriorityFeeSol)
      : null;
  const liveAutoPriorityFeeSol = params.liveAutoPriorityFeeSol ?? resolvedAutoPriority?.sol ?? null;
  const priorityFeeSource = params.priorityFeeSource ?? resolvedAutoPriority?.source;

  const entryFees = computeEntryFees({
    solAmount,
    settings,
    quote: finalQuote,
    needsAtaRent: true,
    liveAutoPriorityFeeSol,
    priorityFeeSource,
  });

  const quantity = effectiveFillPriceSol > 0 ? solAmount / effectiveFillPriceSol : initialTokensOut;
  const estimatedExitFees = computeExitFees({
    estimatedSolOut: solAmount,
    settings,
    quote: finalQuote,
    liveAutoPriorityFeeSol,
    priorityFeeSource,
  });

  const entryWalletFeesSol = entryFees.walletOutFeeSol;
  const estimatedExitWalletFeesSol = estimatedExitFees.walletOutFeeSol;
  const netRentCostAtExitSol = settings.autoReclaimRent ? 0 : entryFees.ataRentSol;

  const breakEven = computeBreakEvenPrices({
    entryPriceUsd: effectiveFillPriceUsd,
    entryPriceSol: effectiveFillPriceSol,
    solIn: solAmount,
    entryFeesSol: entryWalletFeesSol,
    entryRentSol: netRentCostAtExitSol,
    estimatedExitFeesSol: estimatedExitWalletFeesSol,
  });

  const exitParams = snapshotExitParams(settings, breakEven.roundTripCostPct);
  const fillTimeMs = nowMs + Math.round(delaySec * 1000);
  const posId = `${mode}_pos_${fillTimeMs}_${token.mint.slice(0, 6)}`;

  const position: PositionRecord = {
    id: posId,
    mode: mode as ExecutionMode,
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    source: token.source,
    dex: token.dex,
    tokenClass: explanation.tokenClass,
    status: 'OPEN',
    openedAtMs: fillTimeMs,
    updatedAtMs: fillTimeMs,
    tokenAgeAtEntryMin: Math.max(0, poolAgeMinutes),
    decimals,
    quantity,
    entryPriceUsd: effectiveFillPriceUsd,
    entryPriceSol: effectiveFillPriceSol,
    currentPriceUsd: effectiveFillPriceUsd,
    currentPriceSol: effectiveFillPriceSol,
    breakEvenPriceUsd: breakEven.breakEvenPriceUsd,
    breakEvenPriceSol: breakEven.breakEvenPriceSol,
    entryLiquidityUsd: latestLiquidityUsd,
    currentLiquidityUsd: latestLiquidityUsd,
    solIn: solAmount,
    entryFeesSol: entryWalletFeesSol,
    entryRentSol: entryFees.ataRentSol,
    solPriceUsdAtEntry: solPriceUsd,
    peakPriceUsd: effectiveFillPriceUsd,
    peakPnlPct: 0,
    trailingFloorPct: null,
    trailingArmed: false,
    gapDownTriggered: false,
    exitParams,
    txBuy: `sim_buy_${fillTimeMs}_${token.mint.slice(0, 8)}`,
    confirmationLabel: 'simulated',
    qualityScore: explanation.qualityScore,
    tradeScore: explanation.tradeScore,
    explanationJson: JSON.stringify(explanation),
    sellAttempts: 0,
    firstSellFailureAtMs: null,
    lastSellError: null,
    consecutiveZeroBalanceReads: 0,
    reviewReason: null,
    isStaleData: false,
    priceHistory: [effectiveFillPriceUsd],
  };

  return {
    executed: true,
    position,
    quotedPriceUsd,
    worstWindowPriceUsd: worstPriceUsd,
    effectiveFillPriceUsd,
    totalSpentSol: solAmount + entryWalletFeesSol + entryFees.ataRentSol,
  };
}

export async function executeRealisticPaperSell(params: {
  position: PositionRecord;
  exitReason: ExitReason;
  solPriceUsd: number;
  settings: BotSettings;
  measuredLiveGapPct: number;
  jupiterProvider?: JupiterProvider;
  hooks?: PaperSimulationHooks;
  initialQuote?: JupiterQuoteResponse | null;
  liveAutoPriorityFeeSol?: number | null;
  priorityFeeSource?: FeeBreakdown['priorityFeeSource'];
  nowMs?: number;
}): Promise<PaperSellExecutionResult> {
  const { position, exitReason, solPriceUsd, settings, measuredLiveGapPct, jupiterProvider, hooks } =
    params;

  const rng = hooks?.random ?? Math.random;
  const sleep = hooks?.sleepMs ?? defaultSleep;
  const nowMs = params.nowMs ?? Date.now();

  // Simulate "no route" or failed sell — leaves position OPEN and exposed!
  if (exitReason !== 'KILL_SWITCH' && rng() * 100 < settings.paperSellFailChancePct) {
    return {
      executed: false,
      failureReason: 'Simulated paper sell failure: no route / transaction dropped',
      solReturnedNet: 0,
    };
  }

  const rawUnits = Math.max(1, Math.floor(position.quantity * 10 ** position.decimals));
  let initialQuote: JupiterQuoteResponse | null = params.initialQuote ?? null;

  if (hooks?.sampleSellWindow) {
    const sample = await hooks.sampleSellWindow(position);
    initialQuote = sample.quote;
  } else if (!initialQuote && jupiterProvider) {
    initialQuote = await jupiterProvider.getQuote({
      inputMint: position.mint,
      outputMint: WSOL_MINT,
      amountRaw: String(rawUnits),
      slippageBps: settings.slippageBps,
    });
  }

  if (jupiterProvider && !hooks?.sampleSellWindow && !initialQuote) {
    return {
      executed: false,
      failureReason: 'no route: Jupiter returned no sell route back to SOL',
      solReturnedNet: 0,
    };
  }

  let worstExitPriceUsd = position.currentPriceUsd;
  if (initialQuote && Number(initialQuote.outAmount) > 0) {
    const qSol = Number(initialQuote.outAmount) / 1e9;
    const qUsd = (qSol / position.quantity) * solPriceUsd;
    if (qUsd < worstExitPriceUsd) worstExitPriceUsd = qUsd;
  }

  // Delay window for sell: track WORST (lowest) price between signal and fill
  const minSec = Math.max(0, settings.paperDelayMinSec);
  const maxSec = Math.max(minSec, settings.paperDelayMaxSec);
  const delaySec = minSec + rng() * (maxSec - minSec);
  const steps = delaySec <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(delaySec)));
  const stepMs = steps > 0 ? (delaySec * 1000) / steps : 0;

  let finalQuote = initialQuote;
  for (let i = 0; i < steps; i++) {
    await sleep(stepMs);
    if (hooks?.sampleSellWindow) {
      const sample = await hooks.sampleSellWindow(position);
      if (!sample.quote && exitReason !== 'KILL_SWITCH') {
        return {
          executed: false,
          failureReason: 'no route during simulated exit delay window',
          solReturnedNet: 0,
        };
      }
      if (sample.priceUsd < worstExitPriceUsd) {
        worstExitPriceUsd = sample.priceUsd;
      }
      if (sample.quote) {
        finalQuote = sample.quote;
        const qSol = Number(sample.quote.outAmount) / 1e9;
        const qUsd = (qSol / position.quantity) * solPriceUsd;
        if (qUsd < worstExitPriceUsd) worstExitPriceUsd = qUsd;
      }
    } else if (jupiterProvider) {
      const q = await jupiterProvider.getQuote({
        inputMint: position.mint,
        outputMint: WSOL_MINT,
        amountRaw: String(rawUnits),
        slippageBps: settings.slippageBps,
      });
      if (q && Number(q.outAmount) > 0) {
        finalQuote = q;
        const qSol = Number(q.outAmount) / 1e9;
        const qUsd = (qSol / position.quantity) * solPriceUsd;
        if (qUsd < worstExitPriceUsd) worstExitPriceUsd = qUsd;
      }
    }
  }

  const gapPenaltyPct =
    settings.applyMeasuredGapToPaper && measuredLiveGapPct > 0 ? measuredLiveGapPct : 0;
  const effectiveExitPriceUsd = worstExitPriceUsd * (1 - gapPenaltyPct / 100);
  const grossSolOut = (position.quantity * effectiveExitPriceUsd) / solPriceUsd;

  const resolvedAutoPriority =
    params.liveAutoPriorityFeeSol === undefined &&
    jupiterProvider &&
    settings.priorityFeePreset === 'auto' &&
    typeof jupiterProvider.estimateLivePriorityFeeSol === 'function'
      ? await jupiterProvider.estimateLivePriorityFeeSol(undefined, settings.maxPriorityFeeSol)
      : null;
  const liveAutoPriorityFeeSol = params.liveAutoPriorityFeeSol ?? resolvedAutoPriority?.sol ?? null;
  const priorityFeeSource = params.priorityFeeSource ?? resolvedAutoPriority?.source;

  const exitFeesRaw: FeeBreakdown = computeExitFees({
    estimatedSolOut: grossSolOut,
    settings,
    quote: finalQuote,
    liveAutoPriorityFeeSol,
    priorityFeeSource,
  });
  const rentReclaimedSol = settings.autoReclaimRent && position.entryRentSol > 0 ? position.entryRentSol : 0;
  const exitFees: FeeBreakdown = {
    ...exitFeesRaw,
    rentReclaimedSol,
  };

  const exitWalletFeesSol = exitFees.walletOutFeeSol;
  const totalFeesSol = position.entryFeesSol + exitWalletFeesSol;
  const rentSol = Math.max(0, position.entryRentSol - rentReclaimedSol);
  const grossPnlSol = grossSolOut - position.solIn;
  const netSolReturned = Math.max(0, grossSolOut - exitWalletFeesSol) + rentReclaimedSol;
  const netPnlSol = netSolReturned - (position.solIn + position.entryFeesSol + position.entryRentSol);
  const pnlUsd = netPnlSol * solPriceUsd;
  const pnlPct = position.solIn > 0 ? (netPnlSol / position.solIn) * 100 : 0;
  const closedAtMs = nowMs + Math.round(delaySec * 1000);
  const holdSeconds = Math.max(1, Math.round((closedAtMs - position.openedAtMs) / 1000));

  const trade: TradeRecord = {
    tradeId: `${position.mode}_tr_${closedAtMs}_${position.mint.slice(0, 6)}`,
    mode: position.mode,
    openedAt: new Date(position.openedAtMs).toISOString(),
    closedAt: new Date(closedAtMs).toISOString(),
    symbol: position.symbol,
    mint: position.mint,
    source: position.source,
    dex: position.dex,
    tokenAgeAtEntry: Number(position.tokenAgeAtEntryMin.toFixed(1)),
    entryPrice: position.entryPriceUsd,
    exitPrice: effectiveExitPriceUsd,
    quantity: position.quantity,
    solIn: position.solIn,
    solOut: netSolReturned,
    feesSol: totalFeesSol,
    rentSol,
    grossPnlSol,
    pnlSol: netPnlSol,
    pnlUsd,
    pnlPct,
    peakPct: position.peakPnlPct,
    holdSeconds,
    exitReason,
    confirmed: 'simulated',
    txBuy: position.txBuy,
    txSell: `sim_sell_${closedAtMs}_${position.mint.slice(0, 8)}`,
    solPriceUsd,
    feeBreakdownJson: JSON.stringify({
      entryFeesSol: position.entryFeesSol,
      entryRentSol: position.entryRentSol,
      rentReclaimedSol,
      exitFees,
      dexFeeSol: exitFees.dexFeeSol,
      jupiterPlatformFeeSol: exitFees.jupiterPlatformFeeSol,
      routeLabels: exitFees.routeLabels ?? [],
      priorityFeeSource: exitFees.priorityFeeSource ?? 'preset',
      note: 'DEX AMM fees extracted from Jupiter routePlan[].swapInfo (already reflected in Jupiter quote output)',
    }),
    archivedSessionId: null,
  };

  return {
    executed: true,
    trade,
    solReturnedNet: netSolReturned,
  };
}
