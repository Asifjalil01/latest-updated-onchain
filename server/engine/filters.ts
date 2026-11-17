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

  // 1. Pool age check (custom timeframe window if enabled, otherwise default rules)
  if (settings.customAgeWindowEnabled) {
    if (
      !Number.isFinite(poolAgeMinutes) ||
      poolAgeMinutes < settings.customMinPoolAgeMinutes ||
      poolAgeMinutes > settings.customMaxPoolAgeMinutes
    ) {
      reasons.push(
        `Pool age ${Math.max(0, poolAgeMinutes).toFixed(1)}m is outside custom ${settings.customMinPoolAgeMinutes}m–${settings.customMaxPoolAgeMinutes}m timeframe`
      );
    }
  } else {
    const effectiveMinAge = Math.max(30, settings.minPoolAgeMinutes);
    if (!Number.isFinite(poolAgeMinutes) || poolAgeMinutes < effectiveMinAge) {
      reasons.push(
        `Pool age ${Math.max(0, poolAgeMinutes).toFixed(1)}m is below ${effectiveMinAge}m minimum`
      );
    }
    if (poolAgeDays > settings.maxPoolAgeDays) {
      reasons.push(`Pool age ${poolAgeDays.toFixed(1)}d exceeds ${settings.maxPoolAgeDays}d maximum`);
    }
  }

  // 2. Liquidity, volume, tx count, unique traders
  const isCustomMicroWindow =
    settings.customAgeWindowEnabled &&
    (settings.customMaxPoolAgeMinutes <= 60 || settings.minLiquidityUsd < 10_000);
  const effectiveMinVolume24hUsd = isCustomMicroWindow
    ? Math.min(settings.minVolume24hUsd, Math.max(50, settings.minLiquidityUsd))
    : settings.minVolume24hUsd;
  const effectiveMinTx24h = isCustomMicroWindow
    ? Math.min(settings.minTx24h, 5)
    : settings.minTx24h;
  const effectiveMinUniqueTraders24h = isCustomMicroWindow
    ? Math.min(settings.minUniqueTraders24h, 3)
    : settings.minUniqueTraders24h;

  if (token.liquidityUsd < settings.minLiquidityUsd) {
    reasons.push(
      `Liquidity $${token.liquidityUsd.toLocaleString()} < $${settings.minLiquidityUsd.toLocaleString()} floor`
    );
  }
  if (token.volume24hUsd < effectiveMinVolume24hUsd) {
    reasons.push(
      `24h volume $${token.volume24hUsd.toLocaleString()} < $${effectiveMinVolume24hUsd.toLocaleString()} minimum`
    );
  }
  if (token.txCount24h < effectiveMinTx24h) {
    reasons.push(`24h tx count ${token.txCount24h} < ${effectiveMinTx24h} minimum`);
  }
  if (token.uniqueTraders24h < effectiveMinUniqueTraders24h) {
    reasons.push(
      `24h unique traders ${token.uniqueTraders24h} < ${effectiveMinUniqueTraders24h} minimum`
    );
  }

  const effectiveMaxFdvLiquidityRatio = isCustomMicroWindow
    ? Math.max(settings.maxFdvLiquidityRatio, 500)
    : settings.maxFdvLiquidityRatio;
  const effectiveMinPriceChange1hPct = isCustomMicroWindow
    ? Math.min(settings.minPriceChange1hPct, -25)
    : settings.minPriceChange1hPct;
  const effectiveMinPriceChange24hPct = isCustomMicroWindow
    ? Math.min(settings.minPriceChange24hPct, -30)
    : settings.minPriceChange24hPct;
  const effectiveMaxPriceChange1hPct = isCustomMicroWindow
    ? Math.max(settings.maxPriceChange1hPct, 2500)
    : settings.maxPriceChange1hPct;
  const effectiveMinBuyRatio = isCustomMicroWindow
    ? Math.min(settings.minBuyRatio, 0.35)
    : settings.minBuyRatio;
  const effectiveMaxPlannedPriceImpactPct = isCustomMicroWindow
    ? settings.minLiquidityUsd < 2_500
      ? Math.max(settings.maxPlannedPriceImpactPct, 8.0)
      : Math.max(settings.maxPlannedPriceImpactPct, 4.0)
    : settings.maxPlannedPriceImpactPct;

  // 3. Wash-trading & FDV inflation checks
  if (
    volumeLiquidityRatio > settings.maxVolumeLiquidityRatio &&
    token.uniqueTraders24h < effectiveMinUniqueTraders24h * 2
  ) {
    reasons.push(
      `Suspected wash trading: vol/liq ${volumeLiquidityRatio.toFixed(1)}x > ${settings.maxVolumeLiquidityRatio}x without trader breadth`
    );
  }
  if (token.fdvUsd <= 0) {
    warnings.push('FDV unavailable; treating conservatively');
  } else if (fdvLiquidityRatio > effectiveMaxFdvLiquidityRatio) {
    reasons.push(
      `FDV/liquidity ratio ${fdvLiquidityRatio.toFixed(1)}x > ${effectiveMaxFdvLiquidityRatio}x limit`
    );
  }

  // 4. Momentum & anti-dump / anti-parabolic filters
  if (token.priceChange1hPct < effectiveMinPriceChange1hPct) {
    reasons.push(
      `1h price change ${token.priceChange1hPct.toFixed(2)}% < ${effectiveMinPriceChange1hPct >= 0 ? '+' : ''}${effectiveMinPriceChange1hPct}%`
    );
  }
  if (token.priceChange24hPct < effectiveMinPriceChange24hPct) {
    reasons.push(
      `24h price change ${token.priceChange24hPct.toFixed(2)}% < ${effectiveMinPriceChange24hPct}% (dump guard)`
    );
  }
  if (token.priceChange1hPct > effectiveMaxPriceChange1hPct) {
    reasons.push(
      `Parabolic 1h move +${token.priceChange1hPct.toFixed(1)}% > +${effectiveMaxPriceChange1hPct}% cap`
    );
  }
  if (buyRatio < effectiveMinBuyRatio) {
    reasons.push(`Buy ratio ${buyRatio.toFixed(2)} < ${effectiveMinBuyRatio.toFixed(2)} minimum`);
  }

  // 5. Planned trade price impact check
  if (plannedPriceImpactPct === null || !Number.isFinite(plannedPriceImpactPct)) {
    reasons.push('Planned buy quote price impact missing (fail closed)');
  } else if (plannedPriceImpactPct >= effectiveMaxPlannedPriceImpactPct) {
    reasons.push(
      `Planned price impact ${plannedPriceImpactPct.toFixed(2)}% >= ${effectiveMaxPlannedPriceImpactPct}% limit`
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
