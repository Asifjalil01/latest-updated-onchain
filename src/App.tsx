import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useBotStore } from './store/useBotStore';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { SetupModal } from './components/modals/SetupModal';
// import { LiveConfirmModal } from './components/modals/LiveConfirmModal';
import { KillSwitchModal } from './components/modals/KillSwitchModal';
import { CommandPalette } from './components/modals/CommandPalette';
import { DashboardView } from './components/views/DashboardView';
import { PositionsView } from './components/views/PositionsView';
import { ScannerView } from './components/views/ScannerView';
import { ShadowCompareView } from './components/views/ShadowCompareView';
import { HistoryView } from './components/views/HistoryView';
import { SettingsView } from './components/views/SettingsView';
import { WalletsView } from './components/views/WalletsView';
import { LogsView } from './components/views/LogsView';
import { PipelineConfigView } from './components/views/PipelineConfigView';
import { RiskCentreView } from './components/views/RiskCentreView';
import { AvgWinLossView } from './components/views/AvgWinLossView';
import { PythonSniperView } from './components/views/PythonSniperView';

export default function App() {
  const {
    apiToken,
    activeTab,
    theme,
    executionProgress,
    toasts,
    removeToast,
    claimLocalToken,
    hydrateAll,
    connectSse,
    dismissTutorial,
  } = useBotStore();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sync root dark class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Support ?autostart=1 for automated browser testing / quick local boot
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!apiToken && params.get('autostart') === '1') {
      void claimLocalToken().then((ok) => {
        if (ok) {
          dismissTutorial();
        }
      });
    }
  }, [apiToken, claimLocalToken, dismissTutorial]);

  useEffect(() => {
    if (!apiToken) return;
    void hydrateAll();
    const unsub = connectSse();
    return unsub;
  }, [apiToken, hydrateAll, connectSse]);

  if (!apiToken) {
    return <SetupModal />;
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView />;
      case 'positions':
        return <PositionsView />;
      case 'scanner':
        return <ScannerView />;
      case 'shadow':
        return <ShadowCompareView />;
      case 'history':
        return <HistoryView />;
      case 'settings':
        return <SettingsView />;
      case 'wallets':
        return <WalletsView />;
      case 'logs':
        return <LogsView />;
      case 'pipeline':
        return <PipelineConfigView />;
      case 'risk':
        return <RiskCentreView />;
      case 'avgwin':
        return <AvgWinLossView />;
      case 'python_sniper':
        return <PythonSniperView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#070B12] text-slate-900 dark:text-slate-100">
      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />

        {executionProgress && (
          <div className="px-4 lg:px-6 py-2.5 bg-teal-600/12 border-b border-teal-500/30 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold uppercase text-teal-600 dark:text-teal-300">
                {executionProgress.side} {executionProgress.symbol} · {executionProgress.step}
              </span>
              <span className="text-slate-700 dark:text-slate-300">
                {executionProgress.message}
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              {(['quote', 'build', 'sign', 'send', 'confirm'] as const).map((step) => (
                <span
                  key={step}
                  className={
                    executionProgress.step === step
                      ? 'text-teal-500 font-bold underline'
                      : 'text-slate-400'
                  }
                >
                  {step}
                </span>
              ))}
            </div>
          </div>
        )}

        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
            >
              {renderActiveView()}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="px-6 py-3 border-t border-slate-200 dark:border-slate-800/80 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>Solana Spot Bot v{__APP_VERSION__} · Safety-first spot terminal</span>
          <span>Trading can lose all of your money. No guarantee of profit.</span>
        </footer>
      </div>

      {/* Modals & Palettes */}
      <CommandPalette />
      {/* <LiveConfirmModal /> */}
      <KillSwitchModal />

      {/* Toast Stack */}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-3.5 shadow-xl flex items-start justify-between gap-3 text-xs"
          >
            <div>
              <p
                className={`font-semibold ${
                  t.kind === 'error'
                    ? 'text-rose-500'
                    : t.kind === 'warn'
                      ? 'text-amber-500'
                      : t.kind === 'success'
                        ? 'text-emerald-500'
                        : 'text-teal-500'
                }`}
              >
                {t.title}
              </p>
              {t.body && <p className="text-slate-600 dark:text-slate-300 mt-0.5">{t.body}</p>}
            </div>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
