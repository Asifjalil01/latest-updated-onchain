import React, { useMemo, useState } from 'react';
import { Download, ExternalLink, RotateCcw, X } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import {
  HoverTip,
  InfoTooltip,
  PnlText,
  formatPct,
  formatSignedUsd,
  formatSol,
  formatTokenPriceUsd,
  formatUsd,
  maskMint,
} from '../ui/Primitives';
import { formatHoldMinutes } from '../../utils/formatters';
import type { ExecutionMode, TradeRecord } from '../../types';

export function HistoryView() {
  const {
    apiToken,
    status,
    trades,
    analytics,
    colorBlindSafe,
    apiFetch,
    refreshModeData,
    pushToast,
  } = useBotStore();

  const [tab, setTab] = useState<'trades' | 'analytics'>('trades');
  const [filterMode, setFilterMode] = useState<'current' | ExecutionMode>('current');
  const [reasonFilter, setReasonFilter] = useState<string>('ALL');
  const [selectedTrade, setSelectedTrade] = useState<TradeRecord | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeMode = filterMode === 'current' ? (status?.mode ?? 'paper') : filterMode;

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (filterMode !== 'current' && t.mode !== filterMode) return false;
      if (reasonFilter !== 'ALL' && t.exitReason !== reasonFilter) return false;
      return true;
    });
  }, [trades, filterMode, reasonFilter]);

  const reasons = useMemo(() => {
    return Array.from(new Set(trades.map((t) => t.exitReason)));
  }, [trades]);

  const feeDetail = useMemo(() => {
    if (!selectedTrade?.feeBreakdownJson) return null;
    try {
      return JSON.parse(selectedTrade.feeBreakdownJson) as {
        entryFeesSol?: number;
        entryRentSol?: number;
        rentReclaimedSol?: number;
        exitFees?: {
          baseFeeSol?: number;
          priorityFeeSol?: number;
          dexFeeSol?: number;
          jupiterPlatformFeeSol?: number;
          tokenTaxSol?: number;
          walletOutFeeSol?: number;
          routeLabels?: string[];
          priorityFeeSource?: string;
        };
        dexFeeSol?: number;
        jupiterPlatformFeeSol?: number;
        routeLabels?: string[];
        priorityFeeSource?: string;
      };
    } catch {
      return null;
    }
  }, [selectedTrade]);

  const handleArchivePaper = async () => {
    setBusy(true);
    try {
      const target = activeMode === 'testnet' ? 'testnet' : 'paper';
      await apiFetch('/api/account/reset', {
        method: 'POST',
        body: JSON.stringify({ mode: target }),
      });
      await refreshModeData();
      setConfirmArchive(false);
      pushToast({
        kind: 'info',
        title: `${target.toUpperCase()} ledger archived & reset`,
        body: 'Live rows are never deleted or modified.',
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Reset failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setBusy(false);
    }
  };

  const csvHref = `/api/export/trades_log.csv?mode=${encodeURIComponent(activeMode)}&token=${encodeURIComponent(
    apiToken ?? ''
  )}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Trade History &amp; Analytics
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Itemized fees, ATA rent, and Total P&amp;L. Live records are immutable.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <HoverTip text="View every closed trade with exact entry/exit price, fees, ATA rent, and hold duration in minutes.">
              <button
                type="button"
                onClick={() => setTab('trades')}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${
                  tab === 'trades'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-500'
                }`}
              >
                Ledger
              </button>
            </HoverTip>
            <HoverTip text="View aggregated win/loss statistics, total fees/rent paid, profit factor, and performance breakdown by exit reason and discovery source.">
              <button
                type="button"
                onClick={() => setTab('analytics')}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${
                  tab === 'analytics'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-500'
                }`}
              >
                Analytics
              </button>
            </HoverTip>
          </div>

          <HoverTip text="Download the full closed-trade ledger for the selected mode as a CSV spreadsheet.">
            <a
              href={csvHref}
              download="trades_log.csv"
              className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </a>
          </HoverTip>

          {activeMode !== 'live' && (
            confirmArchive ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setConfirmArchive(false)}
                  className="px-2.5 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleArchivePaper()}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600 text-white whitespace-nowrap"
                >
                  Confirm Archive &amp; Reset
                </button>
              </div>
            ) : (
              <HoverTip text="Archive current Paper/Testnet trades and reset your virtual Paper balance back to its starting SOL balance.">
                <button
                  type="button"
                  onClick={() => setConfirmArchive(true)}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Archive Paper Account</span>
                </button>
              </HoverTip>
            )
          )}
        </div>
      </div>

      {tab === 'trades' ? (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Filter by mode"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as 'current' | ExecutionMode)}
              className="px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            >
              <option value="current">Current Mode ({status?.mode ?? 'paper'})</option>
              <option value="paper">Paper</option>
              <option value="testnet">Testnet</option>
              <option value="live">Live</option>
            </select>

            <select
              aria-label="Filter by exit reason"
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            >
              <option value="ALL">All Exit Reasons</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              No closed trades recorded in this view yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2.5 px-2 font-medium">
                      <HoverTip text="Date and time the position exited."><span>Closed</span></HoverTip>
                    </th>
                    <th className="py-2.5 px-2 font-medium">
                      <HoverTip text="Token symbol, discovery source, and execution mode."><span>Token</span></HoverTip>
                    </th>
                    <th className="py-2.5 px-2 font-medium">
                      <HoverTip text="Rule or emergency condition that triggered the sell."><span>Exit Reason</span></HoverTip>
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      <HoverTip text="Effective entry price vs exit price and gross price change %."><span>Buy → Sell Price</span></HoverTip>
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      <HoverTip text="SOL capital spent to enter the trade."><span>Used (Buy)</span></HoverTip>
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      <HoverTip text="Net SOL received after closing the position (including reclaimed ATA rent if enabled)."><span>Returned (Sell)</span></HoverTip>
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      <HoverTip text="Total Solana network + priority fees plus any un-reclaimed ATA rent."><span>Fees + Rent</span></HoverTip>
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      <HoverTip text="Total final profit or loss after all fees and rent."><span>Total P&amp;L</span></HoverTip>
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      <HoverTip text="Total time the coin was held from entry to exit, shown in minutes."><span>Hold</span></HoverTip>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {filteredTrades.map((t) => {
                    const closedDate = new Date(t.closedAt);
                    const usedUsd = t.solPriceUsd > 0 ? t.solIn * t.solPriceUsd : null;
                    const returnedUsd = t.solPriceUsd > 0 ? t.solOut * t.solPriceUsd : null;
                    const feesUsd = t.solPriceUsd > 0 ? (t.feesSol + t.rentSol) * t.solPriceUsd : null;
                    const priceDeltaPct =
                      t.entryPrice > 0 ? ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 : 0;

                    return (
                      <tr
                        key={t.tradeId}
                        onClick={() => setSelectedTrade(t)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"
                      >
                        <td className="py-2.5 px-2 font-mono text-slate-500 whitespace-nowrap">
                          <div>{closedDate.toLocaleDateString()}</div>
                          <div className="text-[11px]">{closedDate.toLocaleTimeString()}</div>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {t.symbol}
                          </div>
                          <div
                            className="text-[11px] text-slate-500 max-w-[140px] truncate"
                            title={`${t.source} · ${t.mode}`}
                          >
                            {t.source} · {t.mode}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 font-mono text-[11px] whitespace-nowrap">
                          {t.exitReason}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div>
                            {formatTokenPriceUsd(t.entryPrice)} → {formatTokenPriceUsd(t.exitPrice)}
                          </div>
                          <div
                            className={`text-[11px] ${
                              priceDeltaPct > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : priceDeltaPct < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-500'
                            }`}
                          >
                            {formatPct(priceDeltaPct)} price
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div>{t.solIn.toFixed(4)} SOL</div>
                          <div className="text-[11px] text-slate-500">
                            {usedUsd !== null ? formatUsd(usedUsd) : '—'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div>{t.solOut.toFixed(4)} SOL</div>
                          <div className="text-[11px] text-slate-500">
                            {returnedUsd !== null ? formatUsd(returnedUsd) : '—'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          <div>{(t.feesSol + t.rentSol).toFixed(5)}</div>
                          <div className="text-[11px]">
                            {feesUsd !== null ? formatUsd(feesUsd) : '—'}
                            {t.rentSol === 0 && t.feeBreakdownJson.includes('rentReclaimedSol') && (
                              <span className="ml-1 text-emerald-600 dark:text-emerald-400">· Reclaimed</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right whitespace-nowrap">
                          <PnlText
                            valueSol={t.pnlSol}
                            valuePct={t.pnlPct}
                            label={t.confirmed}
                            colorBlindSafe={colorBlindSafe}
                          />
                          <div
                            className={`text-[11px] font-mono tabular-nums ${
                              t.pnlUsd > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : t.pnlUsd < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-500'
                            }`}
                          >
                            {formatSignedUsd(t.pnlUsd)}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          <HoverTip text={`Held for ${formatHoldMinutes(t.holdSeconds)} (${t.holdSeconds}s)`}>
                            <span className="cursor-help">{formatHoldMinutes(t.holdSeconds)}</span>
                          </HoverTip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
              <span className="text-xs text-slate-500 flex items-center">
                <span>Avg Win / Avg Loss</span>
                <InfoTooltip text="Average net SOL gained on winning trades versus average net SOL lost on losing trades." />
              </span>
              <div className="font-mono text-xs font-bold tabular-nums mt-1 space-y-0.5">
                <div>
                  <span className="text-emerald-500">
                    +{formatSol(analytics?.avgWinSol ?? 0, 4)}
                    {status?.solPriceUsd ? ` (${formatSignedUsd((analytics?.avgWinSol ?? 0) * status.solPriceUsd)})` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-rose-500">
                    {formatSol(analytics?.avgLossSol ?? 0, 4)}
                    {status?.solPriceUsd ? ` (${formatSignedUsd((analytics?.avgLossSol ?? 0) * status.solPriceUsd)})` : ''}
                  </span>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
              <span className="text-xs text-slate-500 flex items-center">
                <span>Total Fees Paid</span>
                <InfoTooltip text="Cumulative Solana base + priority network fees paid across all closed trades in this mode." />
              </span>
              <div className="font-mono text-sm font-bold tabular-nums mt-1">
                {formatSol(analytics?.totalFeesSol ?? 0, 5)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
              <span className="text-xs text-slate-500 flex items-center">
                <span>Total ATA Rent</span>
                <InfoTooltip text="Net SOL spent on SPL Token Account (ATA) rent that was not reclaimed on exit." />
              </span>
              <div className="font-mono text-sm font-bold tabular-nums mt-1">
                {formatSol(analytics?.totalRentSol ?? 0, 5)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
              <span className="text-xs text-slate-500 flex items-center">
                <span>Profit Factor</span>
                <InfoTooltip text="Total gross profit divided by total gross loss. Above 1.0 means net profitable overall." />
              </span>
              <div className="font-mono text-sm font-bold tabular-nums mt-1">
                {(analytics?.profitFactor ?? 0).toFixed(2)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-3">
              <h2 className="font-display text-sm font-bold">Performance by Exit Reason</h2>
              {(analytics?.byExitReason ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">No data yet.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {analytics?.byExitReason.map((row) => (
                    <div key={row.reason} className="flex items-center justify-between font-mono">
                      <span>
                        {row.reason} ({row.count})
                      </span>
                      <PnlText valueSol={row.netPnlSol} colorBlindSafe={colorBlindSafe} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-3">
              <h2 className="font-display text-sm font-bold">Performance by Discovery Source</h2>
              {(analytics?.bySource ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">No data yet.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {analytics?.bySource.map((row) => (
                    <div key={row.source} className="flex items-center justify-between font-mono">
                      <span>
                        {row.source} ({row.count} · {row.winRatePct.toFixed(0)}% win)
                      </span>
                      <PnlText valueSol={row.netPnlSol} colorBlindSafe={colorBlindSafe} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Trade Detail Drawer */}
      {selectedTrade && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setSelectedTrade(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Trade detail ${selectedTrade.symbol}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg h-full overflow-y-auto bg-white dark:bg-[#0D131F] border-l border-slate-200 dark:border-slate-800 p-6 space-y-5"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-xl font-bold">
                  {selectedTrade.symbol} — {selectedTrade.exitReason}
                </h2>
                <p className="font-mono text-xs text-slate-500 mt-0.5">
                  {maskMint(selectedTrade.mint)} · {selectedTrade.mode.toUpperCase()} (
                  {selectedTrade.confirmed})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTrade(null)}
                aria-label="Close trade detail"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums pt-3 border-t border-slate-200 dark:border-slate-800">
              <div>
                <span className="font-sans text-slate-500 block">Buy Price</span>
                {formatTokenPriceUsd(selectedTrade.entryPrice)}
              </div>
              <div>
                <span className="font-sans text-slate-500 block">Sell Price</span>
                {formatTokenPriceUsd(selectedTrade.exitPrice)}
              </div>
              <div>
                <span className="font-sans text-slate-500 block">Used to Buy</span>
                <div>{selectedTrade.solIn.toFixed(4)} SOL</div>
                <div className="text-slate-500">
                  {selectedTrade.solPriceUsd > 0
                    ? formatUsd(selectedTrade.solIn * selectedTrade.solPriceUsd)
                    : '—'}
                </div>
              </div>
              <div>
                <span className="font-sans text-slate-500 block">Returned After Sell</span>
                <div>{selectedTrade.solOut.toFixed(4)} SOL</div>
                <div className="text-slate-500">
                  {selectedTrade.solPriceUsd > 0
                    ? formatUsd(selectedTrade.solOut * selectedTrade.solPriceUsd)
                    : '—'}
                </div>
              </div>
              {/* Gross P&L commented out per single Total P&L display
              <div>
                <span className="font-sans text-slate-500 block">Gross P&amp;L</span>
                {selectedTrade.grossPnlSol.toFixed(5)} SOL
              </div>
              */}
              <div>
                <span className="font-sans text-slate-500 block">
                  Total P&amp;L ({selectedTrade.confirmed})
                </span>
                <PnlText
                  valueSol={selectedTrade.pnlSol}
                  valuePct={selectedTrade.pnlPct}
                  colorBlindSafe={colorBlindSafe}
                  solUsd={status?.solPriceUsd ?? selectedTrade.solPriceUsd ?? 0}
                />
                <div className="text-slate-500 mt-0.5">{formatSignedUsd(selectedTrade.pnlUsd)}</div>
              </div>
              <div>
                <span className="font-sans text-slate-500 block">Total Fees</span>
                {selectedTrade.feesSol.toFixed(6)} SOL
                {selectedTrade.solPriceUsd > 0 && (
                  <span className="block text-slate-500">
                    {formatUsd(selectedTrade.feesSol * selectedTrade.solPriceUsd)}
                  </span>
                )}
              </div>
              <div>
                <span className="font-sans text-slate-500 block">Net ATA Rent</span>
                {selectedTrade.rentSol.toFixed(6)} SOL
                {selectedTrade.solPriceUsd > 0 && (
                  <span className="block text-slate-500">
                    {formatUsd(selectedTrade.rentSol * selectedTrade.solPriceUsd)}
                  </span>
                )}
              </div>
              <div>
                <span className="font-sans text-slate-500 block">Hold Duration</span>
                {formatHoldMinutes(selectedTrade.holdSeconds)}
                <span className="block text-slate-500 text-[11px]">
                  Peak: +{selectedTrade.peakPct.toFixed(2)}%
                </span>
              </div>
            </div>

            {feeDetail && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 space-y-2 text-xs">
                <p className="font-display font-semibold text-slate-800 dark:text-slate-200">
                  Jupiter Route &amp; Fee Breakdown
                </p>
                <div className="space-y-1.5 font-mono tabular-nums text-[11px]">
                  <div className="flex justify-between gap-3">
                    <span className="font-sans text-slate-500">Jupiter Route AMMs</span>
                    <span className="text-slate-800 dark:text-slate-200 text-right">
                      {feeDetail.routeLabels?.length
                        ? feeDetail.routeLabels.join(' → ')
                        : feeDetail.exitFees?.routeLabels?.length
                          ? feeDetail.exitFees.routeLabels.join(' → ')
                          : 'Direct / Quote'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-sans text-slate-500">DEX LP Fee (in quote outAmount)</span>
                    <span>
                      {(feeDetail.dexFeeSol ?? feeDetail.exitFees?.dexFeeSol ?? 0).toFixed(6)} SOL
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-sans text-slate-500">Jupiter Platform Fee</span>
                    <span>
                      {(
                        feeDetail.jupiterPlatformFeeSol ??
                        feeDetail.exitFees?.jupiterPlatformFeeSol ??
                        0
                      ).toFixed(6)}{' '}
                      SOL
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-sans text-slate-500">
                      Network + Priority ({feeDetail.priorityFeeSource ?? feeDetail.exitFees?.priorityFeeSource ?? 'preset'})
                    </span>
                    <span>{selectedTrade.feesSol.toFixed(6)} SOL</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="font-sans text-slate-500">ATA Rent Paid / Reclaimed</span>
                    <span>
                      {(feeDetail.entryRentSol ?? 0).toFixed(5)} /{' '}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{(feeDetail.rentReclaimedSol ?? 0).toFixed(5)}
                      </span>{' '}
                      SOL
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
              {selectedTrade.txBuy && (
                <a
                  href={`https://solscan.io/tx/${selectedTrade.txBuy}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-teal-500 hover:underline"
                >
                  <span>Buy Tx</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {selectedTrade.txSell && (
                <a
                  href={`https://solscan.io/tx/${selectedTrade.txSell}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-teal-500 hover:underline"
                >
                  <span>Sell Tx</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
