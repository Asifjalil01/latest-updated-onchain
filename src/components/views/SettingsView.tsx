import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Info, Save } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { HoverTip, InfoTooltip } from '../ui/Primitives';
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

  const isOptEnabled = (key: string) => draft.optionToggles?.[key] !== false;

  const setOptEnabled = (key: string, enabled: boolean, ...errorKeysToClear: string[]) => {
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
    clearFieldError(key, ...errorKeysToClear);
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
    // 'gasReserveSol',
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
    'minTradeScore',
    'maxCreatorLaunches',
    'maxCreatorRuggedCoins',
    'creatorFastRugWindowMinutes'
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
          <HoverTip text="Fast scalping preset: 0.10 SOL size, strict 5m/1h momentum filters, -4% SL, +12% TP, tight 3%–12% trailing profit lock, ATA rent auto-reclaim ON, and low-friction Paper realism.">
            <button
              type="button"
              disabled={saving}
              onClick={() => void applyPreset('quick_profit')}
              className="px-3 py-2 rounded-xl text-xs font-bold border border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
            >
              ⚡ Quick Profit Scalper
            </button>
          </HoverTip>
          {(['safe', 'balanced', 'aggressive'] as const).map((preset) => {
            const presetTip =
              preset === 'safe'
                ? 'Conservative preset: mature pools (>=120m), $50K+ liquidity, Q>=82/T>=75, -6% SL, +15% TP.'
                : preset === 'balanced'
                  ? 'Default balanced preset: 30m+ pools, $25K+ liquidity, Q>=60/T>=55, -8% SL, +18% TP, 13-tier profit lock.'
                  : 'Higher-risk preset: 0.05 SOL trades, up to 4 open slots, -12% SL, +24% TP.';
            return (
              <HoverTip key={preset} text={presetTip}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void applyPreset(preset)}
                  className="px-3 py-2 rounded-xl text-xs font-medium capitalize border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {preset} Preset
                </button>
              </HoverTip>
            );
          })}
          <HoverTip text="Validate and save all draft settings to SQLite (and sync active positions if checked below).">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving…' : 'Save Settings'}</span>
            </button>
          </HoverTip>
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
        <HoverTip text="When checked, clicking Save Settings updates Stop-Loss, Take-Profit, and Trailing Ladder on every currently open position immediately.">
          <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-200 bg-white/70 dark:bg-slate-900/70 px-2.5 py-1 rounded-lg border border-teal-500/30">
            <input
              type="checkbox"
              checked={applyToOpenPositions}
              onChange={(e) => setApplyToOpenPositions(e.target.checked)}
            />
            <span>Apply exit rules to active open positions on save</span>
          </label>
        </HoverTip>
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold flex items-center">
                <span>Position Sizing &amp; Risk Caps</span>
                <InfoTooltip text="Controls how much SOL is risked per trade, total concurrent open capital, daily stop-buying cap, and SOL reserved for transaction fees." />
              </h2>
            </div>
            {!draft.autoReclaimRent && Number.isFinite(draft.tradeSizeSol) && draft.tradeSizeSol <= 0.1 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>Rent Drag Warning:</strong> With Auto-Reclaim ATA Rent unchecked, a{' '}
                  <span className="font-mono">{safeFixed(draft.tradeSizeSol * 0.4, 3)} SOL</span> meme trade pays{' '}
                  <span className="font-mono">0.00204 SOL</span> (~
                  {safeFixed((0.00203928 / Math.max(0.005, draft.tradeSizeSol * 0.4)) * 100, 1)}%) in ATA rent on entry, starting Net P&amp;L deep in red.
                </span>
                <button
                  type="button"
                  onClick={() => updateField('autoReclaimRent', true)}
                  className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold shrink-0"
                >
                  Enable Rent Reclaim
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('tradeSizeSol')}
                      onChange={(e) => setOptEnabled('tradeSizeSol', e.target.checked, 'tradeSizeSol')}
                    />
                    <HoverTip text="Base SOL amount allocated per buy (scaled by token class). Uncheck to ignore custom trade size and use default safe minimum.">
                      <span className={`cursor-help ${!isOptEnabled('tradeSizeSol') ? 'line-through opacity-60' : ''}`}>
                        Trade Size (SOL)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('tradeSizeSol') ? (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  ) : (
                    <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                      ≈ ${safeFixed((Number.isFinite(draft.tradeSizeSol) ? draft.tradeSizeSol : 0) * solUsd)} USD
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  step="0.005"
                  disabled={!isOptEnabled('tradeSizeSol')}
                  data-field-key="tradeSizeSol"
                  aria-label="Trade Size (SOL)"
                  value={inputValue(draft.tradeSizeSol)}
                  onChange={(e) => updateField('tradeSizeSol', parseNumInput(e.target.value))}
                  className={inputClass('tradeSizeSol', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <FieldErrorPopup
                  message={fieldErrors.tradeSizeSol}
                  onDismiss={() => clearFieldError('tradeSizeSol')}
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('maxWalletExposureSol')}
                      onChange={(e) => setOptEnabled('maxWalletExposureSol', e.target.checked, 'maxWalletExposureSol', 'tradeSizeSol')}
                    />
                    <HoverTip text="Maximum total SOL allowed across all open positions combined. Uncheck to disable this cap.">
                      <span className={`cursor-help ${!isOptEnabled('maxWalletExposureSol') ? 'line-through opacity-60' : ''}`}>
                        Max Wallet Exposure (SOL)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('maxWalletExposureSol') ? (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  ) : (
                    <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                      ≈ ${safeFixed((Number.isFinite(draft.maxWalletExposureSol) ? draft.maxWalletExposureSol : 0) * solUsd)} USD
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  step="0.01"
                  disabled={!isOptEnabled('maxWalletExposureSol')}
                  data-field-key="maxWalletExposureSol"
                  aria-label="Max Wallet Exposure (SOL)"
                  value={inputValue(draft.maxWalletExposureSol)}
                  onChange={(e) => updateField('maxWalletExposureSol', parseNumInput(e.target.value))}
                  className={inputClass('maxWalletExposureSol', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <FieldErrorPopup
                  message={fieldErrors.maxWalletExposureSol}
                  onDismiss={() => clearFieldError('maxWalletExposureSol')}
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('dailyLossLimitSol')}
                      onChange={(e) => setOptEnabled('dailyLossLimitSol', e.target.checked, 'dailyLossLimitSol')}
                    />
                    <HoverTip text="Circuit-breaker cap: if net realized losses today reach this SOL amount, the bot halts all new buys until tomorrow. Uncheck to disable.">
                      <span className={`cursor-help ${!isOptEnabled('dailyLossLimitSol') ? 'line-through opacity-60' : ''}`}>
                        Daily Loss Limit (SOL)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('dailyLossLimitSol') ? (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  ) : (
                    <span className="font-mono text-teal-600 dark:text-teal-400 font-semibold">
                      ≈ ${safeFixed((Number.isFinite(draft.dailyLossLimitSol) ? draft.dailyLossLimitSol : 0) * solUsd)} USD
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  step="0.01"
                  disabled={!isOptEnabled('dailyLossLimitSol')}
                  data-field-key="dailyLossLimitSol"
                  aria-label="Daily Loss Limit (SOL)"
                  value={inputValue(draft.dailyLossLimitSol)}
                  onChange={(e) => updateField('dailyLossLimitSol', parseNumInput(e.target.value))}
                  className={inputClass('dailyLossLimitSol', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <FieldErrorPopup
                  message={fieldErrors.dailyLossLimitSol}
                  onDismiss={() => clearFieldError('dailyLossLimitSol')}
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('maxOpenPositions')}
                      onChange={(e) => setOptEnabled('maxOpenPositions', e.target.checked, 'maxOpenPositions')}
                    />
                    <HoverTip text="Maximum number of different tokens held open at the same time (1–10). Uncheck to remove the max-slot cap.">
                      <span className={`cursor-help ${!isOptEnabled('maxOpenPositions') ? 'line-through opacity-60' : ''}`}>
                        Max Open Positions
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('maxOpenPositions') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  disabled={!isOptEnabled('maxOpenPositions')}
                  data-field-key="maxOpenPositions"
                  aria-label="Max Open Positions"
                  value={inputValue(draft.maxOpenPositions)}
                  onChange={(e) => updateField('maxOpenPositions', parseNumInput(e.target.value))}
                  className={inputClass('maxOpenPositions', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <FieldErrorPopup
                  message={fieldErrors.maxOpenPositions}
                  onDismiss={() => clearFieldError('maxOpenPositions')}
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('cooldownMinutes')}
                      onChange={(e) => setOptEnabled('cooldownMinutes', e.target.checked, 'cooldownMinutes')}
                    />
                    <HoverTip text="Waiting period (in minutes) before the bot is allowed to buy the same token mint again after closing it. Uncheck to disable cooldown.">
                      <span className={`cursor-help ${!isOptEnabled('cooldownMinutes') ? 'line-through opacity-60' : ''}`}>
                        Re-entry Cooldown (min)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('cooldownMinutes') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min="0"
                  disabled={!isOptEnabled('cooldownMinutes')}
                  data-field-key="cooldownMinutes"
                  aria-label="Re-entry Cooldown (min)"
                  value={inputValue(draft.cooldownMinutes)}
                  onChange={(e) => updateField('cooldownMinutes', parseNumInput(e.target.value))}
                  className={inputClass('cooldownMinutes', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <FieldErrorPopup
                  message={fieldErrors.cooldownMinutes}
                  onDismiss={() => clearFieldError('cooldownMinutes')}
                />
              </div>
            </div>
          </section>

          {/* Custom Stop-Loss Tiers (directly after Position Sizing & Risk Caps) */}
          <section className={sectionClass(stopLossHasError)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold flex items-center">
                  <span>Custom Stop-Loss Tiers ({draft.stopLossTiers?.length || 0} Tiers · Unlimited)</span>
                  <InfoTooltip text="Automatically sells the specified % of your position if price drops by Trigger Drop % below your entry price. Uncheck Enabled to disable stop-loss exits." />
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Max Stop: <span className="font-mono text-rose-500">-{safeFixed(effectiveMaxSl, 1)}%</span> · Unlimited Trigger Drop % (no upper cap)
                </p>
              </div>
              <div className="flex items-center gap-3">
                <HoverTip text="Toggle automatic stop-loss protection on or off.">
                  <label
                    data-field-key="stopLossEnabled"
                    tabIndex={fieldErrors.stopLossEnabled ? -1 : undefined}
                    className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg cursor-pointer ${
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
                </HoverTip>
                {draft.stopLossEnabled && (
                  <HoverTip text="Append another partial or full stop-loss tier.">
                    <button
                      type="button"
                      onClick={addStopLossTier}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white"
                    >
                      + Add Stop Loss Tier
                    </button>
                  </HoverTip>
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
            <h2 className="font-display text-sm font-bold flex items-center">
              <span>Hard Filters &amp; Security Thresholds</span>
              <InfoTooltip text="Gatekeeper filters every discovered token must pass before entering Security, Scoring, and Buy execution." />
            </h2>

            {/* New Launches Only (Brand-new coins: e.g. 5s, 10s, 1m up to 5m) */}
            <div
              className={`rounded-xl border p-3.5 space-y-3 text-xs ${
                hasErrorPrefix('newLaunchMinAgeSeconds', 'newLaunchMaxAgeSeconds')
                  ? 'border-rose-500/70 bg-rose-500/5'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60'
              }`}
            >
              <HoverTip text="Enable to snipe brand-new token pools within a strict age window measured in seconds (e.g., 5s to 300s). Automatically overrides Custom & Default pool age rules.">
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
              </HoverTip>
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
                <HoverTip text="Enable to restrict trades to pools within an exact minute age range (e.g., 5m to 30m old).">
                  <span>Use Custom Pool Age Timeframe (Min–Max Minutes)</span>
                </HoverTip>
              </label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {draft.customAgeWindowEnabled
                  ? `Active: Bot will only search & trade coins between ${Number.isFinite(draft.customMinPoolAgeMinutes) ? draft.customMinPoolAgeMinutes : 0}m and ${Number.isFinite(draft.customMaxPoolAgeMinutes) ? draft.customMaxPoolAgeMinutes : 0}m old (not newer or older).`
                  : 'Unchecked: Bot uses its default age filter (Min Pool Age >= 30m below).'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-slate-500 flex items-center justify-between">
                    <span>Min Coin Age (minutes)</span>
                    {Number.isFinite(draft.customMinPoolAgeMinutes) && draft.customMinPoolAgeMinutes >= 60 && (
                      <span className="font-mono text-[11px] text-teal-600 dark:text-teal-400">
                        = {safeFixed(draft.customMinPoolAgeMinutes / 60, 1)}h
                      </span>
                    )}
                  </span>
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
                  <span className="text-slate-500 flex items-center justify-between">
                    <span>Max Coin Age (minutes)</span>
                    {Number.isFinite(draft.customMaxPoolAgeMinutes) && draft.customMaxPoolAgeMinutes >= 60 && (
                      <span className="font-mono text-[11px] text-teal-600 dark:text-teal-400">
                        = {safeFixed(draft.customMaxPoolAgeMinutes / 60, 1)}h
                      </span>
                    )}
                  </span>
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
              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('minPoolAgeMinutes')}
                      onChange={(e) => setOptEnabled('minPoolAgeMinutes', e.target.checked, 'minPoolAgeMinutes')}
                    />
                    <HoverTip text="Minimum age of a liquidity pool (at least 30 minutes) required when Custom Age Window and New Launches Only are unchecked. Uncheck to ignore min pool age.">
                      <span className={`cursor-help ${!isOptEnabled('minPoolAgeMinutes') ? 'line-through opacity-60' : ''}`}>
                        Default Min Pool Age (min, &ge; 30m)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('minPoolAgeMinutes') ? (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  ) : Number.isFinite(draft.minPoolAgeMinutes) && draft.minPoolAgeMinutes >= 60 ? (
                    <span className="font-mono text-[11px] text-teal-600 dark:text-teal-400">
                      = {safeFixed(draft.minPoolAgeMinutes / 60, 1)}h
                    </span>
                  ) : null}
                </span>
                <input
                  type="number"
                  min="30"
                  disabled={!isOptEnabled('minPoolAgeMinutes') || draft.customAgeWindowEnabled || draft.newLaunchOnlyEnabled}
                  data-field-key="minPoolAgeMinutes"
                  aria-label="Default Min Pool Age (min)"
                  value={inputValue(draft.minPoolAgeMinutes)}
                  onChange={(e) => updateField('minPoolAgeMinutes', parseNumInput(e.target.value))}
                  className={inputClass(
                    'minPoolAgeMinutes',
                    'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40'
                  )}
                />
                <FieldErrorPopup
                  message={fieldErrors.minPoolAgeMinutes}
                  onDismiss={() => clearFieldError('minPoolAgeMinutes')}
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('minLiquidityUsd')}
                      onChange={(e) => setOptEnabled('minLiquidityUsd', e.target.checked, 'minLiquidityUsd')}
                    />
                    <HoverTip text="Minimum USD liquidity required in the token's DEX pool. Uncheck to disable minimum liquidity filtering.">
                      <span className={`cursor-help ${!isOptEnabled('minLiquidityUsd') ? 'line-through opacity-60' : ''}`}>
                        Min Liquidity ($) · Unlimited
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('minLiquidityUsd') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={!isOptEnabled('minLiquidityUsd')}
                  data-field-key="minLiquidityUsd"
                  aria-label="Min Liquidity ($)"
                  value={inputValue(draft.minLiquidityUsd)}
                  onChange={(e) => updateField('minLiquidityUsd', parseNumInput(e.target.value))}
                  className={inputClass(
                    'minLiquidityUsd',
                    'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40'
                  )}
                />
                <span className="text-[11px] text-slate-400 block">
                  {isOptEnabled('minLiquidityUsd')
                    ? 'Any amount from $0 (e.g. $0, $1, $300, $1,000,000); emergency floor auto-scales.'
                    : 'Unchecked: Minimum liquidity threshold is disabled.'}
                </span>
                <FieldErrorPopup
                  message={fieldErrors.minLiquidityUsd}
                  onDismiss={() => clearFieldError('minLiquidityUsd')}
                />
              </div>

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
                  <HoverTip text="Blocks tokens where the top 10 non-pool wallets hold more than this % of supply (prevents whale dumps). Uncheck to disable this gate.">
                    <span className="cursor-help">Max Top-10 Non-Pool Holders (%)</span>
                  </HoverTip>
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
                  <HoverTip text="Requires tokens to meet both Minimum Quality Score (left box: safety, liquidity, holders) and Minimum Trade Score (right box: momentum & buy pressure). Uncheck to bypass the score gate completely.">
                    <span className="cursor-help">Min Quality / Trade Score</span>
                  </HoverTip>
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

            {/* Owner / Creator History & Fast-Rug Speed Check */}
            <div
              className={`rounded-xl border p-3.5 space-y-3 text-xs ${
                hasErrorPrefix('maxCreatorLaunches', 'maxCreatorRuggedCoins', 'creatorFastRugWindowMinutes')
                  ? 'border-rose-500/70 bg-rose-500/5'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60'
              }`}
            >
              <HoverTip text="Inspects the coin creator/deployer wallet before buying: checks how many coins they previously launched, how many rugged, and how fast (minutes) they pulled liquidity so serial fast-ruggers are blocked.">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.creatorHistoryEnabled ?? true}
                    onChange={(e) => {
                      updateField('creatorHistoryEnabled', e.target.checked);
                      clearFieldError('maxCreatorLaunches', 'maxCreatorRuggedCoins', 'creatorFastRugWindowMinutes');
                    }}
                  />
                  <span>Owner / Creator Launch &amp; Rugpull Speed Check</span>
                </label>
              </HoverTip>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {(draft.creatorHistoryEnabled ?? true)
                  ? 'Active: Inspects deployer wallet launch count, prior rugged coins, and minutes-to-rug speed before buying.'
                  : 'Unchecked: Creator launch history & fast-rug checks are bypassed.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <span className="text-slate-500 flex items-center justify-between gap-1">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={draft.creatorHistoryEnabled === false}
                        checked={isOptEnabled('maxCreatorLaunches')}
                        onChange={(e) => setOptEnabled('maxCreatorLaunches', e.target.checked, 'maxCreatorLaunches')}
                      />
                      <span className={!isOptEnabled('maxCreatorLaunches') ? 'line-through opacity-60' : ''}>
                        Max Prior Coins
                      </span>
                    </label>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="1"
                    disabled={draft.creatorHistoryEnabled === false || !isOptEnabled('maxCreatorLaunches')}
                    data-field-key="maxCreatorLaunches"
                    aria-label="Max owner prior coins launched"
                    value={inputValue(draft.maxCreatorLaunches ?? 5)}
                    onChange={(e) => updateField('maxCreatorLaunches', parseNumInput(e.target.value))}
                    className={inputClass(
                      'maxCreatorLaunches',
                      'w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 disabled:opacity-40'
                    )}
                  />
                  <FieldErrorPopup
                    message={fieldErrors.maxCreatorLaunches}
                    onDismiss={() => clearFieldError('maxCreatorLaunches')}
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-slate-500 flex items-center justify-between gap-1">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={draft.creatorHistoryEnabled === false}
                        checked={isOptEnabled('maxCreatorRuggedCoins')}
                        onChange={(e) => setOptEnabled('maxCreatorRuggedCoins', e.target.checked, 'maxCreatorRuggedCoins')}
                      />
                      <span className={!isOptEnabled('maxCreatorRuggedCoins') ? 'line-through opacity-60' : ''}>
                        Max Rugged Coins
                      </span>
                    </label>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    disabled={draft.creatorHistoryEnabled === false || !isOptEnabled('maxCreatorRuggedCoins')}
                    data-field-key="maxCreatorRuggedCoins"
                    aria-label="Max owner prior rugged coins"
                    value={inputValue(draft.maxCreatorRuggedCoins ?? 0)}
                    onChange={(e) => updateField('maxCreatorRuggedCoins', parseNumInput(e.target.value))}
                    className={inputClass(
                      'maxCreatorRuggedCoins',
                      'w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 disabled:opacity-40'
                    )}
                  />
                  <FieldErrorPopup
                    message={fieldErrors.maxCreatorRuggedCoins}
                    onDismiss={() => clearFieldError('maxCreatorRuggedCoins')}
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-slate-500 flex items-center justify-between gap-1">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={draft.creatorHistoryEnabled === false}
                        checked={isOptEnabled('creatorFastRugWindowMinutes')}
                        onChange={(e) => setOptEnabled('creatorFastRugWindowMinutes', e.target.checked, 'creatorFastRugWindowMinutes')}
                      />
                      <span className={!isOptEnabled('creatorFastRugWindowMinutes') ? 'line-through opacity-60' : ''}>
                        Fast-Rug Window (m)
                      </span>
                    </label>
                    {Number.isFinite(draft.creatorFastRugWindowMinutes) && draft.creatorFastRugWindowMinutes >= 60 && (
                      <span className="font-mono text-[10px] text-teal-600 dark:text-teal-400">
                        = {safeFixed(draft.creatorFastRugWindowMinutes / 60, 1)}h
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="10080"
                    step="1"
                    disabled={draft.creatorHistoryEnabled === false || !isOptEnabled('creatorFastRugWindowMinutes')}
                    data-field-key="creatorFastRugWindowMinutes"
                    aria-label="Creator fast rugpull window minutes"
                    value={inputValue(draft.creatorFastRugWindowMinutes ?? 60)}
                    onChange={(e) => updateField('creatorFastRugWindowMinutes', parseNumInput(e.target.value))}
                    className={inputClass(
                      'creatorFastRugWindowMinutes',
                      'w-full px-3 py-2 rounded-xl font-mono bg-white dark:bg-slate-900 disabled:opacity-40'
                    )}
                  />
                  <FieldErrorPopup
                    message={fieldErrors.creatorFastRugWindowMinutes}
                    onDismiss={() => clearFieldError('creatorFastRugWindowMinutes')}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Exit Rules -> Paper Shadow Simulation Realism */}
        <div className="space-y-6">
          {/* Exits */}
          <section className={sectionClass(exitsHasError)}>
            <h2 className="font-display text-sm font-bold flex items-center">
              <span>Exit Rules</span>
              <InfoTooltip text="Defines Take-Profit target, max stagnation hold duration, emergency rug-pull floor, and optional stepped trailing profit lock." />
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-1">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('takeProfitPct')}
                      onChange={(e) => setOptEnabled('takeProfitPct', e.target.checked, 'takeProfitPct')}
                    />
                    <HoverTip text="Target gross gain % where the bot automatically takes profit. Uncheck to disable fixed Take-Profit target.">
                      <span className={`cursor-help ${!isOptEnabled('takeProfitPct') ? 'line-through opacity-60' : ''}`}>
                        Take-Profit (%) · Unlimited
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('takeProfitPct') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min="1.5"
                  step="0.5"
                  disabled={!isOptEnabled('takeProfitPct')}
                  data-field-key="takeProfitPct"
                  aria-label="Take-Profit (%)"
                  value={inputValue(draft.takeProfitPct)}
                  onChange={(e) => updateField('takeProfitPct', parseNumInput(e.target.value))}
                  className={inputClass('takeProfitPct', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <span className="text-[11px] text-slate-400 block">
                  {!isOptEnabled('takeProfitPct')
                    ? 'Take-Profit target disabled — trailing/SL/manual exits only.'
                    : draft.trailingEnabled
                      ? 'Waits here if price clears all trailing tiers.'
                      : 'Trailing ladder disabled — exits directly at this Take-Profit %.'}
                </span>
                <FieldErrorPopup
                  message={fieldErrors.takeProfitPct}
                  onDismiss={() => clearFieldError('takeProfitPct')}
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-1">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.maxHoldStagnationEnabled !== false && isOptEnabled('maxHoldMinutes')}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        updateField('maxHoldStagnationEnabled', checked);
                        setOptEnabled('maxHoldMinutes', checked, 'maxHoldMinutes');
                      }}
                    />
                    <HoverTip text="Maximum minutes to hold a stagnant trade before auto-exiting. Uncheck to hold indefinitely until TP/SL.">
                      <span className={`cursor-help ${draft.maxHoldStagnationEnabled === false || !isOptEnabled('maxHoldMinutes') ? 'line-through opacity-60' : ''}`}>
                        Max Hold Time (min)
                      </span>
                    </HoverTip>
                  </label>
                  {draft.maxHoldStagnationEnabled === false || !isOptEnabled('maxHoldMinutes') ? (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  ) : Number.isFinite(draft.maxHoldMinutes) && draft.maxHoldMinutes >= 60 ? (
                    <span className="font-mono text-[10px] text-teal-600 dark:text-teal-400">
                      = {safeFixed(draft.maxHoldMinutes / 60, 1)}h
                    </span>
                  ) : null}
                </span>
                <input
                  type="number"
                  min="5"
                  disabled={draft.maxHoldStagnationEnabled === false || !isOptEnabled('maxHoldMinutes')}
                  data-field-key="maxHoldMinutes"
                  aria-label="Max Hold Time (minutes)"
                  value={inputValue(draft.maxHoldMinutes)}
                  onChange={(e) => updateField('maxHoldMinutes', parseNumInput(e.target.value))}
                  className={inputClass('maxHoldMinutes', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <FieldErrorPopup
                  message={fieldErrors.maxHoldMinutes}
                  onDismiss={() => clearFieldError('maxHoldMinutes')}
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-1">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('emergencyLiquidityFloorUsd')}
                      onChange={(e) => setOptEnabled('emergencyLiquidityFloorUsd', e.target.checked, 'emergencyLiquidityFloorUsd')}
                    />
                    <HoverTip text="If pool USD liquidity plunges below this floor while you hold the token, the bot immediately triggers an emergency exit. Uncheck to disable.">
                      <span className={`cursor-help ${!isOptEnabled('emergencyLiquidityFloorUsd') ? 'line-through opacity-60' : ''}`}>
                        Emergency Liq Floor ($)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('emergencyLiquidityFloorUsd') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  disabled={!isOptEnabled('emergencyLiquidityFloorUsd')}
                  data-field-key="emergencyLiquidityFloorUsd"
                  aria-label="Emergency Liquidity Floor ($)"
                  value={inputValue(draft.emergencyLiquidityFloorUsd)}
                  onChange={(e) => updateField('emergencyLiquidityFloorUsd', parseNumInput(e.target.value))}
                  className={inputClass('emergencyLiquidityFloorUsd', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <FieldErrorPopup
                  message={fieldErrors.emergencyLiquidityFloorUsd}
                  onDismiss={() => clearFieldError('emergencyLiquidityFloorUsd')}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-1 text-xs">
              <HoverTip text="Locks in higher and higher profit floors as price climbs through custom Peak % tiers. Uncheck to wait strictly for Take-Profit %.">
                <label
                  data-field-key="trailingEnabled"
                  tabIndex={fieldErrors.trailingEnabled ? -1 : undefined}
                  className={`inline-flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer ${
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
              </HoverTip>
              <HoverTip text="Protects winning recovery bounces after a sharp dip by watching break-even recovery levels.">
                <label className="inline-flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.breakEvenRecoveryEnabled}
                    onChange={(e) => updateField('breakEvenRecoveryEnabled', e.target.checked)}
                  />
                  <span>Break-Even Recovery Watch</span>
                </label>
              </HoverTip>
              <HoverTip text="If all Open Position slots are full, allows closing the weakest stagnant position when a much higher-scoring token appears.">
                <label className="inline-flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.allowSlotRotation}
                    onChange={(e) => updateField('allowSlotRotation', e.target.checked)}
                  />
                  <span>Slot Rotation</span>
                </label>
              </HoverTip>
              <HoverTip text="Automatically closes the empty SPL token account (ATA) when selling 100%, returning ~0.00204 SOL rent to your wallet instead of counting it as a loss.">
                <label className="inline-flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.autoReclaimRent}
                    onChange={(e) => updateField('autoReclaimRent', e.target.checked)}
                  />
                  <span>Auto-Reclaim ATA Rent on 100% Sell (+0.00204 SOL)</span>
                </label>
              </HoverTip>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold flex items-center">
                  <span>Paper Shadow Simulation Realism</span>
                  <InfoTooltip text="Simulates real-world Solana execution friction in Paper mode (network confirmation delay, worst-price slippage during the delay, missed blocks, and MEV/bot competition) so Paper results match real Live trading conditions." />
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  Stress-tests Paper entries with realistic execution latency, worst-price sampling, and &lt;24h bot competition slippage. High values cause Paper buys to start red immediately.
                </p>
              </div>
              <HoverTip text="Reset Paper simulation friction to gentle defaults (0.5–2s delay, 0.25% competition penalty, 2%/3% fail chance) and turn on ATA Rent Reclaim to avoid artificial immediate losses.">
                <button
                  type="button"
                  onClick={() => {
                    updateField('paperDelayMinSec', 0.5);
                    updateField('paperDelayMaxSec', 2);
                    updateField('paperDefaultDelaySec', 1);
                    updateField('paperBuyFailChancePct', 2);
                    updateField('paperSellFailChancePct', 3);
                    updateField('paperCompetitionPenaltyPct', 0.25);
                    updateField('autoReclaimRent', true);
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-teal-500/40 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 shrink-0"
                >
                  Apply Realistic Defaults
                </button>
              </HoverTip>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('paperDelayWindow')}
                      onChange={(e) =>
                        setOptEnabled('paperDelayWindow', e.target.checked, 'paperDelayMinSec', 'paperDelayMaxSec')
                      }
                    />
                    <HoverTip text="Simulated confirmation wait window (seconds) between signal and fill. Uncheck to disable Paper confirmation latency simulation.">
                      <span className={`cursor-help ${!isOptEnabled('paperDelayWindow') ? 'line-through opacity-60' : ''}`}>
                        Delay Window Min / Max (sec)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('paperDelayWindow') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    disabled={!isOptEnabled('paperDelayWindow')}
                    data-field-key="paperDelayMinSec"
                    aria-label="Paper delay min seconds"
                    value={inputValue(draft.paperDelayMinSec)}
                    onChange={(e) => updateField('paperDelayMinSec', parseNumInput(e.target.value))}
                    className={inputClass(
                      'paperDelayMinSec',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40'
                    )}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    disabled={!isOptEnabled('paperDelayWindow')}
                    data-field-key="paperDelayMaxSec"
                    aria-label="Paper delay max seconds"
                    value={inputValue(draft.paperDelayMaxSec)}
                    onChange={(e) => updateField('paperDelayMaxSec', parseNumInput(e.target.value))}
                    className={inputClass(
                      'paperDelayMaxSec',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40'
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
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('paperFailChance')}
                      onChange={(e) =>
                        setOptEnabled('paperFailChance', e.target.checked, 'paperBuyFailChancePct', 'paperSellFailChancePct')
                      }
                    />
                    <HoverTip text="Probability (%) that a simulated Paper buy or sell transaction misses a block. Uncheck to disable simulated failures.">
                      <span className={`cursor-help ${!isOptEnabled('paperFailChance') ? 'line-through opacity-60' : ''}`}>
                        Buy / Sell Failure Chance (%)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('paperFailChance') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={!isOptEnabled('paperFailChance')}
                    data-field-key="paperBuyFailChancePct"
                    aria-label="Paper buy failure chance percent"
                    value={inputValue(draft.paperBuyFailChancePct)}
                    onChange={(e) => updateField('paperBuyFailChancePct', parseNumInput(e.target.value))}
                    className={inputClass(
                      'paperBuyFailChancePct',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40'
                    )}
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={!isOptEnabled('paperFailChance')}
                    data-field-key="paperSellFailChancePct"
                    aria-label="Paper sell failure chance percent"
                    value={inputValue(draft.paperSellFailChancePct)}
                    onChange={(e) => updateField('paperSellFailChancePct', parseNumInput(e.target.value))}
                    className={inputClass(
                      'paperSellFailChancePct',
                      'w-1/2 px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40'
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
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('paperCompetitionPenaltyPct')}
                      onChange={(e) =>
                        setOptEnabled('paperCompetitionPenaltyPct', e.target.checked, 'paperCompetitionPenaltyPct')
                      }
                    />
                    <HoverTip text="Extra buy fill penalty (%) added for coins younger than 24 hours to mimic competing sniper bots. Uncheck to disable.">
                      <span className={`cursor-help ${!isOptEnabled('paperCompetitionPenaltyPct') ? 'line-through opacity-60' : ''}`}>
                        &lt;24h Competition Penalty (%)
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('paperCompetitionPenaltyPct') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  disabled={!isOptEnabled('paperCompetitionPenaltyPct')}
                  data-field-key="paperCompetitionPenaltyPct"
                  aria-label="<24h Competition Penalty (%)"
                  value={inputValue(draft.paperCompetitionPenaltyPct)}
                  onChange={(e) => updateField('paperCompetitionPenaltyPct', parseNumInput(e.target.value))}
                  className={inputClass('paperCompetitionPenaltyPct', 'w-full px-3 py-2 rounded-xl font-mono bg-slate-100 dark:bg-slate-900 disabled:opacity-40')}
                />
                <FieldErrorPopup
                  message={fieldErrors.paperCompetitionPenaltyPct}
                  onDismiss={() => clearFieldError('paperCompetitionPenaltyPct')}
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOptEnabled('priorityFeePreset')}
                      onChange={(e) => setOptEnabled('priorityFeePreset', e.target.checked)}
                    />
                    <HoverTip text="Solana priority fee speed tier used to compute transaction fees. Uncheck to use minimal baseline fees.">
                      <span className={`cursor-help ${!isOptEnabled('priorityFeePreset') ? 'line-through opacity-60' : ''}`}>
                        Priority Fee Preset
                      </span>
                    </HoverTip>
                  </label>
                  {!isOptEnabled('priorityFeePreset') && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                      OFF
                    </span>
                  )}
                </span>
                <select
                  disabled={!isOptEnabled('priorityFeePreset')}
                  aria-label="Priority Fee Preset"
                  value={draft.priorityFeePreset}
                  onChange={(e) =>
                    updateField('priorityFeePreset', e.target.value as BotSettings['priorityFeePreset'])
                  }
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-40"
                >
                  <option value="auto">Auto · Live Jupiter / Network (Adaptive)</option>
                  <option value="standard">Standard (0.0001 SOL)</option>
                  <option value="high">High (0.0005 SOL)</option>
                  <option value="ultra">Ultra (0.0015 SOL)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
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
