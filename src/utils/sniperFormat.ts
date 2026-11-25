export interface RawSniperCsvRow {
  time: string;
  action: string;
  symbol: string;
  mint: string;
  price: string;
  amount: string;
  pnlUsd: string;
  pnlPct: string;
  reason: string;
  dexscreener?: string;
  age_s?: string;
  dex?: string;
  source?: string;
  entryPrice?: string;
  solPriceUsd?: string;
  txSig?: string;
}

export interface EnrichedSniperTrade extends RawSniperCsvRow {
  entryPrice: string;
  exitPrice: string;
  solPriceUsd?: string;
  txBuy?: string;
  txSell?: string;
  tradeStatus?: 'OPEN' | 'PARTIAL' | 'CLOSED';
  entryTime?: string;
  exitTime?: string;
  buyAmountUsd?: string;
  exitAmountUsd?: string;
  diffUsd?: string;
  exitCount?: number;
  partialReasons?: string[];
}

export interface ConsolidatedSniperTrade extends EnrichedSniperTrade {
  tradeStatus: 'OPEN' | 'PARTIAL' | 'CLOSED';
  entryTime: string;
  exitTime: string;
  buyAmountUsd: string;
  exitAmountUsd: string;
  diffUsd: string;
  exitCount: number;
  partialReasons?: string[];
}

export function usdToSol(usd: number, solPriceUsd: number | null | undefined): number | null {
  if (!Number.isFinite(usd) || !solPriceUsd || !Number.isFinite(solPriceUsd) || solPriceUsd <= 0) {
    return null;
  }
  return usd / solPriceUsd;
}

export function fmtUsdPrice(val: number | string | undefined | null): string {
  if (val === undefined || val === null || val === '') return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (!Number.isFinite(num)) return String(val);
  if (Math.abs(num) >= 1) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (num === 0) return '0.00';
  if (Math.abs(num) < 0.0001) {
    return num.toFixed(8);
  }
  return num.toFixed(6);
}

export function fmtSolAmount(sol: number | null | undefined): string {
  if (sol === null || sol === undefined || !Number.isFinite(sol)) return '— SOL';
  const abs = Math.abs(sol);
  if (abs === 0) return '0.0000 SOL';
  if (abs < 0.000001) return `${sol.toFixed(9)} SOL`;
  if (abs < 0.0001) return `${sol.toFixed(7)} SOL`;
  if (abs < 1) return `${sol.toFixed(4)} SOL`;
  return `${sol.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 })} SOL`;
}

export function fmtSolPrice(priceUsd: number | string | null | undefined, solPriceUsd: number | null | undefined): string {
  if (priceUsd === undefined || priceUsd === null || priceUsd === '') return '— SOL';
  const usd = typeof priceUsd === 'string' ? parseFloat(priceUsd) : priceUsd;
  const sol = usdToSol(usd, solPriceUsd);
  if (sol === null) return '— SOL';
  const abs = Math.abs(sol);
  if (abs === 0) return '0 SOL';
  if (abs >= 1) return `${sol.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`;
  if (abs >= 0.001) return `${sol.toFixed(6)} SOL`;
  if (abs >= 0.00001) return `${sol.toFixed(8)} SOL`;
  return `${sol.toFixed(10)} SOL`;
}

export function fmtSignedUsdAndSol(
  usd: number,
  solPriceUsd: number | null | undefined,
  usdDecimals = 2
): { usdText: string; solText: string } {
  const safeUsd = Number.isFinite(usd) ? usd : 0;
  const sign = safeUsd >= 0 ? '+' : '-';
  const usdText = `${sign}$${Math.abs(safeUsd).toFixed(usdDecimals)}`;
  const sol = usdToSol(Math.abs(safeUsd), solPriceUsd);
  const solText = sol === null ? '— SOL' : `${sign}${fmtSolAmount(sol)}`;
  return { usdText, solText };
}

