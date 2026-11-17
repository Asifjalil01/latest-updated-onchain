import { DEFAULT_SETTINGS } from '../config/defaults';
import type { BotSettings, CandidateToken, HardFilterResult } from '../types';

export function validateCandidateData(
  token: CandidateToken,
  settings: BotSettings = DEFAULT_SETTINGS
): { valid: boolean; reason?: string } {
  if (!token.mint || token.mint.length < 32) {
    return { valid: false, reason: 'Missing or invalid mint address' };
  }
  if (!Number.isFinite(token.priceUsd) || token.priceUsd <= 0) {
    return { valid: false, reason: 'Missing or non-positive USD price' };
  }
  const allowZeroLiquidity = settings.minLiquidityUsd <= 0;
  if (
    !Number.isFinite(token.liquidityUsd) ||
    (allowZeroLiquidity ? token.liquidityUsd < 0 : token.liquidityUsd <= 0)
  ) {
    return { valid: false, reason: 'Missing or non-positive liquidity' };
  }
  if (!Number.isFinite(token.poolCreatedAtMs) || token.poolCreatedAtMs <= 0) {
    return { valid: false, reason: 'Missing pool creation timestamp (fail closed)' };
  }
  if (!Number.isFinite(token.volume24hUsd) || token.volume24hUsd < 0) {
    return { valid: false, reason: 'Missing 24h volume' };
  }
  const allowMissingPriceChange =
    settings.newLaunchOnlyEnabled ||
    (settings.customAgeWindowEnabled && settings.customMaxPoolAgeMinutes <= 30);
  if (
    !allowMissingPriceChange &&
    (!Number.isFinite(token.priceChange1hPct) || !Number.isFinite(token.priceChange24hPct))
  ) {
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

  const poolAgeSeconds = (nowMs - token.poolCreatedAtMs) / 1000;
  const poolAgeMinutes = poolAgeSeconds / 60;
  const poolAgeDays = poolAgeMinutes / (60 * 24);
  const volumeLiquidityRatio =
    token.liquidityUsd > 0 ? token.volume24hUsd / token.liquidityUsd : 0;
  const fdvLiquidityRatio =
    token.liquidityUsd > 0 && token.fdvUsd > 0 ? token.fdvUsd / token.liquidityUsd : 0;
  const totalBuySell = token.buys24h + token.sells24h;
  const buyRatio = totalBuySell > 0 ? token.buys24h / totalBuySell : 0;
  const priceChange1hPct = Number.isFinite(token.priceChange1hPct) ? token.priceChange1hPct : 0;
  const priceChange24hPct = Number.isFinite(token.priceChange24hPct) ? token.priceChange24hPct : 0;

  // 1. Pool age check (New Launches Only > Custom Timeframe > Default rules)
  if (settings.newLaunchOnlyEnabled) {
    if (
      !Number.isFinite(poolAgeSeconds) ||
      poolAgeSeconds < settings.newLaunchMinAgeSeconds ||
      poolAgeSeconds > settings.newLaunchMaxAgeSeconds
    ) {
      reasons.push(
        `Pool age ${Math.max(0, Math.round(poolAgeSeconds))}s is outside New Launches Only ${settings.newLaunchMinAgeSeconds}s–${settings.newLaunchMaxAgeSeconds}s window`
      );
    }
  } else if (settings.customAgeWindowEnabled) {
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
  const isNewLaunchMode = settings.newLaunchOnlyEnabled;
  const isCustomMicroWindow =
    isNewLaunchMode ||
    (settings.customAgeWindowEnabled &&
      (settings.customMaxPoolAgeMinutes <= 60 || settings.minLiquidityUsd < 10_000));
  const isMicroLiquidityOverride = !isCustomMicroWindow && settings.minLiquidityUsd < 10_000;

  const effectiveMinVolume24hUsd = isNewLaunchMode
    ? 0
    : isCustomMicroWindow || isMicroLiquidityOverride
      ? Math.min(settings.minVolume24hUsd, Math.max(0, settings.minLiquidityUsd))
      : settings.minVolume24hUsd;
  const effectiveMinTx24h = isNewLaunchMode
    ? 0
    : isCustomMicroWindow || isMicroLiquidityOverride
      ? Math.min(settings.minTx24h, 5)
      : settings.minTx24h;
  const effectiveMinUniqueTraders24h = isNewLaunchMode
    ? 0
    : isCustomMicroWindow || isMicroLiquidityOverride
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

  const effectiveMaxFdvLiquidityRatio = isNewLaunchMode
    ? Math.max(settings.maxFdvLiquidityRatio, 2000)
    : isCustomMicroWindow
      ? Math.max(settings.maxFdvLiquidityRatio, 500)
      : settings.maxFdvLiquidityRatio;
  const effectiveMinPriceChange1hPct = isNewLaunchMode
    ? Math.min(settings.minPriceChange1hPct, -50)
    : isCustomMicroWindow
      ? Math.min(settings.minPriceChange1hPct, -25)
      : settings.minPriceChange1hPct;
  const effectiveMinPriceChange24hPct = isNewLaunchMode
    ? Math.min(settings.minPriceChange24hPct, -50)
    : isCustomMicroWindow
      ? Math.min(settings.minPriceChange24hPct, -30)
      : settings.minPriceChange24hPct;
  const effectiveMaxPriceChange1hPct = isNewLaunchMode
    ? Math.max(settings.maxPriceChange1hPct, 10000)
    : isCustomMicroWindow
      ? Math.max(settings.maxPriceChange1hPct, 2500)
      : settings.maxPriceChange1hPct;
  const effectiveMinBuyRatio = isNewLaunchMode
    ? Math.min(settings.minBuyRatio, 0.2)
    : isCustomMicroWindow
      ? Math.min(settings.minBuyRatio, 0.35)
      : settings.minBuyRatio;
  const effectiveMaxPlannedPriceImpactPct = isNewLaunchMode
    ? Math.max(settings.maxPlannedPriceImpactPct, 12.0)
    : isCustomMicroWindow || isMicroLiquidityOverride
      ? settings.minLiquidityUsd < 2_500
        ? Math.max(settings.maxPlannedPriceImpactPct, 8.0)
        : Math.max(settings.maxPlannedPriceImpactPct, 4.0)
      : settings.maxPlannedPriceImpactPct;

  // 3. Wash-trading & FDV inflation checks
  if (
    !isNewLaunchMode &&
    volumeLiquidityRatio > settings.maxVolumeLiquidityRatio &&
    token.uniqueTraders24h < effectiveMinUniqueTraders24h * 2
  ) {
    reasons.push(
      `Suspected wash trading: vol/liq ${volumeLiquidityRatio.toFixed(1)}x > ${settings.maxVolumeLiquidityRatio}x without trader breadth`
    );
  }
  if (token.fdvUsd <= 0) {
    warnings.push('FDV unavailable; treating conservatively');
  } else if (!(isNewLaunchMode && token.liquidityUsd < 1_000) && fdvLiquidityRatio > effectiveMaxFdvLiquidityRatio) {
    reasons.push(
      `FDV/liquidity ratio ${fdvLiquidityRatio.toFixed(1)}x > ${effectiveMaxFdvLiquidityRatio}x limit`
    );
  }

  // 4. Momentum & anti-dump / anti-parabolic filters
  if (priceChange1hPct < effectiveMinPriceChange1hPct) {
    reasons.push(
      `1h price change ${priceChange1hPct.toFixed(2)}% < ${effectiveMinPriceChange1hPct >= 0 ? '+' : ''}${effectiveMinPriceChange1hPct}%`
    );
  }
  if (priceChange24hPct < effectiveMinPriceChange24hPct) {
    reasons.push(
      `24h price change ${priceChange24hPct.toFixed(2)}% < ${effectiveMinPriceChange24hPct}% (dump guard)`
    );
  }
  if (priceChange1hPct > effectiveMaxPriceChange1hPct) {
    reasons.push(
      `Parabolic 1h move +${priceChange1hPct.toFixed(1)}% > +${effectiveMaxPriceChange1hPct}% cap`
    );
  }
  if ((!isNewLaunchMode || totalBuySell > 0) && buyRatio < effectiveMinBuyRatio) {
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
