import type { BotSettings, HolderAccountInfo, SecurityReport } from '../types';
import { isOptionEnabled } from '../config/defaults';
import type { OnChainTokenInspection, SolanaRpcPool } from '../providers/rpcPool';
import type { NormalizedRugCheckResult, RugCheckProvider } from '../providers/rugcheck';
import type { DexScreenerProvider } from '../providers/dexscreener';
import type { CreatorHistorySummary } from '../providers/creatorHistory';
import { inspectCreatorHistory } from '../providers/creatorHistory';
import type { JupiterProvider } from '../providers/jupiter';
import type { BotDatabase } from '../store/db';
import { WSOL_MINT } from '../providers/jupiter';

export interface SecurityEvaluationInputs {
  onChain: OnChainTokenInspection | null;
  rugCheck: NormalizedRugCheckResult | null;
  sellQuoteImpactPct: number | null;
  sellRouteExists: boolean;
  knownBadDeployers?: Set<string>;
  creatorHistory?: CreatorHistorySummary | null;
  sellTaxPct?: number | null;
  tradingEnabled?: boolean;
}

const DEFAULT_KNOWN_BAD_DEPLOYERS = new Set<string>([
  // Known repeat-rugger addresses can be persisted/loaded here
]);

export function evaluateSecurityRules(
  inputs: SecurityEvaluationInputs,
  settings: BotSettings
): SecurityReport {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const criticalFlags: string[] = [];

  const { onChain, rugCheck, sellQuoteImpactPct, sellRouteExists } = inputs;
  const knownBad = inputs.knownBadDeployers ?? DEFAULT_KNOWN_BAD_DEPLOYERS;

  let sourcesAgreed = 0;

  let effectiveHolders: HolderAccountInfo[] = onChain?.holders ?? [];
  let effectiveTop10Pct: number | null =
    onChain && onChain.holderInspectionAvailable !== false ? onChain.top10HoldersPct : null;
  let effectiveSingleMaxPct: number | null =
    onChain && onChain.holderInspectionAvailable !== false ? onChain.singleMaxHolderPct : null;

  // Source 1: On-chain RPC inspection (REQUIRED)
  if (!onChain) {
    reasons.push('On-chain token inspection unavailable (fail closed)');
    criticalFlags.push('ONCHAIN_UNAVAILABLE');
  } else {
    sourcesAgreed += 1;
    if (!onChain.mintAuthorityRevoked) {
      reasons.push('Mint authority is NOT revoked');
      criticalFlags.push('MINT_AUTHORITY_ACTIVE');
    }
    if (!onChain.freezeAuthorityRevoked) {
      reasons.push('Freeze authority is NOT revoked');
      criticalFlags.push('FREEZE_AUTHORITY_ACTIVE');
    }
    if (onChain.disallowedExtensions.length > 0) {
      reasons.push(
        `Disallowed Token-2022 extensions: ${onChain.disallowedExtensions.join(', ')}`
      );
      criticalFlags.push('TOKEN2022_RESTRICTED_EXTENSION');
    }
  }

  // Source 2: Real RugCheck report (REQUIRED at every age, never skipped)
  if (!rugCheck || !rugCheck.available) {
    reasons.push('RugCheck report missing or unavailable (fail closed)');
    criticalFlags.push('RUGCHECK_MISSING');
  } else {
    sourcesAgreed += 1;
    if (rugCheck.mintAuthorityRevoked === false && onChain?.mintAuthorityRevoked) {
      reasons.push('RugCheck reports active mint authority (source mismatch)');
      criticalFlags.push('MINT_AUTHORITY_ACTIVE');
    }
    if (rugCheck.freezeAuthorityRevoked === false && onChain?.freezeAuthorityRevoked) {
      reasons.push('RugCheck reports active freeze authority (source mismatch)');
      criticalFlags.push('FREEZE_AUTHORITY_ACTIVE');
    }
    if (rugCheck.rugged) {
      reasons.push('Token marked as RUGGED by RugCheck');
      criticalFlags.push('RUGGED');
    }
    if (
      isOptionEnabled(settings, 'maxRugCheckRiskScore') &&
      rugCheck.normalizedRiskScore > settings.maxRugCheckRiskScore
    ) {
      reasons.push(
        `RugCheck risk score ${rugCheck.normalizedRiskScore} > ${settings.maxRugCheckRiskScore} threshold`
      );
      criticalFlags.push('RUGCHECK_HIGH_RISK');
    }
    if (
      isOptionEnabled(settings, 'minLpLockedOrBurnedPct') &&
      rugCheck.lpLockedOrBurnedPct < settings.minLpLockedOrBurnedPct
    ) {
      reasons.push(
        `LP burned/locked ${rugCheck.lpLockedOrBurnedPct.toFixed(1)}% < ${settings.minLpLockedOrBurnedPct}% minimum`
      );
      criticalFlags.push('LP_UNLOCKED');
    }
    if (rugCheck.criticalRisks.length > 0) {
      reasons.push(`RugCheck critical risks: ${rugCheck.criticalRisks.join('; ')}`);
      criticalFlags.push('RUGCHECK_CRITICAL_FLAG');
    }
    if (rugCheck.creator && knownBad.has(rugCheck.creator)) {
      reasons.push(`Deployer ${rugCheck.creator.slice(0, 6)}... is a known repeat rugger`);
      criticalFlags.push('REPEAT_RUGGER_DEPLOYER');
    }

    // Also exclude any AMM/Locker accounts reported by RugCheck from on-chain holder list
    if (
      onChain &&
      onChain.holderInspectionAvailable !== false &&
      onChain.holders.length > 0 &&
      rugCheck.knownPoolAddresses &&
      rugCheck.knownPoolAddresses.length > 0
    ) {
      const poolSet = new Set(rugCheck.knownPoolAddresses);
      effectiveHolders = onChain.holders.map((h) =>
        poolSet.has(h.address) ? { ...h, isExcludedPoolOrBurn: true, label: 'Pool / Locker' } : h
      );
      const nonPool = effectiveHolders.filter((h) => !h.isExcludedPoolOrBurn);
      effectiveTop10Pct = nonPool.slice(0, 10).reduce((s, h) => s + h.pct, 0);
      effectiveSingleMaxPct = nonPool.length > 0 ? nonPool[0].pct : 0;
    } else if (
      effectiveTop10Pct === null &&
      typeof rugCheck.top10HoldersPct === 'number' &&
      rugCheck.holders &&
      rugCheck.holders.length > 0
    ) {
      effectiveHolders = rugCheck.holders;
      effectiveTop10Pct = rugCheck.top10HoldersPct;
      effectiveSingleMaxPct = rugCheck.singleMaxHolderPct ?? 0;
    }
  }

  // Enforce holder concentration (fail closed if neither RPC nor RugCheck supplied holder data)
  if (effectiveTop10Pct === null || effectiveSingleMaxPct === null) {
    reasons.push('Top holder concentration unavailable (fail closed)');
    criticalFlags.push('HOLDER_DATA_UNAVAILABLE');
  } else {
    if (settings.enforceMaxTop10Holders && effectiveTop10Pct > settings.maxTop10HoldersPct) {
      reasons.push(
        `Top 10 non-pool holders own ${effectiveTop10Pct.toFixed(1)}% > ${settings.maxTop10HoldersPct}% limit`
      );
      criticalFlags.push('TOP10_CONCENTRATION');
    }
    if (
      isOptionEnabled(settings, 'maxSingleHolderPct') &&
      effectiveSingleMaxPct > settings.maxSingleHolderPct
    ) {
      reasons.push(
        `Largest non-pool holder owns ${effectiveSingleMaxPct.toFixed(1)}% > ${settings.maxSingleHolderPct}% limit`
      );
      criticalFlags.push('SINGLE_HOLDER_CONCENTRATION');
    }
  }

  // Owner / Creator wallet prior launches & rugpull speed guard
  const creatorHist = inputs.creatorHistory ?? null;
  const maxCreatorLaunches = Math.max(0, settings.maxCreatorLaunches ?? 5);
  const maxCreatorRuggedCoins = Math.max(0, settings.maxCreatorRuggedCoins ?? 0);
  const fastRugWindowMin = Math.max(0, settings.creatorFastRugWindowMinutes ?? 60);
  if (settings.creatorHistoryEnabled !== false && creatorHist) {
    if (creatorHist.flaggedByRugCheckRisk) {
      reasons.push('Owner/creator flagged by RugCheck for prior rugged tokens');
      criticalFlags.push('CREATOR_RUG_HISTORY');
    }
    if (
      isOptionEnabled(settings, 'maxCreatorLaunches') &&
      creatorHist.launchCount > maxCreatorLaunches
    ) {
      reasons.push(
        `Owner launched ${creatorHist.launchCount} prior coins > ${maxCreatorLaunches} limit`
      );
      criticalFlags.push('CREATOR_SERIAL_LAUNCHER');
    }
    if (
      isOptionEnabled(settings, 'maxCreatorRuggedCoins') &&
      creatorHist.ruggedCount > maxCreatorRuggedCoins
    ) {
      const speedNote =
        creatorHist.fastestRugMinutes !== null
          ? ` (fastest rugpull in ${creatorHist.fastestRugMinutes.toFixed(1)}m)`
          : '';
      reasons.push(
        `Owner has ${creatorHist.ruggedCount} rugged prior coin(s) > ${maxCreatorRuggedCoins} limit${speedNote}`
      );
      criticalFlags.push('CREATOR_RUG_HISTORY');
    }
    if (
      isOptionEnabled(settings, 'creatorFastRugWindowMinutes') &&
      creatorHist.fastestRugMinutes !== null &&
      fastRugWindowMin > 0 &&
      creatorHist.fastestRugMinutes <= fastRugWindowMin
    ) {
      reasons.push(
        `Owner rugged a prior coin in ${creatorHist.fastestRugMinutes.toFixed(1)}m <= ${fastRugWindowMin}m fast-rug window`
      );
      criticalFlags.push('CREATOR_FAST_RUGGER');
    }
  }

  // Two-source rule: require at least 2 independent sources
  if (sourcesAgreed < 2) {
    reasons.push(`Two-source rule failed: only ${sourcesAgreed}/2 independent security sources verified`);
  }

  // Sell-route test (REQUIRED before every buy)
  if (!sellRouteExists) {
    reasons.push('Sell-route test failed: no Jupiter route back to SOL');
    criticalFlags.push('NO_SELL_ROUTE');
  } else if (
    isOptionEnabled(settings, 'maxSellRouteImpactPct') &&
    (sellQuoteImpactPct === null ||
      !Number.isFinite(sellQuoteImpactPct) ||
      sellQuoteImpactPct > settings.maxSellRouteImpactPct)
  ) {
    const impactStr =
      sellQuoteImpactPct === null ? 'unknown' : `${sellQuoteImpactPct.toFixed(2)}%`;
    reasons.push(
      `Sell-route price impact ${impactStr} > ${settings.maxSellRouteImpactPct}% limit`
    );
    criticalFlags.push('HIGH_SELL_IMPACT');
  }

  const tradingEnabled = inputs.tradingEnabled ?? true;
  if (!tradingEnabled) {
    reasons.push('Trading appears disabled on token');
    criticalFlags.push('TRADING_DISABLED');
  }

  const sellTaxPct = inputs.sellTaxPct ?? 0;
  if (sellTaxPct > settings.emergencyMaxSellTaxPct) {
    reasons.push(`Sell tax ${sellTaxPct.toFixed(1)}% exceeds ${settings.emergencyMaxSellTaxPct}% cap`);
    criticalFlags.push('EXCESSIVE_SELL_TAX');
  }

  return {
    passed: reasons.length === 0,
    reasons,
    warnings,
    criticalFlags,
    sourcesAgreed,
    mintAuthorityRevoked: onChain?.mintAuthorityRevoked ?? null,
    freezeAuthorityRevoked: onChain?.freezeAuthorityRevoked ?? null,
    token2022DisallowedExtensions: onChain?.disallowedExtensions ?? [],
    rugCheckScore: rugCheck?.normalizedRiskScore ?? null,
    rugCheckRisks: rugCheck?.riskNames ?? [],
    lpLockedOrBurnedPct: rugCheck?.lpLockedOrBurnedPct ?? null,
    top10HoldersPct: effectiveTop10Pct,
    singleMaxHolderPct: effectiveSingleMaxPct,
    holders: effectiveHolders,
    deployerFlagged:
      Boolean(rugCheck?.creator && knownBad.has(rugCheck.creator)) ||
      Boolean(
        criticalFlags.some((f) =>
          f === 'CREATOR_RUG_HISTORY' || f === 'CREATOR_FAST_RUGGER' || f === 'CREATOR_SERIAL_LAUNCHER'
        )
      ),
    deployerReason:
      rugCheck?.creator && knownBad.has(rugCheck.creator)
        ? 'Flagged repeat rugger'
        : criticalFlags.includes('CREATOR_FAST_RUGGER')
          ? `Fast rugger (${creatorHist?.fastestRugMinutes?.toFixed(1) ?? '?'}m)`
          : criticalFlags.includes('CREATOR_RUG_HISTORY')
            ? `Prior rugged coins: ${creatorHist?.ruggedCount ?? 1}`
            : undefined,
    creatorAddress: creatorHist?.creatorAddress ?? rugCheck?.creator ?? null,
    creatorLaunchCount: creatorHist?.launchCount ?? 0,
    creatorRuggedCount: creatorHist?.ruggedCount ?? 0,
    creatorFastestRugMinutes: creatorHist?.fastestRugMinutes ?? null,
    sellRouteExists,
    sellRouteImpactPct: sellQuoteImpactPct,
    sellTaxPct,
    tradingEnabled,
    tokenDecimals: onChain?.decimals,
  };
}

