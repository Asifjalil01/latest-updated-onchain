import React, { useState } from 'react';
import { ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { PnlText, SparklineSvg, formatSol, formatTokenPriceUsd, formatUsd, maskMint } from '../ui/Primitives';
import type { PositionRecord } from '../../types';

export function PositionsView() {
  const { status, positions, colorBlindSafe, apiFetch, refreshModeData, pushToast } = useBotStore();
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [confirmSellId, setConfirmSellId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);

  const solUsd = status?.solPriceUsd ?? 0;

  const handleSell = async (pos: PositionRecord) => {
    setBusyId(pos.id);
    try {
      await apiFetch(`/api/sell/${pos.id}`, { method: 'POST' });
      await refreshModeData();
      setConfirmSellId(null);
      pushToast({ kind: 'success', title: `Closed ${pos.symbol}` });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: `Sell failed for ${pos.symbol}`,
        body: err instanceof Error ? err.message : 'Sell error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleResolveReview = async (
    pos: PositionRecord,
    resolution: 'mark_closed_external' | 'restore_open'
  ) => {
    setBusyId(pos.id);
    try {
      await apiFetch(`/api/positions/${pos.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
      await refreshModeData();
      pushToast({ kind: 'info', title: `Resolved ${pos.symbol}` });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Resolution failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReclaimRent = async () => {
    setReclaiming(true);
    try {
      const res = await apiFetch<{ closedCount: number; reclaimedSol: number }>('/api/rent/reclaim', {
        method: 'POST',
      });
      pushToast({
        kind: 'success',
        title: 'Rent reclaim complete',
        body: `Closed ${res.closedCount} empty ATAs · Reclaimed ${res.reclaimedSol} SOL`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Rent reclaim failed',
        body: err instanceof Error ? err.message : 'Failed',
      });
    } finally {
      setReclaiming(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Open Positions
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Exit thresholds are locked per position at entry. Settings edits never mutate active
            trades.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleReclaimRent()}
            disabled={reclaiming}
            className="px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reclaiming ? 'animate-spin' : ''}`} />
            <span>Reclaim ATA Rent</span>
          </button>

          <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-500'
              }`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-500'
              }`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-4 text-xs text-slate-700 dark:text-slate-300 space-y-1">
        <p className="font-semibold text-teal-600 dark:text-teal-400">Understanding Gross vs Net P&L (Take-Home)</p>
        <p>
          <strong>Net P&amp;L</strong> is your true take-home earnings after deducting entry fees, priority tips, and ATA rent. <strong>Gross P&amp;L</strong> reflects price movement only. Prices update live every 1 second.
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-12 text-center space-y-2">
          <p className="font-display text-base font-semibold text-slate-700 dark:text-slate-200">
            No active positions
          </p>
          <p className="text-xs text-slate-500">
            When a token passes every Discovery, Filter, Security, and Scoring gate, it appears here
            with its locked Break-Even price and trailing ladder.
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {positions.map((pos) => {
            const grossPct =
              pos.entryPriceUsd > 0
                ? ((pos.currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100
                : 0;
            const currentSolVal =
              solUsd > 0 ? (pos.quantity * pos.currentPriceUsd) / solUsd : pos.solIn;
            const grossPnlSol = currentSolVal - pos.solIn;
            const estRoundTripCostSol =
              pos.exitParams?.roundTripCostPct > 0
                ? Math.max(
                    pos.entryFeesSol + pos.entryRentSol,
                    pos.solIn * (pos.exitParams.roundTripCostPct / 100)
                  )
                : pos.entryFeesSol + pos.entryRentSol;
            const netPnlSol = grossPnlSol - estRoundTripCostSol;
            const netPct = pos.solIn > 0 ? (netPnlSol / pos.solIn) * 100 : 0;

            return (
              <article
                key={pos.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                        {pos.symbol}
                      </h2>
                      <span className="font-mono text-xs text-slate-500">{maskMint(pos.mint)}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {pos.dex} · {pos.source} · {pos.tokenClass.replace('_', ' ')} ·{' '}
                      <span
                        className={
                          pos.isStaleData
                            ? 'text-amber-500 font-semibold'
                            : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        }
                      >
                        {pos.isStaleData ? 'STALE' : 'LIVE'}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={`https://dexscreener.com/solana/${pos.mint}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 hover:underline whitespace-nowrap"
                    >
                      <span>DexScreener</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    {pos.txBuy && (
                      <a
                        href={`https://solscan.io/tx/${pos.txBuy}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:underline whitespace-nowrap"
                      >
                        <span>Solscan</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {pos.status === 'NEEDS_REVIEW' && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                      <ShieldAlert className="w-4 h-4" />
                      <span>NEEDS REVIEW: {pos.reviewReason}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleResolveReview(pos, 'mark_closed_external')}
                        disabled={busyId === pos.id}
                        className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-600 text-white"
                      >
                        Confirm Sold Externally
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResolveReview(pos, 'restore_open')}
                        disabled={busyId === pos.id}
                        className="px-3 py-1 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700"
                      >
                        Restore Open
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/70">
                  <div>
                    <span className="text-[11px] text-slate-500 block">Entry Price</span>
                    <span className="font-mono text-xs font-semibold tabular-nums block text-slate-900 dark:text-slate-100">
                      {formatTokenPriceUsd(pos.entryPriceUsd)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500 block">Current Price</span>
                    <span className="font-mono text-xs font-semibold tabular-nums block text-teal-600 dark:text-teal-400">
                      {formatTokenPriceUsd(pos.currentPriceUsd)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500 block">Gross P&amp;L</span>
                    <PnlText
                      valueSol={grossPnlSol}
                      valuePct={grossPct}
                      colorBlindSafe={colorBlindSafe}
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500 block">
                      Net P&amp;L ({pos.confirmationLabel})
                    </span>
                    <PnlText
                      valueSol={netPnlSol}
                      valuePct={netPct}
                      label={pos.confirmationLabel}
                      colorBlindSafe={colorBlindSafe}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono tabular-nums pt-3 border-t border-slate-100 dark:border-slate-800/70 text-slate-600 dark:text-slate-300">
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block">Size In</span>
                    {formatSol(pos.solIn, 4)} <span className="text-slate-500 text-[11px]">({formatUsd(pos.solIn * solUsd, false)})</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block">Break-Even</span>
                    {formatTokenPriceUsd(pos.breakEvenPriceUsd)}
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block">
                      Trailing Floor
                    </span>
                    {pos.trailingArmed && pos.trailingFloorPct !== null
                      ? `+${pos.trailingFloorPct.toFixed(2)}% (Armed)`
                      : `Armed > +${(pos.exitParams.roundTripCostPct + 1).toFixed(1)}%`}
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block">Peak / SL / TP</span>
                    +{pos.peakPnlPct.toFixed(1)}% / -{pos.exitParams.stopLossPct}% / +
                    {pos.exitParams.takeProfitPct}%
                  </div>
                </div>

                {/* Trailing Progress Bar */}
                {(() => {
                  const armingTargetPct = pos.exitParams.roundTripCostPct + 1.0;
                  const progressPct = pos.trailingArmed
                    ? Math.min(100, Math.max(0, ((grossPct - (pos.trailingFloorPct ?? 0)) / (pos.exitParams.takeProfitPct - (pos.trailingFloorPct ?? 0))) * 100))
                    : Math.min(100, Math.max(0, (grossPct / armingTargetPct) * 100));
                  return (
                    <div className="space-y-1.5 pt-2">
                      <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                        <span>{pos.trailingArmed ? 'Trailing Ladder Active (Progress to TP)' : `Arming Progress (>+${armingTargetPct.toFixed(1)}%)`}</span>
                        <span className={`font-semibold ${grossPct >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-500'}`}>
                          {grossPct >= 0 ? `+${grossPct.toFixed(2)}%` : `${grossPct.toFixed(2)}%`}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            grossPct < 0
                              ? 'bg-rose-500'
                              : pos.trailingArmed
                                ? 'bg-gradient-to-r from-teal-500 to-emerald-400'
                                : 'bg-sky-500'
                          }`}
                          style={{ width: `${Math.max(4, progressPct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}

                {pos.lastSellError && (
                  <p className="text-xs text-rose-500 font-mono">
                    Last exit error ({pos.sellAttempts} attempts): {pos.lastSellError}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  {confirmSellId === pos.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmSellId(null)}
                        className="px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSell(pos)}
                        disabled={busyId === pos.id}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
                      >
                        {busyId === pos.id ? 'Selling…' : 'Confirm Manual Sell'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmSellId(pos.id)}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 whitespace-nowrap"
                    >
                      Manual Sell
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-3 px-4 font-medium">Token</th>
                <th className="py-3 px-4 font-medium text-right">Entry</th>
                <th className="py-3 px-4 font-medium text-right">Current</th>
                <th className="py-3 px-4 font-medium text-right">Break-Even</th>
                <th className="py-3 px-4 font-medium text-right">Net P&amp;L</th>
                <th className="py-3 px-4 font-medium text-right">Trailing Floor</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {positions.map((pos) => {
                const currentSolVal =
                  solUsd > 0 ? (pos.quantity * pos.currentPriceUsd) / solUsd : pos.solIn;
                const estRoundTripCostSol =
                  pos.exitParams?.roundTripCostPct > 0
                    ? Math.max(
                        pos.entryFeesSol + pos.entryRentSol,
                        pos.solIn * (pos.exitParams.roundTripCostPct / 100)
                      )
                    : pos.entryFeesSol + pos.entryRentSol;
                const netPnlSol = currentSolVal - pos.solIn - estRoundTripCostSol;
                const netPct = pos.solIn > 0 ? (netPnlSol / pos.solIn) * 100 : 0;
                return (
                  <tr key={pos.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {pos.symbol}
                      </span>{' '}
                      <span className="text-slate-500">
                        · {pos.dex} · {pos.isStaleData ? 'STALE' : 'LIVE'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatTokenPriceUsd(pos.entryPriceUsd)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatTokenPriceUsd(pos.currentPriceUsd)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatTokenPriceUsd(pos.breakEvenPriceUsd)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <PnlText
                        valueSol={netPnlSol}
                        valuePct={netPct}
                        label={pos.confirmationLabel}
                        colorBlindSafe={colorBlindSafe}
                      />
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {pos.trailingArmed && pos.trailingFloorPct !== null
                        ? `+${pos.trailingFloorPct.toFixed(2)}%`
                        : 'Pending'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void handleSell(pos)}
                        disabled={busyId === pos.id}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-500 border border-rose-500/30 hover:bg-rose-500/10"
                      >
                        Sell
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
