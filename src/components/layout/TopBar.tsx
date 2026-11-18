import React, { useState } from 'react';
import {
  Command,
  Eye,
  Menu,
  Moon,
  OctagonAlert,
  Play,
  RefreshCw,
  Square,
  Sun,
} from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { HoverTip, formatSol, formatUsd } from '../ui/Primitives';
import type { ExecutionMode } from '../../types';

const MODE_DESCRIPTIONS: Record<ExecutionMode, string> = {
  paper:
    'Simulated shadow trading using live Solana quotes, slippage delay window, and simulated fees. No real funds are spent.',
  testnet:
    'Simulated execution bound to Solana Devnet / Testnet RPC testing without risking mainnet SOL.',
  live:
    'Real mainnet-beta execution using your encrypted server signer. Real SOL and fees are spent autonomously.',
};

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const {
    status,
    walletDiagnostics,
    theme,
    colorBlindSafe,
    toggleTheme,
    toggleColorBlindSafe,
    setCommandPaletteOpen,
    setLiveConfirmModalOpen,
    setKillModalOpen,
    apiFetch,
    refreshModeData,
    pushToast,
  } = useBotStore();

  const [busyAction, setBusyAction] = useState(false);
  const mode = status?.mode ?? 'paper';
  const runState = status?.runState ?? 'stopped';
  const isRunning = runState === 'running';

  const handleModeSwitch = async (nextMode: ExecutionMode) => {
    if (nextMode === 'live' && !status?.liveConfirmed) {
      setLiveConfirmModalOpen(true);
      return;
    }
    try {
      setBusyAction(true);
      await apiFetch('/api/mode', {
        method: 'POST',
        body: JSON.stringify({ mode: nextMode, autoStop: true }),
      });
      await refreshModeData(nextMode);
      pushToast({
        kind: 'info',
        title: isRunning
          ? `Bot stopped & switched to ${nextMode.toUpperCase()} mode`
          : `Switched to ${nextMode.toUpperCase()} mode`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Cannot switch mode',
        body: err instanceof Error ? err.message : 'Mode switch failed',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleStartStop = async () => {
    try {
      setBusyAction(true);
      if (isRunning) {
        await apiFetch('/api/stop', { method: 'POST' });
        pushToast({ kind: 'info', title: 'Bot stopped' });
      } else {
        await apiFetch('/api/start', { method: 'POST' });
        pushToast({ kind: 'success', title: `Bot started (${mode.toUpperCase()})` });
      }
      await refreshModeData();
    } catch (err) {
      pushToast({
        kind: 'error',
        title: isRunning ? 'Stop failed' : 'Start blocked',
        body: err instanceof Error ? err.message : 'Action failed',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleScanOnce = async () => {
    try {
      setBusyAction(true);
      const res = await apiFetch<{ evaluated: number; bought: number }>('/api/scan-once', {
        method: 'POST',
      });
      await refreshModeData();
      pushToast({
        kind: 'info',
        title: 'Single scan complete',
        body: `Evaluated ${res.evaluated} candidates · Opened ${res.bought} positions`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Scan failed',
        body: err instanceof Error ? err.message : 'Scan error',
      });
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 min-h-16 py-2 sm:py-0 sm:h-16 px-3 sm:px-4 lg:px-6 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-[#070B12]/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 sm:gap-4">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Mode Segmented Switch */}
        <div
          role="group"
          aria-label="Execution Mode"
          className="flex items-center p-0.5 sm:p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0"
        >
          {(['paper', 'testnet', 'live'] as ExecutionMode[]).map((m) => {
            const active = mode === m;
            return (
              <HoverTip key={m} text={MODE_DESCRIPTIONS[m]}>
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleModeSwitch(m)}
                  className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold uppercase tracking-wide transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 disabled:opacity-50 ${
                    active
                      ? m === 'live'
                        ? 'bg-rose-600 text-white'
                        : m === 'testnet'
                          ? 'bg-violet-600 text-white'
                          : 'bg-teal-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {m === 'live' && active && (
                    <span
                      className="w-2 h-2 rounded-full bg-white animate-pulse"
                      aria-hidden="true"
                    />
                  )}
                  <span>{m}</span>
                </button>
              </HoverTip>
            );
          })}
        </div>

        {/* Live SOL Price & Wallet Chip */}
        <div className="hidden md:flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300 pl-2">
          <HoverTip text="Live SOL/USD reference price fetched from Jupiter Price API v3 and DexScreener.">
            <span className="font-mono tabular-nums whitespace-nowrap cursor-help">
              SOL:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {status?.solPriceUsd ? formatUsd(status.solPriceUsd) : 'Price unavailable'}
              </strong>
            </span>
          </HoverTip>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
            ·
          </span>
          <HoverTip
            text={
              mode === 'live'
                ? 'Active mainnet wallet address and 2-RPC verified SOL balance available for live trading.'
                : 'Simulated Paper/Testnet SOL bankroll currently available for new trades.'
            }
          >
            <span className="font-mono tabular-nums whitespace-nowrap cursor-help">
              {mode === 'live' ? (
                <>
                  Live:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {walletDiagnostics?.maskedAddress ?? 'No signer'}{' '}
                    {walletDiagnostics?.balanceSol !== null && walletDiagnostics?.balanceSol !== undefined
                      ? `(${formatSol(walletDiagnostics.balanceSol, 3)})`
                      : ''}
                  </strong>
                </>
              ) : (
                <>
                  {mode === 'testnet' ? 'Testnet' : 'Paper'} Bal:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {formatSol(status?.paperBalanceSol, 3)}
                  </strong>
                </>
              )}
            </span>
          </HoverTip>
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <HoverTip text="Runs one immediate discovery, filter, security audit, and entry pass without starting continuous scanning.">
          <button
            type="button"
            onClick={() => void handleScanOnce()}
            disabled={busyAction}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction ? 'animate-spin' : ''}`} />
            <span>Scan Once</span>
          </button>
        </HoverTip>

        <HoverTip
          text={
            isRunning
              ? 'Stop continuous scanning and automated trade execution (open positions still remain visible).'
              : 'Start continuous discovery, security checks, automated buying, and 1-second exit monitoring.'
          }
        >
          <button
            type="button"
            onClick={() => void handleStartStop()}
            disabled={busyAction}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
              isRunning
                ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 hover:bg-slate-700'
                : 'bg-teal-600 hover:bg-teal-500 text-white'
            }`}
          >
            {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isRunning ? 'Stop Bot' : 'Start Bot'}</span>
          </button>
        </HoverTip>

        <HoverTip text="Emergency halt: immediately stops the bot, locks Live trading, and optionally liquidates all open positions.">
          <button
            type="button"
            onClick={() => setKillModalOpen(true)}
            aria-label="Emergency Kill Switch"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <OctagonAlert className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">KILL SWITCH</span>
          </button>
        </HoverTip>

        <HoverTip text="Open Quick Command Palette (Ctrl+K / Cmd+K) to jump to any page or run actions rapidly.">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Open command palette (Ctrl+K)"
            className="hidden md:inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <Command className="w-3.5 h-3.5" />
            <span className="font-mono">K</span>
          </button>
        </HoverTip>

        <HoverTip
          text={`Color-blind safe indicators (${colorBlindSafe ? 'ON' : 'OFF'}): adds directional arrows and icons alongside profit/loss colors.`}
        >
          <button
            type="button"
            onClick={toggleColorBlindSafe}
            aria-label="Toggle color-blind safe indicators"
            className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border transition-colors ${
              colorBlindSafe
                ? 'border-teal-500 text-teal-600 dark:text-teal-400 bg-teal-500/10'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Eye className="w-4 h-4" />
          </button>
        </HoverTip>

        <HoverTip text={`Switch between Dark and Light terminal appearance (currently ${theme}).`}>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </HoverTip>
      </div>
    </header>
  );
}
