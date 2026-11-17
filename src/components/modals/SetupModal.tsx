import React, { useState } from 'react';
import { AlertTriangle, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';

export function SetupModal() {
  const { claimLocalToken, verifyAndSaveToken, hydrateAll, pushToast, dismissTutorial } =
    useBotStore();
  const [manualToken, setManualToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAutoClaim = async () => {
    setBusy(true);
    setError(null);
    const ok = await claimLocalToken();
    if (ok) {
      dismissTutorial();
      await hydrateAll();
      pushToast({ kind: 'success', title: 'Local session authorized in Paper mode' });
    } else {
      setError('Local token claim failed. Paste BOT_API_TOKEN from .env below.');
    }
    setBusy(false);
  };

  const handleVerifyManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    setBusy(true);
    setError(null);
    const ok = await verifyAndSaveToken(manualToken);
    if (ok) {
      dismissTutorial();
      await hydrateAll();
      pushToast({ kind: 'success', title: 'API token verified' });
    } else {
      setError('Invalid API token. Check BOT_API_TOKEN inside .env.');
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-[#070B12]">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
            Local Terminal Authorization
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">
            Solana Spot Bot — Safety-First Setup
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Every state-changing, signer, and settings route is protected by a random{' '}
            <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
              x-api-token
            </code>{' '}
            generated in <code className="font-mono text-xs">.env</code>. The bot always starts in{' '}
            <strong className="text-slate-900 dark:text-slate-100">Paper mode (stopped)</strong>.
          </p>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1 leading-relaxed">
            <p className="font-semibold text-amber-700 dark:text-amber-400">
              Important Risk Disclosure
            </p>
            <p>
              Trading can lose all of your money. No software can guarantee profits. Paper mode
              simulates real Jupiter quotes, decision-to-fill delays, liquidity drops, fees, rent,
              and failed sells, yet live on-chain markets carry additional execution risk.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <ShieldCheck className="w-4 h-4 text-teal-500 mb-2" />
            <p className="font-semibold text-slate-900 dark:text-slate-100">Fail-Closed Pipeline</p>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Missing RugCheck, missing sell route, or pool age &lt; 30m rejects automatically.
            </p>
          </div>
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <Lock className="w-4 h-4 text-teal-500 mb-2" />
            <p className="font-semibold text-slate-900 dark:text-slate-100">AES-256-GCM Signer</p>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Keys are encrypted with scrypt passphrase and never logged or returned by any API.
            </p>
          </div>
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <KeyRound className="w-4 h-4 text-teal-500 mb-2" />
            <p className="font-semibold text-slate-900 dark:text-slate-100">Guided Paper Mode</p>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Test strategies and review Paper vs Live gap before ever confirming Live execution.
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => void handleAutoClaim()}
            disabled={busy}
            className="w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {busy ? 'Authorizing Session…' : 'Authorize Local Session & Enter Paper Mode'}
          </button>

          <form onSubmit={(e) => void handleVerifyManual(e)} className="flex gap-2">
            <label htmlFor="manual-api-token" className="sr-only">
              BOT_API_TOKEN from .env
            </label>
            <input
              id="manual-api-token"
              type="password"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Or paste BOT_API_TOKEN from .env…"
              className="flex-1 px-3.5 py-2.5 rounded-xl text-sm font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              type="submit"
              disabled={busy || !manualToken.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              Verify Token
            </button>
          </form>

          {error && <p className="text-xs text-rose-500 font-medium">{error}</p>}
        </div>
      </div>
    </div>
  );
}
