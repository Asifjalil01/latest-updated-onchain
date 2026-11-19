import { create } from 'zustand';
import type {
  AnalyticsSummary,
  AppTab,
  BotSettings,
  BotStatusSnapshot,
  ExecutionMode,
  ExecutionProgressEvent,
  LogEntry,
  PaperVsLiveGapRecord,
  PositionRecord,
  RejectionRecord,
  RpcEndpointHealth,
  SeenTokenRecord,
  SettingsHistoryEntry,
  SourceHealthRecord,
  TradeRecord,
  WalletDiagnostics,
  WalletFeeProfile,
} from '../types';

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warn' | 'error';
  title: string;
  body?: string;
}

interface ShadowCompareData {
  paperAnalytics: AnalyticsSummary;
  liveAnalytics: AnalyticsSummary;
  paperTrades: TradeRecord[];
  liveTrades: TradeRecord[];
  gaps: PaperVsLiveGapRecord[];
  averageGapPct: number;
}

interface BotStoreState {
  apiToken: string | null;
  authChecked: boolean;
  activeTab: AppTab;
  theme: 'dark' | 'light';
  colorBlindSafe: boolean;
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  liveConfirmModalOpen: boolean;
  killModalOpen: boolean;
  tutorialDismissed: boolean;

  loading: boolean;
  status: BotStatusSnapshot | null;
  positions: PositionRecord[];
  trades: TradeRecord[];
  analytics: AnalyticsSummary | null;
  seenTokens: SeenTokenRecord[];
  rejections: RejectionRecord[];
  sources: SourceHealthRecord[];
  rpcs: RpcEndpointHealth[];
  settings: BotSettings | null;
  settingsHistory: SettingsHistoryEntry[];
  walletDiagnostics: WalletDiagnostics | null;
  feeProfiles: WalletFeeProfile[];
  logs: LogEntry[];
  shadowCompare: ShadowCompareData | null;
  executionProgress: ExecutionProgressEvent | null;
  toasts: ToastMessage[];

  setActiveTab: (tab: AppTab) => void;
  toggleTheme: () => void;
  toggleColorBlindSafe: () => void;
  toggleSidebar: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setLiveConfirmModalOpen: (open: boolean) => void;
  setKillModalOpen: (open: boolean) => void;
  dismissTutorial: () => void;

  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;

  setApiToken: (token: string | null) => void;
  claimLocalToken: () => Promise<boolean>;
  verifyAndSaveToken: (token: string) => Promise<boolean>;
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  hydrateAll: () => Promise<void>;
  refreshModeData: (modeOverride?: ExecutionMode) => Promise<void>;
  refreshScannerAndHealth: () => Promise<void>;
  connectSse: () => () => void;
}

const SESSION_TOKEN_KEY = 'ssb_api_token';
const THEME_KEY = 'ssb_theme';
const CB_KEY = 'ssb_cb_safe';
const TUTORIAL_KEY = 'ssb_tutorial_done';

let scannerRefreshInFlight: Promise<void> | null = null;

