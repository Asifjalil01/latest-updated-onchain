import React, { useState } from 'react';
import { ExternalLink, RefreshCw, ShieldAlert, Sliders } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { PnlText, SparklineSvg, formatSol, formatTokenPriceUsd, formatUsd, maskMint } from '../ui/Primitives';
import type { PositionRecord } from '../../types';

export function PositionsView() {
  const { status, positions, colorBlindSafe, apiFetch, refreshModeData, pushToast } = useBotStore();
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [confirmSellId, setConfirmSellId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);
  const [syncingSettings, setSyncingSettings] = useState(false);

  const solUsd = status?.solPriceUsd ?? 0;

  const handleSyncSettings = async () => {
    setSyncingSettings(true);
    try {
      const res = await apiFetch<{ success: boolean; syncedCount: number }>('/api/positions/sync-settings', {
        method: 'POST',
      });
      await refreshModeData();
      pushToast({
        kind: 'success',
        title: 'Settings synced to active positions',
        body: `Updated SL/TP/Trailing rules on ${res.syncedCount} open positions.`,
      });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Sync failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setSyncingSettings(false);
    }
  };

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
            onClick={() => void handleSyncSettings()}
            disabled={syncingSettings || positions.length === 0}
            className="px-3 py-2 rounded-xl text-xs font-medium border border-teal-500/40 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 whitespace-nowrap shrink-0 flex items-center gap-1.5 disabled:opacity-40"
          >
            <Sliders className={`w-3.5 h-3.5 ${syncingSettings ? 'animate-spin' : ''}`} />
            <span>Sync Settings to Open Positions</span>
          </button>

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
                    <span className="text-[11px] font-sans text-slate-500 block mb-1">Entry Price</span>
                    <div className="text-xs font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 min-h-5 leading-snug">
                      {formatTokenPriceUsd(pos.entryPriceUsd)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block mb-1">Current Price</span>
                    <div className={`text-xs font-semibold font-mono tabular-nums min-h-5 leading-snug ${pos.currentPriceUsd >= pos.entryPriceUsd ? 'text-teal-600 dark:text-teal-400' : 'text-rose-500'}`}>
                      {formatTokenPriceUsd(pos.currentPriceUsd)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block mb-1">Gross P&amp;L</span>
                    <div className="text-xs font-semibold font-mono tabular-nums min-h-5 leading-snug">
                      <PnlText
                        valueSol={grossPnlSol}
                        valuePct={grossPct}
                        colorBlindSafe={colorBlindSafe}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block mb-1">
                      Net P&amp;L ({pos.confirmationLabel})
                    </span>
                    <div className="text-xs font-semibold font-mono tabular-nums min-h-5 leading-snug">
                      <PnlText
                        valueSol={netPnlSol}
                        valuePct={netPct}
                        label={pos.confirmationLabel}
                        colorBlindSafe={colorBlindSafe}
                      />
                    </div>
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
                      Profit Lock Floor
                    </span>
                    {pos.trailingArmed && pos.trailingFloorPct !== null ? (
                      <span className="text-emerald-500 dark:text-emerald-400 font-bold">
                        +{pos.trailingFloorPct.toFixed(1)}% (Locked)
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        Pending (Arms at +{pos.exitParams?.trailingLadder?.[0]?.peakGainPct ?? 1.2}%)
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block">Peak / SL / TP</span>
                    +{pos.peakPnlPct.toFixed(1)}% / {pos.exitParams.stopLossEnabled === false ? 'Disabled' : `-${pos.exitParams.stopLossPct}%`} / +{pos.exitParams.takeProfitPct}%
                  </div>
                </div>

                {/* Trailing Profit Lock System & Progress Bar */}
                {(() => {
                  const ladder = pos.exitParams?.trailingLadder || [];
                  const firstTier = ladder[0];
                  const firstTierPeak = firstTier ? firstTier.peakGainPct : 20;
                  const firstTierFloor = firstTier ? (firstTier.peakGainPct - firstTier.allowedDropPct) : 17;
                  const isArmed = pos.trailingArmed && pos.trailingFloorPct !== null;

                  // Find highest tier reached
                  let activeTierIndex = -1;
                  for (let i = ladder.length - 1; i >= 0; i--) {
                    if (pos.peakPnlPct >= ladder[i].peakGainPct) {
                      activeTierIndex = i;
                      break;
                    }
                  }

                  const nextTierIndex = activeTierIndex + 1;
                  const nextTier = nextTierIndex < ladder.length ? ladder[nextTierIndex] : null;
                  const targetPeak = isArmed
                    ? (nextTier ? nextTier.peakGainPct : pos.exitParams.takeProfitPct)
                    : firstTierPeak;

                  const isLoss = grossPct < 0;
                  const armedSpan = Math.max(0.1, targetPeak - (pos.trailingFloorPct ?? 0));
                  const progressPct = isArmed
                    ? Math.min(100, Math.max(0, ((grossPct - (pos.trailingFloorPct ?? 0)) / armedSpan) * 100))
                    : Math.min(100, Math.max(0, (grossPct / Math.max(0.1, targetPeak)) * 100));

                  return (
                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/70">
                      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono gap-1">
                        <span className="text-slate-500 font-sans">
                          {isArmed
                            ? (nextTier
                                ? `Profit Lock Active (+${pos.trailingFloorPct?.toFixed(1)}% Floor) · Aiming for Tier #${nextTierIndex + 1} (+${nextTier.peakGainPct}%)`
                                : `Profit Lock Active (+${pos.trailingFloorPct?.toFixed(1)}% Floor) · All Tiers Cleared! Aiming for TP (+${pos.exitParams.takeProfitPct}%)`)
                            : `Progress to Profit Lock Tier #1 (Peak +${firstTierPeak}%)`}
                        </span>
                        <span className={`font-semibold ${isLoss ? 'text-rose-500' : 'text-emerald-500 dark:text-emerald-400'}`}>
                          {grossPct >= 0 ? `+${grossPct.toFixed(2)}%` : `${grossPct.toFixed(2)}%`} (Target: +{targetPeak}%)
                        </span>
                      </div>

                      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isLoss
                              ? 'bg-rose-500'
                              : isArmed
                                ? 'bg-gradient-to-r from-teal-500 to-emerald-400'
                                : 'bg-sky-500'
                          }`}
                          style={{ width: `${isLoss ? Math.min(100, Math.max(4, Math.abs(grossPct) * 5)) : Math.max(4, progressPct)}%` }}
                        />
                      </div>

                      {/* Display Custom Trailing Profit Lock System Tiers */}
                      {ladder.length > 0 && (
                        <div className="space-y-1 pt-1">
                          <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-500 gap-1">
                            <span className="font-semibold uppercase tracking-wider">Your Stepped Trailing Profit Lock System</span>
                            <span className="font-mono text-emerald-500 dark:text-emerald-400 font-medium">
                              {isArmed
                                ? `Tier #${activeTierIndex + 1} Locked Floor: +${pos.trailingFloorPct?.toFixed(1)}% ${nextTier ? `➔ Target: Tier #${nextTierIndex + 1} (+${nextTier.peakGainPct}%)` : '➔ All Tiers Hit!'}`
                                : `Arms at Peak +${firstTierPeak}% ➔ Locks +${firstTierFloor.toFixed(1)}% Floor`}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {ladder.map((t, idx) => {
                              const tierFloor = t.peakGainPct - t.allowedDropPct;
                              const isHit = pos.peakPnlPct >= t.peakGainPct;
                              const isInProgress = !isHit && idx === nextTierIndex;
                              return (
                                <span
                                  key={idx}
                                  className={`px-2 py-0.5 rounded-md font-mono text-[10px] tabular-nums border transition-all ${
                                    isHit
                                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-600 dark:text-emerald-300 font-semibold ring-1 ring-emerald-500/30'
                                      : isInProgress
                                        ? 'bg-amber-500/20 border-amber-500 text-amber-700 dark:text-amber-300 font-bold ring-2 ring-amber-500/40 animate-pulse'
                                        : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-500'
                                  }`}
                                  title={
                                    isHit
                                      ? `Tier #${idx + 1} reached (Floor +${tierFloor.toFixed(1)}% secured)`
                                      : isInProgress
                                        ? `Currently in progress (Arms at +${t.peakGainPct}% peak)`
                                        : `Upcoming Tier #${idx + 1}`
                                  }
                                >
                                  {isHit ? '✓ ' : isInProgress ? '▶ ' : ''}#{idx + 1}: +{t.peakGainPct}% ➔ {isHit ? `Locked +${tierFloor.toFixed(1)}%` : `Lock +${tierFloor.toFixed(1)}%`}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
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
                <th className="py-3 px-4 font-medium text-right">Profit Lock Floor</th>
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
                      {pos.trailingArmed && pos.trailingFloorPct !== null ? (
                        <span className="text-emerald-500 dark:text-emerald-400 font-bold">
                          +{pos.trailingFloorPct.toFixed(1)}% (Locked)
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">
                          Pending (+{pos.exitParams?.trailingLadder?.[0]?.peakGainPct ?? 1.2}%)
                        </span>
                      )}
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
