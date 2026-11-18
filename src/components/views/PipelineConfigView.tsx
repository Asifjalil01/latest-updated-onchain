import React, { useEffect, useState } from 'react';
import { Sliders, ShieldCheck, CheckCircle2, AlertTriangle, Save } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { HoverTip, InfoTooltip } from '../ui/Primitives';

export function PipelineConfigView() {
  const { settings, apiFetch, hydrateAll, pushToast } = useBotStore();

  const [minLiquidity, setMinLiquidity] = useState(settings?.minLiquidityUsd ?? 25000);
  const [minPoolAge, setMinPoolAge] = useState(settings?.minPoolAgeMinutes ?? 30);
  const [maxTop10, setMaxTop10] = useState(settings?.maxTop10HoldersPct ?? 35);
  const [enforceTop10, setEnforceTop10] = useState(settings?.enforceMaxTop10Holders ?? true);
  const [minQuality, setMinQuality] = useState(settings?.minQualityScore ?? 60);
  const [minTrade, setMinTrade] = useState(settings?.minTradeScore ?? 55);
  const [enforceScores, setEnforceScores] = useState(settings?.enforceMinScores ?? true);
  const [newLaunchOnly, setNewLaunchOnly] = useState(settings?.newLaunchOnlyEnabled ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setMinLiquidity(settings.minLiquidityUsd);
    setMinPoolAge(settings.minPoolAgeMinutes);
    setMaxTop10(settings.maxTop10HoldersPct);
    setEnforceTop10(settings.enforceMaxTop10Holders);
    setMinQuality(settings.minQualityScore);
    setMinTrade(settings.minTradeScore);
    setEnforceScores(settings.enforceMinScores);
    setNewLaunchOnly(settings.newLaunchOnlyEnabled);
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          minLiquidityUsd: Number(minLiquidity),
          minPoolAgeMinutes: Number(minPoolAge),
          maxTop10HoldersPct: Number(maxTop10),
          enforceMaxTop10Holders: enforceTop10,
          minQualityScore: Number(minQuality),
          minTradeScore: Number(minTrade),
          enforceMinScores: enforceScores,
          newLaunchOnlyEnabled: newLaunchOnly,
        }),
      });
      await hydrateAll();
      pushToast({ kind: 'success', title: 'Pipeline rules updated successfully' });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Failed to update pipeline rules',
        body: err instanceof Error ? err.message : 'Validation error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleApplyPreset = async (preset: 'safe' | 'balanced' | 'aggressive' | 'quick_profit') => {
    try {
      await apiFetch('/api/settings/preset', {
        method: 'POST',
        body: JSON.stringify({ preset }),
      });
      await hydrateAll();
      const updated = useBotStore.getState().settings;
      if (updated) {
        setMinLiquidity(updated.minLiquidityUsd);
        setMinPoolAge(updated.minPoolAgeMinutes);
        setMaxTop10(updated.maxTop10HoldersPct);
        setEnforceTop10(updated.enforceMaxTop10Holders);
        setMinQuality(updated.minQualityScore);
        setMinTrade(updated.minTradeScore);
        setEnforceScores(updated.enforceMinScores);
        setNewLaunchOnly(updated.newLaunchOnlyEnabled);
      }
      pushToast({ kind: 'success', title: `Applied "${preset}" pipeline preset` });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Preset application failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Pipeline Rules &amp; Stage Reference
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Understand how candidate tokens flow through the 6-stage fail-closed evaluation pipeline and tune your thresholds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <HoverTip text="High-speed momentum scalp setup: $25k+ liq, 15m+ age, tight 4% SL, 12% TP, +1.5% trailing lock, 0.1 SOL size.">
            <button
              type="button"
              onClick={() => void handleApplyPreset('quick_profit')}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
            >
              ⚡ Quick Profit Scalper
            </button>
          </HoverTip>
          <HoverTip text="Conservative mature-pool rules ($50k+ liq, >=60m pool age, high Quality/Trade scores, smaller 0.03 SOL size).">
            <button
              type="button"
              onClick={() => void handleApplyPreset('safe')}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Safe Preset
            </button>
          </HoverTip>
          <HoverTip text="Balanced configuration matching realistic defaults ($25k+ liq, 30m+ age, 0.05 SOL size, 0.5–2s realism window).">
            <button
              type="button"
              onClick={() => void handleApplyPreset('balanced')}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Balanced Preset
            </button>
          </HoverTip>
          <HoverTip text="Looser liquidity/age thresholds ($10k+ liq, 15m+ age) with higher max exposure and wider profit targets.">
            <button
              type="button"
              onClick={() => void handleApplyPreset('aggressive')}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Aggressive Preset
            </button>
          </HoverTip>
        </div>
      </div>

      {/* 6 Stage Reference Guide */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          {
            stage: '01. Discovered',
            desc: 'Raw mints ingested from WebSocket feeds (PumpPortal), GeckoTerminal new pools, and Jupiter trending pools.',
            defaultRule: 'Real-time WebSocket & API polling',
          },
          {
            stage: '02. Validated',
            desc: 'Basic structural sanity checks on candidate metadata.',
            defaultRule: 'Mint length >= 32, positive USD price, valid liquidity & volume',
          },
          {
            stage: '03. Hard Filtered',
            desc: 'Pool age, liquidity floors, volume/tx minimums, and price impact limits.',
            defaultRule: 'Default Min Pool Age >= 30m (or New Launches / Custom Age Window)',
          },
          {
            stage: '04. Security Passed',
            desc: 'Fail-closed security audits verifying smart contracts and holder concentration.',
            defaultRule: 'Revoked mint/freeze, RugCheck risk <= 30, LP locked >= 80%, Top-10 <= 35%',
          },
          {
            stage: '05. Scored',
            desc: 'Composite grading across quality (safety, depth, holders) and trade metrics (momentum, buy ratio).',
            defaultRule:
              settings?.enforceMinScores === false
                ? 'Score Gate Disabled (Threshold checks bypassed)'
                : `Quality >= ${settings?.minQualityScore ?? 60} and Trade Score >= ${settings?.minTradeScore ?? 55}`,
          },
          {
            stage: '06. Executed',
            desc: 'Position sizing calculations, risk budget checks, and simulated/live order routing.',
            defaultRule: `Max ${settings?.maxOpenPositions ?? 3} open slots, ${settings?.tradeSizeSol ?? 0.05} SOL trade size, daily loss limit protection`,
          },
        ].map((item) => (
          <div
            key={item.stage}
            className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4 space-y-2"
          >
            <h2 className="font-display text-sm font-bold text-teal-600 dark:text-teal-400">
              {item.stage}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">{item.desc}</p>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 font-mono text-[11px] text-slate-500">
              {item.defaultRule}
            </div>
          </div>
        ))}
      </div>

      {/* Direct Manual Rule Configuration Form */}
      <form
        onSubmit={(e) => void handleSave(e)}
        className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-6 space-y-6"
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Tune Pipeline Thresholds (Loose vs Tight)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Adjust core rules below to allow micro-caps, new launches, or stricter safety gates.
            </p>
          </div>
          <HoverTip text="Save these pipeline thresholds immediately to the backend and refresh Scanner evaluation gates.">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving Rules…' : 'Save Pipeline Rules'}</span>
            </button>
          </HoverTip>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center">
              Min Liquidity ($) · Unlimited
              <InfoTooltip text="Minimum USD liquidity required in a pool before buying. Higher liquidity prevents extreme buy/sell slippage." />
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={minLiquidity}
              onChange={(e) => setMinLiquidity(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            />
            <p className="text-[11px] text-slate-500">Any amount from $0 upwards.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center">
              Default Min Pool Age (Minutes)
              <InfoTooltip text="Minimum minutes a pool must exist before entry (used when Custom Age Window and New Launches Only are unchecked)." />
            </label>
            <input
              type="number"
              min="0"
              value={minPoolAge}
              onChange={(e) => setMinPoolAge(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            />
            <p className="text-[11px] text-slate-500">Default 30m minimum (overridden if new launch mode active).</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center">
              Max Top-10 Non-Pool Holders (%)
              <InfoTooltip text="Maximum percentage of token supply allowed in the top 10 wallets (excluding AMM pools/burn addresses) to avoid whale dumps." />
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="50"
                disabled={!enforceTop10}
                value={maxTop10}
                onChange={(e) => setMaxTop10(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-40"
              />
            </div>
            <HoverTip text="Uncheck to skip top-10 wallet concentration rejection during security audits.">
              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enforceTop10}
                  onChange={(e) => setEnforceTop10(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-[11px] text-slate-600 dark:text-slate-400">Enforce Top-10 Holder Rule</span>
              </label>
            </HoverTip>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center">
              Min Quality Score {enforceScores ? '(50–100)' : '(Disabled)'}
              <InfoTooltip text="Minimum 0–100 safety & structural quality score (liquidity depth, RugCheck score, LP lock, holder distribution)." />
            </label>
            <input
              type="number"
              min={enforceScores ? 50 : 0}
              max="100"
              disabled={!enforceScores}
              value={minQuality}
              onChange={(e) => setMinQuality(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center">
              Min Trade Score {enforceScores ? '(50–100)' : '(Disabled)'}
              <InfoTooltip text="Minimum 0–100 trade opportunity score measuring 5m/1h momentum, buyer dominance, volume-to-liquidity turnover, and pool regime." />
            </label>
            <input
              type="number"
              min={enforceScores ? 50 : 0}
              max="100"
              disabled={!enforceScores}
              value={minTrade}
              onChange={(e) => setMinTrade(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-xl font-mono text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-40"
            />
          </div>

          <div className="space-y-2 flex flex-col justify-center">
            <HoverTip text="When checked, coins below Min Quality or Min Trade score are rejected. Uncheck to trade any coin passing Hard Filters + Security.">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enforceScores}
                  onChange={(e) => setEnforceScores(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Enforce Quality &amp; Trade Score Thresholds
                </span>
              </label>
            </HoverTip>
            <HoverTip text="Restricts discovery and entry to brand-new launches in the 5s–300s age window instead of established pools.">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newLaunchOnly}
                  onChange={(e) => setNewLaunchOnly(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  New Launches Only Mode (5s–300s window)
                </span>
              </label>
            </HoverTip>
          </div>
        </div>
      </form>
    </div>
  );
}
