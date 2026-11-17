import React, { useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import type { LogSeverity } from '../../types';

export function LogsView() {
  const { logs, apiFetch, hydrateAll, pushToast } = useBotStore();
  const [severity, setSeverity] = useState<'ALL' | LogSeverity>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (severity !== 'ALL' && l.severity !== severity) return false;
      if (!q) return true;
      return (
        l.message.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
      );
    });
  }, [logs, severity, query]);

  const handleClearLogs = async () => {
    try {
      await apiFetch('/api/logs', { method: 'DELETE' });
      await hydrateAll();
      pushToast({ kind: 'info', title: 'Event logs cleared' });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Failed to clear logs' });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Structured Event Logs
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Persisted in SQLite and streamed in real time. Private keys are never logged.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleClearLogs()}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Logs</span>
          </button>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logs…"
              className="pl-8 pr-3 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            />
          </div>

          <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(['ALL', 'INFO', 'WARN', 'ERROR', 'CRITICAL'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverity(sev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                  severity === sev
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-500'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-200 p-4 font-mono text-xs max-h-[600px] overflow-y-auto space-y-1.5">
        {filtered.length === 0 ? (
          <p className="text-slate-500 py-8 text-center">No matching log events.</p>
        ) : (
          filtered.map((entry) => {
            const sevCls =
              entry.severity === 'CRITICAL' || entry.severity === 'ERROR'
                ? 'text-rose-400'
                : entry.severity === 'WARN'
                  ? 'text-amber-400'
                  : 'text-teal-400';
            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 py-1 border-b border-slate-900/80 last:border-0"
              >
                <span className="text-slate-500 shrink-0 tabular-nums">
                  {new Date(entry.createdAtMs).toLocaleTimeString()}
                </span>
                <span className={`font-semibold w-16 shrink-0 ${sevCls}`}>{entry.severity}</span>
                <span className="text-violet-400 w-28 shrink-0 truncate">{entry.category}</span>
                <span className="text-slate-200 break-words">{entry.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
