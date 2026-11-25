import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Zap,
  Users,
  TrendingDown,
  Coins,
  Activity,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Save,
  Trash2,
  Plus,
  Play,
  RotateCcw,
} from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import type {
  BotSettings,
  DexScorecardRow,
  RentAuditReport,
  OrphanSweepResult,
  BacktestResult,
} from '../../types';
import { validateSettingsDraft } from '../../utils/settingsValidation';

export function ProDeskView() {
  const { settings, apiFetch, hydrateAll, pushToast, status } = useBotStore();
  const [draft, setDraft] = useState<BotSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Tool states
  const [rentReport, setRentReport] = useState<RentAuditReport | null>(null);
  const [rentLoading, setRentLoading] = useState(false);
  const [burnDustEnabled, setBurnDustEnabled] = useState(false);

  const [sweepResult, setSweepResult] = useState<OrphanSweepResult | null>(null);
  const [sweepLoading, setSweepLoading] = useState(false);

  const [scorecardRows, setScorecardRows] = useState<DexScorecardRow[]>([]);
  const [scorecardLoading, setScorecardLoading] = useState(false);

  const [backtestReq, setBacktestReq] = useState({
    lookbackHours: 24,
    takeProfitPct: 35,
    stopLossPct: 15,
    trailingEnabled: true,
    trailingDropPct: 12,
  });
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);

  const [newWalletInput, setNewWalletInput] = useState('');

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void loadRentAudit();
    void loadScorecard();
  }, []);

  if (!draft) {
    return <div className="p-6 text-xs text-slate-500">Loading Pro Desk settings…</div>;
  }

  const isOptEnabled = (key: string) => draft.optionToggles?.[key] !== false;

  const toggleOpt = (key: string, enabled: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        optionToggles: {
          ...(prev.optionToggles ?? {}),
          [key]: enabled,
        },
      };
    });
    setValidationError(null);
  };

  const updateField = <K extends keyof BotSettings>(key: K, value: BotSettings[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setValidationError(null);
  };

  const loadRentAudit = async () => {
    setRentLoading(true);
    try {
      const res = await apiFetch('/api/rent/audit');
      setRentReport(res as RentAuditReport);
    } catch (err) {
      pushToast({ kind: 'error', title: 'Rent audit failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setRentLoading(false);
    }
  };

  const handleReclaimRent = async (burnDust: boolean) => {
    setRentLoading(true);
    try {
      const res = (await apiFetch('/api/rent/reclaim-all', {
        method: 'POST',
        body: JSON.stringify({ burnDust }),
      })) as { closedCount: number; burnedCount: number; reclaimedSol: number; txSig?: string };
      pushToast({
        kind: 'success',
        title: 'ATA Rent Reclaimed',
        body: `Closed ${res.closedCount} empty ATAs, burned ${res.burnedCount} dust accounts. Reclaimed +${res.reclaimedSol.toFixed(4)} SOL!`,
      });
      await loadRentAudit();
      await hydrateAll();
    } catch (err) {
      pushToast({ kind: 'error', title: 'Reclaim failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setRentLoading(false);
    }
  };

  const handleRunOrphanSweep = async () => {
    setSweepLoading(true);
    try {
      const res = (await apiFetch('/api/wallet/sweep-orphans', {
        method: 'POST',
      })) as OrphanSweepResult;
      setSweepResult(res);
      pushToast({
        kind: 'success',
        title: 'Orphan Sweep Complete',
        body: `Scanned ${res.scanned} accounts, adopted ${res.adopted} unmonitored positions (${res.adoptedSymbols.join(', ') || 'none'}).`,
      });
      await hydrateAll();
    } catch (err) {
      pushToast({ kind: 'error', title: 'Orphan sweep failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setSweepLoading(false);
    }
  };

  const loadScorecard = async () => {
    setScorecardLoading(true);
    try {
      const res = (await apiFetch('/api/telemetry/scorecard')) as { scorecard: DexScorecardRow[] };
      setScorecardRows(res.scorecard || []);
    } catch (err) {
      // ignore or toast
    } finally {
      setScorecardLoading(false);
    }
  };

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBacktestLoading(true);
    try {
      const res = (await apiFetch('/api/backtest', {
        method: 'POST',
        body: JSON.stringify({
          mode: status?.mode ?? 'paper',
          lookbackHours: Number(backtestReq.lookbackHours),
          takeProfitPct: Number(backtestReq.takeProfitPct),
          stopLossPct: Number(backtestReq.stopLossPct),
          trailingEnabled: Boolean(backtestReq.trailingEnabled),
          trailingDropPct: Number(backtestReq.trailingDropPct),
          minAgeMinutes: draft.customMinPoolAgeMinutes,
          maxAgeMinutes: draft.customMaxPoolAgeMinutes,
        }),
      })) as BacktestResult;
      setBacktestResult(res);
      pushToast({ kind: 'success', title: 'Backtest Completed', body: `Evaluated ${res.evaluatedTrades} historical trades.` });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Backtest failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateSettingsDraft(draft);
    if (!validation.valid) {
      setValidationError(validation.errors[0] || 'Invalid Pro Desk settings.');
      pushToast({ kind: 'error', title: 'Validation failed', body: validation.errors[0] });
      return;
    }

    setSaving(true);
    setValidationError(null);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
      await hydrateAll();
      pushToast({ kind: 'success', title: 'Pro Desk Saved', body: 'All Pro Trader settings saved and applied successfully.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setValidationError(msg);
      pushToast({ kind: 'error', title: 'Save failed', body: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    setSaving(true);
    setValidationError(null);
    try {
      await apiFetch('/api/settings/reset', {
        method: 'POST',
        body: JSON.stringify({ scope: 'pro_desk' }),
      });
      await hydrateAll();
      pushToast({
        kind: 'success',
        title: 'Pro Desk Reset to Default',
        body: 'All Pro Trader intelligence and execution modules restored to best Quick-Profit defaults and saved.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reset defaults';
      setValidationError(msg);
      pushToast({ kind: 'error', title: 'Reset failed', body: msg });
    } finally {
      setSaving(false);
    }
  };

  const addSmartWallet = () => {
    const w = newWalletInput.trim();
    if (!w) return;
    const current = draft.smartWallets || [];
    if (current.includes(w)) return;
    updateField('smartWallets', [...current, w]);
    setNewWalletInput('');
  };

  const removeSmartWallet = (idx: number) => {
    const current = draft.smartWallets || [];
    updateField(
      'smartWallets',
      current.filter((_, i) => i !== idx)
    );
  };

  return (
    <div className="space-y-6 pb-12 max-w-[1400px] mx-auto">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
                Pro Trader Intelligence & Execution Desk
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Advanced anti-Sybil bundling protection, smart-money tracking, zero-lag WS exits, Jito dontfront MEV shield, ATA rent reclaim & What-If backtester.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleResetDefaults()}
            disabled={saving}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to Default
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-semibold text-xs transition-colors shadow-lg shadow-teal-600/20 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Pro Desk Settings'}
          </button>
        </div>
      </div>

      {validationError && (
        <div className="rounded-xl border border-rose-500/80 bg-rose-950/40 p-4 text-xs text-rose-200 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* 6 Pro Groups Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* GROUP 1: Deeper Wallet & Scam Intelligence */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <Users className="w-5 h-5 text-teal-500" />
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                Group 1 — Deeper Wallet & Scam Intelligence (Anti-Sybil & Smart Money)
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">3 Advanced Modules</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 1.1 Anti-Sybil Cluster Detection */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('antiSybilEnabled')
                  ? 'border-teal-500/40 bg-teal-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Anti-Sybil Shared-Funder Cluster
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('antiSybilEnabled')}
                    onChange={(e) => toggleOpt('antiSybilEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Detects if top early buyers were freshly created and funded from the same CEX/distributor hot wallet minutes before launch to avoid split-wallet dump bundles.
              </p>
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Fresh Wallet Window (Minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={draft.freshWalletMinutes}
                    onChange={(e) => updateField('freshWalletMinutes', Number(e.target.value))}
                    disabled={!isOptEnabled('antiSybilEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Max Shared-Funder Cluster Count
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={draft.maxSharedFunderCount}
                    onChange={(e) => updateField('maxSharedFunderCount', Number(e.target.value))}
                    disabled={!isOptEnabled('antiSybilEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 1.2 Smart Money Confluence Watchlist */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('smartMoneyEnabled')
                  ? 'border-teal-500/40 bg-teal-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Smart Money / Whale Watchlist
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('smartMoneyEnabled')}
                    onChange={(e) => toggleOpt('smartMoneyEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Prioritizes coins bought by tracked profitable KOL wallets, boosts trade size on confluence, and auto-exits instantly if they sell.
              </p>
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add Smart Wallet Pubkey…"
                    value={newWalletInput}
                    onChange={(e) => setNewWalletInput(e.target.value)}
                    disabled={!isOptEnabled('smartMoneyEnabled')}
                    className="flex-1 px-3 py-1.5 rounded-lg font-mono text-[11px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={addSmartWallet}
                    disabled={!isOptEnabled('smartMoneyEnabled')}
                    className="px-3 py-1.5 rounded-lg bg-teal-600 text-white font-bold text-xs hover:bg-teal-500 disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {(draft.smartWallets || []).map((w, idx) => (
                    <div
                      key={w}
                      className="flex items-center justify-between px-2 py-1 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[10px]"
                    >
                      <span className="truncate max-w-[170px]">{w}</span>
                      <button
                        type="button"
                        onClick={() => removeSmartWallet(idx)}
                        className="text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {(draft.smartWallets || []).length === 0 && (
                    <span className="text-[11px] text-slate-400 italic">No smart wallets added.</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">Min Confluence</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={draft.smartMoneyMinConfluence}
                      onChange={(e) => updateField('smartMoneyMinConfluence', Number(e.target.value))}
                      disabled={!isOptEnabled('smartMoneyEnabled')}
                      className="w-full px-2 py-1.5 rounded-lg font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">Size Boost %</label>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={draft.smartMoneySizeBoostPct}
                      onChange={(e) => updateField('smartMoneySizeBoostPct', Number(e.target.value))}
                      disabled={!isOptEnabled('smartMoneyEnabled')}
                      className="w-full px-2 py-1.5 rounded-lg font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={draft.smartMoneyAutoExitOnSell}
                    onChange={(e) => updateField('smartMoneyAutoExitOnSell', e.target.checked)}
                    disabled={!isOptEnabled('smartMoneyEnabled')}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-[11px] text-slate-700 dark:text-slate-300">
                    Auto-exit immediately if tracked wallet dumps
                  </span>
                </label>
              </div>
            </div>

            {/* 1.3 Reused Socials Detection */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('reusedSocialsEnabled')
                  ? 'border-teal-500/40 bg-teal-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Reused Socials Detection
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('reusedSocialsEnabled')}
                    onChange={(e) => toggleOpt('reusedSocialsEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Blocks serial ruggers recycling the same Telegram group, X/Twitter profile, or Website URL across multiple tokens under different deployer wallets.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  Max Allowed Social Reuse Count
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={draft.maxSocialReuseCount}
                  onChange={(e) => updateField('maxSocialReuseCount', Number(e.target.value))}
                  disabled={!isOptEnabled('reusedSocialsEnabled')}
                  className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </section>

        {/* GROUP 2: Zero-Lag Exits & MEV / Wallet Sweep */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <Zap className="w-5 h-5 text-amber-500" />
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                Group 2 — Zero-Lag Exits & MEV / Wallet Protection (WS Streaming & Jito Shield)
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">3 Execution Modules</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 2.1 Live WS Exit Stream */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('wsExitStreamEnabled')
                  ? 'border-amber-500/40 bg-amber-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Live WebSocket Exit Streaming
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('wsExitStreamEnabled')}
                    onChange={(e) => toggleOpt('wsExitStreamEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Subscribes directly to bought mint trades over PumpPortal WebSocket (<span className="font-mono">&lt;200ms</span>) to catch dump spikes &amp; TP wicks instantly without waiting for HTTP polling loops.
              </p>
            </div>

            {/* 2.2 Jito Sandwich Protection */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('jitoDontFrontEnabled')
                  ? 'border-amber-500/40 bg-amber-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Jito Sandwich Protection (dontfront)
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('jitoDontFrontEnabled')}
                    onChange={(e) => toggleOpt('jitoDontFrontEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Injects Jito anti-sandwich markers and block-engine tips to prevent MEV bots from front-running your trades.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  Jito Tip Amount (SOL)
                </label>
                <input
                  type="number"
                  step="0.00001"
                  min={0}
                  max={0.05}
                  value={draft.jitoTipSol}
                  onChange={(e) => updateField('jitoTipSol', Number(e.target.value))}
                  disabled={!isOptEnabled('jitoDontFrontEnabled')}
                  className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                />
              </div>
            </div>

            {/* 2.3 Orphan Token Auto-Adopter */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('orphanSweepEnabled')
                  ? 'border-amber-500/40 bg-amber-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Orphan Token Auto-Adopter
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('orphanSweepEnabled')}
                    onChange={(e) => toggleOpt('orphanSweepEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Scans wallet SPL accounts periodically so buys that timed out on RPC confirmation but succeeded on-chain are automatically adopted into live TP/SL/Trail monitoring.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleRunOrphanSweep}
                  disabled={sweepLoading || !isOptEnabled('orphanSweepEnabled')}
                  className="w-full py-2 px-3 rounded-xl bg-amber-600/20 border border-amber-500/40 hover:bg-amber-600/30 text-amber-300 font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${sweepLoading ? 'animate-spin' : ''}`} />
                  {sweepLoading ? 'Sweeping Wallet…' : 'Run Manual Orphan Sweep'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* GROUP 3: Market Structure & Entry Timing */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <TrendingDown className="w-5 h-5 text-indigo-500" />
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                Group 3 — Market Structure & Entry Timing (Migrations, Wash-Trading & SOL Regimes)
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">5 Timing Filters</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* 3.1 Post-Migration Pullback / Reclaim */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('postMigrationPullbackEnabled')
                  ? 'border-indigo-500/40 bg-indigo-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Post-Migration Pullback Reclaim
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('postMigrationPullbackEnabled')}
                    onChange={(e) => toggleOpt('postMigrationPullbackEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Waits for post-migration dump after graduation and buys the first higher-low bounce with rising volume.
              </p>
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Min Dip %</label>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={draft.migrationMinDipPct}
                    onChange={(e) => updateField('migrationMinDipPct', Number(e.target.value))}
                    disabled={!isOptEnabled('postMigrationPullbackEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Wait Secs</label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={draft.migrationWaitSec}
                    onChange={(e) => updateField('migrationWaitSec', Number(e.target.value))}
                    disabled={!isOptEnabled('postMigrationPullbackEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 3.2 Pre-Migration Bonding Curve Surge */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('preMigrationCurveEnabled')
                  ? 'border-indigo-500/40 bg-indigo-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Pre-Migration Curve Surge
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('preMigrationCurveEnabled')}
                    onChange={(e) => toggleOpt('preMigrationCurveEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Snipes bonding curves approaching graduation within specified curve completion percentage bounds.
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Min Curve %</label>
                  <input
                    type="number"
                    min={10}
                    max={99}
                    value={draft.preMigrationCurveMinPct}
                    onChange={(e) => updateField('preMigrationCurveMinPct', Number(e.target.value))}
                    disabled={!isOptEnabled('preMigrationCurveEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Max Curve %</label>
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={draft.preMigrationCurveMaxPct}
                    onChange={(e) => updateField('preMigrationCurveMaxPct', Number(e.target.value))}
                    disabled={!isOptEnabled('preMigrationCurveEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 3.3 Wash-Trading / Fake Volume Filter */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('washTradeFilterEnabled')
                  ? 'border-indigo-500/40 bg-indigo-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Wash-Trading / Fake Volume Filter
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('washTradeFilterEnabled')}
                    onChange={(e) => toggleOpt('washTradeFilterEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Checks unique buyer wallets vs total txns to filter out synthetic green candles from ping-pong bot volume.
              </p>
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Min Unique Makers Ratio
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min={0.05}
                    max={1}
                    value={draft.minUniqueMakersRatio}
                    onChange={(e) => updateField('minUniqueMakersRatio', Number(e.target.value))}
                    disabled={!isOptEnabled('washTradeFilterEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Min Unique Traders (5m)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={draft.minUniqueTraders5m}
                    onChange={(e) => updateField('minUniqueTraders5m', Number(e.target.value))}
                    disabled={!isOptEnabled('washTradeFilterEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 3.4 SOL Market Regime Filter */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('solRegimeFilterEnabled')
                  ? 'border-indigo-500/40 bg-indigo-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  SOL Market Regime ("Red Market Pause")
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('solRegimeFilterEnabled')}
                    onChange={(e) => toggleOpt('solRegimeFilterEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Automatically pauses entries or halves position size when SOL drops fast in 15 minutes.
              </p>
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    SOL 15m Drop Threshold %
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min={0.2}
                    max={25}
                    value={draft.solRegimeMaxDropPct}
                    onChange={(e) => updateField('solRegimeMaxDropPct', Number(e.target.value))}
                    disabled={!isOptEnabled('solRegimeFilterEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Action</label>
                  <select
                    value={draft.solRegimeAction}
                    onChange={(e) => updateField('solRegimeAction', e.target.value as 'pause' | 'half_size')}
                    disabled={!isOptEnabled('solRegimeFilterEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  >
                    <option value="pause">Pause New Entries</option>
                    <option value="half_size">Half Position Size</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 3.5 Anti-Top-Wick Guard */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('antiTopWickEnabled')
                  ? 'border-indigo-500/40 bg-indigo-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Anti-Top-Wick Guard
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('antiTopWickEnabled')}
                    onChange={(e) => toggleOpt('antiTopWickEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Waits for a brief pause or micro-dip if a coin pumped heavily in the last 15s instead of market-buying the absolute peak.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  Max Short Spike %
                </label>
                <input
                  type="number"
                  min={5}
                  max={500}
                  value={draft.maxShortSpikePct}
                  onChange={(e) => updateField('maxShortSpikePct', Number(e.target.value))}
                  disabled={!isOptEnabled('antiTopWickEnabled')}
                  className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </section>

        {/* GROUP 4: Dynamic Sizing & Capital Efficiency */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <Coins className="w-5 h-5 text-emerald-500" />
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                Group 4 — Dynamic Sizing & Capital Efficiency (Conviction, Streaks & Meta Caps)
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">3 Capital Modules</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 4.1 Conviction-Based Sizing */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('convictionSizingEnabled')
                  ? 'border-emerald-500/40 bg-emerald-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Conviction-Based Sizing
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('convictionSizingEnabled')}
                    onChange={(e) => toggleOpt('convictionSizingEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Risks 0.5x on unproven micro-launches and 1.5x–2x on A+ setups (deep LP, Smart Money inflow).
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Min Multiplier</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0.1}
                    max={1.5}
                    value={draft.convictionMinMult}
                    onChange={(e) => updateField('convictionMinMult', Number(e.target.value))}
                    disabled={!isOptEnabled('convictionSizingEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Max Multiplier</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0.5}
                    max={3}
                    value={draft.convictionMaxMult}
                    onChange={(e) => updateField('convictionMaxMult', Number(e.target.value))}
                    disabled={!isOptEnabled('convictionSizingEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 4.2 Drawdown / Losing-Streak Throttle */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('streakThrottleEnabled')
                  ? 'border-emerald-500/40 bg-emerald-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Drawdown / Losing-Streak Throttle
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('streakThrottleEnabled')}
                    onChange={(e) => toggleOpt('streakThrottleEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Automatically halves position size or pauses for 15–30 minutes after taking N consecutive stop-losses.
              </p>
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Streak Loss Limit</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={draft.streakLossLimit}
                    onChange={(e) => updateField('streakLossLimit', Number(e.target.value))}
                    disabled={!isOptEnabled('streakThrottleEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Cooldown (Mins)</label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={draft.streakCooldownMinutes}
                    onChange={(e) => updateField('streakCooldownMinutes', Number(e.target.value))}
                    disabled={!isOptEnabled('streakThrottleEnabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 4.3 Meta / Narrative Duplicate Cap */}
            <div
              className={`rounded-xl border p-4 space-y-4 transition-colors ${
                isOptEnabled('narrativeCapEnabled')
                  ? 'border-emerald-500/40 bg-emerald-500/[0.03]'
                  : 'border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Meta / Narrative Duplicate Cap
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOptEnabled('narrativeCapEnabled')}
                    onChange={(e) => toggleOpt('narrativeCapEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Limits concurrent open positions sharing the same keyword or ticker stem to prevent correlated meta drawdown.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  Max Same Narrative Positions
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={draft.maxSameNarrativePositions}
                  onChange={(e) => updateField('maxSameNarrativePositions', Number(e.target.value))}
                  disabled={!isOptEnabled('narrativeCapEnabled')}
                  className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </section>

        {/* GROUP 5: Hidden Profit Leaks (ATA Rent Reclaim & DEX Telemetry Scorecard) */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <Activity className="w-5 h-5 text-teal-500" />
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                Group 5 — Hidden Profit Leaks (ATA Rent Reclaim & DEX Slippage Scorecard)
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void loadRentAudit()}
              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rentLoading ? 'animate-spin' : ''}`} />
              Refresh ATA Audit
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 5.1 Empty ATA Rent Audit & Reclaim */}
            <div className="lg:col-span-1 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Empty ATA Rent Reclaim (~0.002 SOL/acc)
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Every token traded locks SOL in Associated Token Accounts. Reclaiming empty accounts puts that SOL straight back to work.
              </p>
              {rentReport ? (
                <div className="space-y-3 font-mono text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Empty ATAs:</span>
                      <span className="font-bold">{rentReport.emptyCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Dust Accounts:</span>
                      <span className="font-bold">{rentReport.dustCount}</span>
                    </div>
                    <div className="flex justify-between text-teal-600 dark:text-teal-400 font-bold pt-1 border-t border-slate-200 dark:border-slate-800">
                      <span>Reclaimable SOL:</span>
                      <span>
                        {(rentReport.emptyReclaimableSol + rentReport.dustReclaimableSol).toFixed(4)} SOL
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={burnDustEnabled}
                        onChange={(e) => setBurnDustEnabled(e.target.checked)}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-slate-700 dark:text-slate-300">
                        Include dust accounts (&lt; $0.05 value)
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleReclaimRent(burnDustEnabled)}
                      disabled={rentLoading || (rentReport.emptyCount === 0 && (!burnDustEnabled || rentReport.dustCount === 0))}
                      className="w-full py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs transition-colors disabled:opacity-50 shadow-md shadow-teal-600/20"
                    >
                      {rentLoading ? 'Processing…' : 'Reclaim All ATA Rent'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 italic">Audit report loading…</div>
              )}
            </div>

            {/* 5.2 Real Slippage & Latency Scorecard */}
            <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  DEX Slippage &amp; Latency Scorecard
                </span>
                <span className="text-xs text-slate-400 font-mono">Real vs Quoted Execution</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                      <th className="pb-2 font-medium">DEX / Platform</th>
                      <th className="pb-2 font-medium">Trades</th>
                      <th className="pb-2 font-medium">Avg Slippage</th>
                      <th className="pb-2 font-medium">Max Slippage</th>
                      <th className="pb-2 font-medium">Avg Latency</th>
                      <th className="pb-2 font-medium">Win Rate</th>
                      <th className="pb-2 font-medium">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {scorecardRows.map((row) => (
                      <tr key={`${row.dex}-${row.platform}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td className="py-2.5 font-bold text-slate-900 dark:text-slate-100 uppercase">
                          {row.dex} <span className="text-[10px] text-slate-400">({row.platform})</span>
                        </td>
                        <td className="py-2.5 tabular-nums">{row.tradeCount}</td>
                        <td className="py-2.5 tabular-nums text-amber-600 dark:text-amber-400">
                          {row.avgSlippagePct.toFixed(2)}%
                        </td>
                        <td className="py-2.5 tabular-nums text-rose-600 dark:text-rose-400">
                          {row.maxSlippagePct.toFixed(2)}%
                        </td>
                        <td className="py-2.5 tabular-nums">{row.avgLatencyMs.toFixed(0)}ms</td>
                        <td className="py-2.5 tabular-nums font-semibold text-teal-600 dark:text-teal-400">
                          {row.winRatePct.toFixed(1)}%
                        </td>
                        <td
                          className={`py-2.5 tabular-nums font-bold ${
                            row.netPnlSol >= 0 ? 'text-emerald-500' : 'text-rose-500'
                          }`}
                        >
                          {row.netPnlSol >= 0 ? '+' : ''}
                          {row.netPnlSol.toFixed(3)} SOL
                        </td>
                      </tr>
                    ))}
                    {scorecardRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-400 italic">
                          No execution telemetry recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* GROUP 6: Local What-If Strategy Backtester */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <BarChart3 className="w-5 h-5 text-purple-500" />
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                Group 6 — Local Strategy What-If Backtester
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">Historical Replay Simulator</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <form onSubmit={handleRunBacktest} className="lg:col-span-1 space-y-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
              <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 block">
                Simulation Parameters
              </span>
              <div className="space-y-3 font-mono text-xs">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Lookback Hours</label>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={backtestReq.lookbackHours}
                    onChange={(e) => setBacktestReq({ ...backtestReq, lookbackHours: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Take Profit %</label>
                    <input
                      type="number"
                      min={5}
                      max={500}
                      value={backtestReq.takeProfitPct}
                      onChange={(e) => setBacktestReq({ ...backtestReq, takeProfitPct: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Stop Loss %</label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={backtestReq.stopLossPct}
                      onChange={(e) => setBacktestReq({ ...backtestReq, stopLossPct: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-700 dark:text-slate-300">Enable Trailing Stop</span>
                  <input
                    type="checkbox"
                    checked={backtestReq.trailingEnabled}
                    onChange={(e) => setBacktestReq({ ...backtestReq, trailingEnabled: e.target.checked })}
                    className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                </div>
                {backtestReq.trailingEnabled && (
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Trailing Drop %</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={backtestReq.trailingDropPct}
                      onChange={(e) => setBacktestReq({ ...backtestReq, trailingDropPct: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                )}
                <button
                  type="submit"
                  disabled={backtestLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2 shadow-md shadow-purple-600/20 disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 ${backtestLoading ? 'animate-spin' : ''}`} />
                  {backtestLoading ? 'Running Backtest…' : 'Run Strategy Backtest'}
                </button>
              </div>
            </form>

            <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
              <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 block">
                Backtest Comparison Results
              </span>
              {backtestResult ? (
                <div className="space-y-4 font-mono text-xs">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 space-y-1">
                      <span className="text-[10px] text-slate-400 block uppercase">Sample Size</span>
                      <span className="font-bold text-sm tabular-nums">{backtestResult.sampleSize}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 space-y-1">
                      <span className="text-[10px] text-slate-400 block uppercase">Evaluated Trades</span>
                      <span className="font-bold text-sm tabular-nums">{backtestResult.evaluatedTrades}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 space-y-1">
                      <span className="text-[10px] text-slate-400 block uppercase">Filtered Out</span>
                      <span className="font-bold text-sm tabular-nums text-amber-500">
                        {backtestResult.filteredOutCount}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 space-y-1">
                      <span className="text-[10px] text-slate-400 block uppercase">Unit</span>
                      <span className="font-bold text-sm uppercase text-teal-500">{backtestResult.pnlUnit}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                      <span className="font-bold text-slate-400 block uppercase text-[10px]">Baseline Strategy</span>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Win Rate:</span>
                        <span className="font-bold tabular-nums">{backtestResult.baselineWinRatePct.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Net P&amp;L:</span>
                        <span
                          className={`font-bold tabular-nums ${
                            backtestResult.baselineNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'
                          }`}
                        >
                          {backtestResult.baselineNetPnl >= 0 ? '+' : ''}
                          {backtestResult.baselineNetPnl.toFixed(3)} {backtestResult.pnlUnit}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Max Drawdown:</span>
                        <span className="font-bold tabular-nums text-rose-500">
                          -{backtestResult.baselineMaxDrawdown.toFixed(3)} {backtestResult.pnlUnit}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/[0.03] space-y-2">
                      <span className="font-bold text-purple-400 block uppercase text-[10px]">Simulated Strategy</span>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Win Rate:</span>
                        <span className="font-bold tabular-nums text-purple-600 dark:text-purple-300">
                          {backtestResult.simulatedWinRatePct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Net P&amp;L:</span>
                        <span
                          className={`font-bold tabular-nums ${
                            backtestResult.simulatedNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'
                          }`}
                        >
                          {backtestResult.simulatedNetPnl >= 0 ? '+' : ''}
                          {backtestResult.simulatedNetPnl.toFixed(3)} {backtestResult.pnlUnit}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Max Drawdown:</span>
                        <span className="font-bold tabular-nums text-rose-500">
                          -{backtestResult.simulatedMaxDrawdown.toFixed(3)} {backtestResult.pnlUnit}
                        </span>
                      </div>
                    </div>
                  </div>

                  {backtestResult.notes.length > 0 && (
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 text-[11px] text-slate-500 space-y-1">
                      <span className="font-semibold block text-slate-700 dark:text-slate-300">Simulation Notes:</span>
                      <ul className="list-disc list-inside space-y-0.5">
                        {backtestResult.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-slate-400 italic text-xs">
                  Run a strategy backtest simulation to compare historical trade performance.
                </div>
              )}
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}
