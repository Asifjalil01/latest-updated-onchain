import type {
  AnalyticsSummary,
  BotSettings,
  CandidateToken,
  ExplanationRecord,
  TradeRecord,
} from '../types';
import type { JupiterQuoteResponse } from '../providers/jupiter';
import { WSOL_MINT } from '../providers/jupiter';
import { evaluateHardFilters, validateCandidateData } from './filters';
import { evaluateSecurityRules, type SecurityEvaluationInputs } from './security';
import { scoreCandidate } from './scoring';
import { calculatePositionSize } from './sizing';
import { computeAnalyticsSummary } from './fees';
import { evaluatePositionExit } from './exits';
import { executeRealisticPaperBuy, executeRealisticPaperSell } from './paperEngine';

export interface ReplayCandidateSnapshot {
  token: CandidateToken;
  solPriceUsd: number;
  plannedBuyImpactPct: number;
  security: SecurityEvaluationInputs;
  pricePathUsd: Array<{ offsetSeconds: number; priceUsd: number; liquidityUsd: number }>;
}

export interface ReplayResult {
  totalCandidates: number;
  passedPipeline: number;
  rejectedCount: number;
  explanations: ExplanationRecord[];
  trades: TradeRecord[];
  analytics: AnalyticsSummary;
  endingBalanceSol: number;
}

