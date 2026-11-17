import React from 'react';
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  GitCompare,
  History,
  LayoutDashboard,
  Radar,
  Settings,
  ShieldAlert,
  Terminal,
  Wallet,
} from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import type { AppTab } from '../../types';

const NAV_ITEMS: Array<{ id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'positions', label: 'Positions', icon: Activity },
  { id: 'scanner', label: 'Scanner', icon: Radar },
  { id: 'shadow', label: 'Shadow Compare', icon: GitCompare },
  { id: 'history', label: 'History & Analytics', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'wallets', label: 'Wallets & Signer', icon: Wallet },
  { id: 'logs', label: 'Event Logs', icon: Terminal },
  { id: 'risk', label: 'Risk Centre', icon: ShieldAlert },
];

export function Sidebar({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { activeTab, setActiveTab, sidebarCollapsed, toggleSidebar, positions, status } =
    useBotStore();

  const navContent = (
    <div className="flex flex-col h-full justify-between py-4">
      <div>
        <div
          className={`flex items-center ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'
          } pb-4 mb-3 border-b border-slate-200 dark:border-slate-800/80`}
        >
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <BarChart3 className="w-5 h-5 text-teal-500 shrink-0" aria-hidden="true" />
              <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
                Solana Spot Bot
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors focus-visible:outline-2 focus-visible:outline-teal-500"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        <nav aria-label="Primary Navigation" className="space-y-1 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const badgeCount =
              item.id === 'positions' && positions.length > 0 ? positions.length : null;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  onCloseMobile();
                }}
                aria-current={active ? 'page' : undefined}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center ${
                  sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'
                } py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-teal-500 ${
                  active
                    ? 'bg-teal-500/12 text-teal-700 dark:text-teal-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!sidebarCollapsed && badgeCount !== null && (
                  <span className="font-mono text-xs tabular-nums text-teal-600 dark:text-teal-400">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {!sidebarCollapsed && (
        <div className="px-4 pt-4 border-t border-slate-200 dark:border-slate-800/80 text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
          <div className="flex items-center justify-between font-mono tabular-nums">
            <span>Mode</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200 uppercase">
              {status?.mode ?? 'paper'}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-500">
            Trading can lose all of your money. Fail-closed safeguards active.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B101B] transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 max-w-[80vw] bg-white dark:bg-[#0B101B] border-r border-slate-200 dark:border-slate-800 h-full">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
