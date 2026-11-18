import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Info, Save } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import type { BotSettings, StopLossTier } from '../../types';
import { validateSettingsDraft } from '../../utils/settingsValidation';

function parseNumInput(raw: string): number {
  if (raw.trim() === '') return Number.NaN;
  return Number(raw);
}

function inputValue(val: number): string | number {
  return Number.isFinite(val) ? val : '';
}

function safeFixed(val: number, digits = 2): string {
  return (Number.isFinite(val) ? val : 0).toFixed(digits);
}

function FieldErrorPopup({
  message,
  onDismiss,
}: {
  message?: string;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="tooltip"
      className="mt-1.5 relative z-20 rounded-xl border border-rose-500/80 bg-rose-950/95 text-rose-100 px-3 py-2 text-[11px] leading-snug shadow-lg shadow-rose-950/40 flex items-start justify-between gap-2"
    >
      <span className="inline-flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
        <span>{message}</span>
      </span>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss field error"
          onClick={onDismiss}
          className="text-rose-300 hover:text-white shrink-0 font-bold leading-none px-0.5"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function SettingsView() {
  const { settings, settingsHistory, apiFetch, hydrateAll, pushToast, status } = useBotStore();
  const [draft, setDraft] = useState<BotSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [applyToOpenPositions, setApplyToOpenPositions] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const stopLossListRef = useRef<HTMLDivElement | null>(null);
  const trailingListRef = useRef<HTMLDivElement | null>(null);

  const solUsd = status?.solPriceUsd ?? 72.21;

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!draft) {
    return <div className="text-xs text-slate-500">Loading settings…</div>;
  }

  const clearFieldError = (...keys: string[]) => {
    setFieldErrors((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const k of keys) {
        if (k in next) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  const focusFirstInvalidField = (errs: Record<string, string>) => {
    const firstKey = Object.keys(errs)[0];
    if (!firstKey) return;
    setTimeout(() => {
      const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(firstKey) : firstKey;
      const el = document.querySelector<HTMLElement>(`[data-field-key="${escaped}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus?.();
      }
    }, 30);
  };

  const updateField = <K extends keyof BotSettings>(key: K, value: BotSettings[K]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      // Keep hidden maxPositionSizeSol aligned with editable Trade Size & Max Wallet Exposure
      if (key === 'tradeSizeSol' || key === 'maxWalletExposureSol') {
        const tradeSize = Number.isFinite(next.tradeSizeSol) ? next.tradeSizeSol : prev.tradeSizeSol;
        const maxExp = Number.isFinite(next.maxWalletExposureSol)
          ? next.maxWalletExposureSol
          : prev.maxWalletExposureSol;
        if (maxExp > 0 && tradeSize > 0) {
          next.maxPositionSizeSol = Math.min(maxExp, Math.max(tradeSize, prev.maxPositionSizeSol));
        }
      }
      return next;
    });
    setValidationError(null);
    clearFieldError(String(key));
  };

  const addTrailingTier = () => {
    if (!draft) return;
    const current = draft.trailingLadder || [];
    const lastPeak = current.length > 0 && Number.isFinite(current[current.length - 1].peakGainPct)
      ? current[current.length - 1].peakGainPct
      : 1.0;
    const nextPeak = Number((lastPeak + 1.0).toFixed(1));
    const nextDrop = Math.min(0.25, Number((nextPeak * 0.5).toFixed(2)));
    updateField('trailingLadder', [...current, { peakGainPct: nextPeak, allowedDropPct: nextDrop }]);
    clearFieldError('trailingEnabled');
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
    setFieldErrors((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith('trailingLadder.')) next[k] = v;
      }
      return next;
    });
  };

  const updateTrailingTierField = (idx: number, field: 'peakGainPct' | 'allowedDropPct', val: number) => {
    if (!draft) return;
    const current = [...(draft.trailingLadder || [])];
    current[idx] = { ...current[idx], [field]: val };
    updateField('trailingLadder', current);
    clearFieldError(`trailingLadder.${idx}.peakGainPct`, `trailingLadder.${idx}.allowedDropPct`);
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
    const lastDrop = current.length > 0 && Number.isFinite(current[current.length - 1].triggerDropPct)
      ? current[current.length - 1].triggerDropPct
      : 2.0;
    const nextDrop = Number((lastDrop + 2.0).toFixed(1));
    const nextSell = 50;
    syncStopLossTiers([...current, { triggerDropPct: nextDrop, sellPct: nextSell }]);
    clearFieldError('stopLossEnabled');
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
    setFieldErrors((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith('stopLossTiers.')) next[k] = v;
      }
      return next;
    });
  };

  const updateStopLossTierField = (idx: number, field: 'triggerDropPct' | 'sellPct', val: number) => {
    if (!draft) return;
    const current = [...(draft.stopLossTiers || [])];
    current[idx] = { ...current[idx], [field]: val };
    syncStopLossTiers(current);
    clearFieldError(`stopLossTiers.${idx}.${field}`);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const clientValidation = validateSettingsDraft(draft);
    if (!clientValidation.valid) {
      setFieldErrors(clientValidation.fieldErrors);
      const count = Object.keys(clientValidation.fieldErrors).length;
      const summary = `${count} setting${count === 1 ? '' : 's'} need attention — see the highlighted box${count === 1 ? '' : 'es'} below.`;
      setValidationError(summary);
      pushToast({
        kind: 'error',
        title: 'Please fix highlighted settings',
        body: clientValidation.errors[0],
      });
      focusFirstInvalidField(clientValidation.fieldErrors);
      return;
    }

    setSaving(true);
    setValidationError(null);
    setFieldErrors({});
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ ...draft, applyToOpenPositions }),
      });
      await hydrateAll();
      pushToast({
        kind: 'success',
        title: 'Settings saved',
        body: applyToOpenPositions ? 'Settings saved and synced to active positions.' : 'Changes apply to new positions only.',
      });
    } catch (err) {
      const typedErr = err as Error & { fieldErrors?: Record<string, string> };
      const msg = typedErr instanceof Error ? typedErr.message : 'Validation failed';
      setValidationError(msg);
      if (typedErr.fieldErrors && Object.keys(typedErr.fieldErrors).length > 0) {
        setFieldErrors(typedErr.fieldErrors);
        focusFirstInvalidField(typedErr.fieldErrors);
      }
      pushToast({ kind: 'error', title: 'Invalid settings', body: msg });
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async (preset: 'safe' | 'balanced' | 'aggressive' | 'quick_profit') => {
    setSaving(true);
    setValidationError(null);
    setFieldErrors({});
    try {
      await apiFetch('/api/settings/preset', {
        method: 'POST',
        body: JSON.stringify({ preset, applyToOpenPositions }),
      });
      await hydrateAll();
      pushToast({ kind: 'info', title: `Applied "${preset}" preset` });
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

  const inputClass = (fieldKey: string, extra = 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900') =>
    fieldErrors[fieldKey]
      ? `${extra} border-2 border-rose-500 ring-2 ring-rose-500/35 bg-rose-500/10 dark:bg-rose-950/30 text-rose-700 dark:text-rose-200 focus:outline-none`
      : `${extra} border border-slate-200 dark:border-slate-800`;

  const tierInputClass = (fieldKey: string, extra = 'w-20 px-2 py-1 rounded-lg font-mono') =>
    fieldErrors[fieldKey]
      ? `${extra} bg-rose-500/10 dark:bg-rose-950/40 border-2 border-rose-500 ring-2 ring-rose-500/35 text-rose-700 dark:text-rose-200 focus:outline-none`
      : `${extra} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700`;

  const hasErrorPrefix = (...prefixes: string[]) =>
    Object.keys(fieldErrors).some((k) => prefixes.some((p) => k === p || k.startsWith(`${p}.`)));

  const sectionClass = (hasErr: boolean) =>
    hasErr
      ? 'rounded-2xl border-2 border-rose-500/60 bg-white dark:bg-[#0D131F] p-5 space-y-4 shadow-sm shadow-rose-500/10'
      : 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4';

  const effectiveMaxSl =
    (draft.stopLossTiers?.length ?? 0) > 0
      ? Math.max(
          0.5,
          ...draft.stopLossTiers.map((t) => (Number.isFinite(t.triggerDropPct) ? t.triggerDropPct : 0))
        )
      : Math.max(0.5, Number.isFinite(draft.stopLossPct) ? draft.stopLossPct : 0.5);

  const sizingHasError = hasErrorPrefix(
    'tradeSizeSol',
    'maxWalletExposureSol',
    'dailyLossLimitSol',
    'gasReserveSol',
    'maxOpenPositions',
    'cooldownMinutes'
  );
  const stopLossHasError = hasErrorPrefix('stopLossEnabled', 'stopLossTiers');
  const filtersHasError = hasErrorPrefix(
    'newLaunchMinAgeSeconds',
    'newLaunchMaxAgeSeconds',
    'customMinPoolAgeMinutes',
    'customMaxPoolAgeMinutes',
    'minPoolAgeMinutes',
    'minLiquidityUsd',
    'maxTop10HoldersPct',
    'minQualityScore',
    'minTradeScore'
  );
  const exitsHasError = hasErrorPrefix(
    'takeProfitPct',
    'maxHoldMinutes',
    'emergencyLiquidityFloorUsd',
    'trailingEnabled',
    'trailingLadder'
  );
  const paperHasError = hasErrorPrefix(
    'paperDelayMinSec',
    'paperDelayMaxSec',
    'paperBuyFailChancePct',
    'paperSellFailChancePct',
    'paperCompetitionPenaltyPct'
  );

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
          <button
            type="button"
            disabled={saving}
            onClick={() => void applyPreset('quick_profit')}
            className="px-3 py-2 rounded-xl text-xs font-bold border border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
          >
            ⚡ Quick Profit Scalper
          </button>
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

      <div className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-2.5">
          <Info className="w-4 h-4 text-teal-500 shrink-0" />
          <span>
            {applyToOpenPositions
              ? 'New exit rules (SL, TP, trailing ladder) will automatically sync to currently active open positions.'
              : 'Applies to new positions only (active trades retain their entry rules).'}
          </span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-200 bg-white/70 dark:bg-slate-900/70 px-2.5 py-1 rounded-lg border border-teal-500/30">
          <input
            type="checkbox"
            checked={applyToOpenPositions}
            onChange={(e) => setApplyToOpenPositions(e.target.checked)}
          />
          <span>Apply exit rules to active open positions on save</span>
        </label>
      </div>

      {validationError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/60 bg-rose-500/10 p-3.5 text-xs text-rose-600 dark:text-rose-300 font-medium flex items-center justify-between gap-3"
        >
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{validationError}</span>
          </span>
          {Object.keys(fieldErrors).length > 0 && (
            <button
              type="button"
              onClick={() => focusFirstInvalidField(fieldErrors)}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold shrink-0"
            >
              Jump to First Error
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: Sizing -> Custom Stop-Loss Tiers -> Hard Filters */}
        <div className="space-y-6">
          {/* Risk & Sizing */}
          <section className={sectionClass(sizingHasError)}>
            <h2 className="font-display text-sm font-bold">Position Sizing &amp; Risk Caps</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between">
                  <span>Trade Size (SOL)</span>
                  <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                    ≈ ${safeFixed((Number.isFinite(draft.tradeSizeSol) ? draft.tradeSizeSol : 0) * solUsd)} USD
                  </span>
                </span>
                <input
                  type="number"
                  step="0.005"
                  data-field-key="tradeSizeSol"
                  value={inputValue(draft.tradeSizeSol)}
                  onChange={(e) => updateField('tradeSizeSol', parseNumInput(e.target.value))}
                  className={inputClass('tradeSizeSol')}
                />
                <FieldErrorPopup
                  message={fieldErrors.tradeSizeSol}
                  onDismiss={() => clearFieldError('tradeSizeSol')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between">
                  <span>Max Wallet Exposure (SOL)</span>
                  <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                    ≈ ${safeFixed((Number.isFinite(draft.maxWalletExposureSol) ? draft.maxWalletExposureSol : 0) * solUsd)} USD
                  </span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  data-field-key="maxWalletExposureSol"
                  value={inputValue(draft.maxWalletExposureSol)}
                  onChange={(e) => updateField('maxWalletExposureSol', parseNumInput(e.target.value))}
                  className={inputClass('maxWalletExposureSol')}
                />
                <FieldErrorPopup
                  message={fieldErrors.maxWalletExposureSol}
                  onDismiss={() => clearFieldError('maxWalletExposureSol')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between">
                  <span>Daily Loss Limit (SOL)</span>
                  <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                    ≈ ${safeFixed((Number.isFinite(draft.dailyLossLimitSol) ? draft.dailyLossLimitSol : 0) * solUsd)} USD
                  </span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  data-field-key="dailyLossLimitSol"
                  value={inputValue(draft.dailyLossLimitSol)}
                  onChange={(e) => updateField('dailyLossLimitSol', parseNumInput(e.target.value))}
                  className={inputClass('dailyLossLimitSol')}
                />
                <FieldErrorPopup
                  message={fieldErrors.dailyLossLimitSol}
                  onDismiss={() => clearFieldError('dailyLossLimitSol')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between">
                  <span>Gas Reserve (SOL)</span>
                  <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                    ≈ ${safeFixed((Number.isFinite(draft.gasReserveSol) ? draft.gasReserveSol : 0) * solUsd)} USD
                  </span>
                </span>
                <input
                  type="number"
                  step="0.005"
                  min="0.01"
                  data-field-key="gasReserveSol"
                  value={inputValue(draft.gasReserveSol)}
                  onChange={(e) => updateField('gasReserveSol', parseNumInput(e.target.value))}
                  className={inputClass('gasReserveSol')}
                />
                <FieldErrorPopup
                  message={fieldErrors.gasReserveSol}
                  onDismiss={() => clearFieldError('gasReserveSol')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 block">Max Open Positions</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  data-field-key="maxOpenPositions"
                  value={inputValue(draft.maxOpenPositions)}
                  onChange={(e) => updateField('maxOpenPositions', parseNumInput(e.target.value))}
                  className={inputClass('maxOpenPositions')}
                />
                <FieldErrorPopup
                  message={fieldErrors.maxOpenPositions}
                  onDismiss={() => clearFieldError('maxOpenPositions')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 block">Re-entry Cooldown (min)</span>
                <input
                  type="number"
                  min="0"
                  data-field-key="cooldownMinutes"
                  value={inputValue(draft.cooldownMinutes)}
                  onChange={(e) => updateField('cooldownMinutes', parseNumInput(e.target.value))}
                  className={inputClass('cooldownMinutes')}
                />
                <FieldErrorPopup
                  message={fieldErrors.cooldownMinutes}
                  onDismiss={() => clearFieldError('cooldownMinutes')}
                />
              </label>
            </div>
          </section>

          {/* Custom Stop-Loss Tiers (directly after Position Sizing & Risk Caps) */}
          <section className={sectionClass(stopLossHasError)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold">
                  Custom Stop-Loss Tiers ({draft.stopLossTiers?.length || 0} Tiers · Unlimited)
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Max Stop: <span className="font-mono text-rose-500">-{safeFixed(effectiveMaxSl, 1)}%</span> · Unlimited Trigger Drop % (no upper cap)
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label
                  data-field-key="stopLossEnabled"
                  tabIndex={fieldErrors.stopLossEnabled ? -1 : undefined}
                  className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg ${
                    fieldErrors.stopLossEnabled
                      ? 'border-2 border-rose-500 ring-2 ring-rose-500/35 bg-rose-500/10 text-rose-300'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
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
            <FieldErrorPopup
              message={fieldErrors.stopLossEnabled}
              onDismiss={() => clearFieldError('stopLossEnabled')}
            />

            {draft.stopLossEnabled ? (
              <div ref={stopLossListRef} className="space-y-2 max-h-80 overflow-y-auto">
                {(draft.stopLossTiers || []).map((tier, idx) => {
                  const dropKey = `stopLossTiers.${idx}.triggerDropPct`;
                  const sellKey = `stopLossTiers.${idx}.sellPct`;
                  const rowHasError = Boolean(fieldErrors[dropKey] || fieldErrors[sellKey]);
                  return (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-xl border text-xs space-y-1.5 ${
                        rowHasError
                          ? 'bg-rose-500/5 border-rose-500/70'
                          : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-500 font-mono">#{idx + 1}</span>
                          <label className="flex items-center gap-1">
                            <span className="text-slate-400">Trigger Drop %:</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0.5"
                              data-field-key={dropKey}
                              aria-label={`Stop-loss tier ${idx + 1} trigger drop percent`}
                              value={inputValue(tier.triggerDropPct)}
                              onChange={(e) =>
                                updateStopLossTierField(idx, 'triggerDropPct', parseNumInput(e.target.value))
                              }
                              className={tierInputClass(dropKey)}
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            <span className="text-slate-400">Sell %:</span>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              max="100"
                              data-field-key={sellKey}
                              aria-label={`Stop-loss tier ${idx + 1} sell percent`}
                              value={inputValue(tier.sellPct)}
                              onChange={(e) =>
                                updateStopLossTierField(idx, 'sellPct', parseNumInput(e.target.value))
                              }
                              className={tierInputClass(sellKey)}
                            />
                          </label>
                        </div>
                        <div className="flex items-center gap-3 font-mono">
                          <span className="text-rose-600 dark:text-rose-400">
                            Sell {Number.isFinite(tier.sellPct) ? tier.sellPct : 0}% at -{safeFixed(tier.triggerDropPct, 1)}% drop
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
                      <FieldErrorPopup
                        message={fieldErrors[dropKey]}
                        onDismiss={() => clearFieldError(dropKey)}
                      />
                      <FieldErrorPopup
                        message={fieldErrors[sellKey]}
                        onDismiss={() => clearFieldError(sellKey)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-amber-500">
                Stop-loss tiers are currently disabled in your draft. Re-enable to enforce automatic stop-loss protection.
              </p>
            )}
          </section>

          {/* Hard Filters & Security */}
          <section className={sectionClass(filtersHasError)}>
            <h2 className="font-display text-sm font-bold">Hard Filters &amp; Security Thresholds</h2>

            {/* New Launches Only (Brand-new coins: e.g. 5s, 10s, 1m up to 5m) */}
            <div
              className={`rounded-xl border p-3.5 space-y-3 text-xs ${
                hasErrorPrefix('newLaunchMinAgeSeconds', 'newLaunchMaxAgeSeconds')
                  ? 'border-rose-500/70 bg-rose-500/5'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60'
              }`}
            >
              <label className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.newLaunchOnlyEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateField('newLaunchOnlyEnabled', checked);
                    if (checked && draft.customAgeWindowEnabled) {
                      updateField('customAgeWindowEnabled', false);
                    }
                    clearFieldError(
                      'newLaunchMinAgeSeconds',
                      'newLaunchMaxAgeSeconds',
                      'customMinPoolAgeMinutes',
                      'customMaxPoolAgeMinutes',
                      'minPoolAgeMinutes'
                    );
                  }}
                />
                <span>New Launches Only (Brand-New Coins Window in Seconds)</span>
              </label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {draft.newLaunchOnlyEnabled
                  ? `Active: Bot searches & trades only newly launched coins between ${Number.isFinite(draft.newLaunchMinAgeSeconds) ? draft.newLaunchMinAgeSeconds : 0}s and ${Number.isFinite(draft.newLaunchMaxAgeSeconds) ? draft.newLaunchMaxAgeSeconds : 0}s (${safeFixed((Number.isFinite(draft.newLaunchMaxAgeSeconds) ? draft.newLaunchMaxAgeSeconds : 0) / 60, 1)}m) old.`
                  : 'Unchecked: Bot uses Custom Pool Age Timeframe below (if checked) or Default Min Pool Age (>= 30m).'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-slate-500 block">Min Launch Age (seconds)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    disabled={!draft.newLaunchOnlyEnabled}
                    data-field-key="newLaunchMinAgeSeconds"
                    aria-label="New launch min age seconds"
                    value={inputValue(draft.newLaunchMinAgeSeconds)}
                    onChange={(e) => updateField('newLaunchMinAgeSeconds', parseNumInput(e.target.value))}
                    className={inputClass(
                      'newLaunchMinAgeSeconds',
                      'w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 disabled:opacity-50'
                    )}
                  />
                  <FieldErrorPopup
                    message={fieldErrors.newLaunchMinAgeSeconds}
                    onDismiss={() => clearFieldError('newLaunchMinAgeSeconds')}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-500 flex items-center justify-between">
                    <span>Max Launch Age (seconds)</span>
                    <span className="font-mono text-[11px] text-teal-600 dark:text-teal-400">
                      = {safeFixed((Number.isFinite(draft.newLaunchMaxAgeSeconds) ? draft.newLaunchMaxAgeSeconds : 0) / 60, 1)}m
                    </span>
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    disabled={!draft.newLaunchOnlyEnabled}
                    data-field-key="newLaunchMaxAgeSeconds"
                    aria-label="New launch max age seconds"
                    value={inputValue(draft.newLaunchMaxAgeSeconds)}
                    onChange={(e) => updateField('newLaunchMaxAgeSeconds', parseNumInput(e.target.value))}
                    className={inputClass(
                      'newLaunchMaxAgeSeconds',
                      'w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 disabled:opacity-50'
                    )}
                  />
                  <FieldErrorPopup
                    message={fieldErrors.newLaunchMaxAgeSeconds}
                    onDismiss={() => clearFieldError('newLaunchMaxAgeSeconds')}
                  />
                </label>
              </div>
            </div>

            {/* Custom Pool Age Timeframe Window */}
            <div
              className={`rounded-xl border p-3.5 space-y-3 text-xs ${
                hasErrorPrefix('customMinPoolAgeMinutes', 'customMaxPoolAgeMinutes')
                  ? 'border-rose-500/70 bg-rose-500/5'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60'
              }`}
            >
              <label className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.customAgeWindowEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateField('customAgeWindowEnabled', checked);
                    if (checked && draft.newLaunchOnlyEnabled) {
                      updateField('newLaunchOnlyEnabled', false);
                    }
                    clearFieldError(
                      'customMinPoolAgeMinutes',
                      'customMaxPoolAgeMinutes',
                      'newLaunchMinAgeSeconds',
                      'newLaunchMaxAgeSeconds',
                      'minPoolAgeMinutes'
                    );
                  }}
                />
                <span>Use Custom Pool Age Timeframe (Min–Max Minutes)</span>
              </label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {draft.customAgeWindowEnabled
                  ? `Active: Bot will only search & trade coins between ${Number.isFinite(draft.customMinPoolAgeMinutes) ? draft.customMinPoolAgeMinutes : 0}m and ${Number.isFinite(draft.customMaxPoolAgeMinutes) ? draft.customMaxPoolAgeMinutes : 0}m old (not newer or older).`
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
                    data-field-key="customMinPoolAgeMinutes"
                    aria-label="Custom min pool age minutes"
                    value={inputValue(draft.customMinPoolAgeMinutes)}
                    onChange={(e) => updateField('customMinPoolAgeMinutes', parseNumInput(e.target.value))}
                    className={inputClass(
                      'customMinPoolAgeMinutes',
                      'w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 disabled:opacity-50'
                    )}
                  />
                  <FieldErrorPopup
                    message={fieldErrors.customMinPoolAgeMinutes}
                    onDismiss={() => clearFieldError('customMinPoolAgeMinutes')}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-500 block">Max Coin Age (minutes)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    disabled={!draft.customAgeWindowEnabled}
                    data-field-key="customMaxPoolAgeMinutes"
                    aria-label="Custom max pool age minutes"
                    value={inputValue(draft.customMaxPoolAgeMinutes)}
                    onChange={(e) => updateField('customMaxPoolAgeMinutes', parseNumInput(e.target.value))}
                    className={inputClass(
                      'customMaxPoolAgeMinutes',
                      'w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 disabled:opacity-50'
                    )}
                  />
                  <FieldErrorPopup
                    message={fieldErrors.customMaxPoolAgeMinutes}
                    onDismiss={() => clearFieldError('customMaxPoolAgeMinutes')}
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
                  disabled={draft.customAgeWindowEnabled || draft.newLaunchOnlyEnabled}
                  data-field-key="minPoolAgeMinutes"
                  value={inputValue(draft.minPoolAgeMinutes)}
                  onChange={(e) => updateField('minPoolAgeMinutes', parseNumInput(e.target.value))}
                  className={inputClass(
                    'minPoolAgeMinutes',
                    'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-50'
                  )}
                />
                <FieldErrorPopup
                  message={fieldErrors.minPoolAgeMinutes}
                  onDismiss={() => clearFieldError('minPoolAgeMinutes')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 block">Min Liquidity ($) · Unlimited</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  data-field-key="minLiquidityUsd"
                  value={inputValue(draft.minLiquidityUsd)}
                  onChange={(e) => updateField('minLiquidityUsd', parseNumInput(e.target.value))}
                  className={inputClass('minLiquidityUsd')}
                />
                <span className="text-[11px] text-slate-400 block">
                  Any amount from $0 (e.g. $0, $1, $300, $1,000,000); emergency floor auto-scales.
                </span>
                <FieldErrorPopup
                  message={fieldErrors.minLiquidityUsd}
                  onDismiss={() => clearFieldError('minLiquidityUsd')}
                />
              </label>

              <div className="space-y-1.5">
                <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enforceMaxTop10Holders}
                    onChange={(e) => {
                      updateField('enforceMaxTop10Holders', e.target.checked);
                      clearFieldError('maxTop10HoldersPct');
                    }}
                  />
                  <span>Max Top-10 Non-Pool Holders (%)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  disabled={!draft.enforceMaxTop10Holders}
                  data-field-key="maxTop10HoldersPct"
                  aria-label="Max Top-10 Non-Pool Holders (%)"
                  value={inputValue(draft.maxTop10HoldersPct)}
                  onChange={(e) => updateField('maxTop10HoldersPct', parseNumInput(e.target.value))}
                  className={inputClass(
                    'maxTop10HoldersPct',
                    'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-50'
                  )}
                />
                <span className="text-[11px] text-slate-400 block">
                  {draft.enforceMaxTop10Holders
                    ? 'Checked: Enforces Top-10 non-pool holder limit.'
                    : 'Unchecked: Top-10 non-pool holder % rule is disabled.'}
                </span>
                <FieldErrorPopup
                  message={fieldErrors.maxTop10HoldersPct}
                  onDismiss={() => clearFieldError('maxTop10HoldersPct')}
                />
              </div>

              <div className="space-y-1.5">
                <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enforceMinScores}
                    onChange={(e) => {
                      updateField('enforceMinScores', e.target.checked);
                      clearFieldError('minQualityScore', 'minTradeScore');
                    }}
                  />
                  <span>Min Quality / Trade Score</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="50"
                    max="100"
                    disabled={!draft.enforceMinScores}
                    data-field-key="minQualityScore"
                    aria-label="Min Quality Score"
                    value={inputValue(draft.minQualityScore)}
                    onChange={(e) => updateField('minQualityScore', parseNumInput(e.target.value))}
                    className={inputClass(
                      'minQualityScore',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-50'
                    )}
                  />
                  <input
                    type="number"
                    min="50"
                    max="100"
                    disabled={!draft.enforceMinScores}
                    data-field-key="minTradeScore"
                    aria-label="Min Trade Score"
                    value={inputValue(draft.minTradeScore)}
                    onChange={(e) => updateField('minTradeScore', parseNumInput(e.target.value))}
                    className={inputClass(
                      'minTradeScore',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-50'
                    )}
                  />
                </div>
                <span className="text-[11px] text-slate-400 block">
                  {draft.enforceMinScores
                    ? 'Checked: Enforces minimum Quality & Trade score thresholds.'
                    : 'Unchecked: Minimum Quality / Trade score rule is disabled.'}
                </span>
                <FieldErrorPopup
                  message={fieldErrors.minQualityScore}
                  onDismiss={() => clearFieldError('minQualityScore')}
                />
                <FieldErrorPopup
                  message={fieldErrors.minTradeScore}
                  onDismiss={() => clearFieldError('minTradeScore')}
                />
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Exit Rules -> Paper Shadow Simulation Realism */}
        <div className="space-y-6">
          {/* Exits */}
          <section className={sectionClass(exitsHasError)}>
            <h2 className="font-display text-sm font-bold">
              Exit Rules
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 block">Take-Profit (%) · Unlimited</span>
                <input
                  type="number"
                  min="1.5"
                  step="0.5"
                  data-field-key="takeProfitPct"
                  value={inputValue(draft.takeProfitPct)}
                  onChange={(e) => updateField('takeProfitPct', parseNumInput(e.target.value))}
                  className={inputClass('takeProfitPct')}
                />
                <span className="text-[11px] text-slate-400 block">
                  {draft.trailingEnabled
                    ? 'Waits here if price clears all trailing tiers.'
                    : 'Trailing ladder disabled — exits directly at this Take-Profit %.'}
                </span>
                <FieldErrorPopup
                  message={fieldErrors.takeProfitPct}
                  onDismiss={() => clearFieldError('takeProfitPct')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 block">Max Hold Time (minutes)</span>
                <input
                  type="number"
                  min="5"
                  data-field-key="maxHoldMinutes"
                  value={inputValue(draft.maxHoldMinutes)}
                  onChange={(e) => updateField('maxHoldMinutes', parseNumInput(e.target.value))}
                  className={inputClass('maxHoldMinutes')}
                />
                <FieldErrorPopup
                  message={fieldErrors.maxHoldMinutes}
                  onDismiss={() => clearFieldError('maxHoldMinutes')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 block">Emergency Liquidity Floor ($)</span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  data-field-key="emergencyLiquidityFloorUsd"
                  value={inputValue(draft.emergencyLiquidityFloorUsd)}
                  onChange={(e) => updateField('emergencyLiquidityFloorUsd', parseNumInput(e.target.value))}
                  className={inputClass('emergencyLiquidityFloorUsd')}
                />
                <FieldErrorPopup
                  message={fieldErrors.emergencyLiquidityFloorUsd}
                  onDismiss={() => clearFieldError('emergencyLiquidityFloorUsd')}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-4 pt-1 text-xs">
              <label
                data-field-key="trailingEnabled"
                tabIndex={fieldErrors.trailingEnabled ? -1 : undefined}
                className={`inline-flex items-center gap-2 px-2 py-1 rounded-lg ${
                  fieldErrors.trailingEnabled
                    ? 'border-2 border-rose-500 ring-2 ring-rose-500/35 bg-rose-500/10 text-rose-300'
                    : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={draft.trailingEnabled}
                  onChange={(e) => updateField('trailingEnabled', e.target.checked)}
                />
                <span>Stepped Trailing Ladder</span>
              </label>
              <label className="inline-flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={draft.breakEvenRecoveryEnabled}
                  onChange={(e) => updateField('breakEvenRecoveryEnabled', e.target.checked)}
                />
                <span>Break-Even Recovery Watch</span>
              </label>
              <label className="inline-flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={draft.allowSlotRotation}
                  onChange={(e) => updateField('allowSlotRotation', e.target.checked)}
                />
                <span>Slot Rotation</span>
              </label>
              <label className="inline-flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={draft.autoReclaimRent}
                  onChange={(e) => updateField('autoReclaimRent', e.target.checked)}
                />
                <span>Auto-Reclaim ATA Rent on 100% Sell (+0.00204 SOL)</span>
              </label>
            </div>
            <FieldErrorPopup
              message={fieldErrors.trailingEnabled}
              onDismiss={() => clearFieldError('trailingEnabled')}
            />

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
                    const peakKey = `trailingLadder.${idx}.peakGainPct`;
                    const dropKey = `trailingLadder.${idx}.allowedDropPct`;
                    const rowHasError = Boolean(fieldErrors[peakKey] || fieldErrors[dropKey]);
                    const lockedFloor =
                      (Number.isFinite(tier.peakGainPct) ? tier.peakGainPct : 0) -
                      (Number.isFinite(tier.allowedDropPct) ? tier.allowedDropPct : 0);
                    return (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl border text-xs space-y-1.5 ${
                          rowHasError
                            ? 'bg-rose-500/5 dark:bg-rose-950/20 border-rose-500/70'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 font-mono">#{idx + 1}</span>
                            <label className="flex items-center gap-1">
                              <span className="text-slate-400">Peak %:</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0.1"
                                data-field-key={peakKey}
                                aria-label={`Trailing tier ${idx + 1} peak percent`}
                                value={inputValue(tier.peakGainPct)}
                                onChange={(e) =>
                                  updateTrailingTierField(idx, 'peakGainPct', parseNumInput(e.target.value))
                                }
                                className={tierInputClass(
                                  peakKey,
                                  'w-20 px-2 py-1 rounded-lg font-mono'
                                )}
                              />
                            </label>
                            <label className="flex items-center gap-1">
                              <span className="text-slate-400">Allowed Drop %:</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                data-field-key={dropKey}
                                aria-label={`Trailing tier ${idx + 1} allowed drop percent`}
                                value={inputValue(tier.allowedDropPct)}
                                onChange={(e) =>
                                  updateTrailingTierField(idx, 'allowedDropPct', parseNumInput(e.target.value))
                                }
                                className={tierInputClass(
                                  dropKey,
                                  'w-20 px-2 py-1 rounded-lg font-mono'
                                )}
                              />
                            </label>
                          </div>
                          <div className="flex items-center gap-3 font-mono">
                            <span className="text-teal-600 dark:text-teal-400">
                              Floor: +{safeFixed(lockedFloor, 2)}%
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
                        <FieldErrorPopup
                          message={fieldErrors[peakKey]}
                          onDismiss={() => clearFieldError(peakKey)}
                        />
                        <FieldErrorPopup
                          message={fieldErrors[dropKey]}
                          onDismiss={() => clearFieldError(dropKey)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Paper Realism */}
          <section className={sectionClass(paperHasError)}>
            <h2 className="font-display text-sm font-bold">Paper Shadow Simulation Realism</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 block">Delay Window Min / Max (sec)</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    data-field-key="paperDelayMinSec"
                    aria-label="Paper delay min seconds"
                    value={inputValue(draft.paperDelayMinSec)}
                    onChange={(e) => updateField('paperDelayMinSec', parseNumInput(e.target.value))}
                    className={inputClass(
                      'paperDelayMinSec',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900'
                    )}
                  />
                  <input
                    type="number"
                    min="0"
                    data-field-key="paperDelayMaxSec"
                    aria-label="Paper delay max seconds"
                    value={inputValue(draft.paperDelayMaxSec)}
                    onChange={(e) => updateField('paperDelayMaxSec', parseNumInput(e.target.value))}
                    className={inputClass(
                      'paperDelayMaxSec',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900'
                    )}
                  />
                </div>
                <FieldErrorPopup
                  message={fieldErrors.paperDelayMinSec}
                  onDismiss={() => clearFieldError('paperDelayMinSec')}
                />
                <FieldErrorPopup
                  message={fieldErrors.paperDelayMaxSec}
                  onDismiss={() => clearFieldError('paperDelayMaxSec')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 block">Buy / Sell Failure Chance (%)</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    data-field-key="paperBuyFailChancePct"
                    aria-label="Paper buy failure chance percent"
                    value={inputValue(draft.paperBuyFailChancePct)}
                    onChange={(e) => updateField('paperBuyFailChancePct', parseNumInput(e.target.value))}
                    className={inputClass(
                      'paperBuyFailChancePct',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900'
                    )}
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    data-field-key="paperSellFailChancePct"
                    aria-label="Paper sell failure chance percent"
                    value={inputValue(draft.paperSellFailChancePct)}
                    onChange={(e) => updateField('paperSellFailChancePct', parseNumInput(e.target.value))}
                    className={inputClass(
                      'paperSellFailChancePct',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900'
                    )}
                  />
                </div>
                <FieldErrorPopup
                  message={fieldErrors.paperBuyFailChancePct}
                  onDismiss={() => clearFieldError('paperBuyFailChancePct')}
                />
                <FieldErrorPopup
                  message={fieldErrors.paperSellFailChancePct}
                  onDismiss={() => clearFieldError('paperSellFailChancePct')}
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 block">&lt;24h Competition Penalty (%)</span>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  data-field-key="paperCompetitionPenaltyPct"
                  value={inputValue(draft.paperCompetitionPenaltyPct)}
                  onChange={(e) => updateField('paperCompetitionPenaltyPct', parseNumInput(e.target.value))}
                  className={inputClass('paperCompetitionPenaltyPct')}
                />
                <FieldErrorPopup
                  message={fieldErrors.paperCompetitionPenaltyPct}
                  onDismiss={() => clearFieldError('paperCompetitionPenaltyPct')}
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
                  <option value="auto">Auto · Live Jupiter / Network (Adaptive)</option>
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
