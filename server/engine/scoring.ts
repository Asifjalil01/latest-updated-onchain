import type {
  BotSettings,
  CandidateToken,
  ExplanationRecord,
  HardFilterResult,
  SecurityReport,
  TokenClass,
} from '../types';

export function classifyToken(
  token: CandidateToken,
  poolAgeMinutes: number,
  allowCustomYoungAge = false,
  customMinLiquidityUsd = 10_000
): {
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
  const microOverride = customMinLiquidityUsd < 10_000;
  const memeFloorUsd =
    allowCustomYoungAge || microOverride ? Math.min(10_000, Math.max(0, customMinLiquidityUsd)) : 10_000;
  if (token.liquidityUsd >= memeFloorUsd && (poolAgeMinutes >= 30 || allowCustomYoungAge)) {
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
  const poolAgeSeconds = poolAgeMinutes * 60;
  const allowNewLaunchAge =
    settings.newLaunchOnlyEnabled &&
    poolAgeSeconds >= settings.newLaunchMinAgeSeconds &&
    poolAgeSeconds <= settings.newLaunchMaxAgeSeconds;
  const allowCustomYoungAge =
    allowNewLaunchAge ||
    (settings.customAgeWindowEnabled &&
      poolAgeMinutes >= settings.customMinPoolAgeMinutes &&
      poolAgeMinutes <= settings.customMaxPoolAgeMinutes);
  const { tokenClass, sizeMultiplier } = classifyToken(
    token,
    poolAgeMinutes,
    allowCustomYoungAge,
    settings.minLiquidityUsd
  );

  // Quality score components (max 100)
  const safetyPts = securityReport.passed
    ? Math.max(0, 30 - (securityReport.rugCheckScore ?? 30) * 0.5)
    : 0;
  const isMicroCustomWindow = (allowCustomYoungAge || settings.minLiquidityUsd < 10_000) && settings.minLiquidityUsd < 10_000;
  const baseLiqLog = Math.log10(
    Math.max(1, allowCustomYoungAge || settings.minLiquidityUsd < 10_000 ? Math.min(10_000, settings.minLiquidityUsd) : 10_000)
  );
  const targetLiqLog = isMicroCustomWindow ? Math.max(baseLiqLog + 1.5, 4.5) : 6;
  const liqSpan = Math.max(1, targetLiqLog - baseLiqLog);
  const liquidityPts = Math.min(
    25,
    ((Math.log10(Math.max(1, token.liquidityUsd)) - baseLiqLog) / liqSpan) * 25
  );
  const top10 = securityReport.top10HoldersPct ?? 50;
  const holderPts = Math.max(0, Math.min(20, ((40 - top10) / 30) * 20));
  const contractPts =
    securityReport.mintAuthorityRevoked &&
    securityReport.freezeAuthorityRevoked &&
    securityReport.token2022DisallowedExtensions.length === 0
      ? 15
      : 0;
  const agePts = allowCustomYoungAge
    ? 8
    : Math.min(10, (Math.log10(Math.max(30, poolAgeMinutes)) - 1.4) * 4.5);

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
  const safe1h = Number.isFinite(token.priceChange1hPct) ? token.priceChange1hPct : 0;
  const safe24h = Number.isFinite(token.priceChange24hPct) ? token.priceChange24hPct : 0;
  const mom1h = Math.max(0, Math.min(45, safe1h));
  const momentumPts = Math.min(25, (mom1h / 25) * 20 + (safe24h > 0 ? 5 : 0));
  const buyRatio = filterResult.computed.buyRatio;
  const buyPressurePts = Math.max(0, Math.min(25, ((buyRatio - 0.45) / 0.25) * 25));
  const volLiq = filterResult.computed.volumeLiquidityRatio;
  const depthPts = volLiq >= 0.5 && volLiq <= 15 ? 20 : volLiq > 15 ? 12 : 8;
  const breadthTarget = allowCustomYoungAge ? 100 : 500;
  const breadthPts = Math.min(15, (token.uniqueTraders24h / breadthTarget) * 15);
  const regimePts = allowCustomYoungAge
    ? safe1h >= -10 && safe1h <= 300
      ? 15
      : 10
    : safe24h >= 0 && safe1h <= 60
      ? 15
      : safe1h <= 100
        ? 10
        : 5;

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

  const effectiveClass =
    tokenClass === 'high_risk_micro' && !settings.enforceMinScores && filterResult.passed && securityReport.passed
      ? 'meme'
      : tokenClass;
  const effectiveMultiplier =
    effectiveClass === 'meme' && sizeMultiplier === 0 ? 0.4 : sizeMultiplier;

  const reasons: string[] = [...filterResult.reasons, ...securityReport.reasons];
  const warnings: string[] = [...filterResult.warnings, ...securityReport.warnings];

  if (!settings.enforceMinScores) {
    warnings.push('Min Quality / Trade Score gate disabled — score check bypassed');
  }

  if (effectiveClass === 'high_risk_micro') {
    reasons.push('Classified as high_risk_micro (always rejected)');
  }
  if (settings.enforceMinScores) {
    if (qualityScore < settings.minQualityScore) {
      reasons.push(`Quality score ${qualityScore} < ${settings.minQualityScore} threshold`);
    }
    if (tradeScore < settings.minTradeScore) {
      reasons.push(`Trade score ${tradeScore} < ${settings.minTradeScore} threshold`);
    }
  }
  if (securityReport.criticalFlags.length > 0) {
    reasons.push(`Critical security flags present: ${securityReport.criticalFlags.join(', ')}`);
  }

  const scoreGatePassed =
    !settings.enforceMinScores ||
    (qualityScore >= settings.minQualityScore && tradeScore >= settings.minTradeScore);

  const approved =
    filterResult.passed &&
    securityReport.passed &&
    securityReport.criticalFlags.length === 0 &&
    effectiveClass !== 'high_risk_micro' &&
    scoreGatePassed;

  return {
    mint: token.mint,
    symbol: token.symbol,
    tokenClass: effectiveClass,
    qualityScore,
    tradeScore,
    combinedScore: Math.round((qualityScore + tradeScore) / 2),
    sizeMultiplier: effectiveMultiplier,
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
