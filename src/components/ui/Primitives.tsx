import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, AreaSeries } from 'lightweight-charts';
import { ArrowDownRight, ArrowUpRight, AlertTriangle, CheckCircle2, Minus } from 'lucide-react';
import type { ConfirmationLabel } from '../../types';

export function formatSol(val: number | null | undefined, digits = 4): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return `${val.toFixed(digits)} SOL`;
}

export function formatUsd(val: number | null | undefined, compact = false): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  if (compact) {
    if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  }
  if (Math.abs(val) > 0 && Math.abs(val) < 0.01) {
    return `$${val.toFixed(6)}`;
  }
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSignedUsd(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = val > 0 ? '+' : val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs > 0 && abs < 0.01) {
    return `${sign}$${abs.toFixed(4)}`;
  }
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(val: number | null | undefined, showPlus = true): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = val > 0 && showPlus ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

export function maskMint(mint: string): string {
  if (!mint || mint.length <= 10) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function PnlText({
  valueSol,
  valuePct,
  label,
  colorBlindSafe,
}: {
  valueSol: number;
  valuePct?: number;
  label?: ConfirmationLabel;
  colorBlindSafe?: boolean;
}) {
  const prevRef = useRef(valueSol);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (valueSol !== prevRef.current) {
      setFlash(valueSol > prevRef.current ? 'up' : 'down');
      prevRef.current = valueSol;
      const t = setTimeout(() => setFlash(null), 500);
      return () => clearTimeout(t);
    }
  }, [valueSol]);

  const isPos = valueSol > 0;
  const isNeg = valueSol < 0;
  const colorCls = isPos
    ? 'text-emerald-600 dark:text-emerald-400'
    : isNeg
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-slate-600 dark:text-slate-400';

  const flashBg =
    flash === 'up'
      ? 'bg-emerald-500/15'
      : flash === 'down'
        ? 'bg-rose-500/15'
        : 'bg-transparent';

  return (
    <span
      className={`inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono tabular-nums rounded px-1 -mx-1 transition-colors duration-300 ${colorCls} ${flashBg}`}
    >
      {colorBlindSafe &&
        (isPos ? (
          <ArrowUpRight className="w-3.5 h-3.5 shrink-0 self-center" aria-hidden="true" />
        ) : isNeg ? (
          <ArrowDownRight className="w-3.5 h-3.5 shrink-0 self-center" aria-hidden="true" />
        ) : (
          <Minus className="w-3.5 h-3.5 shrink-0 self-center" aria-hidden="true" />
        ))}
      <span className="whitespace-nowrap">
        {valueSol > 0 ? '+' : ''}
        {valueSol.toFixed(4)} SOL
      </span>
      {valuePct !== undefined && (
        <span className="text-xs opacity-80 whitespace-nowrap">({formatPct(valuePct)})</span>
      )}
      {label && (
        <span className="text-[11px] font-sans uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {label}
        </span>
      )}
    </span>
  );
}

export function SemanticStatusText({
  status,
  text,
  colorBlindSafe,
}: {
  status: 'ok' | 'warn' | 'error';
  text: string;
  colorBlindSafe?: boolean;
}) {
  const cls =
    status === 'ok'
      ? 'text-emerald-600 dark:text-emerald-400'
      : status === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`}>
      {(colorBlindSafe || status !== 'ok') && status === 'ok' && (
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      )}
      {status === 'warn' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      {status === 'error' && <ArrowDownRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span>{text}</span>
    </span>
  );
}

export function SparklineSvg({
  data,
  positive,
  height = 28,
  width = 96,
}: {
  data: number[];
  positive: boolean;
  height?: number;
  width?: number;
}) {
  if (!data || data.length < 2) {
    return null;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data
    .map((v, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline
        fill="none"
        stroke={positive ? '#10B981' : '#EF4444'}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function EquityCurveChart({
  data,
  theme,
  height = 240,
}: {
  data: Array<{ timestamp: string; cumulativeNetSol: number }>;
  theme: 'dark' | 'light';
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme === 'dark' ? '#94A3B8' : '#475569',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.06)' },
        horzLines: { color: theme === 'dark' ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.06)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#14B8A6',
      topColor: 'rgba(20, 184, 166, 0.28)',
      bottomColor: 'rgba(20, 184, 166, 0.0)',
      lineWidth: 2,
    });

    const formatted = data.map((d, idx) => ({
      time: Math.floor(new Date(d.timestamp).getTime() / 1000) + idx,
      value: d.cumulativeNetSol,
    }));

    series.setData(formatted as Parameters<typeof series.setData>[0]);
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [data, theme, height]);

  if (data.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl"
        style={{ height }}
      >
        <p className="font-medium text-slate-700 dark:text-slate-300">No closed trades yet</p>
        <p className="text-xs mt-1">Equity curve populates as positions close.</p>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
