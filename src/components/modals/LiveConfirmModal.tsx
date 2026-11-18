import React, { useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';

export function LiveConfirmModal() {
  const {
    liveConfirmModalOpen,
    setLiveConfirmModalOpen,
    settings,
    walletDiagnostics,
    apiFetch,
    refreshModeData,
    pushToast,
  } = useBotStore();

  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!liveConfirmModalOpen) return null;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/live/confirm', {
        method: 'POST',
        body: JSON.stringify({ confirmationText: typed }),
      });
      await apiFetch('/api/mode', {
        method: 'POST',
        body: JSON.stringify({ mode: 'live', autoStop: true }),
      });
      await refreshModeData('live');
      setLiveConfirmModalOpen(false);
      setTyped('');
      pushToast({ kind: 'warn', title: 'Live mode armed (still stopped)' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live confirmation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-confirm-title"
        className="w-full max-w-lg rounded-2xl border border-rose-500/40 bg-white dark:bg-[#0D131F] p-6 space-y-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <h2 id="live-confirm-title" className="font-display text-lg font-bold">
              Confirm Live Execution Mode
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setLiveConfirmModalOpen(false)}
            aria-label="Close Live confirmation dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Live mode executes real on-chain swaps on Solana mainnet via Jupiter using your unlocked
          server signer. <strong>Trading can lose all of your money.</strong> If any of the parameters
          below change later, Live mode will automatically disarm and require re-confirmation.
        </p>

        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-xs font-mono tabular-nums">
          <div>
            <span className="text-slate-500 block font-sans">Trade Size</span>
            <span className="font-semibold">{settings?.tradeSizeSol} SOL</span>
          </div>
          <div>
            <span className="text-slate-500 block font-sans">Max Exposure</span>
            <span className="font-semibold">{settings?.maxWalletExposureSol} SOL</span>
          </div>
          <div>
            <span className="text-slate-500 block font-sans">Take-Profit</span>
            <span className="font-semibold text-emerald-500">+{settings?.takeProfitPct}%</span>
          </div>
          <div>
            <span className="text-slate-500 block font-sans">Stop-Loss</span>
            <span className="font-semibold text-rose-500">-{settings?.stopLossPct}%</span>
          </div>
          <div>
            <span className="text-slate-500 block font-sans">Daily Loss Limit</span>
            <span className="font-semibold">{settings?.dailyLossLimitSol} SOL</span>
          </div>
          <div>
            <span className="text-slate-500 block font-sans">Signer Status</span>
            <span className="font-semibold">
              {walletDiagnostics?.signerUnlocked ? 'Unlocked' : 'Locked'}
            </span>
          </div>
        </div>

        {walletDiagnostics && walletDiagnostics.liveNotReadyReasons.length > 0 && (
          <div className="text-xs text-amber-600 dark:text-amber-400 space-y-1">
            <p className="font-semibold">Current blockers:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {walletDiagnostics.liveNotReadyReasons
                .filter((r) => !r.includes('ENABLE LIVE'))
                .map((r) => (
                  <li key={r}>{r}</li>
                ))}
            </ul>
          </div>
        )}

        <form onSubmit={(e) => void handleConfirm(e)} className="space-y-4">
          <div>
            <label
              htmlFor="enable-live-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Type <code className="font-mono font-bold">ENABLE LIVE</code> to arm Live mode:
            </label>
            <input
              id="enable-live-input"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="ENABLE LIVE"
              className="w-full px-3.5 py-2.5 rounded-xl font-mono text-sm bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          {error && <p className="text-xs text-rose-500 font-medium">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setLiveConfirmModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || typed.trim() !== 'ENABLE LIVE'}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40"
            >
              {busy ? 'Confirming…' : 'Confirm & Switch to Live'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