export function fmtUnsignedUsdAndSol(
  usd: number,
  solPriceUsd: number | null | undefined,
  usdDecimals = 2
): { usdText: string; solText: string } {
  const safeUsd = Number.isFinite(usd) ? usd : 0;
  const usdText = `$${safeUsd.toFixed(usdDecimals)}`;
  const sol = usdToSol(safeUsd, solPriceUsd);
  const solText = sol === null ? '— SOL' : fmtSolAmount(sol);
  return { usdText, solText };
}

/**
 * Given CSV rows in chronological order (oldest first), pairs BUY and SELL events
 * per mint so every SELL record carries both its purchase `entryPrice` and its
 * sale `exitPrice` (while BUY records carry `entryPrice` and empty `exitPrice`),
 * then returns up to `limit` rows in newest-first order.
 */
export function pairTradesWithEntryAndExit(
  chronologicalRows: RawSniperCsvRow[],
  limit = 200
): EnrichedSniperTrade[] {
  const lastBuyPriceByMint = new Map<string, string>();
  const lastBuyTxByMint = new Map<string, string>();
  const enriched: EnrichedSniperTrade[] = [];

  for (const row of chronologicalRows) {
    const action = (row.action || '').toUpperCase();
    const mint = row.mint || '';
    const rowTx = (row.txSig || '').trim();
    if (action === 'BUY') {
      if (mint && row.price) {
        lastBuyPriceByMint.set(mint, row.price);
      }
      if (mint && rowTx) {
        lastBuyTxByMint.set(mint, rowTx);
      }
      enriched.push({
        ...row,
        entryPrice: row.entryPrice || row.price || '',
        exitPrice: '',
        txBuy: rowTx || undefined,
      });
    } else if (action === 'SELL') {
      const matchedEntry = row.entryPrice || (mint ? lastBuyPriceByMint.get(mint) : '') || '';
      const matchedBuyTx = mint ? lastBuyTxByMint.get(mint) : undefined;
      const isPartialSell =
        (row.reason || '').startsWith('principal_recovery') ||
        (row.reason || '').startsWith('scale_out');
      if (mint && !isPartialSell) {
        lastBuyPriceByMint.delete(mint);
        lastBuyTxByMint.delete(mint);
      }
      enriched.push({
        ...row,
        entryPrice: matchedEntry,
        exitPrice: row.price || '',
        txBuy: matchedBuyTx || undefined,
        txSell: rowTx || undefined,
      });
    } else {
      enriched.push({
        ...row,
        entryPrice: row.entryPrice || row.price || '',
        exitPrice: '',
        txBuy: rowTx || undefined,
      });
    }
  }

  return enriched.slice(-limit).reverse();
}

/**
 * Merges BUY and subsequent partial/final SELL CSV events into a single
 * consolidated trade record per coin position lifecycle, updating the BUY row
 * in-place when exited so history counts unique coin trades rather than raw events.
 * Returns up to `limit` trades sorted newest-activity-first.
 */
