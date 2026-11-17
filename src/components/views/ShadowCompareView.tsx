import React, { useState } from 'react';
import { useBotStore } from '../../store/useBotStore';
import { EquityCurveChart, PnlText, formatPct, formatSol, formatUsd } from '../ui/Primitives';

export function ShadowCompareView() {
  const { shadowCompare, settings, theme, colorBlindSafe, apiFetch, hydrateAll, pushToast } =
    useBotStore();
  const [saving, setSaving] = useState(false);

  const toggleApplyGap = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ applyMeasuredGapToPaper: !settings.applyMeasuredGapToPaper }),
      });
      await hydrateAll();
      pushToast({
        kind: 'info',
        title: `Auto-apply measured gap ${!settings.applyMeasuredGapToPaper ? 'enabled' : 'disabled'}`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Update failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleShadowCompare = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ shadowCompareEnabled: !settings.shadowCompareEnabled }),
      });
      await hydrateAll();
      pushToast({
        kind: 'info',
        title: `Shadow Compare ${!settings.shadowCompareEnabled ? 'armed (requires unlocked & confirmed Live signer)' : 'disabled'}`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Update failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setSaving(false);
    }
  };

  const paperAn = shadowCompare?.paperAnalytics;
  const liveAn = shadowCompare?.liveAnalytics;
  const avgGap = shadowCompare?.averageGapPct ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Shadow Compare &amp; Reality Gap
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Measure how Paper simulated fills diverge from confirmed Live Jupiter execution.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void toggleApplyGap()}
            className={`px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap ${
              settings?.applyMeasuredGapToPaper
                ? 'border-teal-500 bg-teal-500/12 text-teal-600 dark:text-teal-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            {settings?.applyMeasuredGapToPaper
              ? 'Applying Live Gap to Paper: ON'
              : 'Apply Measured Gap to Paper: OFF'}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void toggleShadowCompare()}
            className={`px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap ${
              settings?.shadowCompareEnabled
                ? 'border-violet-500 bg-violet-500/12 text-violet-600 dark:text-violet-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            {settings?.shadowCompareEnabled
              ? `Shadow Live (${settings.shadowLiveSizeSol} SOL): ON`
              : 'Shadow Live Mode: OFF'}
          </button>
        </div>
      </div>

      {/* Summary Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-1">
          <span className="text-xs text-slate-500">Measured Average Reality Gap</span>
          <div className="font-mono text-2xl font-bold tabular-nums text-violet-500">
            {formatPct(avgGap)}
          </div>
          <p className="text-[11px] text-slate-500">
            Positive gap means Live fills cost more than quoted price.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-1">
          <span className="text-xs text-slate-500">Paper Net P&amp;L (Simulated)</span>
          <div className="text-xl font-bold">
            <PnlText
              valueSol={paperAn?.netPnlSol ?? 0}
              label="simulated"
              colorBlindSafe={colorBlindSafe}
            />
          </div>
          <p className="text-[11px] font-mono text-slate-500">
            {paperAn?.totalTrades ?? 0} trades · Win rate {(paperAn?.winRatePct ?? 0).toFixed(1)}%
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-1">
          <span className="text-xs text-slate-500">Live Net P&amp;L (Confirmed)</span>
          <div className="text-xl font-bold">
            <PnlText
              valueSol={liveAn?.netPnlSol ?? 0}
              label="confirmed"
              colorBlindSafe={colorBlindSafe}
            />
          </div>
          <p className="text-[11px] font-mono text-slate-500">
            {liveAn?.totalTrades ?? 0} trades · Win rate {(liveAn?.winRatePct ?? 0).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Side-by-Side Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-3">
          <h2 className="font-display text-sm font-bold">Paper Equity Curve (Simulated)</h2>
          <EquityCurveChart data={paperAn?.equityCurve ?? []} theme={theme} height={220} />
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-3">
          <h2 className="font-display text-sm font-bold">Live Equity Curve (Confirmed)</h2>
          <EquityCurveChart data={liveAn?.equityCurve ?? []} theme={theme} height={220} />
        </section>
      </div>

      {/* Quote vs Fill Reality Gap Log */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-3">
        <h2 className="font-display text-sm font-bold">Recorded Live Quote vs Fill Slippage</h2>
        {!shadowCompare?.gaps || shadowCompare.gaps.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            No Live fills recorded yet. Live trades log their quoted price against confirmed on-chain
            SOL spent here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3 text-right">Quoted Price</th>
                  <th className="py-2 px-3 text-right">Actual Fill Price</th>
                  <th className="py-2 px-3 text-right">Reality Gap</th>
                  <th className="py-2 px-3 text-right">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                {shadowCompare.gaps.map((g) => (
                  <tr key={g.id}>
                    <td className="py-2 px-3 font-sans font-semibold">{g.symbol}</td>
                    <td className="py-2 px-3 text-right">{formatUsd(g.quotedPriceUsd)}</td>
                    <td className="py-2 px-3 text-right">{formatUsd(g.actualFillPriceUsd)}</td>
                    <td className="py-2 px-3 text-right text-violet-500">{formatPct(g.gapPct)}</td>
                    <td className="py-2 px-3 text-right text-slate-500">
                      {new Date(g.createdAtMs).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