export async function runSecurityChecks(params: {
  mint: string;
  symbol?: string;
  poolCreatedAtMs?: number;
  priceUsd: number;
  solPriceUsd: number;
  testSizeSol: number;
  settings: BotSettings;
  rpcPool: SolanaRpcPool;
  rugCheckProvider: RugCheckProvider;
  jupiterProvider: JupiterProvider;
  dexScreenerProvider?: DexScreenerProvider;
  db?: BotDatabase;
}): Promise<SecurityReport> {
  const { mint, priceUsd, solPriceUsd, testSizeSol, settings, rpcPool, rugCheckProvider, jupiterProvider } =
    params;

  const [onChainResult, rugCheckResult] = await Promise.allSettled([
    rpcPool.inspectTokenOnChain(mint),
    rugCheckProvider.getReport(mint),
  ]);

  const onChain = onChainResult.status === 'fulfilled' ? onChainResult.value : null;
  const rugCheck = rugCheckResult.status === 'fulfilled' ? rugCheckResult.value : null;

  let sellRouteExists = false;
  let sellQuoteImpactPct: number | null = null;

  const [quoteRes, creatorHistory] = await Promise.all([
    onChain && priceUsd > 0 && solPriceUsd > 0
      ? (() => {
          const testTokenUi = (testSizeSol * solPriceUsd) / priceUsd;
          const rawUnits = Math.max(1, Math.floor(testTokenUi * 10 ** onChain.decimals));
          return jupiterProvider
            .getQuote({
              inputMint: mint,
              outputMint: WSOL_MINT,
              amountRaw: String(rawUnits),
              slippageBps: settings.slippageBps,
            })
            .catch(() => null);
        })()
      : Promise.resolve(null),
    settings.creatorHistoryEnabled !== false && rugCheck
      ? inspectCreatorHistory({
          creatorAddress: rugCheck.creator,
          currentMint: mint,
          currentPoolCreatedAtMs: params.poolCreatedAtMs,
          currentSymbol: params.symbol,
          rugCheck,
          dexScreener: params.dexScreenerProvider,
          rpcPool,
          db: params.db,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (quoteRes && Number(quoteRes.outAmount) > 0) {
    sellRouteExists = true;
    sellQuoteImpactPct = Math.abs(Number(quoteRes.priceImpactPct || 0)) * 100;
  }

  return evaluateSecurityRules(
    {
      onChain,
      rugCheck,
      creatorHistory,
      sellRouteExists,
      sellQuoteImpactPct,
    },
    settings
  );
}