export async function runDeterministicReplay(params: {
  snapshots: ReplayCandidateSnapshot[];
  settings: BotSettings;
  startingBalanceSol?: number;
  baseTimeMs?: number;
}): Promise<ReplayResult> {
  const { snapshots, settings } = params;
  let balanceSol = params.startingBalanceSol ?? settings.paperInitialBalanceSol;
  const baseTimeMs = params.baseTimeMs ?? 1_760_000_000_000;

  const explanations: ExplanationRecord[] = [];
  const trades: TradeRecord[] = [];
  let passedPipeline = 0;
  let rejectedCount = 0;

  for (let idx = 0; idx < snapshots.length; idx++) {
    const snap = snapshots[idx];
    const evalNow = baseTimeMs + idx * 60_000;

    const valid = validateCandidateData(snap.token);
    if (!valid.valid) {
      rejectedCount += 1;
      explanations.push({
        mint: snap.token.mint,
        symbol: snap.token.symbol,
        tokenClass: 'high_risk_micro',
        qualityScore: 0,
        tradeScore: 0,
        combinedScore: 0,
        sizeMultiplier: 0,
        decision: 'REJECT',
        stageFailed: 'DATA_VALIDATE',
        reasons: [valid.reason || 'Invalid candidate data'],
        warnings: [],
        qualityBreakdown: {},
        tradeBreakdown: {},
        evaluatedAtMs: evalNow,
      });
      continue;
    }

    const filterResult = evaluateHardFilters(
      snap.token,
      settings,
      snap.plannedBuyImpactPct,
      evalNow
    );
    const securityReport = evaluateSecurityRules(snap.security, settings);
    const explanation = scoreCandidate({
      token: snap.token,
      filterResult,
      securityReport,
      settings,
      nowMs: evalNow,
    });
    explanations.push(explanation);

    if (explanation.decision !== 'BUY') {
      rejectedCount += 1;
      continue;
    }

    const sizing = calculatePositionSize({
      settings,
      availableBalanceSol: balanceSol,
      currentExposureSol: 0,
      openPositionsCount: 0,
      dailyRealizedPnlSol: trades.reduce((a, t) => a + t.pnlSol, 0),
      poolLiquidityUsd: snap.token.liquidityUsd,
      solPriceUsd: snap.solPriceUsd,
      tokenClassMultiplier: explanation.sizeMultiplier,
    });

    if (!sizing.approved) {
      rejectedCount += 1;
      continue;
    }

    passedPipeline += 1;
    const decimals = snap.token.tokenDecimals ?? 6;
    const initialTokensOut = Math.floor(
      ((sizing.solAmount * snap.solPriceUsd) / snap.token.priceUsd) * 10 ** decimals
    );

    const syntheticBuyQuote: JupiterQuoteResponse = {
      inputMint: WSOL_MINT,
      inAmount: String(Math.floor(sizing.solAmount * 1e9)),
      outputMint: snap.token.mint,
      outAmount: String(initialTokensOut),
      slippageBps: settings.slippageBps,
      priceImpactPct: String(snap.plannedBuyImpactPct / 100),
      routePlan: [{ swapInfo: { label: snap.token.dex }, percent: 100 }],
    };

    const buyRes = await executeRealisticPaperBuy({
      mode: 'paper',
      token: snap.token,
      solAmount: sizing.solAmount,
      solPriceUsd: snap.solPriceUsd,
      settings: { ...settings, paperDelayMinSec: 0, paperDelayMaxSec: 0, paperBuyFailChancePct: 0 },
      explanation,
      initialQuote: syntheticBuyQuote,
      measuredLiveGapPct: 0,
      nowMs: evalNow,
      hooks: {
        random: () => 0.5,
        sleepMs: async () => undefined,
      },
    });

    if (!buyRes.executed || !buyRes.position) continue;
    let position = buyRes.position;
    balanceSol -= buyRes.totalSpentSol;

    let exited = false;
    for (const step of snap.pricePathUsd) {
      const stepTime = position.openedAtMs + step.offsetSeconds * 1000;
      const evalExit = evaluatePositionExit(position, {
        currentPriceUsd: step.priceUsd,
        currentLiquidityUsd: step.liquidityUsd,
        nowMs: stepTime,
      });

      position = {
        ...position,
        currentPriceUsd: step.priceUsd,
        currentPriceSol: step.priceUsd / snap.solPriceUsd,
        currentLiquidityUsd: step.liquidityUsd,
        peakPriceUsd: evalExit.updatedPeakPriceUsd,
        peakPnlPct: evalExit.updatedPeakPnlPct,
        trailingArmed: evalExit.updatedTrailingArmed,
        trailingFloorPct: evalExit.updatedTrailingFloorPct,
        gapDownTriggered: evalExit.updatedGapDownTriggered,
      };

      if (evalExit.shouldExit && evalExit.reason) {
        const sellOutLamports = Math.floor(
          ((position.quantity * step.priceUsd) / snap.solPriceUsd) * 1e9
        );
        const syntheticSellQuote: JupiterQuoteResponse = {
          inputMint: position.mint,
          inAmount: String(Math.floor(position.quantity * 10 ** position.decimals)),
          outputMint: WSOL_MINT,
          outAmount: String(Math.max(1, sellOutLamports)),
          slippageBps: settings.slippageBps,
          priceImpactPct: '0.005',
          routePlan: [{ swapInfo: { label: position.dex }, percent: 100 }],
        };

        const sellRes = await executeRealisticPaperSell({
          position,
          exitReason: evalExit.reason,
          solPriceUsd: snap.solPriceUsd,
          settings: {
            ...settings,
            paperDelayMinSec: 0,
            paperDelayMaxSec: 0,
            paperSellFailChancePct: 0,
          },
          measuredLiveGapPct: 0,
          nowMs: stepTime,
          hooks: {
            random: () => 0.5,
            sleepMs: async () => undefined,
            sampleSellWindow: async () => ({
              priceUsd: step.priceUsd,
              liquidityUsd: step.liquidityUsd,
              quote: syntheticSellQuote,
            }),
          },
        });

        if (sellRes.executed && sellRes.trade) {
          trades.push(sellRes.trade);
          balanceSol += sellRes.solReturnedNet;
          exited = true;
          break;
        }
      }
    }

    if (!exited && snap.pricePathUsd.length > 0) {
      const last = snap.pricePathUsd[snap.pricePathUsd.length - 1];
      const stepTime = position.openedAtMs + last.offsetSeconds * 1000;
      const sellOutLamports = Math.floor(
        ((position.quantity * last.priceUsd) / snap.solPriceUsd) * 1e9
      );
      const sellRes = await executeRealisticPaperSell({
        position: { ...position, currentPriceUsd: last.priceUsd },
        exitReason: 'MANUAL_SELL',
        solPriceUsd: snap.solPriceUsd,
        settings: {
          ...settings,
          paperDelayMinSec: 0,
          paperDelayMaxSec: 0,
          paperSellFailChancePct: 0,
        },
        measuredLiveGapPct: 0,
        nowMs: stepTime,
        hooks: {
          random: () => 0.5,
          sleepMs: async () => undefined,
          sampleSellWindow: async () => ({
            priceUsd: last.priceUsd,
            liquidityUsd: last.liquidityUsd,
            quote: {
              inputMint: position.mint,
              inAmount: String(Math.floor(position.quantity * 10 ** position.decimals)),
              outputMint: WSOL_MINT,
              outAmount: String(Math.max(1, sellOutLamports)),
              slippageBps: settings.slippageBps,
              priceImpactPct: '0.005',
              routePlan: [{ swapInfo: { label: position.dex }, percent: 100 }],
            },
          }),
        },
      });
      if (sellRes.executed && sellRes.trade) {
        trades.push(sellRes.trade);
        balanceSol += sellRes.solReturnedNet;
      }
    }
  }

  return {
    totalCandidates: snapshots.length,
    passedPipeline,
    rejectedCount,
    explanations,
    trades,
    analytics: computeAnalyticsSummary(trades),
    endingBalanceSol: balanceSol,
  };
}
