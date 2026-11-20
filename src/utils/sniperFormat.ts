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

export interface SniperSettingsValidation {
  valid: boolean;
  error: string | null;
  recovery: RecoveryThresholdResult | null;
}

export function validatePythonSniperSettings(
  settings: Record<string, any>,
  solPriceUsd?: number | null
): SniperSettingsValidation {
  const recoverEnabled =
    settings.recover_principal_enabled === true || settings.recover_principal_enabled === 'true';
  if (!recoverEnabled) {
    return { valid: true, error: null, recovery: null };
  }

  const tradeSizeUsd = parseFloat(String(settings.trade_size_usd ?? 0));
  if (!Number.isFinite(tradeSizeUsd) || tradeSizeUsd <= 0) {
    return {
      valid: false,
      error: 'Trade size $ must be greater than $0 when Principal Recovery is enabled.',
      recovery: null,
    };
  }

  const recoverSellPct = parseFloat(String(settings.recover_principal_sell_pct ?? 50));
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
    feePct: parseFloat(String(settings.fee_pct ?? 1)),
    slippagePct: parseFloat(String(settings.slippage_pct ?? 2)),
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

  return { valid: true, error: null, recovery };
}


