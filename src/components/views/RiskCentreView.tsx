import React from 'react';
import { OctagonAlert, ShieldCheck } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { HoverTip, InfoTooltip, SemanticStatusText } from '../ui/Primitives';

export function RiskCentreView() {
  const {
    status,
    settings,
    walletDiagnostics,
    rpcs,
    colorBlindSafe,
    // setLiveConfirmModalOpen,
    setKillModalOpen,
  } = useBotStore();

  const healthyRpcs = rpcs.filter((r) => r.healthy).length;

  const checklist = [
    {
      label: 'Server-side encrypted signer unlocked (no browser popup automation)',
      ok: Boolean(walletDiagnostics?.signerUnlocked),
    },
    {
      label: 'At least 2 healthy Solana RPC endpoints agreeing on balances',
      ok: healthyRpcs >= 2 && walletDiagnostics?.syncState === 'synced',
    },
    {
      label: 'Live SOL/USD price feed available (Jupiter v3 / DexScreener)',
      ok: status?.solPriceUsd !== null && status?.solPriceUsd !== undefined,
    },
    /* Trade size + gas reserve & ENABLE LIVE confirmation gates commented out per user request:
    {
      label: `Wallet balance covers trade size + gas reserve (${(
        (settings?.tradeSizeSol ?? 0.05) + (settings?.gasReserveSol ?? 0.02)
      ).toFixed(3)} SOL)`,
      ok:
        walletDiagnostics?.balanceSol !== null &&
        walletDiagnostics?.balanceSol !== undefined &&
        walletDiagnostics.balanceSol >=
          (settings?.tradeSizeSol ?? 0.05) + (settings?.gasReserveSol ?? 0.02),
    },
    {
      label: 'Explicit ENABLE LIVE confirmation matching current risk limits',
      ok: Boolean(status?.liveConfirmed),
    },
    */
  ];

  const allGreen = checklist.every((c) => c.ok);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Risk Centre &amp; Live Readiness Gate
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Trading can lose all of your money. Every safeguard below must pass before Live mode can
            start.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* ENABLE LIVE confirmation modal button commented out per user request:
          <HoverTip text="Open the explicit Live Trading Confirmation modal to review active caps and type ENABLE LIVE before switching to real funds.">
            <button
              type="button"
              onClick={() => setLiveConfirmModalOpen(true)}
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Arm Live Confirmation
            </button>
          </HoverTip>
          */}
          <HoverTip text="Emergency halt: immediately stops scanning and trading, locks Live mode, and lets you close all open positions.">
            <button
              type="button"
              onClick={() => setKillModalOpen(true)}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white inline-flex items-center gap-1.5"
            >
              <OctagonAlert className="w-3.5 h-3.5" />
              <span>KILL SWITCH</span>
            </button>
          </HoverTip>
        </div>
      </div>

      {/* Plain-language risk explanations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-3">
          <h2 className="font-display text-base font-bold flex items-center">
            What Can Go Wrong in Solana Spot Trading
            <InfoTooltip text="Key execution risks on Solana DEXs so you know why fail-closed pipeline filters and signer safeguards exist." />
          </h2>
          <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            <li>
              <strong>Rug pulls &amp; liquidity drains:</strong> Even mature pools can have LP pulled
              or taxes changed. Our emergency monitor checks liquidity drops and sell taxes every
              second, but extreme drains can still exceed slippage limits.
            </li>
            <li>
              <strong>Failed or slow sells:</strong> During congestion, exit swaps can fail or drop
              with no route. Never assume every exit succeeds at the trigger price.
            </li>
            <li>
              <strong>Confirmation timeouts:</strong> A timed-out transaction may still land
              on-chain seconds later. The bot polls for 120 seconds and reconciles balances before
              ever considering an order failed.
            </li>
            <li>
              <strong>Browser popup limitation:</strong> Phantom/Solflare popups cannot sign
              automated stop-losses while you are away; Live mode strictly blocks popup-only
              wallets.
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold flex items-center">
              Live Readiness Checklist
              <InfoTooltip text="Every single safeguard below must read PASS before the bot allows switching to autonomous Live mainnet trading." />
            </h2>
            <SemanticStatusText
              status={allGreen ? 'ok' : 'warn'}
              text={allGreen ? 'ALL GATES GREEN' : 'BLOCKED'}
              colorBlindSafe={colorBlindSafe}
            />
          </div>

          <div className="space-y-2.5">
            {checklist.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-xs"
              >
                <span className="text-slate-700 dark:text-slate-200">{item.label}</span>
                <SemanticStatusText
                  status={item.ok ? 'ok' : 'error'}
                  text={item.ok ? 'PASS' : 'BLOCKED'}
                  colorBlindSafe={colorBlindSafe}
                />
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-teal-500 shrink-0" />
            <span>
              Active Limits: SL &ge; 0.5% (unlimited tiers) · TP &ge; 1.5% (unlimited) · Pool age{' '}
              {settings?.customAgeWindowEnabled
                ? `${settings.customMinPoolAgeMinutes}–${settings.customMaxPoolAgeMinutes}m`
                : `>= ${settings?.minPoolAgeMinutes ?? 30}m`}{' '}
              · Exposure max {settings?.maxWalletExposureSol ?? 0.1} SOL · Daily loss cap{' '}
              {settings?.dailyLossLimitSol ?? 0.15} SOL.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
