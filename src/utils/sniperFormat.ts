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
}

export interface EnrichedSniperTrade extends RawSniperCsvRow {
  entryPrice: string;
  exitPrice: string;
  solPriceUsd?: string;
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
  const enriched: EnrichedSniperTrade[] = [];

  for (const row of chronologicalRows) {
    const action = (row.action || '').toUpperCase();
    const mint = row.mint || '';
    if (action === 'BUY') {
      if (mint && row.price) {
        lastBuyPriceByMint.set(mint, row.price);
      }
      enriched.push({
        ...row,
        entryPrice: row.entryPrice || row.price || '',
        exitPrice: '',
      });
    } else if (action === 'SELL') {
      const matchedEntry = row.entryPrice || (mint ? lastBuyPriceByMint.get(mint) : '') || '';
      if (mint) {
        lastBuyPriceByMint.delete(mint);
      }
      enriched.push({
        ...row,
        entryPrice: matchedEntry,
        exitPrice: row.price || '',
      });
    } else {
      enriched.push({
        ...row,
        entryPrice: row.entryPrice || row.price || '',
        exitPrice: '',
      });
    }
  }

  return enriched.slice(-limit).reverse();
}

export function orderLogsNewestFirst<T>(logs: readonly T[]): T[] {
  return [...logs].reverse();
}
