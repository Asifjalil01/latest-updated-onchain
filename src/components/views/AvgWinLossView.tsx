import React from 'react';
import { Award, TrendingDown, TrendingUp } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import {
  HoverTip,
  InfoTooltip,
  PnlText,
  formatPct,
  formatSignedUsd,
  formatSol,
  formatUsd,
  maskMint,
} from '../ui/Primitives';

export function AvgWinLossView() {
  const { status, trades, analytics, colorBlindSafe } = useBotStore();
  const solUsd = status?.solPriceUsd ?? 0;

  const avgWinSol = analytics?.avgWinSol ?? 0;
  const avgLossSol = analytics?.avgLossSol ?? 0;
  const avgWinUsd = solUsd > 0 ? avgWinSol * solUsd : null;
  const avgLossUsd = solUsd > 0 ? avgLossSol * solUsd : null;

  const winsCount = analytics?.wins ?? 0;
  const lossesCount = analytics?.losses ?? 0;
  const winRate = analytics?.winRatePct ?? 0;
  const totalTrades = analytics?.totalTrades ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          Average Win / Average Loss Analytics
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Comprehensive performance breakdown comparing average winning trades against average losing trades in SOL and USD ($).
        </p>
      </div>

      {/* Main Avg Win vs Avg Loss Side-by-Side Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              <span>Average Winning Trade</span>
            </span>
            <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold">
              {winsCount} Wins ({winRate.toFixed(1)}%)
            </span>
          </div>

          <div className="space-y-1">
            <div className="font-mono text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              +{formatSol(avgWinSol, 4)}
            </div>
            {avgWinUsd !== null && (
              <div className="font-mono text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">
                {formatSignedUsd(avgWinUsd)}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-2 border-t border-emerald-500/20">
            Average net take-home profit on winning positions after subtracting DEX fees, priority tips, and ATA rent.
          </p>
        </div>

        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4" />
              <span>Average Losing Trade</span>
            </span>
            <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold">
              {lossesCount} Losses ({(100 - winRate).toFixed(1)}%)
            </span>
          </div>

          <div className="space-y-1">
            <div className="font-mono text-3xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {formatSol(avgLossSol, 4)}
            </div>
            {avgLossUsd !== null && (
              <div className="font-mono text-base font-semibold tabular-nums text-rose-600 dark:text-rose-300">
                {formatSignedUsd(avgLossUsd)}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-2 border-t border-rose-500/20">
            Average net loss on unsuccessful trades including stop-losses, manual exits, and fee friction.
          </p>
        </div>
      </div>

      {/* Summary Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500">Total Closed Trades</span>
          <div className="font-mono text-lg font-bold tabular-nums mt-1">{totalTrades}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500">Profit Factor</span>
          <div className="font-mono text-lg font-bold tabular-nums mt-1">
            {(analytics?.profitFactor ?? 0).toFixed(2)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500">Expectancy per Trade</span>
          <div className="font-mono text-lg font-bold tabular-nums mt-1">
            {formatSol(analytics?.expectancySol ?? 0, 4)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500">Total Net Realized P&amp;L</span>
          <div className="font-mono text-lg font-bold tabular-nums mt-1">
            <PnlText valueSol={analytics?.netPnlSol ?? 0} colorBlindSafe={colorBlindSafe} solUsd={solUsd} />
          </div>
        </div>
      </div>

      {/* Recent Trades Win/Loss List */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center">
          Closed Trade Win/Loss History
          <InfoTooltip text="Itemized win/loss breakdown for all closed trades in the active execution mode." />
        </h2>

        {trades.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            No closed trades recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2.5 px-3 font-medium">Closed At</th>
                  <th className="py-2.5 px-3 font-medium">Token</th>
                  <th className="py-2.5 px-3 font-medium">Exit Reason</th>
                  <th className="py-2.5 px-3 font-medium text-right">Net P&amp;L (SOL &amp; $)</th>
                  <th className="py-2.5 px-3 font-medium text-right">Return %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {trades.map((t) => {
                  const isWin = t.pnlSol > 0;
                  return (
                    <tr key={t.tradeId} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                      <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                        {new Date(t.closedAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                        {t.symbol} <span className="font-mono text-xs text-slate-500">{maskMint(t.mint)}</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs">{t.exitReason}</td>
                      <td className="py-2.5 px-3 text-right">
                        <PnlText valueSol={t.pnlSol} colorBlindSafe={colorBlindSafe} solUsd={t.solPriceUsd || solUsd} />
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${isWin ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {formatPct(t.pnlPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
