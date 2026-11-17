import type { BotSettings, CandidateToken, HardFilterResult } from '../types';

export function validateCandidateData(token: CandidateToken): { valid: boolean; reason?: string } {
  if (!token.mint || token.mint.length < 32) {
    return { valid: false, reason: 'Missing or invalid mint address' };
  }
  if (!Number.isFinite(token.priceUsd) || token.priceUsd <= 0) {
    return { valid: false, reason: 'Missing or non-positive USD price' };
  }
  if (!Number.isFinite(token.liquidityUsd) || token.liquidityUsd <= 0) {
    return { valid: false, reason: 'Missing or non-positive liquidity' };
  }
  if (!Number.isFinite(token.poolCreatedAtMs) || token.poolCreatedAtMs <= 0) {
    return { valid: false, reason: 'Missing pool creation timestamp (fail closed)' };
  }
  if (!Number.isFinite(token.volume24hUsd) || token.volume24hUsd < 0) {
    return { valid: false, reason: 'Missing 24h volume' };
  }
  if (!Number.isFinite(token.priceChange1hPct) || !Number.isFinite(token.priceChange24hPct)) {
    return { valid: false, reason: 'Missing 1h or 24h price change metrics' };
  }
  return { valid: true };
}

export function evaluateHardFilters(
  token: CandidateToken,
  settings: BotSettings,
  plannedPriceImpactPct: number | null,
  nowMs = Date.now()
): HardFilterResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const poolAgeMinutes = (nowMs - token.poolCreatedAtMs) / 60_000;
  const poolAgeDays = poolAgeMinutes / (60 * 24);
  const volumeLiquidityRatio = token.liquidityUsd > 0 ? token.volume24hUsd / token.liquidityUsd : Infinity;
  const fdvLiquidityRatio =
    token.liquidityUsd > 0 && token.fdvUsd > 0 ? token.fdvUsd / token.liquidityUsd : 0;
  const totalBuySell = token.buys24h + token.sells24h;
  const buyRatio = totalBuySell > 0 ? token.buys24h / totalBuySell : 0;

  // 1. Pool age check (strict: no ultra-early bypass, no grace window)
  const effectiveMinAge = Math.max(30, settings.minPoolAgeMinutes);
  if (!Number.isFinite(poolAgeMinutes) || poolAgeMinutes < effectiveMinAge) {
    reasons.push(
      `Pool age ${Math.max(0, poolAgeMinutes).toFixed(1)}m is below ${effectiveMinAge}m minimum`
    );
  }
  if (poolAgeDays > settings.maxPoolAgeDays) {
    reasons.push(`Pool age ${poolAgeDays.toFixed(1)}d exceeds ${settings.maxPoolAgeDays}d maximum`);
  }

  // 2. Liquidity, volume, tx count, unique traders
  if (token.liquidityUsd < settings.minLiquidityUsd) {
    reasons.push(
      `Liquidity $${token.liquidityUsd.toLocaleString()} < $${settings.minLiquidityUsd.toLocaleString()} floor`
    );
  }
  if (token.volume24hUsd < settings.minVolume24hUsd) {
    reasons.push(
      `24h volume $${token.volume24hUsd.toLocaleString()} < $${settings.minVolume24hUsd.toLocaleString()} minimum`
    );
  }
  if (token.txCount24h < settings.minTx24h) {
    reasons.push(`24h tx count ${token.txCount24h} < ${settings.minTx24h} minimum`);
  }
  if (token.uniqueTraders24h < settings.minUniqueTraders24h) {
    reasons.push(
      `24h unique traders ${token.uniqueTraders24h} < ${settings.minUniqueTraders24h} minimum`
    );
  }

  // 3. Wash-trading & FDV inflation checks
  if (
    volumeLiquidityRatio > settings.maxVolumeLiquidityRatio &&
    token.uniqueTraders24h < settings.minUniqueTraders24h * 2
  ) {
    reasons.push(
      `Suspected wash trading: vol/liq ${volumeLiquidityRatio.toFixed(1)}x > ${settings.maxVolumeLiquidityRatio}x without trader breadth`
    );
  }
  if (token.fdvUsd <= 0) {
    warnings.push('FDV unavailable; treating conservatively');
  } else if (fdvLiquidityRatio > settings.maxFdvLiquidityRatio) {
    reasons.push(
      `FDV/liquidity ratio ${fdvLiquidityRatio.toFixed(1)}x > ${settings.maxFdvLiquidityRatio}x limit`
    );
  }

  // 4. Momentum & anti-dump / anti-parabolic filters
  if (token.priceChange1hPct < settings.minPriceChange1hPct) {
    reasons.push(
      `1h price change ${token.priceChange1hPct.toFixed(2)}% < +${settings.minPriceChange1hPct}%`
    );
  }
  if (token.priceChange24hPct < settings.minPriceChange24hPct) {
    reasons.push(
      `24h price change ${token.priceChange24hPct.toFixed(2)}% < ${settings.minPriceChange24hPct}% (dump guard)`
    );
  }
  if (token.priceChange1hPct > settings.maxPriceChange1hPct) {
    reasons.push(
      `Parabolic 1h move +${token.priceChange1hPct.toFixed(1)}% > +${settings.maxPriceChange1hPct}% cap`
    );
  }
  if (buyRatio < settings.minBuyRatio) {
    reasons.push(`Buy ratio ${buyRatio.toFixed(2)} < ${settings.minBuyRatio.toFixed(2)} minimum`);
  }

  // 5. Planned trade price impact check
  if (plannedPriceImpactPct === null || !Number.isFinite(plannedPriceImpactPct)) {
    reasons.push('Planned buy quote price impact missing (fail closed)');
  } else if (plannedPriceImpactPct >= settings.maxPlannedPriceImpactPct) {
    reasons.push(
      `Planned price impact ${plannedPriceImpactPct.toFixed(2)}% >= ${settings.maxPlannedPriceImpactPct}% limit`
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    warnings,
    computed: {
      poolAgeMinutes,
      volumeLiquidityRatio,
      fdvLiquidityRatio,
      buyRatio,
    },
  };
}