export function consolidateSniperTrades(
  chronologicalRows: RawSniperCsvRow[],
  limit = 200
): ConsolidatedSniperTrade[] {
  interface InternalTrade {
    trade: ConsolidatedSniperTrade;
    buyCostNum: number;
    exitAmountNum: number;
    accPnlUsd: number;
    hasPnl: boolean;
    lastSeq: number;
  }

  const records: InternalTrade[] = [];
  const activeIdxByMint = new Map<string, number>();

  for (let seq = 0; seq < chronologicalRows.length; seq++) {
    const row = chronologicalRows[seq];
    const action = (row.action || '').toUpperCase();
    const mint = (row.mint || '').trim();
    const rowTx = (row.txSig || '').trim();

    if (action === 'BUY') {
      const buyCost = parseFloat(row.amount || '0');
      const safeBuyCost = Number.isFinite(buyCost) ? buyCost : 0;
      const rec: InternalTrade = {
        trade: {
          ...row,
          action: 'BUY',
          tradeStatus: 'OPEN',
          entryTime: row.time || '',
          exitTime: '',
          entryPrice: row.entryPrice || row.price || '',
          exitPrice: '',
          buyAmountUsd: row.amount || safeBuyCost.toFixed(4),
          exitAmountUsd: '',
          diffUsd: '',
          exitCount: 0,
          txBuy: rowTx || undefined,
          partialReasons: [],
        },
        buyCostNum: safeBuyCost,
        exitAmountNum: 0,
        accPnlUsd: 0,
        hasPnl: false,
        lastSeq: seq,
      };
      const idx = records.push(rec) - 1;
      if (mint) {
        activeIdxByMint.set(mint, idx);
      }
      continue;
    }

    if (action === 'SELL') {
      const reason = row.reason || '';
      const isPartialSell =
        reason.startsWith('principal_recovery') || reason.startsWith('scale_out');
      const sellProceeds = parseFloat(row.amount || '0');
      const safeProceeds = Number.isFinite(sellProceeds) ? sellProceeds : 0;
      const sellPnl = parseFloat(row.pnlUsd || '');
      const hasSellPnl = Number.isFinite(sellPnl);

      const activeIdx = mint ? activeIdxByMint.get(mint) : undefined;
      if (activeIdx !== undefined && records[activeIdx]) {
        const rec = records[activeIdx];
        const t = rec.trade;
        rec.exitAmountNum += safeProceeds;
        if (hasSellPnl) {
          rec.accPnlUsd += sellPnl;
          rec.hasPnl = true;
        }
        rec.lastSeq = seq;

        t.exitCount += 1;
        t.time = row.time || t.time;
        t.exitTime = row.time || '';
        t.entryPrice = t.entryPrice || row.entryPrice || '';
        t.exitPrice = row.price || '';
        t.txSell = rowTx || t.txSell;
        t.solPriceUsd = row.solPriceUsd || t.solPriceUsd;
        t.reason = reason || t.reason;
        if (isPartialSell && reason) {
          t.partialReasons = [...(t.partialReasons || []), reason];
        }

        const effectiveBuy = rec.buyCostNum;
        const effectiveExit = rec.exitAmountNum;
        const diffVal = effectiveExit - effectiveBuy;

        t.amount = effectiveExit.toFixed(4);
        t.buyAmountUsd = effectiveBuy.toFixed(4);
        t.exitAmountUsd = effectiveExit.toFixed(4);
        t.diffUsd = diffVal.toFixed(4);
        t.pnlUsd = rec.hasPnl ? rec.accPnlUsd.toFixed(4) : diffVal.toFixed(4);

        if (t.exitCount === 1 && !isPartialSell && row.pnlPct && Number.isFinite(parseFloat(row.pnlPct))) {
          t.pnlPct = row.pnlPct;
        } else if (effectiveBuy > 0) {
          const pnlForPct = rec.hasPnl ? rec.accPnlUsd : diffVal;
          t.pnlPct = ((pnlForPct / effectiveBuy) * 100).toFixed(2);
        } else {
          t.pnlPct = row.pnlPct || '0.00';
        }

        if (isPartialSell) {
          t.tradeStatus = 'PARTIAL';
          t.action = 'PARTIAL';
        } else {
          t.tradeStatus = 'CLOSED';
          t.action = 'CLOSED';
          if (mint) activeIdxByMint.delete(mint);
        }
        continue;
      }

      // Orphaned SELL without an earlier BUY row in this CSV
      const inferredBuy = hasSellPnl ? Math.max(0, safeProceeds - sellPnl) : 0;
      const diffVal = safeProceeds - inferredBuy;
      const rec: InternalTrade = {
        trade: {
          ...row,
          action: isPartialSell ? 'PARTIAL' : 'CLOSED',
          tradeStatus: isPartialSell ? 'PARTIAL' : 'CLOSED',
          entryTime: row.time || '',
          exitTime: row.time || '',
          entryPrice: row.entryPrice || '',
          exitPrice: row.price || '',
          buyAmountUsd: inferredBuy.toFixed(4),
          exitAmountUsd: safeProceeds.toFixed(4),
          diffUsd: (hasSellPnl ? sellPnl : diffVal).toFixed(4),
          exitCount: 1,
          txSell: rowTx || undefined,
          partialReasons: isPartialSell && reason ? [reason] : [],
        },
        buyCostNum: inferredBuy,
        exitAmountNum: safeProceeds,
        accPnlUsd: hasSellPnl ? sellPnl : diffVal,
        hasPnl: hasSellPnl,
        lastSeq: seq,
      };
      records.push(rec);
      continue;
    }

    const fallbackCost = parseFloat(row.amount || '0');
    records.push({
      trade: {
        ...row,
        tradeStatus: 'OPEN',
        entryTime: row.time || '',
        exitTime: '',
        entryPrice: row.entryPrice || row.price || '',
        exitPrice: '',
        buyAmountUsd: Number.isFinite(fallbackCost) ? fallbackCost.toFixed(4) : '0',
        exitAmountUsd: '',
        diffUsd: '',
        exitCount: 0,
        txBuy: rowTx || undefined,
      },
      buyCostNum: Number.isFinite(fallbackCost) ? fallbackCost : 0,
      exitAmountNum: 0,
      accPnlUsd: 0,
      hasPnl: false,
      lastSeq: seq,
    });
  }

  return records
    .sort((a, b) => b.lastSeq - a.lastSeq)
    .slice(0, limit)
    .map((r) => r.trade);
}

