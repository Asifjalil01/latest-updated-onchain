import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import type { AppTab } from '../../types';

export function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveTab,
    toggleTheme,
    toggleColorBlindSafe,
    setKillModalOpen,
    apiFetch,
    refreshModeData,
    pushToast,
    status,
  } = useBotStore();

  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      } else if (e.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const actions = useMemo(() => {
    const nav = (tab: AppTab, label: string) => ({
      id: `nav_${tab}`,
      label: `Go to ${label}`,
      run: () => setActiveTab(tab),
    });

    return [
      nav('dashboard', 'Dashboard'),
      nav('positions', 'Positions'),
      nav('scanner', 'Scanner & Pipeline'),
      nav('shadow', 'Shadow Compare'),
      nav('history', 'History & Analytics'),
      nav('settings', 'Settings'),
      nav('wallets', 'Wallets & Signer'),
      nav('logs', 'Event Logs'),
      nav('risk', 'Risk Centre'),
      {
        id: 'scan_once',
        label: 'Action: Run Single Discovery Scan',
        run: async () => {
          await apiFetch('/api/scan-once', { method: 'POST' });
          await refreshModeData();
          pushToast({ kind: 'info', title: 'Single scan completed' });
        },
      },
      {
        id: 'toggle_bot',
        label: status?.runState === 'running' ? 'Action: Stop Bot' : 'Action: Start Bot',
        run: async () => {
          const ep = status?.runState === 'running' ? '/api/stop' : '/api/start';
          await apiFetch(ep, { method: 'POST' });
          await refreshModeData();
        },
      },
      {
        id: 'kill_switch',
        label: 'Action: Open Kill Switch',
        run: () => setKillModalOpen(true),
      },
      {
        id: 'toggle_theme',
        label: 'Preference: Toggle Light / Dark Theme',
        run: () => toggleTheme(),
      },
      {
        id: 'toggle_cb',
        label: 'Preference: Toggle Color-Blind Safe Mode',
        run: () => toggleColorBlindSafe(),
      },
    ];
  }, [
    apiFetch,
    pushToast,
    refreshModeData,
    setActiveTab,
    setKillModalOpen,
    status?.runState,
    toggleColorBlindSafe,
    toggleTheme,
  ]);

  if (!commandPaletteOpen) return null;

  const filtered = actions.filter((a) =>
    a.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/60 backdrop-blur-xs"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to view or run action…"
            className="w-full bg-transparent text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
          />
          <span className="text-[11px] font-mono text-slate-400">ESC</span>
        </div>
        <div className="max-h-72 overflow-y-auto p-2 space-y-1">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setCommandPaletteOpen(false);
                setQuery('');
                void item.run();
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-teal-500/10 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
            >
              {item.label}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-slate-500 px-3 py-4 text-center">No matching commands.</p>
          )}
        </div>
      </div>
    </div>
  );
}