export const useBotStore = create<BotStoreState>((set, get) => ({
  apiToken: typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SESSION_TOKEN_KEY) : null,
  authChecked: false,
  activeTab: 'dashboard',
  theme: (typeof localStorage !== 'undefined' && localStorage.getItem(THEME_KEY) === 'light')
    ? 'light'
    : 'dark',
  colorBlindSafe: typeof localStorage !== 'undefined' && localStorage.getItem(CB_KEY) === 'true',
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  liveConfirmModalOpen: false,
  killModalOpen: false,
  tutorialDismissed:
    typeof localStorage !== 'undefined' && localStorage.getItem(TUTORIAL_KEY) === 'true',

  loading: false,
  status: null,
  positions: [],
  trades: [],
  analytics: null,
  seenTokens: [],
  rejections: [],
  sources: [],
  rpcs: [],
  settings: null,
  settingsHistory: [],
  walletDiagnostics: null,
  feeProfiles: [],
  logs: [],
  shadowCompare: null,
  executionProgress: null,
  toasts: [],

  setActiveTab: (tab) => set({ activeTab: tab }),

  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark';
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', next === 'dark');
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(THEME_KEY, next);
      }
      return { theme: next };
    }),

  toggleColorBlindSafe: () =>
    set((s) => {
      const next = !s.colorBlindSafe;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CB_KEY, String(next));
      }
      return { colorBlindSafe: next };
    }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setLiveConfirmModalOpen: (open) => set({ liveConfirmModalOpen: open }),
  setKillModalOpen: (open) => set({ killModalOpen: open }),
  dismissTutorial: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TUTORIAL_KEY, 'true');
    }
    set({ tutorialDismissed: true });
  },

  pushToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...toast, id }] }));
    setTimeout(() => {
      get().removeToast(id);
    }, 4500);
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setApiToken: (token) => {
    if (typeof sessionStorage !== 'undefined') {
      if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      else sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
    set({ apiToken: token, authChecked: true });
  },

  claimLocalToken: async () => {
    try {
      const res = await fetch('/api/auth/claim-local-token', { method: 'POST' });
      if (!res.ok) return false;
      const data = (await res.json()) as { apiToken?: string };
      if (!data.apiToken) return false;
      get().setApiToken(data.apiToken);
      return true;
    } catch {
      return false;
    }
  },

  verifyAndSaveToken: async (token) => {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-token': token.trim() },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) return false;
      get().setApiToken(token.trim());
      return true;
    } catch {
      return false;
    }
  },

  apiFetch: async <T>(path: string, init?: RequestInit): Promise<T> => {
    const token = get().apiToken;
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-api-token': token } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 401) {
      get().setApiToken(null);
      throw new Error('Unauthorized: API token invalid or missing.');
    }
    const body = (await res.json()) as T & {
      error?: string;
      errors?: string[];
      details?: string[];
      fieldErrors?: Record<string, string>;
    };
    if (!res.ok) {
      const msg =
        body.errors?.join('; ') ||
        body.details?.join('; ') ||
        body.error ||
        `HTTP ${res.status}`;
      const err = new Error(msg) as Error & { fieldErrors?: Record<string, string> };
      if (body.fieldErrors) {
        err.fieldErrors = body.fieldErrors;
      }
      throw err;
    }
    return body;
  },

  hydrateAll: async () => {
    const { apiToken, apiFetch } = get();
    if (!apiToken) {
      set({ authChecked: true });
      return;
    }
    set({ loading: true });
    try {
      const status = await apiFetch<BotStatusSnapshot>('/api/status');
      const [posRes, trRes, anRes, scanRes, healthRes, setRes, walRes, logRes, shadowRes] =
        await Promise.all([
          apiFetch<{ positions: PositionRecord[] }>(`/api/positions?mode=${status.mode}`),
          apiFetch<{ trades: TradeRecord[] }>(`/api/trades?mode=${status.mode}`),
          apiFetch<AnalyticsSummary>(`/api/analytics?mode=${status.mode}`),
          apiFetch<{ seenTokens: SeenTokenRecord[]; rejections: RejectionRecord[] }>(
            '/api/scanner/state'
          ),
          apiFetch<{ sources: SourceHealthRecord[]; rpcs: RpcEndpointHealth[] }>(
            '/api/source-health'
          ),
          apiFetch<{ settings: BotSettings; history: SettingsHistoryEntry[] }>('/api/settings'),
          apiFetch<{ diagnostics: WalletDiagnostics; feeProfiles: WalletFeeProfile[] }>(
            '/api/wallets'
          ),
          apiFetch<{ logs: LogEntry[] }>('/api/logs?limit=250'),
          apiFetch<ShadowCompareData>('/api/shadow-compare'),
        ]);

      set({
        authChecked: true,
        loading: false,
        status,
        positions: posRes.positions,
        trades: trRes.trades,
        analytics: anRes,
        seenTokens: scanRes.seenTokens,
        rejections: scanRes.rejections,
        sources: healthRes.sources,
        rpcs: healthRes.rpcs,
        settings: setRes.settings,
        settingsHistory: setRes.history,
        walletDiagnostics: walRes.diagnostics,
        feeProfiles: walRes.feeProfiles,
        logs: logRes.logs,
        shadowCompare: shadowRes,
      });
    } catch (err) {
      set({ loading: false, authChecked: true });
      get().pushToast({
        kind: 'error',
        title: 'Sync error',
        body: err instanceof Error ? err.message : 'Failed to load bot state',
      });
    }
  },

  refreshModeData: async (modeOverride) => {
    const { apiFetch, status } = get();
    const targetMode = modeOverride ?? status?.mode ?? 'paper';
    const [nextStatus, posRes, trRes, anRes, shadowRes, scanRes, healthRes, logRes] =
      await Promise.all([
        apiFetch<BotStatusSnapshot>('/api/status'),
        apiFetch<{ positions: PositionRecord[] }>(`/api/positions?mode=${targetMode}`),
        apiFetch<{ trades: TradeRecord[] }>(`/api/trades?mode=${targetMode}`),
        apiFetch<AnalyticsSummary>(`/api/analytics?mode=${targetMode}`),
        apiFetch<ShadowCompareData>('/api/shadow-compare'),
        apiFetch<{ seenTokens: SeenTokenRecord[]; rejections: RejectionRecord[] }>(
          '/api/scanner/state'
        ),
        apiFetch<{ sources: SourceHealthRecord[]; rpcs: RpcEndpointHealth[] }>(
          '/api/source-health'
        ),
        apiFetch<{ logs: LogEntry[] }>('/api/logs?limit=250'),
      ]);
    set({
      status: nextStatus,
      positions: posRes.positions,
      trades: trRes.trades,
      analytics: anRes,
      shadowCompare: shadowRes,
      seenTokens: scanRes.seenTokens,
      rejections: scanRes.rejections,
      sources: healthRes.sources,
      rpcs: healthRes.rpcs,
      logs: logRes.logs,
    });
  },

  refreshScannerAndHealth: async () => {
    const { apiToken, apiFetch } = get();
    if (!apiToken) return;
    if (scannerRefreshInFlight) return scannerRefreshInFlight;
    scannerRefreshInFlight = (async () => {
      try {
        const [scanRes, healthRes] = await Promise.all([
          apiFetch<{ seenTokens: SeenTokenRecord[]; rejections: RejectionRecord[] }>(
            '/api/scanner/state'
          ),
          apiFetch<{ sources: SourceHealthRecord[]; rpcs: RpcEndpointHealth[] }>(
            '/api/source-health'
          ),
        ]);
        set({
          seenTokens: scanRes.seenTokens,
          rejections: scanRes.rejections,
          sources: healthRes.sources,
          rpcs: healthRes.rpcs,
        });
      } catch {
        // ignore transient refresh failure; next poll or SSE event will retry
      } finally {
        scannerRefreshInFlight = null;
      }
    })();
    return scannerRefreshInFlight;
  },

  connectSse: () => {
    const token = get().apiToken;
    if (!token) return () => undefined;

    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    let rejectionRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as BotStatusSnapshot;
        const prev = get().status;
        set({ status: data });
        const scanChanged =
          !prev ||
          prev.lastScanAtMs !== data.lastScanAtMs ||
          prev.runState !== data.runState ||
          prev.funnel.discovered !== data.funnel.discovered ||
          prev.funnel.validated !== data.funnel.validated ||
          prev.funnel.filtered !== data.funnel.filtered ||
          prev.funnel.securityPassed !== data.funnel.securityPassed ||
          prev.funnel.scored !== data.funnel.scored ||
          prev.funnel.bought !== data.funnel.bought;
        if (scanChanged) {
          void get().refreshScannerAndHealth();
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse((ev as MessageEvent).data) as LogEntry;
        set((s) => ({ logs: [entry, ...s.logs].slice(0, 400) }));
      } catch {
        // ignore
      }
    });

    es.addEventListener('positions_batch_update', (ev) => {
      try {
        const deltas = JSON.parse((ev as MessageEvent).data) as Array<{
          id: string;
          currentPriceUsd: number;
          currentLiquidityUsd: number;
          peakPnlPct: number;
          trailingArmed: boolean;
          trailingFloorPct: number | null;
          isStaleData: boolean;
        }>;
        const map = new Map(deltas.map((d) => [d.id, d]));
        set((s) => ({
          positions: s.positions.map((p) => {
            const d = map.get(p.id);
            if (!d) return p;
            return {
              ...p,
              currentPriceUsd: d.currentPriceUsd,
              currentLiquidityUsd: d.currentLiquidityUsd,
              peakPnlPct: d.peakPnlPct,
              trailingArmed: d.trailingArmed,
              trailingFloorPct: d.trailingFloorPct,
              isStaleData: d.isStaleData,
              priceHistory: [...p.priceHistory, d.currentPriceUsd].slice(-60),
            };
          }),
        }));
      } catch {
        // ignore
      }
    });

    es.addEventListener('rejection', (ev) => {
      try {
        const rej = JSON.parse((ev as MessageEvent).data) as RejectionRecord;
        set((s) => ({ rejections: [rej, ...s.rejections].slice(0, 200) }));
        if (!rejectionRefreshTimer) {
          rejectionRefreshTimer = setTimeout(() => {
            rejectionRefreshTimer = null;
            void get().refreshScannerAndHealth();
          }, 1200);
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener('execution_progress', (ev) => {
      try {
        const prog = JSON.parse((ev as MessageEvent).data) as ExecutionProgressEvent;
        set({ executionProgress: prog.step === 'done' ? null : prog });
      } catch {
        // ignore
      }
    });

    es.addEventListener('trade_event', () => {
      void get().refreshModeData();
    });

    es.addEventListener('wallet_insufficient', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          symbol?: string;
          message?: string;
        };
        get().pushToast({
          kind: 'error',
          title: data.symbol
            ? `No SOL / $ to buy ${data.symbol}`
            : 'No SOL / $ in wallet to trade',
          body: data.message || 'There is no SOL or $ in the wallet to trade.',
        });
      } catch {
        // ignore
      }
    });

    return () => {
      if (rejectionRefreshTimer) {
        clearTimeout(rejectionRefreshTimer);
        rejectionRefreshTimer = null;
      }
      es.close();
    };
  },
}));
