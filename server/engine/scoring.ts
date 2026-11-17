import type {
  BotSettings,
  CandidateToken,
  ExplanationRecord,
  HardFilterResult,
  SecurityReport,
  TokenClass,
} from '../types';

export function classifyToken(token: CandidateToken, poolAgeMinutes: number): {
  tokenClass: TokenClass;
  sizeMultiplier: number;
} {
  if (token.liquidityUsd >= 1_000_000 && token.volume24hUsd >= 2_000_000 && poolAgeMinutes >= 14 * 24 * 60) {
    return { tokenClass: 'bluechip', sizeMultiplier: 1.0 };
  }
  if (token.liquidityUsd >= 250_000 && token.volume24hUsd >= 500_000 && poolAgeMinutes >= 3 * 24 * 60) {
    return { tokenClass: 'mid_cap', sizeMultiplier: 0.9 };
  }
  if (token.liquidityUsd >= 75_000 && poolAgeMinutes >= 180) {
    return { tokenClass: 'early_stage', sizeMultiplier: 0.7 };
  }
  if (token.liquidityUsd >= 10_000 && poolAgeMinutes >= 30) {
    return { tokenClass: 'meme', sizeMultiplier: 0.4 };
  }
  return { tokenClass: 'high_risk_micro', sizeMultiplier: 0 };
}

export function scoreCandidate(params: {
  token: CandidateToken;
  filterResult: HardFilterResult;
  securityReport: SecurityReport;
  settings: BotSettings;
  nowMs?: number;
}): ExplanationRecord {
  const { token, filterResult, securityReport, settings } = params;
  const nowMs = params.nowMs ?? Date.now();
  const poolAgeMinutes = filterResult.computed.poolAgeMinutes;
  const { tokenClass, sizeMultiplier } = classifyToken(token, poolAgeMinutes);

  // Quality score components (max 100)
  const safetyPts = securityReport.passed
    ? Math.max(0, 30 - (securityReport.rugCheckScore ?? 30) * 0.5)
    : 0;
  const liquidityPts = Math.min(25, (Math.log10(Math.max(1, token.liquidityUsd)) - 4) * 12.5);
  const top10 = securityReport.top10HoldersPct ?? 50;
  const holderPts = Math.max(0, Math.min(20, ((40 - top10) / 30) * 20));
  const contractPts =
    securityReport.mintAuthorityRevoked &&
    securityReport.freezeAuthorityRevoked &&
    securityReport.token2022DisallowedExtensions.length === 0
      ? 15
      : 0;
  const agePts = Math.min(10, (Math.log10(Math.max(30, poolAgeMinutes)) - 1.4) * 4.5);

  const qualityBreakdown: Record<string, number> = {
    safety: Number(safetyPts.toFixed(1)),
    liquidity: Number(Math.max(0, liquidityPts).toFixed(1)),
    holders: Number(holderPts.toFixed(1)),
    contract: contractPts,
    age: Number(Math.max(0, agePts).toFixed(1)),
  };
  const qualityScore = Math.min(
    100,
    Math.round(Object.values(qualityBreakdown).reduce((a, b) => a + b, 0))
  );

  // Trade score components (max 100)
  const mom1h = Math.max(0, Math.min(45, token.priceChange1hPct));
  const momentumPts = Math.min(25, (mom1h / 25) * 20 + (token.priceChange24hPct > 0 ? 5 : 0));
  const buyRatio = filterResult.computed.buyRatio;
  const buyPressurePts = Math.max(0, Math.min(25, ((buyRatio - 0.45) / 0.25) * 25));
  const volLiq = filterResult.computed.volumeLiquidityRatio;
  const depthPts = volLiq >= 0.5 && volLiq <= 15 ? 20 : volLiq > 15 ? 12 : 8;
  const breadthPts = Math.min(15, (token.uniqueTraders24h / 500) * 15);
  const regimePts =
    token.priceChange24hPct >= 0 && token.priceChange1hPct <= 60 ? 15 : token.priceChange1hPct <= 100 ? 10 : 5;

  const tradeBreakdown: Record<string, number> = {
    momentum: Number(momentumPts.toFixed(1)),
    buyPressure: Number(buyPressurePts.toFixed(1)),
    depth: depthPts,
    breadth: Number(breadthPts.toFixed(1)),
    regime: regimePts,
  };
  const tradeScore = Math.min(
    100,
    Math.round(Object.values(tradeBreakdown).reduce((a, b) => a + b, 0))
  );

  const reasons: string[] = [...filterResult.reasons, ...securityReport.reasons];
  const warnings: string[] = [...filterResult.warnings, ...securityReport.warnings];

  if (tokenClass === 'high_risk_micro') {
    reasons.push('Classified as high_risk_micro (always rejected)');
  }
  if (qualityScore < settings.minQualityScore) {
    reasons.push(`Quality score ${qualityScore} < ${settings.minQualityScore} threshold`);
  }
  if (tradeScore < settings.minTradeScore) {
    reasons.push(`Trade score ${tradeScore} < ${settings.minTradeScore} threshold`);
  }
  if (securityReport.criticalFlags.length > 0) {
    reasons.push(`Critical security flags present: ${securityReport.criticalFlags.join(', ')}`);
  }

  const approved =
    filterResult.passed &&
    securityReport.passed &&
    securityReport.criticalFlags.length === 0 &&
    tokenClass !== 'high_risk_micro' &&
    qualityScore >= settings.minQualityScore &&
    tradeScore >= settings.minTradeScore;

  return {
    mint: token.mint,
    symbol: token.symbol,
    tokenClass,
    qualityScore,
    tradeScore,
    combinedScore: Math.round((qualityScore + tradeScore) / 2),
    sizeMultiplier,
    decision: approved ? 'BUY' : 'REJECT',
    stageFailed: approved
      ? undefined
      : !filterResult.passed
        ? 'HARD_FILTER'
        : !securityReport.passed
          ? 'SECURITY'
          : 'SCORE',
    reasons,
    warnings,
    qualityBreakdown,
    tradeBreakdown,
    evaluatedAtMs: nowMs,
  };
}
