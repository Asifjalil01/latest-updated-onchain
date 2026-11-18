import React from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import {
  EquityCurveChart,
  HoverTip,
  InfoTooltip,
  PnlText,
  SparklineSvg,
  formatPct,
  formatSignedUsd,
  formatSol,
  formatTokenPriceUsd,
  formatUsd,
} from '../ui/Primitives';

export function DashboardView() {
  const {
    status,
    positions,
    trades,
    analytics,
    settings,
    theme,
    colorBlindSafe,
    setActiveTab,
    tutorialDismissed,
    dismissTutorial,
  } = useBotStore();

  const mode = status?.mode ?? 'paper';
  const isSim = mode !== 'live';
  const confirmationTag = isSim ? 'simulated' : 'confirmed';
  const solUsd = status?.solPriceUsd ?? null;

  const activeBalanceSol =
    mode === 'live' ? (status?.liveBalanceSol ?? 0) : (status?.paperBalanceSol ?? 0);

  const openCostSol = positions.reduce((s, p) => s + p.solIn, 0);
  const openMarketSol = positions.reduce((s, p) => {
    const val = solUsd && solUsd > 0 ? (p.quantity * p.currentPriceUsd) / solUsd : p.solIn;
    return s + val;
  }, 0);
  const estOpenRoundTripCostsSol = positions.reduce((s, p) => {
    const roundTripCost =
      p.exitParams?.roundTripCostPct > 0
        ? Math.max(p.entryFeesSol + p.entryRentSol, p.solIn * (p.exitParams.roundTripCostPct / 100))
        : p.entryFeesSol + p.entryRentSol;
    return s + roundTripCost;
  }, 0);
  const openPnlSol = openMarketSol - openCostSol - estOpenRoundTripCostsSol;
  const totalValueSol = activeBalanceSol + openMarketSol;
  const realizedNetSol = analytics?.netPnlSol ?? 0;
  const todayPnlSol = status?.dailyRealizedPnlSol ?? 0;

  const maxExposure = settings?.maxWalletExposureSol ?? 0.1;
  const exposureRatio = Math.min(100, (openCostSol / Math.max(0.0001, maxExposure)) * 100);

  const dailyLossLimit = settings?.dailyLossLimitSol ?? 0.15;
  const dailyLossUsed = Math.max(0, -todayPnlSol);
  const dailyLossPct = Math.min(100, (dailyLossUsed / Math.max(0.0001, dailyLossLimit)) * 100);

  const equitySeries = analytics?.equityCurve ?? [];
  const sparkData = equitySeries.map((e) => e.cumulativeNetSol);

  return (
    <div className="space-y-6">
      {status?.dailyLossLimitHit && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Daily Loss Limit Reached — Buying Halted</p>
              <p className="text-xs opacity-90">
                Realized daily loss ({formatSol(todayPnlSol)}
                {solUsd ? ` / ${formatSignedUsd(todayPnlSol * solUsd)}` : ''}) reached the -
                {dailyLossLimit} SOL{solUsd ? ` (${formatUsd(dailyLossLimit * solUsd)})` : ''} limit.
                New entries are blocked until UTC day rollover or limit review.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('risk')}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 text-white whitespace-nowrap shrink-0"
          >
            Risk Centre
          </button>
        </div>
      )}

      {!tutorialDismissed && (
        <div className="rounded-2xl border border-teal-500/30 bg-teal-500/5 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Guided Paper Mode Workflow
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              1. Click <strong>Scan Once</strong> in the top bar to discover Solana pools and
              inspect rejections in the Scanner. 2. Review Risk Centre before unlocking any signer.
              Trading can lose all of your money.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white whitespace-nowrap"
            >
              Open Scanner
            </button>
            <button
              type="button"
              onClick={dismissTutorial}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center">
              Wallet Balance
              <InfoTooltip text="Liquid SOL currently uninvested and available in the active trading mode (Paper, Testnet, or Live)." />
            </span>
            <span className="uppercase">{mode}</span>
          </div>
          <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatSol(activeBalanceSol, 4)}
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-500">
            {solUsd ? formatUsd(activeBalanceSol * solUsd) : 'SOL price unavailable'}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center">
              Total Portfolio Value
              <InfoTooltip text="Liquid wallet SOL plus the current mark-to-market SOL value of all open token positions." />
            </span>
            <span>{confirmationTag}</span>
          </div>
          <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatSol(totalValueSol, 4)}
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-500">
            {solUsd ? formatUsd(totalValueSol * solUsd) : '—'}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center">
              Open P&amp;L
              <InfoTooltip text="Estimated take-home profit/loss across all open positions after subtracting entry/exit fees, priority tips, and un-reclaimed ATA rent." />
            </span>
            <span>{positions.length} open</span>
          </div>
          <div className="text-lg font-bold">
            <PnlText
              valueSol={openPnlSol}
              label={isSim ? 'simulated' : 'est.'}
              colorBlindSafe={colorBlindSafe}
              solUsd={solUsd}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-xs font-mono tabular-nums font-medium ${
                openPnlSol > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : openPnlSol < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-500'
              }`}
            >
              {solUsd ? formatSignedUsd(openPnlSol * solUsd) : '—'}
            </span>
            <SparklineSvg
              data={positions[0]?.priceHistory ?? []}
              positive={openPnlSol >= 0}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center">
              Today Realized
              <InfoTooltip text="Closed-trade net profit/loss since UTC midnight. Enforces your Daily Loss Limit circuit breaker." />
            </span>
            <span>{confirmationTag}</span>
          </div>
          <div className="text-lg font-bold">
            <PnlText
              valueSol={todayPnlSol}
              label={confirmationTag}
              colorBlindSafe={colorBlindSafe}
              solUsd={solUsd}
            />
          </div>
          <div className="text-xs font-mono tabular-nums flex items-center justify-between gap-2 flex-wrap">
            <span
              className={`font-medium ${
                todayPnlSol > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : todayPnlSol < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-500'
              }`}
            >
              {solUsd ? formatSignedUsd(todayPnlSol * solUsd) : '—'}
            </span>
            <span className="text-slate-500">
              Limit: -{dailyLossLimit.toFixed(3)} SOL
              {solUsd ? ` (${formatUsd(dailyLossLimit * solUsd)})` : ''}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center">
              Net Realized P&amp;L
              <InfoTooltip text="Total cumulative net profit/loss across all closed trades in the current mode after every fee and rent cost." />
            </span>
            <span>{trades.length} trades</span>
          </div>
          <div className="text-lg font-bold">
            <PnlText
              valueSol={realizedNetSol}
              label={confirmationTag}
              colorBlindSafe={colorBlindSafe}
              solUsd={solUsd}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-xs font-mono tabular-nums font-medium ${
                realizedNetSol > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : realizedNetSol < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-500'
              }`}
            >
              {solUsd ? formatSignedUsd(realizedNetSol * solUsd) : '—'}
            </span>
            <SparklineSvg data={sparkData} positive={realizedNetSol >= 0} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center">
              Win Rate &amp; Expectancy
              <InfoTooltip text="Percentage of profitable closed trades, Profit Factor (gross wins / gross losses), and average expected net SOL per trade." />
            </span>
            <span>PF {(analytics?.profitFactor ?? 0).toFixed(2)}</span>
          </div>
          <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {(analytics?.winRatePct ?? 0).toFixed(1)}%
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-500">
            Exp: {(analytics?.expectancySol ?? 0).toFixed(4)} SOL/tr
            {solUsd ? ` (${formatSignedUsd((analytics?.expectancySol ?? 0) * solUsd)})` : ''}
          </div>
        </div>
      </div>

      {/* Main Chart + Risk Gauges */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center">
                Net Cumulative Equity Curve ({mode.toUpperCase()})
                <InfoTooltip text="Visualizes cumulative net profit/loss over closed trades in the active mode after deducting DEX fees, priority fees, and rent." />
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                After fees, priority tips, and ATA rent · Labelled {confirmationTag}
              </p>
            </div>
            <HoverTip text="Worst peak-to-trough drop in cumulative realized equity across your trade history.">
              <div className="text-right font-mono text-xs tabular-nums text-slate-500 cursor-help">
                Max Drawdown:{' '}
                <span className="text-rose-500 font-semibold">
                  -{formatSol(analytics?.maxDrawdownSol ?? 0, 4)}
                  {solUsd ? ` (${formatUsd((analytics?.maxDrawdownSol ?? 0) * solUsd)})` : ''}
                </span>
              </div>
            </HoverTip>
          </div>

          <EquityCurveChart data={equitySeries} theme={theme} height={240} />

          {equitySeries.length > 0 && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                <span className="inline-flex items-center">
                  Trade-by-Trade Drawdown Depth
                  <InfoTooltip text="Each bar shows how far equity dipped below its prior all-time high after that trade closed." />
                </span>
                <span className="font-mono tabular-nums">
                  {equitySeries.length} closed trades
                </span>
              </div>
              <div className="flex items-end gap-1 h-12">
                {equitySeries.slice(-40).map((pt, idx) => {
                  const maxDd = Math.max(0.001, analytics?.maxDrawdownSol ?? 0.001);
                  const hPct = Math.min(100, (pt.drawdownSol / maxDd) * 100);
                  return (
                    <div
                      key={`${pt.timestamp}_${idx}`}
                      title={`Drawdown: -${pt.drawdownSol.toFixed(4)} SOL`}
                      className="flex-1 bg-rose-500/35 hover:bg-rose-500/60 rounded-t transition-colors"
                      style={{ height: `${Math.max(4, hPct)}%` }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-5">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center">
            Exposure &amp; Safeguards
            <InfoTooltip text="Real-time usage of your capital exposure cap, open position slots, daily loss budget, and Paper-vs-Live slippage calibration." />
          </h2>

          {/* Wallet Exposure Gauge */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-slate-500 dark:text-slate-400 inline-flex items-center">
                Wallet Exposure
                <InfoTooltip text="Total SOL currently deployed in open positions compared against your Max Wallet Exposure cap." />
              </span>
              <span className="font-mono tabular-nums font-semibold text-right">
                {openCostSol.toFixed(4)} / {maxExposure.toFixed(4)} SOL
                {solUsd ? (
                  <span className="text-slate-500 font-normal ml-1">
                    ({formatUsd(openCostSol * solUsd)} / {formatUsd(maxExposure * solUsd)})
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  exposureRatio >= 85 ? 'bg-amber-500' : 'bg-teal-500'
                }`}
                style={{ width: `${exposureRatio}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              {positions.length} of {settings?.maxOpenPositions ?? 3} max open slots · Gas reserve{' '}
              {settings?.gasReserveSol ?? 0.02} SOL
              {solUsd ? ` (${formatUsd((settings?.gasReserveSol ?? 0.02) * solUsd)})` : ''}
            </p>
          </div>

          {/* Daily Loss Limit Bar */}
          <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-slate-500 dark:text-slate-400 inline-flex items-center">
                Daily Loss Budget Used
                <InfoTooltip text="Tracks realized daily losses against your Daily Loss Limit. Reaching 100% automatically halts new buys." />
              </span>
              <span className="font-mono tabular-nums font-semibold text-right">
                {dailyLossUsed.toFixed(4)} / {dailyLossLimit.toFixed(4)} SOL
                {solUsd ? (
                  <span className="text-slate-500 font-normal ml-1">
                    ({formatUsd(dailyLossUsed * solUsd)} / {formatUsd(dailyLossLimit * solUsd)})
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  dailyLossPct >= 80 ? 'bg-rose-500' : 'bg-violet-500'
                }`}
                style={{ width: `${dailyLossPct}%` }}
              />
            </div>
          </div>

          {/* Paper vs Live Reality Gap Summary */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400 inline-flex items-center">
                Paper vs Live Reality Gap
                <InfoTooltip text="Average percentage difference between Jupiter quotes and real on-chain Live execution fills." />
              </span>
              <span className="font-mono tabular-nums font-semibold text-violet-500">
                {formatPct(status?.averagePaperLiveGapPct ?? 0)}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Measured difference between quoted price and confirmed live fills.
            </p>
            <HoverTip text="Open the Shadow Compare view to compare Paper vs Live equity curves and recorded fill gaps.">
              <button
                type="button"
                onClick={() => setActiveTab('shadow')}
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline pt-1"
              >
                <span>Inspect Shadow Compare</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </HoverTip>
          </div>
        </section>
      </div>

      {/* Live Positions Preview */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center">
            Active Positions ({positions.length})
            <InfoTooltip text="Quick preview of currently open trades with Quality/Trade entry scores, live prices, and exit thresholds." />
          </h2>
          <HoverTip text="Open the full Positions workspace with Hold Timers, Trailing Profit Lock tiers, and Manual Sell.">
            <button
              type="button"
              onClick={() => setActiveTab('positions')}
              className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline"
            >
              Manage all positions
            </button>
          </HoverTip>
        </div>

        {positions.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            <p className="font-medium text-slate-700 dark:text-slate-300">
              No open positions in {mode.toUpperCase()} mode
            </p>
            <p className="text-xs mt-1">
              Run a Scan Once or start the bot to evaluate candidates through the 8-stage safety
              pipeline.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {positions.slice(0, 6).map((pos) => {
              const currentSolVal =
                solUsd && solUsd > 0 ? (pos.quantity * pos.currentPriceUsd) / solUsd : pos.solIn;
              const roundTripCostSol =
                pos.exitParams?.roundTripCostPct > 0
                  ? Math.max(
                      pos.entryFeesSol + pos.entryRentSol,
                      pos.solIn * (pos.exitParams.roundTripCostPct / 100)
                    )
                  : pos.entryFeesSol + pos.entryRentSol;
              const estPnlSol = currentSolVal - pos.solIn - roundTripCostSol;
              const estNetPct = pos.solIn > 0 ? (estPnlSol / pos.solIn) * 100 : 0;
              return (
                <div
                  key={pos.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-display font-bold text-slate-900 dark:text-slate-100">
                        {pos.symbol}
                      </span>
                      <span className="text-xs text-slate-500 ml-2">
                        {pos.dex} · {pos.source}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-slate-500">
                      Q{pos.qualityScore}/T{pos.tradeScore}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm tabular-nums">
                      {formatTokenPriceUsd(pos.currentPriceUsd)}
                    </span>
                    <div className="text-right">
                      <PnlText
                        valueSol={estPnlSol}
                        valuePct={estNetPct}
                        label={pos.confirmationLabel}
                        colorBlindSafe={colorBlindSafe}
                      />
                      {solUsd ? (
                        <div
                          className={`text-[11px] font-mono tabular-nums ${
                            estPnlSol > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : estPnlSol < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-500'
                          }`}
                        >
                          {formatSignedUsd(estPnlSol * solUsd)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800/70">
                    <span>BE: {formatTokenPriceUsd(pos.breakEvenPriceUsd)}</span>
                    <span>SL: -{pos.exitParams.stopLossPct}%</span>
                    <span>TP: +{pos.exitParams.takeProfitPct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
