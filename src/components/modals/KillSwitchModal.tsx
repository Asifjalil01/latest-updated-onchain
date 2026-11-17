import React, { useState } from 'react';
import { OctagonAlert } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';

export function KillSwitchModal() {
  const { killModalOpen, setKillModalOpen, apiFetch, refreshModeData, pushToast, positions } =
    useBotStore();
  const [busy, setBusy] = useState(false);

  if (!killModalOpen) return null;

  const handleKill = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ closedCount: number; errors: string[] }>('/api/kill', {
        method: 'POST',
      });
      await refreshModeData();
      setKillModalOpen(false);
      pushToast({
        kind: res.errors.length > 0 ? 'warn' : 'success',
        title: 'Kill switch executed',
        body: `Bot stopped. Closed ${res.closedCount} positions.${
          res.errors.length > 0 ? ` Errors: ${res.errors.join('; ')}` : ''
        }`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Kill switch error',
        body: err instanceof Error ? err.message : 'Failed',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kill-dialog-title"
        className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-white dark:bg-[#0D131F] p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
          <OctagonAlert className="w-5 h-5" />
          <h2 id="kill-dialog-title" className="font-display text-lg font-bold">
            Activate Emergency Kill Switch?
          </h2>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          This immediately halts all discovery and entry loops and attempts to exit all{' '}
          <strong className="font-mono">{positions.length}</strong> open position(s) at elevated
          slippage.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setKillModalOpen(false)}
            className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleKill()}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
          >
            {busy ? 'Executing…' : 'Confirm Kill Switch'}
          </button>
        </div>
      </div>
    </div>
  );
}
