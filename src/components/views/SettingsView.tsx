import React, { useEffect, useRef, useState } from 'react';
import { Info, Save } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import type { BotSettings, StopLossTier } from '../../types';

export function SettingsView() {
  const { settings, settingsHistory, apiFetch, hydrateAll, pushToast, status } = useBotStore();
  const [draft, setDraft] = useState<BotSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const stopLossListRef = useRef<HTMLDivElement | null>(null);
  const trailingListRef = useRef<HTMLDivElement | null>(null);

  const solUsd = status?.solPriceUsd ?? 72.21;

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!draft) {
    return <div className="text-xs text-slate-500">Loading settings…</div>;
  }

  const updateField = <K extends keyof BotSettings>(key: K, value: BotSettings[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setValidationError(null);
  };

  const addTrailingTier = () => {
    if (!draft) return;
    const current = draft.trailingLadder || [];
    const lastPeak = current.length > 0 ? current[current.length - 1].peakGainPct : 1.0;
    const nextPeak = Number((lastPeak + 1.0).toFixed(1));
    const nextDrop = Math.min(0.25, Number((nextPeak * 0.5).toFixed(2)));
    updateField('trailingLadder', [...current, { peakGainPct: nextPeak, allowedDropPct: nextDrop }]);
    setTimeout(() => {
      if (trailingListRef.current) {
        trailingListRef.current.scrollTop = trailingListRef.current.scrollHeight;
      }
    }, 0);
  };

  const removeTrailingTier = (idx: number) => {
    if (!draft) return;
    const current = draft.trailingLadder || [];
    updateField('trailingLadder', current.filter((_, i) => i !== idx));
  };

  const updateTrailingTierField = (idx: number, field: 'peakGainPct' | 'allowedDropPct', val: number) => {
    if (!draft) return;
    const current = [...(draft.trailingLadder || [])];
    current[idx] = { ...current[idx], [field]: val };
    updateField('trailingLadder', current);
  };

  const syncStopLossTiers = (nextTiers: StopLossTier[]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const validDrops = nextTiers
        .map((t) => t.triggerDropPct)
        .filter((d) => Number.isFinite(d) && d > 0);
      const maxDrop = validDrops.length > 0 ? Math.max(...validDrops) : prev.stopLossPct;
      const syncedStopLossPct = Math.max(0.5, maxDrop);
      return {
        ...prev,
        stopLossTiers: nextTiers,
        stopLossPct: syncedStopLossPct,
      };
    });
    setValidationError(null);
  };

  const addStopLossTier = () => {
    if (!draft) return;
    const current = draft.stopLossTiers || [];
    const lastDrop = current.length > 0 ? current[current.length - 1].triggerDropPct : 2.0;
    const nextDrop = Number((lastDrop + 2.0).toFixed(1));
    const nextSell = 50;
    syncStopLossTiers([...current, { triggerDropPct: nextDrop, sellPct: nextSell }]);
    setTimeout(() => {
      if (stopLossListRef.current) {
        stopLossListRef.current.scrollTop = stopLossListRef.current.scrollHeight;
      }
    }, 0);
  };

  const removeStopLossTier = (idx: number) => {
    if (!draft) return;
    const current = draft.stopLossTiers || [];
    syncStopLossTiers(current.filter((_, i) => i !== idx));
  };

  const updateStopLossTierField = (idx: number, field: 'triggerDropPct' | 'sellPct', val: number) => {
    if (!draft) return;
    const current = [...(draft.stopLossTiers || [])];
    current[idx] = { ...current[idx], [field]: val };
    syncStopLossTiers(current);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setValidationError(null);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
      await hydrateAll();
      pushToast({
        kind: 'success',
        title: 'Settings saved',
        body: 'Changes apply to new positions only.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Validation failed';
      setValidationError(msg);
      pushToast({ kind: 'error', title: 'Invalid settings', body: msg });
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async (preset: 'safe' | 'balanced' | 'aggressive') => {
    setSaving(true);
    setValidationError(null);
    try {
      await apiFetch('/api/settings/preset', {
        method: 'POST',
        body: JSON.stringify({ preset }),
      });
      await hydrateAll();
      pushToast({ kind: 'info', title: `Applied "${preset}" safety preset` });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Preset failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setSaving(false);
    }
  };

  const effectiveMaxSl =
    (draft.stopLossTiers?.length ?? 0) > 0
      ? Math.max(
          0.5,
          ...draft.stopLossTiers.map((t) => (Number.isFinite(t.triggerDropPct) ? t.triggerDropPct : 0))
        )
      : Math.max(0.5, draft.stopLossPct);

  return (
    <form onSubmit={(e) => void handleSave(e)} noValidate className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Bot &amp; Risk Settings
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Hard safety limits are enforced on both client and server.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['safe', 'balanced', 'aggressive'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={saving}
              onClick={() => void applyPreset(preset)}
              className="px-3 py-2 rounded-xl text-xs font-medium capitalize border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {preset} Preset
            </button>
          ))}
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving…' : 'Save Settings'}</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-3.5 flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
        <Info className="w-4 h-4 text-teal-500 shrink-0" />
        <span>
          <strong>Applies to new positions only:</strong> Every open position retains the exact
          stop-loss, take-profit, and trailing ladder captured when it opened.
        </span>
      </div>

      {validationError && (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-500 font-medium">
          {validationError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: Sizing -> Custom Stop-Loss Tiers -> Hard Filters */}
        <div className="space-y-6">
          {/* Risk & Sizing */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <h2 className="font-display text-sm font-bold">Position Sizing &amp; Risk Caps</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between">
                  <span>Trade Size (SOL)</span>
                  <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                    ≈ ${(draft.tradeSizeSol * solUsd).toFixed(2)} USD
                  </span>
                </span>
                <input
                  type="number"
                  step="0.005"
                  value={draft.tradeSizeSol}
                  onChange={(e) => updateField('tradeSizeSol', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between">
                  <span>Max Wallet Exposure (SOL)</span>
                  <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                    ≈ ${(draft.maxWalletExposureSol * solUsd).toFixed(2)} USD
                  </span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={draft.maxWalletExposureSol}
                  onChange={(e) => updateField('maxWalletExposureSol', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between">
                  <span>Daily Loss Limit (SOL)</span>
                  <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                    ≈ ${(draft.dailyLossLimitSol * solUsd).toFixed(2)} USD
                  </span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={draft.dailyLossLimitSol}
                  onChange={(e) => updateField('dailyLossLimitSol', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between">
                  <span>Gas Reserve (SOL)</span>
                  <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                    ≈ ${(draft.gasReserveSol * solUsd).toFixed(2)} USD
                  </span>
                </span>
                <input
                  type="number"
                  step="0.005"
                  min="0.01"
                  value={draft.gasReserveSol}
                  onChange={(e) => updateField('gasReserveSol', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Max Open Positions</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={draft.maxOpenPositions}
                  onChange={(e) => updateField('maxOpenPositions', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Re-entry Cooldown (min)</span>
                <input
                  type="number"
                  min="0"
                  value={draft.cooldownMinutes}
                  onChange={(e) => updateField('cooldownMinutes', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
            </div>
          </section>

          {/* Custom Stop-Loss Tiers (directly after Position Sizing & Risk Caps) */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold">
                  Custom Stop-Loss Tiers ({draft.stopLossTiers?.length || 0} Tiers · Unlimited)
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Max Stop: <span className="font-mono text-rose-500">-{effectiveMaxSl.toFixed(1)}%</span> · Unlimited Trigger Drop % (no upper cap)
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.stopLossEnabled}
                    onChange={(e) => updateField('stopLossEnabled', e.target.checked)}
                  />
                  <span>Enabled</span>
                </label>
                {draft.stopLossEnabled && (
                  <button
                    type="button"
                    onClick={addStopLossTier}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white"
                  >
                    + Add Stop Loss Tier
                  </button>
                )}
              </div>
            </div>

            {draft.stopLossEnabled ? (
              <div ref={stopLossListRef} className="space-y-2 max-h-80 overflow-y-auto">
                {(draft.stopLossTiers || []).map((tier, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-500 font-mono">#{idx + 1}</span>
                      <label className="flex items-center gap-1">
                        <span className="text-slate-400">Trigger Drop %:</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0.5"
                          aria-label={`Stop-loss tier ${idx + 1} trigger drop percent`}
                          value={tier.triggerDropPct}
                          onChange={(e) => updateStopLossTierField(idx, 'triggerDropPct', Number(e.target.value))}
                          className="w-20 px-2 py-1 rounded-lg font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="text-slate-400">Sell %:</span>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          max="100"
                          aria-label={`Stop-loss tier ${idx + 1} sell percent`}
                          value={tier.sellPct}
                          onChange={(e) => updateStopLossTierField(idx, 'sellPct', Number(e.target.value))}
                          className="w-20 px-2 py-1 rounded-lg font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                        />
                      </label>
                    </div>
                    <div className="flex items-center gap-3 font-mono">
                      <span className="text-rose-600 dark:text-rose-400">
                        Sell {tier.sellPct}% at -{tier.triggerDropPct.toFixed(1)}% drop
                      </span>
                      <button
                        type="button"
                        aria-label={`Delete stop-loss tier ${idx + 1}`}
                        disabled={(draft.stopLossTiers?.length || 0) <= 1}
                        onClick={() => removeStopLossTier(idx)}
                        className="px-2 py-1 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed font-sans"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-500">
                Stop-loss tiers are currently disabled in your draft. Re-enable to enforce automatic stop-loss protection.
              </p>
            )}
          </section>

          {/* Hard Filters & Security */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <h2 className="font-display text-sm font-bold">Hard Filters &amp; Security Thresholds</h2>

            {/* Custom Pool Age Timeframe Window */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3.5 space-y-3 text-xs">
              <label className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.customAgeWindowEnabled}
                  onChange={(e) => updateField('customAgeWindowEnabled', e.target.checked)}
                />
                <span>Use Custom Pool Age Timeframe (Min–Max Minutes)</span>
              </label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {draft.customAgeWindowEnabled
                  ? `Active: Bot will only search & trade coins between ${draft.customMinPoolAgeMinutes}m and ${draft.customMaxPoolAgeMinutes}m old (not newer or older).`
                  : 'Unchecked: Bot uses its default age filter (Min Pool Age >= 30m below).'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-slate-500 block">Min Coin Age (minutes)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    disabled={!draft.customAgeWindowEnabled}
                    aria-label="Custom min pool age minutes"
                    value={draft.customMinPoolAgeMinutes}
                    onChange={(e) => updateField('customMinPoolAgeMinutes', Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-50"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-500 block">Max Coin Age (minutes)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    disabled={!draft.customAgeWindowEnabled}
                    aria-label="Custom max pool age minutes"
                    value={draft.customMaxPoolAgeMinutes}
                    onChange={(e) => updateField('customMaxPoolAgeMinutes', Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-50"
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 block">Default Min Pool Age (min, &ge; 30m)</span>
                <input
                  type="number"
                  min="30"
                  disabled={draft.customAgeWindowEnabled}
                  value={draft.minPoolAgeMinutes}
                  onChange={(e) => updateField('minPoolAgeMinutes', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-50"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Min Liquidity ($)</span>
                <input
                  type="number"
                  min="10000"
                  step="1000"
                  value={draft.minLiquidityUsd}
                  onChange={(e) => updateField('minLiquidityUsd', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Max Top-10 Non-Pool Holders (%)</span>
                <input
                  type="number"
                  min="5"
                  max="50"
                  value={draft.maxTop10HoldersPct}
                  onChange={(e) => updateField('maxTop10HoldersPct', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Min Quality / Trade Score</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="50"
                    max="100"
                    value={draft.minQualityScore}
                    onChange={(e) => updateField('minQualityScore', Number(e.target.value))}
                    className="w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                  />
                  <input
                    type="number"
                    min="50"
                    max="100"
                    value={draft.minTradeScore}
                    onChange={(e) => updateField('minTradeScore', Number(e.target.value))}
                    className="w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                  />
                </div>
              </label>
            </div>
          </section>
        </div>

        {/* Right Column: Exit Rules -> Paper Shadow Simulation Realism */}
        <div className="space-y-6">
          {/* Exits */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <h2 className="font-display text-sm font-bold">
              Exit Rules (TP &ge; 1.5x Max SL)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 block">Take-Profit (%) · Unlimited</span>
                <input
                  type="number"
                  min="1.5"
                  step="0.5"
                  value={draft.takeProfitPct}
                  onChange={(e) => updateField('takeProfitPct', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
                <span className="text-[11px] text-slate-400 block">
                  Waits here if price clears all trailing tiers.
                </span>
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Max Hold Time (minutes)</span>
                <input
                  type="number"
                  min="5"
                  value={draft.maxHoldMinutes}
                  onChange={(e) => updateField('maxHoldMinutes', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Emergency Liquidity Floor ($)</span>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={draft.emergencyLiquidityFloorUsd}
                  onChange={(e) => updateField('emergencyLiquidityFloorUsd', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 pt-1 text-xs">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.trailingEnabled}
                  onChange={(e) => updateField('trailingEnabled', e.target.checked)}
                />
                <span>Stepped Trailing Ladder</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.breakEvenRecoveryEnabled}
                  onChange={(e) => updateField('breakEvenRecoveryEnabled', e.target.checked)}
                />
                <span>Break-Even Recovery Watch</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.allowSlotRotation}
                  onChange={(e) => updateField('allowSlotRotation', e.target.checked)}
                />
                <span>Slot Rotation</span>
              </label>
            </div>

            {draft.trailingEnabled && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span>Custom Stepped Trailing Exit Tiers ({draft.trailingLadder?.length || 0} Tiers · Unlimited)</span>
                  <button
                    type="button"
                    onClick={addTrailingTier}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white"
                  >
                    + Add Tier
                  </button>
                </div>
                <div ref={trailingListRef} className="space-y-2 max-h-96 overflow-y-auto">
                  {(draft.trailingLadder || []).map((tier, idx) => {
                    const lockedFloor = tier.peakGainPct - tier.allowedDropPct;
                    return (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 font-mono">#{idx + 1}</span>
                          <label className="flex items-center gap-1">
                            <span className="text-slate-400">Peak %:</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              aria-label={`Trailing tier ${idx + 1} peak percent`}
                              value={tier.peakGainPct}
                              onChange={(e) => updateTrailingTierField(idx, 'peakGainPct', Number(e.target.value))}
                              className="w-20 px-2 py-1 rounded-lg font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            <span className="text-slate-400">Allowed Drop %:</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              aria-label={`Trailing tier ${idx + 1} allowed drop percent`}
                              value={tier.allowedDropPct}
                              onChange={(e) => updateTrailingTierField(idx, 'allowedDropPct', Number(e.target.value))}
                              className="w-20 px-2 py-1 rounded-lg font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                            />
                          </label>
                        </div>
                        <div className="flex items-center gap-3 font-mono">
                          <span className="text-teal-600 dark:text-teal-400">
                            Floor: +{lockedFloor.toFixed(2)}%
                          </span>
                          <button
                            type="button"
                            aria-label={`Delete trailing tier ${idx + 1}`}
                            disabled={(draft.trailingLadder?.length || 0) <= 1}
                            onClick={() => removeTrailingTier(idx)}
                            className="px-2 py-1 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed font-sans"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Paper Realism */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <h2 className="font-display text-sm font-bold">Paper Shadow Simulation Realism</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 block">Delay Window Min / Max (sec)</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    value={draft.paperDelayMinSec}
                    onChange={(e) => updateField('paperDelayMinSec', Number(e.target.value))}
                    className="w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                  />
                  <input
                    type="number"
                    min="0"
                    value={draft.paperDelayMaxSec}
                    onChange={(e) => updateField('paperDelayMaxSec', Number(e.target.value))}
                    className="w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                  />
                </div>
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Buy / Sell Failure Chance (%)</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={draft.paperBuyFailChancePct}
                    onChange={(e) => updateField('paperBuyFailChancePct', Number(e.target.value))}
                    className="w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={draft.paperSellFailChancePct}
                    onChange={(e) => updateField('paperSellFailChancePct', Number(e.target.value))}
                    className="w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                  />
                </div>
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">&lt;24h Competition Penalty (%)</span>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={draft.paperCompetitionPenaltyPct}
                  onChange={(e) => updateField('paperCompetitionPenaltyPct', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 block">Priority Fee Preset</span>
                <select
                  value={draft.priorityFeePreset}
                  onChange={(e) =>
                    updateField('priorityFeePreset', e.target.value as BotSettings['priorityFeePreset'])
                  }
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                >
                  <option value="standard">Standard (0.0001 SOL)</option>
                  <option value="high">High (0.0005 SOL)</option>
                  <option value="ultra">Ultra (0.0015 SOL)</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      </div>

      {/* Settings Change History */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-3">
        <h2 className="font-display text-sm font-bold">Settings Audit Log</h2>
        {settingsHistory.length === 0 ? (
          <p className="text-xs text-slate-500">No settings changes recorded yet.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70 text-xs font-mono">
            {settingsHistory.slice(0, 30).map((h) => (
              <div key={h.id} className="py-2 flex items-center justify-between gap-4">
                <span>
                  <strong className="text-teal-500">{h.field}</strong>: {h.oldValue} →{' '}
                  {h.newValue}
                </span>
                <span className="text-slate-500 shrink-0">
                  {new Date(h.changedAtMs).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </form>
  );
}
