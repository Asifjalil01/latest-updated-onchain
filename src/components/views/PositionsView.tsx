import React, { useEffect, useState } from 'react';
import { Clock, ExternalLink, RefreshCw, ShieldAlert, Sliders } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import {
  HoverTip,
  InfoTooltip,
  PnlText,
  SparklineSvg,
  formatSol,
  formatTokenPriceUsd,
  formatUsd,
  maskMint,
} from '../ui/Primitives';
import { formatHoldDuration } from '../../utils/formatters';
import type { PositionRecord } from '../../types';

export function PositionsView() {
  const { status, settings, positions, colorBlindSafe, apiFetch, refreshModeData, pushToast } = useBotStore();
  const autoReclaimRent = settings?.autoReclaimRent !== false;
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [confirmSellId, setConfirmSellId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);
  const [syncingSettings, setSyncingSettings] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
          <HoverTip text="Push your current Settings (Stop-Loss, Take-Profit, and Stepped Trailing Ladder) immediately onto all currently open positions.">
            <button
              type="button"
              onClick={() => void handleSyncSettings()}
              disabled={syncingSettings || positions.length === 0}
              className="px-3 py-2 rounded-xl text-xs font-medium border border-teal-500/40 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 whitespace-nowrap shrink-0 flex items-center gap-1.5 disabled:opacity-40"
            >
              <Sliders className={`w-3.5 h-3.5 ${syncingSettings ? 'animate-spin' : ''}`} />
              <span>Sync Settings to Open Positions</span>
            </button>
          </HoverTip>

          <HoverTip text="Sweep and close empty SPL Associated Token Accounts (ATAs) in your wallet to recover locked ~0.00204 SOL rent deposits.">
            <button
              type="button"
              onClick={() => void handleReclaimRent()}
              disabled={reclaiming}
              className="px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reclaiming ? 'animate-spin' : ''}`} />
              <span>Reclaim ATA Rent</span>
            </button>
          </HoverTip>

          <HoverTip text="Switch between detailed position cards and compact comparison table layout.">
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
          </HoverTip>
        </div>
      </div>

      <div className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-4 text-xs text-slate-700 dark:text-slate-300 space-y-1">
        <p className="font-semibold text-teal-600 dark:text-teal-400">Understanding Gross vs Net P&amp;L (Take-Home)</p>
        <p>
          <strong>Net P&amp;L</strong> is your true take-home earnings after Jupiter route DEX fees, Solana base/priority fees{autoReclaimRent ? ' (ATA rent auto-reclaimed on 100% sell)' : ', and ATA rent'}. <strong>Gross P&amp;L</strong> reflects price movement only.
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
            const rentCostSol = autoReclaimRent ? 0 : pos.entryRentSol;
            const baseWalletFeesSol = pos.entryFeesSol * 2 + rentCostSol;
            const estRoundTripCostSol =
              pos.exitParams?.roundTripCostPct > 0
                ? Math.max(
                    baseWalletFeesSol,
                    pos.solIn * (pos.exitParams.roundTripCostPct / 100)
                  )
                : baseWalletFeesSol;
            const netPnlSol = grossPnlSol - estRoundTripCostSol;
            const netPct = pos.solIn > 0 ? (netPnlSol / pos.solIn) * 100 : 0;

            return (
              <article
                key={pos.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                        {pos.symbol}
                      </h2>
                      <span className="font-mono text-xs text-slate-500">{maskMint(pos.mint)}</span>
                      <HoverTip
                        text={`Live elapsed hold duration since entry (${new Date(pos.openedAtMs).toLocaleString()}). Counts up in real time (seconds, minutes, hours).`}
                      >
                        <span
                          data-testid={`hold-timer-${pos.symbol}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums"
                        >
                          <Clock className="w-3 h-3 text-teal-500" aria-hidden="true" />
                          <span>{formatHoldDuration(nowMs - pos.openedAtMs)}</span>
                        </span>
                      </HoverTip>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {pos.dex} · {pos.source} · {pos.tokenClass.replace('_', ' ')} ·{' '}
                      <HoverTip
                        text={
                          pos.isStaleData
                            ? 'Latest price poll failed or fell back to cached value; automatic checks retry every 1s.'
                            : 'Live Jupiter & DexScreener price feed updating every second.'
                        }
                      >
                        <span
                          className={
                            pos.isStaleData
                              ? 'text-amber-500 font-semibold cursor-help'
                              : 'text-emerald-600 dark:text-emerald-400 font-semibold cursor-help'
                          }
                        >
                          {pos.isStaleData ? 'STALE' : 'LIVE'}
                        </span>
                      </HoverTip>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <HoverTip text="Open live pair chart and transaction feed on DexScreener.">
                      <a
                        href={`https://dexscreener.com/solana/${pos.mint}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 hover:underline whitespace-nowrap"
                      >
                        <span>DexScreener</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </HoverTip>
                    {pos.txBuy && (
                      <HoverTip text="View the entry transaction ID / signature on Solscan.">
                        <a
                          href={`https://solscan.io/tx/${pos.txBuy}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:underline whitespace-nowrap"
                        >
                          <span>Solscan</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </HoverTip>
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
                    <span className="text-[11px] font-sans text-slate-500 flex items-center mb-1">
                      <HoverTip text="Effective buy fill price per token (includes Paper execution delay & competition slippage in Paper mode, or confirmed on-chain fill in Live mode).">
                        <span className="cursor-help">Entry Price</span>
                      </HoverTip>
                    </span>
                    <div className="text-xs font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 min-h-5 leading-snug">
                      {formatTokenPriceUsd(pos.entryPriceUsd)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 flex items-center mb-1">
                      <HoverTip text="Latest live market price per token fetched every second from Jupiter & DexScreener.">
                        <span className="cursor-help">Current Price</span>
                      </HoverTip>
                    </span>
                    <div className={`text-xs font-semibold font-mono tabular-nums min-h-5 leading-snug ${pos.currentPriceUsd >= pos.entryPriceUsd ? 'text-teal-600 dark:text-teal-400' : 'text-rose-500'}`}>
                      {formatTokenPriceUsd(pos.currentPriceUsd)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 flex items-center mb-1">
                      <HoverTip text="Pure token price movement P&L before subtracting Solana gas, priority tips, DEX fees, and ATA rent.">
                        <span className="cursor-help">Gross P&amp;L</span>
                      </HoverTip>
                    </span>
                    <div className="text-xs font-semibold font-mono tabular-nums min-h-5 leading-snug">
                      <PnlText
                        valueSol={grossPnlSol}
                        valuePct={grossPct}
                        colorBlindSafe={colorBlindSafe}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 flex items-center mb-1">
                      <HoverTip text="True take-home P&L after deducting entry + exit fees, priority tips, and un-reclaimed ATA rent (if Auto-Reclaim Rent is off).">
                        <span className="cursor-help">Net P&amp;L ({pos.confirmationLabel})</span>
                      </HoverTip>
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
                    <span className="text-[11px] font-sans text-slate-500 block">
                      <HoverTip text="SOL capital invested into this position (scaled by token class safety multiplier).">
                        <span className="cursor-help">Size In</span>
                      </HoverTip>
                    </span>
                    {formatSol(pos.solIn, 4)} <span className="text-slate-500 text-[11px]">({formatUsd(pos.solIn * solUsd, false)})</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block">
                      <HoverTip text="Minimum token price required to recover 100% of SOL spent plus all round-trip fees and rent.">
                        <span className="cursor-help">Break-Even</span>
                      </HoverTip>
                    </span>
                    {formatTokenPriceUsd(pos.breakEvenPriceUsd)}
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block">
                      <HoverTip text="Locked minimum gain % protected by your Stepped Trailing Ladder. Once armed, if price drops below this floor, the bot sells to lock profit.">
                        <span className="cursor-help">Profit Lock Floor</span>
                      </HoverTip>
                    </span>
                    {(() => {
                      const trailingEnabled = pos.exitParams?.trailingEnabled !== false;
                      if (!trailingEnabled) {
                        return <span className="text-slate-500">Disabled</span>;
                      }
                      const ladder = pos.exitParams?.trailingLadder || [];
                      let activeIdx = -1;
                      for (let i = ladder.length - 1; i >= 0; i--) {
                        if (pos.peakPnlPct >= ladder[i].peakGainPct) {
                          activeIdx = i;
                          break;
                        }
                      }
                      const floorVal =
                        pos.trailingFloorPct ??
                        (activeIdx >= 0 ? pos.peakPnlPct - ladder[activeIdx].allowedDropPct : null);
                      if ((pos.trailingArmed || activeIdx >= 0) && floorVal !== null) {
                        return (
                          <span className="text-emerald-500 dark:text-emerald-400 font-bold">
                            +{floorVal.toFixed(1)}% (Locked)
                          </span>
                        );
                      }
                      return (
                        <span className="text-slate-500">
                          Pending (Arms at +{ladder[0]?.peakGainPct ?? 1.2}%)
                        </span>
                      );
                    })()}
                  </div>
                  <div>
                    <span className="text-[11px] font-sans text-slate-500 block">
                      <HoverTip text="Highest gain % reached since entry / Configured Stop-Loss drop % / Configured Take-Profit target %.">
                        <span className="cursor-help">Peak / SL / TP</span>
                      </HoverTip>
                    </span>
                    +{pos.peakPnlPct.toFixed(1)}% / {pos.exitParams.stopLossEnabled === false ? 'Disabled' : `-${pos.exitParams.stopLossPct}%`} / +{pos.exitParams.takeProfitPct}%
                  </div>
                </div>

                {/* Trailing Profit Lock System & Progress Bar */}
                {(() => {
                  const trailingEnabled = pos.exitParams?.trailingEnabled !== false;
                  const isLoss = grossPct < 0;

                  if (!trailingEnabled) {
                    const tpPct = Math.max(0.1, pos.exitParams.takeProfitPct);
                    const tpProgressPct = Math.min(100, Math.max(0, (grossPct / tpPct) * 100));
                    return (
                      <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/70">
                        <div className="flex flex-wrap items-center justify-between text-[11px] font-mono gap-1">
                          <span className="text-slate-500 font-sans">
                            Progress to Take-Profit (+{pos.exitParams.takeProfitPct}%) · Trailing Ladder Disabled
                          </span>
                          <span className={`font-semibold ${isLoss ? 'text-rose-500' : 'text-emerald-500 dark:text-emerald-400'}`}>
                            {grossPct >= 0 ? `+${grossPct.toFixed(2)}%` : `${grossPct.toFixed(2)}%`} (Target: +{pos.exitParams.takeProfitPct}%)
                          </span>
                        </div>

                        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isLoss
                                ? 'bg-rose-500'
                                : 'bg-gradient-to-r from-teal-500 to-emerald-400'
                            }`}
                            style={{ width: `${isLoss ? Math.min(100, Math.max(4, Math.abs(grossPct) * 5)) : Math.max(4, tpProgressPct)}%` }}
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-500 pt-1">
                          <span className="font-semibold uppercase tracking-wider">Stepped Trailing Profit Lock</span>
                          <span className="font-mono text-slate-400">
                            Disabled — Exiting at Take-Profit (+{pos.exitParams.takeProfitPct}%)
                          </span>
                        </div>
                      </div>
                    );
                  }

                  const ladder = pos.exitParams?.trailingLadder || [];
                  const firstTier = ladder[0];
                  const firstTierPeak = firstTier ? firstTier.peakGainPct : 20;
                  const firstTierFloor = firstTier ? (firstTier.peakGainPct - firstTier.allowedDropPct) : 17;

                  // Find highest tier reached based on peakPnlPct
                  let activeTierIndex = -1;
                  for (let i = ladder.length - 1; i >= 0; i--) {
                    if (pos.peakPnlPct >= ladder[i].peakGainPct) {
                      activeTierIndex = i;
                      break;
                    }
                  }

                  const hasPassedTier = activeTierIndex >= 0;
                  const nextTierIndex = activeTierIndex + 1;
                  const nextTier = nextTierIndex < ladder.length ? ladder[nextTierIndex] : null;
                  const effectiveFloorPct = hasPassedTier
                    ? (pos.trailingFloorPct ?? (pos.peakPnlPct - ladder[activeTierIndex].allowedDropPct))
                    : pos.trailingFloorPct;
                  const effectiveArmed = (pos.trailingArmed || hasPassedTier) && effectiveFloorPct !== null;

                  const targetPeak = hasPassedTier
                    ? (nextTier ? nextTier.peakGainPct : pos.exitParams.takeProfitPct)
                    : firstTierPeak;

                  const baseFloor = effectiveArmed && effectiveFloorPct !== null ? effectiveFloorPct : 0;
                  const armedSpan = Math.max(0.1, targetPeak - baseFloor);
                  const progressPct = effectiveArmed
                    ? Math.min(100, Math.max(0, ((grossPct - baseFloor) / armedSpan) * 100))
                    : Math.min(100, Math.max(0, (grossPct / Math.max(0.1, targetPeak)) * 100));

                  return (
                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/70">
                      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono gap-1">
                        <span className="text-slate-500 font-sans">
                          {effectiveArmed && effectiveFloorPct !== null
                            ? (nextTier
                                ? `Progress to Profit Lock Tier #${nextTierIndex + 1} (Peak +${nextTier.peakGainPct}%)`
                                : `All Tiers Cleared · Progress to TP (+${pos.exitParams.takeProfitPct}%)`)
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
                              : effectiveArmed
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
                              {effectiveArmed && effectiveFloorPct !== null
                                ? `Tier #${activeTierIndex + 1} Locked (+${effectiveFloorPct.toFixed(1)}% Floor) ${nextTier ? `· Next: #${nextTierIndex + 1} (+${nextTier.peakGainPct}% ➔ +${(nextTier.peakGainPct - nextTier.allowedDropPct).toFixed(1)}%)` : '· All Tiers Hit!'}`
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
                    <HoverTip text="Immediately exit 100% of this position at the current executable Jupiter market price.">
                      <button
                        type="button"
                        onClick={() => setConfirmSellId(pos.id)}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 whitespace-nowrap"
                      >
                        Manual Sell
                      </button>
                    </HoverTip>
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
                <th className="py-3 px-4 font-medium">
                  <HoverTip text="Token symbol, DEX venue, and live feed status."><span>Token</span></HoverTip>
                </th>
                <th className="py-3 px-4 font-medium text-right">
                  <HoverTip text="Live elapsed hold time since position opened."><span>Holding</span></HoverTip>
                </th>
                <th className="py-3 px-4 font-medium text-right">
                  <HoverTip text="Effective buy fill price."><span>Entry</span></HoverTip>
                </th>
                <th className="py-3 px-4 font-medium text-right">
                  <HoverTip text="Live market price per token."><span>Current</span></HoverTip>
                </th>
                <th className="py-3 px-4 font-medium text-right">
                  <HoverTip text="Minimum exit price needed to cover round-trip costs."><span>Break-Even</span></HoverTip>
                </th>
                <th className="py-3 px-4 font-medium text-right">
                  <HoverTip text="Estimated take-home P&L after fees and rent."><span>Net P&amp;L</span></HoverTip>
                </th>
                <th className="py-3 px-4 font-medium text-right">
                  <HoverTip text="Current stepped trailing profit floor status."><span>Profit Lock Floor</span></HoverTip>
                </th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {positions.map((pos) => {
                const currentSolVal =
                  solUsd > 0 ? (pos.quantity * pos.currentPriceUsd) / solUsd : pos.solIn;
                const rentCostSol = autoReclaimRent ? 0 : pos.entryRentSol;
                const baseWalletFeesSol = pos.entryFeesSol * 2 + rentCostSol;
                const estRoundTripCostSol =
                  pos.exitParams?.roundTripCostPct > 0
                    ? Math.max(
                        baseWalletFeesSol,
                        pos.solIn * (pos.exitParams.roundTripCostPct / 100)
                      )
                    : baseWalletFeesSol;
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
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {formatHoldDuration(nowMs - pos.openedAtMs)}
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
                        solUsd={solUsd}
                      />
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {pos.exitParams?.trailingEnabled === false ? (
                        <span className="text-slate-500 text-xs">Disabled</span>
                      ) : pos.trailingArmed && pos.trailingFloorPct !== null ? (
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
                      <HoverTip text="Immediately close 100% of this position at market.">
                        <button
                          type="button"
                          onClick={() => void handleSell(pos)}
                          disabled={busyId === pos.id}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-500 border border-rose-500/30 hover:bg-rose-500/10"
                        >
                          Sell
                        </button>
                      </HoverTip>
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
