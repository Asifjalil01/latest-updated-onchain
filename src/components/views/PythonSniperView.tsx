import React, { useEffect, useState, useRef } from 'react';
import { Play, Square, RotateCcw, Copy, ExternalLink, RefreshCw, Terminal, Sliders, Activity, History } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { HoverTip, InfoTooltip } from '../ui/Primitives';

interface SniperPosition {
  symbol: string;
  qty: number;
  entry_price: number;
  cost: number;
  opened: number;
  url: string;
  peak_price?: number;
  low_price?: number;
  dex?: string;
  source?: string;
  age_at_entry?: number;
}

interface SniperTrade {
  time: string;
  action: string;
  symbol: string;
  mint: string;
  price: string;
  amount: string;
  pnlUsd: string;
  pnlPct: string;
  reason: string;
}

interface SniperLog {
  id: string;
  timestamp: string;
  message: string;
  tag: 'buy' | 'sell' | 'reject' | 'warn' | 'info';
}

export function PythonSniperView() {
  const { pushToast } = useBotStore();
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<{ cash: number; positions: Record<string, SniperPosition>; closed: number; wins: number; total_pnl: number; day_pnl: number }>({
    cash: 50.0,
    positions: {},
    closed: 0,
    wins: 0,
    total_pnl: 0.0,
    day_pnl: 0.0,
  });
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [trades, setTrades] = useState<SniperTrade[]>([]);
  const [logs, setLogs] = useState<SniperLog[]>([]);
  const [activeTab, setActiveTab] = useState<'positions' | 'history' | 'logs' | 'settings'>('positions');
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/sniper/status');
      if (res.ok) {
        const data = await res.json();
        setRunning(data.running);
        setState(data.state || {});
        setSettings(data.settings || {});
        setTrades(data.trades || []);
        setLogs(data.logs || []);
      }
    } catch {}
  };

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async () => {
    try {
      const action = running ? 'stop' : 'start';
      const res = await fetch('/api/sniper/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.ok) {
        setRunning(action === 'start');
        pushToast({ kind: 'success', title: data.message });
      } else {
        pushToast({ kind: 'error', title: 'Control error', body: data.message });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Request failed' });
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset Python sniper paper account and clear trade history?')) return;
    try {
      const res = await fetch('/api/sniper/reset', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        pushToast({ kind: 'info', title: 'Account reset successfully' });
        void fetchStatus();
      }
    } catch {}
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/sniper/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const data = await res.json();
      if (data.ok) {
        pushToast({ kind: 'success', title: 'Python sniper settings saved' });
      }
    } catch {}
  };

  const handleSellNow = async (mint: string) => {
    if (!window.confirm('Close this position immediately?')) return;
    try {
      const res = await fetch('/api/sniper/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint }),
      });
      const data = await res.json();
      if (data.ok) {
        pushToast({ kind: 'success', title: data.message });
        void fetchStatus();
      } else {
        pushToast({ kind: 'error', title: data.message });
      }
    } catch {}
  };

  const positionsList = Object.entries(state.positions || {}).map(([mint, p]) => {
    const entry = p.entry_price;
    const cost = p.cost;
    return { mint, ...p };
  });

  const openValue = positionsList.reduce((acc, p) => acc + p.cost, 0);
  const totalValue = (state.cash || 0) + openValue;
  const closedCount = state.closed || 0;
  const winsCount = state.wins || 0;
  const winRateText = closedCount > 0 ? `${((winsCount / closedCount) * 100).toFixed(0)}% (${winsCount}/${closedCount})` : 'no closed trades';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Python New-Launch Sniper Bot</span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono uppercase ${running ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-500/20 text-slate-400'}`}>
              {running ? '● Running' : '● Stopped'}
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Multi-source brand-new launch sniper (GeckoTerminal, Jupiter recent, DexScreener profiles, PumpPortal) with hard RPC rug screen.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleToggle()}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2 shadow-lg transition-all ${
              running ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {running ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{running ? 'Stop Python Bot' : 'Start Python Bot'}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500 block">Cash Balance</span>
          <span className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1 block">
            ${(state.cash || 0).toFixed(2)}
          </span>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500 block">Est. Total Value</span>
          <span className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1 block">
            ${totalValue.toFixed(2)}
          </span>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500 block">Open Positions</span>
          <span className="font-mono text-lg font-bold tabular-nums text-teal-600 dark:text-teal-400 mt-1 block">
            {positionsList.length} slots
          </span>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500 block">Today&apos;s PnL</span>
          <span className={`font-mono text-lg font-bold tabular-nums mt-1 block ${(state.day_pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {(state.day_pnl || 0) >= 0 ? '+' : ''}${(state.day_pnl || 0).toFixed(2)}
          </span>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500 block">Realized PnL</span>
          <span className={`font-mono text-lg font-bold tabular-nums mt-1 block ${(state.total_pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {(state.total_pnl || 0) >= 0 ? '+' : ''}${(state.total_pnl || 0).toFixed(2)}
          </span>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4">
          <span className="text-xs text-slate-500 block">Win Rate</span>
          <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1 block truncate">
            {winRateText}
          </span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-fit">
        {[
          { id: 'positions', label: `Open Positions (${positionsList.length})`, icon: Activity },
          { id: 'history', label: `Trade History (${trades.length})`, icon: History },
          { id: 'logs', label: 'Scan Log', icon: Terminal },
          { id: 'settings', label: 'Python Bot Settings', icon: Sliders },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content: Open Positions */}
      {activeTab === 'positions' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          {positionsList.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              No open positions. Start the Python bot to begin sniping brand-new Solana launches.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2.5 px-3 font-medium">Coin</th>
                    <th className="py-2.5 px-3 font-medium">Source / DEX</th>
                    <th className="py-2.5 px-3 font-medium text-right">Entry Price</th>
                    <th className="py-2.5 px-3 font-medium text-right">Cost ($)</th>
                    <th className="py-2.5 px-3 font-medium text-right">Held Time</th>
                    <th className="py-2.5 px-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {positionsList.map((p) => {
                    const heldMins = (Date.now() / 1000 - p.opened) / 60;
                    return (
                      <tr key={p.mint} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td className="py-3 px-3 font-semibold text-slate-900 dark:text-slate-100">
                          {p.symbol}
                          <span className="block font-mono text-[10px] text-slate-500">{p.mint}</span>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-500">
                          {p.source || 'gecko'} · {p.dex || 'raydium'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          ${p.entry_price.toFixed(6)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          ${p.cost.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                          {heldMins < 1 ? `${Math.floor(heldMins * 60)}s` : `${heldMins.toFixed(1)}m`}
                        </td>
                        <td className="py-3 px-3 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => window.open(`https://dexscreener.com/solana/${p.mint}`, '_blank')}
                            className="px-2 py-1 rounded bg-teal-500/10 text-teal-600 hover:bg-teal-500/20 text-[11px]"
                          >
                            Chart
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSellNow(p.mint)}
                            className="px-2 py-1 rounded bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 text-[11px] font-semibold"
                          >
                            Sell
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Trade History */}
      {activeTab === 'history' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          {trades.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              No closed trades recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2.5 px-3 font-medium">Time</th>
                    <th className="py-2.5 px-3 font-medium">Action</th>
                    <th className="py-2.5 px-3 font-medium">Coin</th>
                    <th className="py-2.5 px-3 font-medium text-right">Price</th>
                    <th className="py-2.5 px-3 font-medium text-right">Amount</th>
                    <th className="py-2.5 px-3 font-medium text-right">PnL ($)</th>
                    <th className="py-2.5 px-3 font-medium">Exit Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {trades.map((t, idx) => {
                    const isBuy = t.action === 'BUY';
                    const isProfit = t.pnlUsd && t.pnlUsd.startsWith('+');
                    return (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 font-mono">
                        <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">{t.time}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isBuy ? 'bg-sky-500/20 text-sky-500' : 'bg-slate-500/20 text-slate-400'}`}>
                            {t.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                          {t.symbol}
                        </td>
                        <td className="py-2.5 px-3 text-right">{t.price}</td>
                        <td className="py-2.5 px-3 text-right">{t.amount}</td>
                        <td className={`py-2.5 px-3 text-right font-bold ${isBuy ? 'text-slate-500' : isProfit ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {t.pnlUsd || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{t.reason || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Scan Log */}
      {activeTab === 'logs' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#070B12] p-4 space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-slate-800">
            <span>Live Python Sniper Console Output</span>
            <span>{logs.length} log events</span>
          </div>
          <div className="h-[450px] overflow-y-auto space-y-1 pr-2">
            {logs.map((l) => {
              const color =
                l.tag === 'buy'
                  ? 'text-emerald-400 font-semibold'
                  : l.tag === 'sell'
                    ? 'text-sky-400 font-semibold'
                    : l.tag === 'reject'
                      ? 'text-slate-500'
                      : l.tag === 'warn'
                        ? 'text-amber-400'
                        : 'text-slate-300';
              return (
                <div key={l.id} className={`${color} leading-relaxed`}>
                  <span className="text-slate-600 mr-2">[{l.timestamp}]</span>
                  <span>{l.message}</span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Tab Content: Settings */}
      {activeTab === 'settings' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Python Bot Configuration (settings.json)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Adjust snipping parameters, take-profit %, age windows, and RPC rug checks.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleReset()}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Account &amp; History</span>
            </button>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              {Object.entries(settings).map(([key, val]) => (
                <div key={key} className="space-y-1">
                  <label htmlFor={`setting-${key}`} className="font-mono text-slate-500 dark:text-slate-400 block truncate" title={key}>
                    {key}
                  </label>
                  {typeof val === 'boolean' ? (
                    <select
                      id={`setting-${key}`}
                      value={val ? 'true' : 'false'}
                      onChange={(e) => setSettings({ ...settings, [key]: e.target.value === 'true' })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono"
                    >
                      <option value="true">True (Enabled)</option>
                      <option value="false">False (Disabled)</option>
                    </select>
                  ) : (
                    <input
                      id={`setting-${key}`}
                      type={typeof val === 'number' ? 'number' : 'text'}
                      step="any"
                      value={val ?? ''}
                      onChange={(e) => {
                        const parsed = typeof val === 'number' ? parseFloat(e.target.value) : e.target.value;
                        setSettings({ ...settings, [key]: isNaN(parsed as number) ? e.target.value : parsed });
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white"
              >
                Save Python Settings
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