export function orderLogsNewestFirst<T>(logs: readonly T[]): T[] {
  return [...logs].reverse();
}

export function formatBotUptime(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTrailingModeHint(takeProfitPct: number, trailingStopPct: number): string {
  const tp = Number.isFinite(takeProfitPct) && takeProfitPct > 0 ? takeProfitPct : 0;
  const trail = Number.isFinite(trailingStopPct) && trailingStopPct > 0 ? trailingStopPct : 0;
  if (tp > 0 && trail > 0) {
    return `Arms at +${tp}% · exits -${trail}% from peak PnL (profit only)`;
  }
  if (tp <= 0 && trail > 0) {
    const arm = Math.max(10, Math.ceil(trail + 5));
    return `Arms at +${arm}% · profit-only trail (-${trail}% peak PnL)`;
  }
  if (tp > 0 && trail <= 0) {
    return `Fixed TP at +${tp}% (trailing off)`;
  }
  return 'Disabled';
}

export interface RecoveryThresholdResult {
  tradeSizeUsd: number;
  recoverSellPct: number;
  targetRecoveryUsd: number;
  minTpPct: number;
  estimatedTxFeeUsd: number;
}

/**
 * Calculates the minimum Take Profit % required so selling `recoverSellPct`%
 * of a position returns at least 100% of the invested `tradeSizeUsd` PLUS
 * buy/sell fees, slippage, and live Solana tx fees.
 */
export function calcMinRecoveryTakeProfitPct(params: {
  tradeSizeUsd: number;
  recoverSellPct?: number;
  feePct?: number;
  slippagePct?: number;
  mode?: 'paper' | 'live' | string;
  solPriceUsd?: number | null;
}): RecoveryThresholdResult {
  const tradeSizeUsd = Math.max(0.01, Number(params.tradeSizeUsd) || 0);
  const recoverSellPct = Math.min(95, Math.max(5, Number(params.recoverSellPct ?? 50) || 50));
  const fee = Math.min(0.45, Math.max(0, (Number(params.feePct ?? 1) || 0) / 100));
  const slip = Math.min(0.45, Math.max(0, (Number(params.slippagePct ?? 2) || 0) / 100));

  const sellFraction = recoverSellPct / 100;
  const isLive = String(params.mode || 'paper').toLowerCase() === 'live';
  const solPx = params.solPriceUsd && Number.isFinite(params.solPriceUsd) && params.solPriceUsd > 0 ? params.solPriceUsd : 0;
  // In live mode include estimated buy+sell Solana priority/tx fee (~0.0002 SOL total, capped reasonably relative to position)
  const estimatedTxFeeUsd = isLive && solPx > 0 ? Math.min(tradeSizeUsd * 0.25, 0.0002 * solPx) : 0;
  const targetRecoveryUsd = tradeSizeUsd + estimatedTxFeeUsd;

  // Net proceeds factor on selling fraction f at gain G:
  // Paper: f * tradeSize * (1 - fee_buy) * (1 - slip_sell) * (1 - fee_sell) * (1 + G)
  // Live:  f * tradeSize * (1 - slip_sell) * (1 - fee_sell) * (1 + G) [plus buy/sell tx fee covered by targetRecoveryUsd]
  const retentionFactor = isLive
    ? (1 - slip) * (1 - fee)
    : (1 - fee) * (1 - slip) * (1 - fee);

  const safeRetention = Math.max(0.05, sellFraction * retentionFactor);
  const multiplierNeeded = targetRecoveryUsd / (tradeSizeUsd * safeRetention);
  const rawPct = Math.max(0, (multiplierNeeded - 1) * 100);
  // Round UP to nearest 0.1% so net return strictly >= targetRecoveryUsd
  const minTpPct = Math.ceil(rawPct * 10) / 10;

  return {
    tradeSizeUsd,
    recoverSellPct,
    targetRecoveryUsd: Number(targetRecoveryUsd.toFixed(4)),
    minTpPct,
    estimatedTxFeeUsd: Number(estimatedTxFeeUsd.toFixed(4)),
  };
}

export function isPyOptionEnabled(
  settings: Record<string, any> | undefined | null,
  key: string,
  defaultVal = true
): boolean {
  const toggles = settings?.option_enabled;
  if (toggles && typeof toggles === 'object' && typeof toggles[key] === 'boolean') {
    return toggles[key];
  }
  return defaultVal;
}

export interface SniperSettingsValidation {
  valid: boolean;
  error: string | null;
  recovery: RecoveryThresholdResult | null;
}

export function validatePythonSniperSettings(
  settings: Record<string, any>,
  solPriceUsd?: number | null
): SniperSettingsValidation {
  if (isPyOptionEnabled(settings, 'min_age_minutes', false)) {
    const minAge = parseFloat(String(settings.min_age_minutes ?? 0));
    if (!Number.isFinite(minAge) || minAge < 0) {
      return {
        valid: false,
        error: 'Minimum coin age (minutes) must be 0 or greater.',
        recovery: null,
      };
    }
    if (isPyOptionEnabled(settings, 'max_age_minutes', true)) {
      const maxAge = parseFloat(String(settings.max_age_minutes ?? 0));
      if (Number.isFinite(maxAge) && maxAge > 0 && minAge > maxAge) {
        return {
          valid: false,
          error: `Minimum coin age (${minAge}m) cannot exceed Maximum coin age (${maxAge}m).`,
          recovery: null,
        };
      }
    }
  }

  const creatorHistoryActive =
    isPyOptionEnabled(settings, 'check_creator_history', true) &&
    settings.check_creator_history !== false &&
    settings.check_creator_history !== 'false';
  if (creatorHistoryActive) {
    if (isPyOptionEnabled(settings, 'max_creator_launches', true)) {
      const maxLaunches = parseFloat(String(settings.max_creator_launches ?? 5));
      if (!Number.isFinite(maxLaunches) || maxLaunches < 0) {
        return {
          valid: false,
          error: 'Max owner prior coins launched must be 0 or greater.',
          recovery: null,
        };
      }
    }
    if (isPyOptionEnabled(settings, 'max_creator_rugged_coins', true)) {
      const maxRugs = parseFloat(String(settings.max_creator_rugged_coins ?? 0));
      if (!Number.isFinite(maxRugs) || maxRugs < 0) {
        return {
          valid: false,
          error: 'Max owner prior rugged coins must be 0 or greater.',
          recovery: null,
        };
      }
    }
    if (isPyOptionEnabled(settings, 'creator_fast_rug_window_min', true)) {
      const fastWindow = parseFloat(String(settings.creator_fast_rug_window_min ?? 60));
      if (!Number.isFinite(fastWindow) || fastWindow < 0) {
        return {
          valid: false,
          error: 'Fast rugpull window (minutes) must be 0 or greater.',
          recovery: null,
        };
      }
    }
  }

  const recoverEnabled =
    isPyOptionEnabled(settings, 'recover_principal_enabled', true) &&
    (settings.recover_principal_enabled === true || settings.recover_principal_enabled === 'true');
  if (!recoverEnabled) {
    return { valid: true, error: null, recovery: null };
  }

  if (!isPyOptionEnabled(settings, 'take_profit_pct', true)) {
    return {
      valid: false,
      error: 'Enable Take profit % (check its option box) or turn off Recover 100% Principal before saving.',
      recovery: null,
    };
  }

  const tradeSizeUsd = isPyOptionEnabled(settings, 'trade_size_usd', true)
    ? parseFloat(String(settings.trade_size_usd ?? 0))
    : 5.0;
  if (!Number.isFinite(tradeSizeUsd) || tradeSizeUsd <= 0) {
    return {
      valid: false,
      error: 'Trade size $ must be greater than $0 when Principal Recovery is enabled.',
      recovery: null,
    };
  }

  const recoverSellPct = isPyOptionEnabled(settings, 'recover_principal_sell_pct', true)
    ? parseFloat(String(settings.recover_principal_sell_pct ?? 50))
    : 50;
  if (!Number.isFinite(recoverSellPct) || recoverSellPct < 5 || recoverSellPct > 95) {
    return {
      valid: false,
      error: 'Step 1 Principal Recovery sell % must be between 5% and 95%.',
      recovery: null,
    };
  }

  const recovery = calcMinRecoveryTakeProfitPct({
    tradeSizeUsd,
    recoverSellPct,
    feePct: isPyOptionEnabled(settings, 'fee_pct', true) ? parseFloat(String(settings.fee_pct ?? 1)) : 0,
    slippagePct: isPyOptionEnabled(settings, 'slippage_pct', true)
      ? parseFloat(String(settings.slippage_pct ?? 2))
      : 0,
    mode: settings.mode,
    solPriceUsd,
  });

  const tpPct = parseFloat(String(settings.take_profit_pct ?? 0));
  if (!Number.isFinite(tpPct) || tpPct <= 0 || tpPct + 1e-9 < recovery.minTpPct) {
    const tpDisplay = Number.isFinite(tpPct) && tpPct > 0 ? `+${tpPct}%` : '0% (off)';
    return {
      valid: false,
      error: `Your investment is $${recovery.tradeSizeUsd.toFixed(2)} (requires ~$${recovery.targetRecoveryUsd.toFixed(2)} back incl. fees & slippage). To sell ${recovery.recoverSellPct}% and recover your money, you must set Take profit % to at least +${recovery.minTpPct.toFixed(1)}% (currently ${tpDisplay}).`,
      recovery,
    };
  }

  // Pro Desk range validation (only enforced when respective checkbox is enabled)
  if (isPyOptionEnabled(settings, 'pre_migration_curve_enabled', false)) {
    const cMin = parseFloat(String(settings.pre_migration_curve_min_pct ?? 75));
    const cMax = parseFloat(String(settings.pre_migration_curve_max_pct ?? 92));
    if (!Number.isFinite(cMin) || !Number.isFinite(cMax) || cMin < 0 || cMax > 100 || cMin >= cMax) {
      return {
        valid: false,
        error: 'Pre-migration bonding curve range must satisfy 0 <= Min % < Max % <= 100.',
        recovery: null,
      };
    }
  }
  if (isPyOptionEnabled(settings, 'conviction_sizing_enabled', true)) {
    const mMin = parseFloat(String(settings.conviction_min_mult ?? 0.5));
    const mMax = parseFloat(String(settings.conviction_max_mult ?? 1.5));
    if (!Number.isFinite(mMin) || !Number.isFinite(mMax) || mMin <= 0 || mMin > mMax) {
      return {
        valid: false,
        error: 'Conviction size multiplier must satisfy 0 < Min <= Max.',
        recovery: null,
      };
    }
  }
  if (isPyOptionEnabled(settings, 'wash_trade_filter_enabled', true)) {
    const ratio = parseFloat(String(settings.min_unique_makers_ratio ?? 0.25));
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      return {
        valid: false,
        error: 'Min unique makers ratio must be between 0.01 and 1.0.',
        recovery: null,
      };
    }
  }

  return { valid: true, error: null, recovery: null };
}

export interface SniperProModuleMeta {
  key: string;
  label: string;
  group: 'scam_intel' | 'execution' | 'entry_timing' | 'sizing' | 'capital';
  defaultEnabled: boolean;
  description: string;
  linkedTo?: string;
}

export const SNIPER_PRO_MODULES: SniperProModuleMeta[] = [
  {
    key: 'anti_sybil_enabled',
    label: 'Anti-Sybil Fresh-Wallet Cluster Guard',
    group: 'scam_intel',
    defaultEnabled: true,
    description: 'Blocks launches where multiple fresh top-holder wallets were funded from the same distributor wallet just before launch.',
    linkedTo: 'Links to fresh_wallet_minutes & max_shared_funder_count',
  },
  {
    key: 'smart_money_enabled',
    label: 'Smart Money / KOL Watchlist & Confluence',
    group: 'scam_intel',
    defaultEnabled: true,
    description: 'Boosts conviction sizing when tracked profitable wallets buy early in PumpPortal WS trades.',
    linkedTo: 'Links to smart_wallets, smart_money_min_confluence & smart_money_size_boost_pct',
  },
  {
    key: 'smart_money_auto_exit_on_sell',
    label: 'Smart Wallet Auto-Exit on Sell',
    group: 'scam_intel',
    defaultEnabled: true,
    description: 'Immediately sells an open position when any tracked smart wallet exits that mint via the live WS stream.',
    linkedTo: 'Requires Smart Money Watchlist & Live WS Exit Stream',
  },
  {
    key: 'reused_socials_enabled',
    label: 'Reused Socials / Recycled Handle Detector',
    group: 'scam_intel',
    defaultEnabled: true,
    description: 'Flags tokens reusing Telegram, X/Twitter, or website URLs previously seen on rugged or repeat serial launches.',
    linkedTo: 'Links to max_social_reuse_count (/sniper/social_history.json)',
  },
  {
    key: 'ws_exit_stream_enabled',
    label: 'Live WS Open-Position Price & Trade Streaming (<200ms)',
    group: 'execution',
    defaultEnabled: true,
    description: 'Pins open mints on Node PumpPortal WS so TP, SL, Trailing Stop, and Smart-Sell exit triggers react sub-second without Jupiter 429 polling lag.',
  },
  {
    key: 'jito_dontfront_enabled',
    label: 'Jito Sandwich Protection (dontfront)',
    group: 'execution',
    defaultEnabled: true,
    description: 'Injects the official jitodontfront marker account into live Jupiter swap txs and routes bundles privately through Jito block-engine.',
    linkedTo: 'Pairs with Settings -> Jito Tip (SOL)',
  },
  {
    key: 'orphan_sweep_enabled',
    label: 'Orphan Token Auto-Adopter (Wallet Sweep)',
    group: 'execution',
    defaultEnabled: true,
    description: 'Periodically checks on-chain SPL/Token-2022 balances in LIVE mode and adopts any unmonitored tokens so TP/SL/Trail protection attaches automatically.',
  },
  {
    key: 'post_migration_pullback_enabled',
    label: 'Post-Migration Pullback / Reclaim Entry',
    group: 'entry_timing',
    defaultEnabled: false,
    description: 'For migrated PumpSwap/Raydium pools (including Axiom Pulse Migrated), waits out the post-migration dump window until a pullback dip occurs.',
    linkedTo: 'Links to migration_wait_sec & migration_min_dip_pct',
  },
  {
    key: 'pre_migration_curve_enabled',
    label: 'Pre-Migration Bonding Curve Surge Filter',
    group: 'entry_timing',
    defaultEnabled: false,
    description: 'Filters Pump.fun bonding-curve tokens to the late-stage migration push sweet spot (e.g. 75%-92% curve fill).',
    linkedTo: 'Links to pre_migration_curve_min_pct & pre_migration_curve_max_pct',
  },
  {
    key: 'wash_trade_filter_enabled',
    label: 'Wash-Trading / Fake Volume Guard',
    group: 'entry_timing',
    defaultEnabled: true,
    description: 'Rejects coins with high transaction counts generated by too few unique trader wallets (ping-pong volume bots).',
    linkedTo: 'Links to min_unique_makers_ratio & min_unique_traders_5m',
  },
  {
    key: 'sol_regime_filter_enabled',
    label: 'SOL 15m Market Regime Filter ("Red Market Pause")',
    group: 'entry_timing',
    defaultEnabled: true,
    description: 'Pauses new entries or cuts trade size by 50% when SOL drops sharply over the trailing 15-minute window.',
    linkedTo: 'Links to sol_regime_max_drop_pct & sol_regime_action',
  },
  {
    key: 'anti_top_wick_enabled',
    label: 'Anti-Top-Wick Guard',
    group: 'entry_timing',
    defaultEnabled: true,
    description: 'Prevents market-buying vertical green peak candles that spiked aggressively right before evaluation.',
    linkedTo: 'Links to max_short_spike_pct',
  },
  {
    key: 'conviction_sizing_enabled',
    label: 'Conviction-Based Dynamic Sizing',
    group: 'sizing',
    defaultEnabled: true,
    description: 'Scales USD position size between min and max multipliers based on liquidity depth, buy pressure, unique makers, and Smart Money confluence.',
    linkedTo: 'Links to conviction_min_mult & conviction_max_mult',
  },
  {
    key: 'streak_throttle_enabled',
    label: 'Drawdown / Losing-Streak Throttle',
    group: 'sizing',
    defaultEnabled: true,
    description: 'Automatically halves size or pauses fresh entries after consecutive losing closes until cooldown expires.',
    linkedTo: 'Links to streak_loss_limit, streak_cooldown_minutes & streak_action',
  },
  {
    key: 'narrative_cap_enabled',
    label: 'Meta / Narrative Ticker Duplicate Guard',
    group: 'sizing',
    defaultEnabled: true,
    description: 'Caps simultaneous open positions sharing the same normalized meme ticker stem (e.g. DOGE / DOGE2 / MINIDOGE).',
    linkedTo: 'Links to max_same_narrative_positions',
  },
  {
    key: 'auto_reclaim_rent_enabled',
    label: 'Auto-Reclaim Empty ATA Rent (0.00204 SOL)',
    group: 'capital',
    defaultEnabled: true,
    description: 'Automatically closes empty token accounts right after a full live sell to recover ~0.00204 SOL lockup rent.',
  },
];




