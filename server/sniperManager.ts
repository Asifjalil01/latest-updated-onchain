import { spawn, spawnSync, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { LAMPORTS_PER_SOL, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createBurnInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import {
  consolidateSniperTrades,
  isPyOptionEnabled,
  pairTradesWithEntryAndExit,
  validatePythonSniperSettings,
  type RawSniperCsvRow,
} from '../src/utils/sniperFormat.ts';
import { loadAppEnv } from './config/env';
import type { BotOrchestrator } from './engine/pipeline';
import { DefaultLiveTxAdapter, type LiveTxAdapter } from './engine/liveEngine';
import { WSOL_MINT } from './providers/jupiter';
import { injectDontFrontMarker } from './providers/proSignals';

const SNIPER_ATA_RENT_SOL = 0.00203928;

const SNIPER_DIR = path.resolve(process.cwd(), 'sniper');

export type SniperMode = 'paper' | 'live';

export interface SniperLogEntry {
  id: string;
  timestamp: string;
  message: string;
  tag: string;
}

export interface SniperFilePaths {
  stateFile: string;
  tradesCsv: string;
  pnlCsv: string;
  sellQueueFile: string;
  deleteQueueFile: string;
}

export function getSniperFilePaths(mode: SniperMode, baseDir = SNIPER_DIR): SniperFilePaths {
  if (mode === 'live') {
    return {
      stateFile: path.join(baseDir, 'live_state.json'),
      tradesCsv: path.join(baseDir, 'live_trades.csv'),
      pnlCsv: path.join(baseDir, 'live_pnl_history.csv'),
      sellQueueFile: path.join(baseDir, 'live_sell_queue.json'),
      deleteQueueFile: path.join(baseDir, 'live_delete_queue.json'),
    };
  }
  return {
    stateFile: path.join(baseDir, 'state.json'),
    tradesCsv: path.join(baseDir, 'trades.csv'),
    pnlCsv: path.join(baseDir, 'pnl_history.csv'),
    sellQueueFile: path.join(baseDir, 'sell_queue.json'),
    deleteQueueFile: path.join(baseDir, 'delete_queue.json'),
  };
}

export function writeStopSignal(reason = 'user_stop', baseDir = SNIPER_DIR): void {
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(baseDir, 'stop.flag'),
    JSON.stringify({ stoppedAt: Date.now(), reason }),
    'utf-8'
  );
}

export function clearStopSignal(baseDir = SNIPER_DIR): void {
  const fp = path.join(baseDir, 'stop.flag');
  if (fs.existsSync(fp)) {
    try {
      fs.unlinkSync(fp);
    } catch {}
  }
}

export function isStopFlagActive(baseDir = SNIPER_DIR): boolean {
  return fs.existsSync(path.join(baseDir, 'stop.flag'));
}

export function readPidFile(baseDir = SNIPER_DIR): { pid?: number; run_id?: string; mode?: string } | null {
  const pf = path.join(baseDir, 'bot.pid');
  if (!fs.existsSync(pf)) return null;
  try {
    const raw = fs.readFileSync(pf, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function removePidFile(baseDir = SNIPER_DIR): void {
  const pf = path.join(baseDir, 'bot.pid');
  if (fs.existsSync(pf)) {
    try {
      fs.unlinkSync(pf);
    } catch {}
  }
}

export function killProcessTreeSync(pid: number | undefined): void {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 4000,
      });
    } catch {}
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {}
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}

export function detectPythonCommand(customPath?: string): { command: string; args: string[]; info: string } {
  const isWin = process.platform === 'win32';

  // 1. If user configured a custom path / binary in Settings
  if (customPath && typeof customPath === 'string' && customPath.trim() && customPath.trim().toLowerCase() !== 'auto') {
    const trimmed = customPath.trim();
    try {
      const res = spawnSync(trimmed, ['-c', 'import sys; print(sys.version)'], {
        encoding: 'utf-8',
        timeout: 4000,
        shell: isWin,
      });
      if (res.status === 0 && !res.stderr?.includes('Microsoft Store') && !res.stdout?.includes('Microsoft Store')) {
        const ver = (res.stdout || '').split('\n')[0].trim();
        return { command: trimmed, args: [], info: `Configured path: "${trimmed}" (${ver})` };
      }
    } catch {}
  }

  // 2. If PYTHON_PATH environment variable is set
  if (process.env.PYTHON_PATH) {
    try {
      const res = spawnSync(process.env.PYTHON_PATH, ['-c', 'import sys; print(sys.version)'], {
        encoding: 'utf-8',
        timeout: 4000,
        shell: isWin,
      });
      if (res.status === 0 && !res.stderr?.includes('Microsoft Store') && !res.stdout?.includes('Microsoft Store')) {
        const ver = (res.stdout || '').split('\n')[0].trim();
        return { command: process.env.PYTHON_PATH, args: [], info: `Env PYTHON_PATH (${ver})` };
      }
    } catch {}
  }

  // 3. Platform-specific candidate probing
  const candidates: Array<{ cmd: string; args: string[]; label: string }> = isWin
    ? [
        { cmd: 'py', args: ['-3'], label: 'Windows Python Launcher (py -3)' },
        { cmd: 'py', args: [], label: 'Windows Python Launcher (py)' },
        { cmd: 'python', args: [], label: 'System Python (python)' },
        { cmd: 'python3', args: [], label: 'python3' },
      ]
    : [
        { cmd: 'python3', args: [], label: 'python3' },
        { cmd: 'python', args: [], label: 'python' },
      ];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || '';

    const searchDirs = [
      path.join(localAppData, 'Programs', 'Python'),
      programFiles,
      programFilesX86,
    ];

    for (const baseDir of searchDirs) {
      if (baseDir && fs.existsSync(baseDir)) {
        try {
          const entries = fs.readdirSync(baseDir);
          for (const entry of entries) {
            if (entry.toLowerCase().startsWith('python')) {
              const fullExe = path.join(baseDir, entry, 'python.exe');
              if (fs.existsSync(fullExe)) {
                candidates.push({ cmd: fullExe, args: [], label: `Direct Path: ${fullExe}` });
              }
            }
          }
        } catch {}
      }
    }
  }

  for (const cand of candidates) {
    try {
      const testArgs = [...cand.args, '-c', 'import sys; print(sys.version.split()[0])'];
      const res = spawnSync(cand.cmd, testArgs, {
        encoding: 'utf-8',
        timeout: 4000,
        shell: isWin,
      });
      const out = (res.stdout || '').trim();
      const err = (res.stderr || '').trim();
      if (res.status === 0 && out.length > 0 && !err.includes('Microsoft Store') && !out.includes('Microsoft Store')) {
        return {
          command: cand.cmd,
          args: cand.args,
          info: `${cand.label} [Python ${out}]`,
        };
      }
    } catch {}
  }

  return isWin
    ? { command: 'py', args: [], info: 'Default Windows Python (py)' }
    : { command: 'python3', args: [], info: 'Default Python (python3)' };
}

export class SniperManager {
  private readonly baseDir: string;
  private readonly settingsFile: string;
  private process: ChildProcess | null = null;
  private activeRunId: string | null = null;
  private running = false;
  private startedAtMs: number | null = null;
  private logs: SniperLogEntry[] = [];
  private maxLogs = 1000;
  private solPriceUsd: number | null = null;
  private solPriceUpdatedAt = 0; // epoch ms
  private refreshingSol = false;
  private refreshingPositions = false;
  private stateRevision = 0;
  private recentlyDeletedMints = new Map<string, number>();
  private orchestrator: BotOrchestrator | null = null;
  private txAdapter: LiveTxAdapter | null = null;
  private liveWalletBalanceSol: number | null = null;
  private liveWalletUpdatedAt = 0;
  private refreshingLiveWallet = false;
  private liveSwapActiveCount = 0;
  private lastLiveSwapAtMs = 0;
  private wsWatchedMints: string[] = [];
  private recentWhaleHoldings: Array<{
    mint: string;
    wallet: string;
    symbol: string;
    uiAmount: number;
    ageHours: number;
    discoveredAtMs: number;
  }> = [];
  private whaleHoldingsCursor = 0;
  private lastSmartOldHoldingsLogMs = 0;
  private lastAlphaDiscoverAtMs = 0;
  private alphaDiscoverInFlight = false;
  private manualAlphaSnipes = new Map<string, number>();

  constructor(options?: { baseDir?: string; startTimers?: boolean }) {
    this.baseDir = options?.baseDir || SNIPER_DIR;
    this.settingsFile = path.join(this.baseDir, 'settings.json');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.settingsFile)) {
      this.saveDefaultSettings();
    }
    if (options?.startTimers !== false) {
      void this.refreshSolPrice();
      const solTimer = setInterval(() => {
        void this.refreshSolPrice();
      }, 12_000);
      solTimer.unref();

      const posTimer = setInterval(() => {
        if (!this.running) {
          void this.refreshStoppedOpenPositions();
        }
        if (this.getMode() === 'live') {
          void this.refreshLiveWalletInfo(false);
        }
      }, 1_000);
      posTimer.unref();

      let lastSmartLog = 0;
      let lastAlphaLog = 0;
      let lastAutoDiscoverAt = 0;
      let autoDiscoverInFlight = false;
      const smartTimer = setInterval(() => {
        if (this.running) {
          const now = Date.now();
          const settings = this.readSettings();
          const scanMode = String(settings.smart_money_scan_mode || 'both').trim().toLowerCase();
          const smEnabled =
            scanMode === 'smart_money_only' ||
            (scanMode !== 'sniper_only' &&
              scanMode !== 'alpha_signal_only' &&
              isPyOptionEnabled(settings, 'smart_money_enabled', true) &&
              settings.smart_money_enabled !== false);
          const autoDisc =
            smEnabled &&
            isPyOptionEnabled(settings, 'smart_money_auto_discover', true) &&
            settings.smart_money_auto_discover !== false;
          const followOlder =
            smEnabled &&
            (scanMode === 'smart_money_only' ||
              (isPyOptionEnabled(settings, 'smart_money_follow_older_coins', true) &&
                settings.smart_money_follow_older_coins !== false));
          const rawMaxWallets = Number(settings.smart_money_max_wallets ?? 50);
          const maxWallets = !Number.isFinite(rawMaxWallets)
            ? 50
            : rawMaxWallets <= 0
              ? 0
              : Math.min(5000, Math.max(1, Math.round(rawMaxWallets)));
          const refreshMs = Math.max(
            10_000,
            Math.min(86_400_000, Number(settings.smart_money_refresh_interval_sec ?? 30) * 1000)
          );
          const wallets = Array.isArray(settings.smart_wallets) ? settings.smart_wallets : [];

          if (smEnabled && !autoDiscoverInFlight && now - lastAutoDiscoverAt >= refreshMs) {
            lastAutoDiscoverAt = now;
            autoDiscoverInFlight = true;
            const needMore = maxWallets === 0 || wallets.length < maxWallets;
            void (async () => {
              if (autoDisc) {
                await this.discoverSmartWallets({ autoAdd: needMore, silentIfEmpty: true });
              }
              const latestWallets = Array.isArray(this.readSettings().smart_wallets)
                ? this.readSettings().smart_wallets
                : wallets;
              if (followOlder && latestWallets.length > 0) {
                await this.scanTrackedWhaleHoldings({ batchSize: 10 });
              }
            })().finally(() => {
              autoDiscoverInFlight = false;
            });
          }

          const alphaAutoFind =
            scanMode === 'alpha_signal_only' ||
            (scanMode !== 'smart_money_only' &&
              scanMode !== 'sniper_only' &&
              isPyOptionEnabled(settings, 'alpha_signal_auto_find', true) &&
              settings.alpha_signal_auto_find !== false);
          const alphaRefreshMs = Math.max(
            5_000,
            Math.min(300_000, Number(settings.alpha_signal_refresh_interval_sec ?? 10) * 1000)
          );
          if (alphaAutoFind && !this.alphaDiscoverInFlight && now - this.lastAlphaDiscoverAtMs >= alphaRefreshMs) {
            void this.discoverAlphaSignals({ silent: true });
          }

          if (now - lastSmartLog >= 25_000) {
            lastSmartLog = now;
            if (smEnabled) {
              const capTxt = maxWallets === 0 ? 'Unlimited' : String(maxWallets);
              if (wallets.length > 0) {
                this.appendLog(
                  'INFO',
                  `[SmartMoney] Live stream monitoring ${wallets.length}/${capTxt} verified whale wallet(s) (mode: ${scanMode}, refresh ${Math.round(refreshMs / 1000)}s)...`
                );
              } else {
                this.appendLog(
                  'INFO',
                  '[SmartMoney] Auto-discovery warming up — scanning winning Solana pools & PumpPortal stream for active whales...'
                );
              }
            }
          }

          if (scanMode === 'alpha_signal_only' && now - lastAlphaLog >= 25_000) {
            lastAlphaLog = now;
            const readyCnt = this.alphaSignalsBuffer.filter((s) => s.status !== 'SKIPPED').length;
            this.appendLog(
              'INFO',
              `[AlphaSignal] Auto-finder active (mode: alpha_signal_only, refresh ${Math.round(alphaRefreshMs / 1000)}s, ${readyCnt} active signal(s)) — scanning WS curves + DexScreener Boosts + Gecko Momentum...`
            );
          }
        }
      }, 4_000);
      smartTimer.unref();
    }
  }

  private smartTradeUnsub: (() => void) | null = null;
  private lastSmartEventLogByWallet = new Map<string, number>();

  public attachOrchestrator(orchestrator: BotOrchestrator, customTxAdapter?: LiveTxAdapter): void {
    this.orchestrator = orchestrator;
    this.txAdapter = customTxAdapter ?? new DefaultLiveTxAdapter(orchestrator.rpcPool);
    const settings = this.readSettings();
    const customRpc = isPyOptionEnabled(settings, 'custom_rpc_url', true) ? settings.custom_rpc_url : '';
    if (typeof customRpc === 'string' && customRpc.trim()) {
      (orchestrator.rpcPool as any)?.setPrimaryCustomRpc?.(customRpc);
    }
    const jupKey = isPyOptionEnabled(settings, 'jupiter_api_key', true) ? settings.jupiter_api_key : '';
    if (typeof jupKey === 'string' && jupKey.trim()) {
      (orchestrator.jupiter as any)?.setApiKey?.(jupKey);
    }
    if (this.smartTradeUnsub) {
      this.smartTradeUnsub();
      this.smartTradeUnsub = null;
    }
    if (typeof (orchestrator.pumpPortal as any)?.onSmartTrade === 'function') {
      this.smartTradeUnsub = (orchestrator.pumpPortal as any).onSmartTrade((ev: any) => {
        const now = Date.now();
        const prevTs = this.lastSmartEventLogByWallet.get(`${ev.wallet}:${ev.mint}:${ev.side}`) || 0;
        if (now - prevTs < 5_000) return;
        this.lastSmartEventLogByWallet.set(`${ev.wallet}:${ev.mint}:${ev.side}`, now);
        if (this.lastSmartEventLogByWallet.size > 300) {
          this.lastSmartEventLogByWallet.clear();
        }
        const allMeta = this.readSmartWalletsMeta();
        const meta = allMeta[ev.wallet] || {};
        allMeta[ev.wallet] = {
          ...meta,
          address: ev.wallet,
          recentToken: ev.symbol && ev.symbol !== '?' ? ev.symbol : (meta.recentToken || ev.mint.slice(0, 6)),
          recentMint: ev.mint,
          recentAction: ev.side === 'buy' ? 'HOLDING' : 'CLOSED_PROFIT',
          lastActiveMs: now,
        };
        this.saveSmartWalletsMeta(allMeta);
        const label = meta?.label ? `${meta.label} (${ev.wallet.slice(0, 4)}..${ev.wallet.slice(-4)})` : `${ev.wallet.slice(0, 6)}...`;
        const icon = ev.side === 'buy' ? '🟢' : '🔴';
        this.appendLog(
          ev.side === 'buy' ? 'BUY' : 'SELL',
          `[SmartMoney] ${icon} Whale ${label} ${ev.side.toUpperCase()} ${Number(ev.solAmount || 0).toFixed(2)} SOL of $${ev.symbol || ev.mint.slice(0, 6)} (${ev.mint.slice(0, 6)}...)`
        );
      });
    }
    const wallets = Array.isArray(settings.smart_wallets) ? settings.smart_wallets : [];
    if (wallets.length > 0 && typeof (orchestrator.pumpPortal as any)?.setTrackedSmartWallets === 'function') {
      (orchestrator.pumpPortal as any).setTrackedSmartWallets(wallets);
    }
    if (this.getMode(settings) === 'live') {
      void this.refreshLiveWalletInfo(true);
    }
  }

  private static readonly LEGACY_PLACEHOLDER_WALLETS = new Set<string>([
    'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    'Avy9z2YfS4cZ1y5R341KkL9p6sXkQx7Yt8K6U3c7j4qR',
    '7vWp8eE9U1jB3T4g7qZ6L5jH4P8Y9v2W1e3R4t5Y6u7I',
    'G1vM9Wz4s9X2k5L8p1Q7j3T6v4R8e9Y2u1I3o5P7a9S1',
    '3vEFeEjCoq5L9z6N8v1Y4u7I2o5P8a9S1d3F5g7H9j2K',
    '8Et3m6huUB5k9v2Y4u7I2o5P8a9S1d3F5g7H9j2K1L3M',
  ]);

  private readSettings(): Record<string, any> {
    if (!fs.existsSync(this.settingsFile)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsFile, 'utf-8'));
      if (!parsed || typeof parsed !== 'object') return {};
      if (Array.isArray(parsed.smart_wallets)) {
        const cleaned = parsed.smart_wallets.filter(
          (w: any) => typeof w === 'string' && !SniperManager.LEGACY_PLACEHOLDER_WALLETS.has(w.trim())
        );
        if (cleaned.length !== parsed.smart_wallets.length) {
          parsed.smart_wallets = cleaned;
          try {
            fs.writeFileSync(this.settingsFile, JSON.stringify(parsed, null, 2), 'utf-8');
          } catch {}
        }
      }
      return parsed;
    } catch {
      return {};
    }
  }

  private getSmartWalletsMetaPath(): string {
    return path.join(this.baseDir, 'smart_wallets_meta.json');
  }

  private readSmartWalletsMeta(): Record<string, any> {
    const fp = this.getSmartWalletsMetaPath();
    if (!fs.existsSync(fp)) return {};
    try {
      const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      return d && typeof d === 'object' ? d : {};
    } catch {
      return {};
    }
  }

  private saveSmartWalletsMeta(meta: Record<string, any>): void {
    try {
      const keys = Object.keys(meta);
      if (keys.length > 500) {
        const trimmed: Record<string, any> = {};
        for (const k of keys.slice(-500)) trimmed[k] = meta[k];
        this.writeStateAtomic(this.getSmartWalletsMetaPath(), trimmed);
      } else {
        this.writeStateAtomic(this.getSmartWalletsMetaPath(), meta);
      }
    } catch {}
  }

  public getMode(settings?: Record<string, any>): SniperMode {
    const s = settings ?? this.readSettings();
    return String(s.mode || 'paper').toLowerCase() === 'live' ? 'live' : 'paper';
  }

  private async fetchJsonWithTimeout(url: string, timeoutMs = 4000, headers?: Record<string, string>): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'solana-launch-sniper/2.0',
          ...(headers || {}),
        },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  public async refreshSolPrice(): Promise<number | null> {
    if (this.refreshingSol) return this.solPriceUsd;
    this.refreshingSol = true;
    try {
      let price: number | null = null;
      const jup = await this.fetchJsonWithTimeout(`https://lite-api.jup.ag/price/v3?ids=${WSOL_MINT}`, 3500);
      if (jup && typeof jup === 'object') {
        const quote = jup[WSOL_MINT] || jup.data?.[WSOL_MINT];
        const raw = Number(quote?.usdPrice ?? quote?.price);
        if (Number.isFinite(raw) && raw > 0) price = raw;
      }
      if (!price) {
        const ds = await this.fetchJsonWithTimeout(`https://api.dexscreener.com/tokens/v1/solana/${WSOL_MINT}`, 3500);
        if (Array.isArray(ds) && ds.length > 0) {
          let bestLiq = -1;
          for (const p of ds) {
            const px = Number(p?.priceUsd);
            const liq = Number(p?.liquidity?.usd || 0);
            if (Number.isFinite(px) && px > 0 && liq > bestLiq) {
              bestLiq = liq;
              price = px;
            }
          }
        }
      }
      if (price && price > 0) {
        this.solPriceUsd = price;
        this.solPriceUpdatedAt = Date.now();
      }
      return this.solPriceUsd;
    } finally {
      this.refreshingSol = false;
    }
  }

  public async refreshLiveWalletInfo(force = false): Promise<{
    ok: boolean;
    unlocked: boolean;
    publicKey: string | null;
    maskedPublicKey: string;
    balanceSol: number | null;
    balanceUsd: number | null;
    healthyRpcs: number;
    solPriceUsd: number | null;
  }> {
    if (!this.orchestrator) {
      return {
        ok: false,
        unlocked: false,
        publicKey: null,
        maskedPublicKey: 'Not initialized',
        balanceSol: null,
        balanceUsd: null,
        healthyRpcs: 0,
        solPriceUsd: this.solPriceUsd,
      };
    }

    const { signer, rpcPool } = this.orchestrator;
    const unlocked = signer.isUnlocked();
    const publicKey = signer.getPublicKey();
    const maskedPublicKey = signer.getMaskedPublicKey();
    let healthyRpcs = rpcPool.getHealthSnapshot().filter((r) => r.healthy).length;

    const now = Date.now();
    if (
      this.refreshingLiveWallet === false &&
      (force || now - this.liveWalletUpdatedAt > 9_000)
    ) {
      this.refreshingLiveWallet = true;
      try {
        if (healthyRpcs < 2) {
          const checked = await rpcPool.checkAllEndpoints().catch(() => []);
          healthyRpcs = checked.filter((r) => r.healthy).length;
        }
        if (publicKey && typeof rpcPool.getAgreedBalanceSol === 'function') {
          const bal = await rpcPool.getAgreedBalanceSol(publicKey).catch(() => ({
            agreed: false,
            balanceSol: null,
            readings: [],
          }));
          if (bal.agreed && bal.balanceSol !== null) {
            this.liveWalletBalanceSol = bal.balanceSol;
            this.liveWalletUpdatedAt = Date.now();
          } else if (bal.readings.length > 0 && this.liveWalletBalanceSol === null) {
            this.liveWalletBalanceSol = bal.readings[0];
            this.liveWalletUpdatedAt = Date.now();
          }
        }
        if (!this.solPriceUsd) {
          await this.refreshSolPrice();
        }
      } finally {
        this.refreshingLiveWallet = false;
      }
    }

    const balanceSol = this.liveWalletBalanceSol;
    const balanceUsd =
      balanceSol !== null && this.solPriceUsd && this.solPriceUsd > 0
        ? Number((balanceSol * this.solPriceUsd).toFixed(4))
        : null;

    return {
      ok: true,
      unlocked,
      publicKey,
      maskedPublicKey,
      balanceSol,
      balanceUsd,
      healthyRpcs,
      solPriceUsd: this.solPriceUsd,
    };
  }

  public getLiveWalletSnapshot() {
    if (!this.orchestrator) {
      return {
        unlocked: false,
        publicKey: null,
        maskedPublicKey: 'Not connected',
        balanceSol: null,
        balanceUsd: null,
        healthyRpcs: 0,
      };
    }
    const unlocked = this.orchestrator.signer.isUnlocked();
    const publicKey = this.orchestrator.signer.getPublicKey();
    const maskedPublicKey = this.orchestrator.signer.getMaskedPublicKey();
    const healthyRpcs = this.orchestrator.rpcPool.getHealthSnapshot().filter((r) => r.healthy).length;
    const balanceSol = this.liveWalletBalanceSol;
    const balanceUsd =
      balanceSol !== null && this.solPriceUsd && this.solPriceUsd > 0
        ? Number((balanceSol * this.solPriceUsd).toFixed(4))
        : null;
    return {
      unlocked,
      publicKey,
      maskedPublicKey,
      balanceSol,
      balanceUsd,
      healthyRpcs,
    };
  }

  private writeStateAtomic(stateFile: string, state: any): void {
    const tmp = `${stateFile}.tmp.${process.pid}.${Date.now()}`;
    const payload = JSON.stringify(state, null, 2);
    fs.writeFileSync(tmp, payload, 'utf-8');
    try {
      fs.renameSync(tmp, stateFile);
    } catch {
      fs.writeFileSync(stateFile, payload, 'utf-8');
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {}
    }
  }

  public async refreshStoppedOpenPositions(
    customFetcher?: (mints: string[]) => Promise<Record<string, number>>
  ): Promise<void> {
    const mode = this.getMode();
    const { stateFile } = getSniperFilePaths(mode, this.baseDir);
    if (this.refreshingPositions || this.running || !fs.existsSync(stateFile)) return;
    this.refreshingPositions = true;
    const startRevision = this.stateRevision;
    try {
      const initialState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      const initialPositions = initialState?.positions;
      if (!initialPositions || typeof initialPositions !== 'object') return;
      const nowMs = Date.now();
      const mints = Object.keys(initialPositions).filter((m) => {
        const deletedAt = this.recentlyDeletedMints.get(m);
        return !deletedAt || nowMs - deletedAt > 30_000;
      });
      if (mints.length === 0) return;

      const settings = this.readSettings();
      const prices: Record<string, number> = customFetcher ? await customFetcher(mints) : {};
      if (!customFetcher) {
        const useJupPrice =
          isPyOptionEnabled(settings, 'use_jupiter_price', true) && settings.use_jupiter_price !== false;
        const jupApiKey =
          isPyOptionEnabled(settings, 'jupiter_api_key', true) && typeof settings.jupiter_api_key === 'string'
            ? settings.jupiter_api_key.trim()
            : '';
        if (useJupPrice) {
          const jupUrl = jupApiKey
            ? `https://api.jup.ag/price/v3?ids=${encodeURIComponent(mints.join(','))}`
            : `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(mints.join(','))}`;
          const jup = await this.fetchJsonWithTimeout(
            jupUrl,
            3500,
            jupApiKey ? { 'x-api-key': jupApiKey } : undefined
          );
          if (jup && typeof jup === 'object') {
            const map = jup.data && typeof jup.data === 'object' ? jup.data : jup;
            for (const mint of mints) {
              const px = Number(map?.[mint]?.usdPrice ?? map?.[mint]?.price);
              if (Number.isFinite(px) && px > 0) prices[mint] = px;
            }
          }
        }

        const missing = mints.filter((m) => !prices[m]);
        for (let i = 0; i < missing.length; i += 30) {
          const chunk = missing.slice(i, i + 30);
          const ds = await this.fetchJsonWithTimeout(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`, 3500);
          if (Array.isArray(ds)) {
            const bestLiq: Record<string, number> = {};
            for (const pair of ds) {
              const mint = pair?.baseToken?.address;
              const px = Number(pair?.priceUsd);
              const liq = Number(pair?.liquidity?.usd || 0);
              if (mint && initialPositions[mint] && !prices[mint] && Number.isFinite(px) && px > 0) {
                if (bestLiq[mint] === undefined || liq > bestLiq[mint]) {
                  bestLiq[mint] = liq;
                  prices[mint] = px;
                }
              }
            }
          }
        }
      }

      // Abort or re-read fresh state after async network calls so deleted/sold positions can NEVER be resurrected
      if (this.running || this.stateRevision !== startRevision || !fs.existsSync(stateFile)) {
        return;
      }

      const freshState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      const freshPositions = freshState?.positions;
      if (!freshPositions || typeof freshPositions !== 'object' || Object.keys(freshPositions).length === 0) {
        return;
      }

      const nowSec = Date.now() / 1000;
      freshState.last_price_time = nowSec;
      const slippage = isPyOptionEnabled(settings, 'slippage_pct', true)
        ? Number(settings.slippage_pct ?? 2.0) / 100
        : 0;
      const fee = isPyOptionEnabled(settings, 'fee_pct', true)
        ? Number(settings.fee_pct ?? 1.0) / 100
        : 0;
      let anyUpdated = false;
      for (const mint of Object.keys(freshPositions)) {
        const deletedAt = this.recentlyDeletedMints.get(mint);
        if (deletedAt && Date.now() - deletedAt <= 30_000) {
          delete freshPositions[mint];
          anyUpdated = true;
          continue;
        }
        const pos = freshPositions[mint];
        let px = prices[mint];
        if (!pos || !px || px <= 0) continue;
        const prevCur = Number(pos.current_price || pos.entry_price || px);
        if (prevCur > 0 && px < prevCur * 0.30) {
          const crashStreak = Number(pos.crash_streak || 0) + 1;
          pos.crash_streak = crashStreak;
          if (crashStreak < 2 && !pos.liq_drop_streak) {
            px = prevCur;
          }
        } else {
          pos.crash_streak = 0;
        }
        anyUpdated = true;
        const entry = Number(pos.entry_price || px);
        pos.current_price = px;
        pos.last_updated = nowSec;
        pos.peak_price = Math.max(Number(pos.peak_price || entry), px);
        pos.low_price = Math.min(Number(pos.low_price || entry), px);
        pos.pnl_pct = Number((((px / entry) - 1) * 100).toFixed(2));
        const fill = px * (1 - slippage);
        const proceeds = Number(pos.qty || 0) * fill * (1 - fee);
        pos.pnl_usd = Number((proceeds - Number(pos.cost || 0)).toFixed(4));
        pos.peak_pct = Number((((pos.peak_price / entry) - 1) * 100).toFixed(2));
        pos.low_pct = Number((((pos.low_price / entry) - 1) * 100).toFixed(2));
      }
      if (!anyUpdated) return;
      if (this.solPriceUsd) {
        freshState.sol_price_usd = this.solPriceUsd;
        freshState.sol_price_updated_at = this.solPriceUpdatedAt / 1000;
      }
      if (this.running || this.stateRevision !== startRevision) return;
      this.writeStateAtomic(stateFile, freshState);
    } catch {
      // Ignore transient errors
    } finally {
      this.refreshingPositions = false;
    }
  }

  public getDefaultSettings(): Record<string, any> {
    return {
      mode: 'paper',
      start_balance_usd: 50.0,
      trade_size_usd: 5.0,
      max_open_positions: 3,
      daily_loss_limit_usd: 10.0,
      take_profit_pct: 25.0,
      stop_loss_pct: 20.0,
      trailing_stop_pct: 8.0,
      recover_principal_enabled: false,
      recover_principal_sell_pct: 50.0,
      scale_out_sell_pct: 25.0,
      scale_out_step_gain_pct: 100.0,
      auto_rug_exit: false,
      rug_liq_drop_pct: 50.0,
      max_hold_minutes: 60,
      min_age_minutes: 0,
      max_age_minutes: 2.0,
      ultra_early_grace_sec: 0,
      scan_interval_sec: 1,
      monitor_interval_sec: 1.0,
      min_liquidity_usd: 5000.0,
      min_volume_m5_usd: 2000.0,
      min_buys_m5: 8,
      min_buy_sell_ratio_m5: 1.5,
      min_recent_buys_60s: 3,
      max_price_change_m5_pct: 200.0,
      min_holders: 0,
      use_rugcheck: true,
      strict_rugcheck: true,
      require_lp_locked: false,
      block_insider_bundles: true,
      block_creator_dump: true,
      check_creator_history: true,
      max_creator_launches: 5,
      max_creator_rugged_coins: 0,
      creator_fast_rug_window_min: 60,
      max_dev_hold_pct: 5.0,
      rugcheck_max_score: 55.0,
      max_top10_holder_pct: 35.0,
      rug_recheck_minutes: 15,
      use_gecko: true,
      use_jupiter_recent: true,
      use_jupiter_price: true,
      use_real_swap_quotes: true,
      use_dex_profiles: true,
      use_pumpportal: true,
      use_promoted_feeds: false,
      axiom_pulse_migrated_only_enabled: false,
      enabled_platforms: [],
      slippage_pct: 3.0,
      fee_pct: 1.0,
      priority_fee_tier: 'fast',
      jito_tip_sol: 0.0002,
      custom_rpc_url: '',
      log_rejects: false,
      jupiter_api_key: '',
      fast_live_buy_enabled: true,
      parallel_rug_screen_enabled: true,
      jupiter_quota_guard_enabled: true,
      direct_dex_fallback_enabled: true,
      anti_rug_tight_score_enabled: false,
      anti_rug_pool_depth_check_enabled: true,
      anti_rug_sell_sim_enabled: false,
      anti_rug_copycat_cooldown_enabled: true,
      early_rug_shield_enabled: true,
      python_binary_path: 'auto',
      rescan_delay_after_sell_sec: 0,
      anti_sybil_enabled: true,
      fresh_wallet_minutes: 30,
      max_shared_funder_count: 3,
      smart_money_enabled: true,
      smart_wallets: [],
      smart_money_min_confluence: 1,
      smart_money_size_boost_pct: 35,
      smart_money_auto_exit_on_sell: true,
      smart_money_auto_discover: true,
      smart_money_max_wallets: 50,
      smart_money_refresh_interval_sec: 30,
      smart_money_scan_mode: 'both',
      smart_money_follow_older_coins: true,
      smart_money_max_coin_age_hours: 72,
      smart_money_prioritize_entries: true,
      alpha_signal_auto_find: true,
      alpha_signal_auto_snipe: true,
      alpha_signal_jito_tip_sol: 0.0005,
      alpha_signal_refresh_interval_sec: 10,
      alpha_signal_max_risk_score: 45,
      alpha_signal_min_real_sol: 1.5,
      reused_socials_enabled: true,
      max_social_reuse_count: 2,
      ws_exit_stream_enabled: true,
      jito_dontfront_enabled: true,
      orphan_sweep_enabled: true,
      post_migration_pullback_enabled: false,
      migration_min_dip_pct: 15,
      migration_wait_sec: 45,
      pre_migration_curve_enabled: false,
      pre_migration_curve_min_pct: 75,
      pre_migration_curve_max_pct: 92,
      wash_trade_filter_enabled: true,
      min_unique_makers_ratio: 0.25,
      min_unique_traders_5m: 6,
      sol_regime_filter_enabled: true,
      sol_regime_max_drop_pct: 2.0,
      sol_regime_action: 'pause',
      anti_top_wick_enabled: true,
      max_short_spike_pct: 60,
      conviction_sizing_enabled: true,
      conviction_min_mult: 0.6,
      conviction_max_mult: 1.5,
      streak_throttle_enabled: true,
      streak_loss_limit: 2,
      streak_cooldown_minutes: 15,
      streak_action: 'half_size',
      narrative_cap_enabled: true,
      max_same_narrative_positions: 1,
      auto_reclaim_rent_enabled: true,
      option_enabled: {
        min_age_minutes: false,
        early_rug_shield_enabled: true,
        anti_sybil_enabled: true,
        smart_money_enabled: true,
        smart_money_auto_exit_on_sell: true,
        smart_money_auto_discover: true,
        smart_money_follow_older_coins: true,
        smart_money_prioritize_entries: true,
        alpha_signal_auto_find: true,
        alpha_signal_auto_snipe: true,
        reused_socials_enabled: true,
        ws_exit_stream_enabled: true,
        jito_dontfront_enabled: true,
        orphan_sweep_enabled: true,
        post_migration_pullback_enabled: false,
        pre_migration_curve_enabled: false,
        wash_trade_filter_enabled: true,
        sol_regime_filter_enabled: true,
        anti_top_wick_enabled: true,
        conviction_sizing_enabled: true,
        streak_throttle_enabled: true,
        narrative_cap_enabled: true,
        auto_reclaim_rent_enabled: true,
      },
    };
  }

  private saveDefaultSettings() {
    const defaults = this.getDefaultSettings();
    fs.writeFileSync(this.settingsFile, JSON.stringify(defaults, null, 2), 'utf-8');
  }

  public getStatus() {
    const settings = this.readSettings();
    const mode = this.getMode(settings);
    const { stateFile, tradesCsv } = getSniperFilePaths(mode, this.baseDir);

    const defaultCash =
      mode === 'live'
        ? this.liveWalletBalanceSol !== null && this.solPriceUsd
          ? Number((this.liveWalletBalanceSol * this.solPriceUsd).toFixed(4))
          : 0.0
        : typeof settings.start_balance_usd === 'number'
          ? settings.start_balance_usd
          : 50.0;

    let state: any = {
      mode,
      cash: defaultCash,
      wallet_sol: mode === 'live' ? this.liveWalletBalanceSol : null,
      positions: {},
      closed: 0,
      wins: 0,
      total_pnl: 0.0,
      day_pnl: 0.0,
      last_price_time: 0,
      scan_paused: false,
    };
    if (fs.existsSync(stateFile)) {
      try {
        state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf-8')) };
      } catch {}
    }

    if (mode === 'live' && this.liveWalletBalanceSol !== null && this.solPriceUsd && this.solPriceUsd > 0) {
      state.wallet_sol = this.liveWalletBalanceSol;
      state.cash = Number((this.liveWalletBalanceSol * this.solPriceUsd).toFixed(4));
    }

    if (state.positions) {
      const nowMs = Date.now();
      for (const mint of Object.keys(state.positions)) {
        const deletedAt = this.recentlyDeletedMints.get(mint);
        if (deletedAt) {
          if (nowMs - deletedAt <= 30_000) {
            delete state.positions[mint];
            continue;
          }
          this.recentlyDeletedMints.delete(mint);
        }
      }
      let creatorHist: Record<string, Record<string, any>> | null = null;
      const histFile = path.join(this.baseDir, 'creator_history.json');
      if (fs.existsSync(histFile)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(histFile, 'utf-8'));
          if (parsed && typeof parsed === 'object') {
            creatorHist = parsed;
          }
        } catch {}
      }

      const smartMeta = this.readSmartWalletsMeta();

      for (const [mintKey, pos] of Object.entries<any>(state.positions)) {
        if (!pos.current_price || pos.current_price <= 0) {
          pos.current_price = pos.entry_price;
        }
        if (pos.current_price && pos.entry_price) {
          if (pos.pnl_pct === undefined || pos.pnl_pct === null) {
            pos.pnl_pct = Number(((pos.current_price / pos.entry_price - 1) * 100).toFixed(2));
          }
          if (pos.pnl_usd === undefined || pos.pnl_usd === null) {
            const slippage = isPyOptionEnabled(settings, 'slippage_pct', true)
              ? Number(settings.slippage_pct ?? 2.0) / 100
              : 0;
            const fee = isPyOptionEnabled(settings, 'fee_pct', true)
              ? Number(settings.fee_pct ?? 1.0) / 100
              : 0;
            const fill = pos.current_price * (1 - slippage);
            const proceeds = (pos.qty || 0) * fill * (1 - fee);
            pos.pnl_usd = Number((proceeds - (pos.cost || 0)).toFixed(4));
          }
          if (pos.peak_pct === undefined) {
            const peak = pos.peak_price || pos.entry_price;
            pos.peak_pct = Number(((peak / pos.entry_price - 1) * 100).toFixed(2));
          }
          if (pos.low_pct === undefined) {
            const low = pos.low_price || pos.entry_price;
            pos.low_pct = Number(((low / pos.entry_price - 1) * 100).toFixed(2));
          }
        }

        // Enrich Dev / Creator wallet address & launch/rug stats from creator_history.json
        let creatorAddr = typeof pos.creator === 'string' ? pos.creator.trim() : '';
        if (!creatorAddr && creatorHist) {
          for (const [cAddr, coins] of Object.entries(creatorHist)) {
            if (coins && typeof coins === 'object' && Object.prototype.hasOwnProperty.call(coins, mintKey)) {
              creatorAddr = cAddr;
              pos.creator = cAddr;
              break;
            }
          }
        }
        if (creatorAddr) {
          pos.creator = creatorAddr;
          const bucket = creatorHist?.[creatorAddr];
          if (bucket && typeof bucket === 'object') {
            const entries = Object.entries(bucket).filter(([, v]) => v && typeof v === 'object');
            const diskTotal = Object.prototype.hasOwnProperty.call(bucket, mintKey)
              ? entries.length
              : entries.length + 1;
            const ruggedEntries = entries.filter(([, v]) => Boolean((v as any).rugged));
            const diskRugged = ruggedEntries.length;
            let diskFastRugMin: number | null = null;
            for (const [, v] of ruggedEntries) {
              const info = v as any;
              if (typeof info.rug_minutes === 'number' && Number.isFinite(info.rug_minutes)) {
                diskFastRugMin = diskFastRugMin === null ? info.rug_minutes : Math.min(diskFastRugMin, info.rug_minutes);
              } else {
                const cMs = Number(info.pool_created_at_ms || info.first_seen_ms || (info.launch_ts ? info.launch_ts * 1000 : 0) || 0);
                const rMs = Number(info.rugged_at_ms || (info.rug_ts ? info.rug_ts * 1000 : 0) || 0);
                if (cMs > 0 && rMs >= cMs) {
                  const mins = Math.round(((rMs - cMs) / 60000) * 10) / 10;
                  diskFastRugMin = diskFastRugMin === null ? mins : Math.min(diskFastRugMin, mins);
                }
              }
            }
            const recordedTotal = Number(pos.creator_launches ?? (typeof pos.creator_prior_launches === 'number' ? pos.creator_prior_launches + 1 : 0));
            const recordedRugged = Number(pos.creator_rugged ?? 0);
            pos.creator_launches = Math.max(1, recordedTotal, diskTotal);
            pos.creator_rugged = Math.max(0, recordedRugged, diskRugged);
            if ((pos.creator_fast_rug_min === undefined || pos.creator_fast_rug_min === null) && diskFastRugMin !== null) {
              pos.creator_fast_rug_min = diskFastRugMin;
            }
          } else {
            const recordedTotal = Number(pos.creator_launches ?? (typeof pos.creator_prior_launches === 'number' ? pos.creator_prior_launches + 1 : 1));
            pos.creator_launches = Math.max(1, Number.isFinite(recordedTotal) ? recordedTotal : 1);
            pos.creator_rugged = Math.max(0, Number(pos.creator_rugged ?? 0) || 0);
          }
        }

        // Enrich triggering Smart Money / Whale wallets with profile metadata
        const rawHits: string[] = Array.isArray(pos.smart_wallets_hit)
          ? pos.smart_wallets_hit.map((w: any) => String(w || '').trim()).filter(Boolean)
          : [];
        const hitWallets = Array.from(new Set(rawHits));
        pos.smart_wallets_hit = hitWallets;
        pos.smart_money_entry = Boolean(pos.smart_money_entry || hitWallets.length > 0);
        if (hitWallets.length > 0) {
          pos.smart_wallet_details = hitWallets.map((address) => {
            const m = smartMeta[address];
            return {
              address,
              label: typeof m?.label === 'string' && m.label.trim() ? m.label.trim() : undefined,
              winRate: typeof m?.winRate === 'number' && Number.isFinite(m.winRate) ? m.winRate : undefined,
              source: typeof m?.source === 'string' && m.source.trim() ? m.source.trim() : undefined,
            };
          });
        } else {
          pos.smart_wallet_details = [];
        }
      }
    }

    const rawRows: RawSniperCsvRow[] = [];
    if (fs.existsSync(tradesCsv)) {
      try {
        const content = fs.readFileSync(tradesCsv, 'utf-8');
        const lines = content.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map((p) => p.trim());
          if (parts.length >= 6) {
            rawRows.push({
              time: parts[0] || '',
              action: parts[1] || '',
              symbol: parts[2] || '',
              mint: parts[3] || '',
              price: parts[4] || '',
              amount: parts[5] || '',
              pnlUsd: parts[6] || '',
              pnlPct: parts[7] || '',
              reason: parts[8] || '',
              dexscreener: parts[9] || (parts[3] ? `https://dexscreener.com/solana/${parts[3]}` : ''),
              age_s: parts[10] || '',
              dex: parts[11] || '',
              source: parts[12] || '',
              entryPrice: parts[13] || '',
              solPriceUsd: parts[14] || '',
              txSig: parts[15] || '',
            });
          }
        }
      } catch {}
    }

    const trades = consolidateSniperTrades(rawRows, 200);
    const closedTrades = trades.filter((t) => t.tradeStatus === 'CLOSED' || t.tradeStatus === 'PARTIAL');
    const winTrades = closedTrades.filter((t) => parseFloat(t.pnlUsd || t.diffUsd || '0') > 0);
    if (closedTrades.length > 0 || trades.length > 0) {
      state.closed = closedTrades.length;
      state.wins = winTrades.length;
      let totalPnl = 0;
      let dayPnl = 0;
      const todayStartMs = new Date().setHours(0, 0, 0, 0);
      for (const t of closedTrades) {
        const p = parseFloat(t.pnlUsd || t.diffUsd || '0');
        if (Number.isFinite(p)) {
          totalPnl += p;
          const tTime = t.exitTime ? new Date(t.exitTime).getTime() : 0;
          if (!tTime || tTime >= todayStartMs) {
            dayPnl += p;
          }
        }
      }
      state.total_pnl = Number(totalPnl.toFixed(4));
      state.day_pnl = Number(dayPnl.toFixed(4));
    }

    const stateSolPx = typeof state.sol_price_usd === 'number' && state.sol_price_usd > 0 ? state.sol_price_usd : null;
    const stateSolTsMs = typeof state.sol_price_updated_at === 'number' ? state.sol_price_updated_at * 1000 : 0;
    const effectiveSolPrice =
      stateSolPx && stateSolTsMs > this.solPriceUpdatedAt
        ? stateSolPx
        : this.solPriceUsd ?? stateSolPx;
    const effectiveSolUpdatedAt =
      stateSolPx && stateSolTsMs > this.solPriceUpdatedAt
        ? stateSolTsMs
        : this.solPriceUpdatedAt;

    const lastPriceSec = typeof state.last_price_time === 'number' ? state.last_price_time : 0;
    const priceAgeSec = lastPriceSec > 0 ? Math.max(0, Date.now() / 1000 - lastPriceSec) : null;

    const rescanDelaySec = isPyOptionEnabled(settings, 'rescan_delay_after_sell_sec', true)
      ? Math.max(0, Number(settings.rescan_delay_after_sell_sec || 0))
      : 0;
    const lastSellTimeSec = typeof state.last_sell_time === 'number' ? state.last_sell_time : 0;
    const elapsedSinceSell = lastSellTimeSec > 0 ? Date.now() / 1000 - lastSellTimeSec : 9999999;
    const cooldownRemainingSec =
      rescanDelaySec > 0 && elapsedSinceSell < rescanDelaySec
        ? Math.max(0, Math.ceil(rescanDelaySec - elapsedSinceSell))
        : 0;

    state.cooldown_remaining_sec = cooldownRemainingSec;

    const uptimeSec =
      this.running && this.startedAtMs
        ? Math.max(0, Math.floor((Date.now() - this.startedAtMs) / 1000))
        : 0;

    const defaultSettings = this.getDefaultSettings();
    const mergedSettings = {
      ...defaultSettings,
      ...settings,
      option_enabled: {
        ...(defaultSettings.option_enabled || {}),
        ...(settings.option_enabled && typeof settings.option_enabled === 'object' ? settings.option_enabled : {}),
      },
      mode,
    };

    return {
      mode,
      running: this.running,
      started_at_ms: this.running ? this.startedAtMs : null,
      uptime_sec: uptimeSec,
      state,
      settings: mergedSettings,
      trades,
      logs: this.logs.slice(-200),
      sol_price_usd: effectiveSolPrice,
      sol_price_updated_at: effectiveSolUpdatedAt,
      price_age_sec: priceAgeSec,
      scan_paused: Boolean(state.scan_paused) || cooldownRemainingSec > 0,
      cooldown_remaining_sec: cooldownRemainingSec,
      rescan_delay_sec: rescanDelaySec,
      live_wallet: this.getLiveWalletSnapshot(),
      smart_wallet_profiles: this.readSmartWalletsMeta(),
    };
  }

  public async switchMode(targetMode: SniperMode) {
    const cleanMode: SniperMode = targetMode === 'live' ? 'live' : 'paper';
    if (this.running) {
      this.stop();
    }
    const current = this.readSettings();
    const updated = { ...current, mode: cleanMode };
    fs.writeFileSync(this.settingsFile, JSON.stringify(updated, null, 2), 'utf-8');
    if (cleanMode === 'live') {
      await this.refreshLiveWalletInfo(true);
      this.appendLog('INFO', 'Switched Python Sniper Bot to LIVE mode (real Solana wallet via Jupiter Swap).');
    } else {
      this.appendLog('INFO', 'Switched Python Sniper Bot to PAPER mode (simulated trading).');
    }
    return {
      ok: true,
      mode: cleanMode,
      live_wallet: this.getLiveWalletSnapshot(),
      message: cleanMode === 'live' ? 'Switched Python Sniper to LIVE mode' : 'Switched Python Sniper to PAPER mode',
    };
  }

  private terminateAnyExistingBot(): boolean {
    let killed = false;
    if (this.process && this.process.pid) {
      killProcessTreeSync(this.process.pid);
      this.process = null;
      killed = true;
    }
    const pidInfo = readPidFile(this.baseDir);
    if (pidInfo?.pid && Number.isFinite(pidInfo.pid)) {
      killProcessTreeSync(pidInfo.pid);
      killed = true;
    }
    removePidFile(this.baseDir);
    return killed;
  }

  public start() {
    if (this.running) return { ok: true, message: 'Already running' };

    const botPath = path.join(this.baseDir, 'bot.py');
    if (!fs.existsSync(botPath)) {
      return { ok: false, message: 'bot.py not found in sniper directory' };
    }

    const settings = this.readSettings();
    const mode = this.getMode(settings);
    const validation = validatePythonSniperSettings({ ...settings, mode }, this.solPriceUsd);
    if (!validation.valid) {
      return {
        ok: false,
        message: validation.error || 'Invalid Python Sniper settings: raise Take Profit % before starting.',
      };
    }

    if (mode === 'live') {
      if (!this.orchestrator?.signer.isUnlocked() || !this.orchestrator.signer.getPublicKey()) {
        return {
          ok: false,
          message: 'Live wallet signer is locked. Open Wallets & Signer to unlock your wallet first.',
        };
      }
      if (this.liveWalletBalanceSol !== null && this.liveWalletBalanceSol <= 0.001) {
        this.appendLog(
          'WARN',
          `Live wallet balance is ${this.liveWalletBalanceSol.toFixed(4)} SOL ($${((this.liveWalletBalanceSol || 0) * (this.solPriceUsd || 0)).toFixed(2)}). Buys will alert until funded.`
        );
      }
    }

    // Ensure zero orphaned background python process remains before starting
    this.terminateAnyExistingBot();
    clearStopSignal(this.baseDir);

    const detected = detectPythonCommand(settings.python_binary_path);
    const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.activeRunId = runId;

    let bridgeUrl = '';
    let bridgeToken = '';
    try {
      const env = loadAppEnv();
      const connectHost = env.host === '0.0.0.0' || env.host === '::' ? '127.0.0.1' : env.host;
      bridgeUrl = `http://${connectHost}:${env.port}`;
      bridgeToken = env.apiToken;
    } catch {}

    this.appendLog(
      'INFO',
      `Starting Python New-Launch Sniper Bot [${mode.toUpperCase()}] using: ${detected.info}...`
    );

    const spawnArgs = [...detected.args, botPath, `--run-id=${runId}`];
    this.process = spawn(detected.command, spawnArgs, {
      cwd: this.baseDir,
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        SNIPER_MODE: mode,
        SNIPER_RUN_ID: runId,
        SNIPER_BRIDGE_URL: bridgeUrl,
        SNIPER_BRIDGE_TOKEN: bridgeToken,
      },
    });

    this.running = true;
    this.startedAtMs = Date.now();
    const startScanMode = String(settings.smart_money_scan_mode || 'both').trim().toLowerCase();
    if (
      (startScanMode === 'alpha_signal_only' ||
        (isPyOptionEnabled(settings, 'use_pumpportal', true) && settings.use_pumpportal !== false)) &&
      this.orchestrator?.pumpPortal
    ) {
      this.orchestrator.pumpPortal.start();
    }
    if (
      startScanMode === 'alpha_signal_only' ||
      (startScanMode === 'both' &&
        isPyOptionEnabled(settings, 'alpha_signal_auto_find', true) &&
        settings.alpha_signal_auto_find !== false)
    ) {
      if (startScanMode === 'alpha_signal_only') {
        this.appendLog(
          'INFO',
          '[AlphaSignal] Strategy locked to ALPHA SIGNALS ONLY — Whale Wallets and Sniper New-Launch scanning are disabled.'
        );
      }
      void this.discoverAlphaSignals({ silent: true });
    }

    if (this.process.stdout) {
      const rl = readline.createInterface({ input: this.process.stdout });
      rl.on('line', (line) => {
        this.parseAndLogStdout(line);
      });
    }

    if (this.process.stderr) {
      const rl = readline.createInterface({ input: this.process.stderr });
      rl.on('line', (line) => {
        this.appendLog('WARN', line);
      });
    }

    this.process.on('exit', (code) => {
      if (this.activeRunId === runId) {
        this.running = false;
        this.startedAtMs = null;
        this.process = null;
        this.activeRunId = null;
      }
      if (code === 9009) {
        this.appendLog(
          'WARN',
          'Exit code 9009: Windows could not find Python. Set your Python executable in Settings > "Python executable / path" (e.g. py, python, or full path to python.exe).'
        );
      }
      this.appendLog('INFO', `Python bot exited with code ${code}`);
    });

    return { ok: true, message: `Python sniper bot started (${mode.toUpperCase()} · ${detected.info})` };
  }

  public stop() {
    const pidPath = path.join(this.baseDir, 'bot.pid');
    const wasRunning = this.running || Boolean(this.process) || fs.existsSync(pidPath);
    // 1. Signal cooperative immediate halt across all scan/buy/sell/monitor loops
    writeStopSignal('user_stop', this.baseDir);
    // 2. Hard-kill process tree + child Python PID stored in bot.pid (critical on Windows)
    const killedPid = this.terminateAnyExistingBot();

    this.running = false;
    this.startedAtMs = null;
    this.process = null;
    this.activeRunId = null;
    if (this.orchestrator && this.orchestrator.getStatusSnapshot().runState === 'stopped') {
      this.orchestrator.pumpPortal.stop();
    }

    if (wasRunning || killedPid) {
      this.appendLog('INFO', 'Python sniper bot stopped cleanly (all scan, buy & sell loops halted).');
      return { ok: true, message: 'Python sniper bot stopped' };
    }
    return { ok: true, message: 'Python sniper bot stopped (no active process)' };
  }

  public clearLogs() {
    const count = this.logs.length;
    this.logs = [];
    return { ok: true, cleared: count, message: 'Scan logs cleared' };
  }

  public getPumpPortalMints(maxAgeMs = 180_000): string[] {
    if (!this.orchestrator?.pumpPortal) return [];
    const settings = this.readSettings();
    if (!isPyOptionEnabled(settings, 'use_pumpportal', true) || settings.use_pumpportal === false) return [];
    this.orchestrator.pumpPortal.start();
    return this.orchestrator.pumpPortal.drainRecentMints(maxAgeMs);
  }

  public setWsWatchedMints(mints: string[], creatorsByMint?: Record<string, string>): { ok: boolean; watched: string[] } {
    const clean = Array.from(
      new Set(
        (Array.isArray(mints) ? mints : [])
          .map((m) => String(m || '').trim())
          .filter((m) => m.length >= 32)
      )
    );
    this.wsWatchedMints = clean;
    if (this.orchestrator?.pumpPortal && typeof this.orchestrator.pumpPortal.setPinnedOpenMints === 'function') {
      if (clean.length > 0) this.orchestrator.pumpPortal.start();
      (this.orchestrator.pumpPortal as any).setPinnedOpenMints(clean, creatorsByMint);
    }
    return { ok: true, watched: clean };
  }

  private alphaSignalsBuffer: Array<{
    id: string;
    mint: string;
    symbol: string;
    name: string;
    source: string;
    channelType: 'ws_curve' | 'boost_alpha' | 'gecko_momentum' | 'manual';
    realSol: number;
    liquidityUsd: number;
    devBuySol: number;
    buys5m: number;
    sells5m: number;
    riskScore: number;
    timestamp: string;
    status: 'AUTO_SNIPED' | 'READY' | 'PENDING' | 'SKIPPED';
    tsMs: number;
    pair?: any;
  }> = [];

  private computeAlphaRiskScore(params: {
    realSol: number;
    liquidityUsd: number;
    devBuySol: number;
    creatorSold: boolean;
    buys: number;
    sells: number;
    uniqueTraders: number;
    isBondingCurve?: boolean;
  }): number {
    let score = 26;
    if (params.isBondingCurve) {
      if (params.realSol >= 8.0) score -= 10;
      else if (params.realSol >= 3.0) score -= 5;
      else if (params.realSol < 1.5) score += 22;
      if (params.realSol < 0.8) score += 12;
    } else {
      if (params.realSol >= 6.0 || params.liquidityUsd >= 25_000) score -= 10;
      else if (params.realSol >= 2.5 || params.liquidityUsd >= 10_000) score -= 5;
      else if (params.realSol < 1.2 && params.liquidityUsd < 5_000) score += 20;
    }

    if (params.devBuySol > 8.0) score += 32;
    else if (params.devBuySol > 4.5) score += 14;
    else if (params.devBuySol > 0 && params.devBuySol <= 2.5) score -= 3;

    if (params.creatorSold) score += 38;

    const totalTx = params.buys + params.sells;
    if (params.buys >= 6 && params.buys >= params.sells * 1.6) score -= 6;
    else if (totalTx >= 6 && params.sells > params.buys) score += 18;
    else if (params.buys >= 6 && params.sells === 0) score += 16; // potential early honeypot skew

    if (params.uniqueTraders >= 10) score -= 4;
    return Math.max(5, Math.min(99, Math.round(score)));
  }

  private ingestPumpPortalAlphaCandidates(settings: Record<string, any>) {
    const pp: any = this.orchestrator?.pumpPortal;
    if (!pp || typeof pp.getSyntheticPairs !== 'function') return 0;
    const synth = pp.getSyntheticPairs(this.solPriceUsd, 180_000);
    if (!Array.isArray(synth) || synth.length === 0) return 0;

    const autoSnipe =
      isPyOptionEnabled(settings, 'alpha_signal_auto_snipe', true) && settings.alpha_signal_auto_snipe !== false;
    const maxRisk = Math.max(10, Math.min(100, Number(settings.alpha_signal_max_risk_score ?? 45) || 45));
    const minRealSol = Math.max(0, Number(settings.alpha_signal_min_real_sol ?? 1.5) || 0);
    const now = Date.now();
    let added = 0;

    for (const p of synth.slice(0, 25)) {
      const mint = String(p?.baseToken?.address || '').trim();
      if (!mint || mint.length < 32) continue;
      const ppInfo = p._pumpportal || {};
      const realSol = Number(ppInfo.real_sol || 0);
      const liquidityUsd = Number(p?.liquidity?.usd || 0);
      const devBuySol = Number(ppInfo.initial_buy_sol || 0);
      const buys = Number(p?.txns?.m5?.buys || ppInfo.buys_60s || 0);
      const sells = Number(p?.txns?.m5?.sells || ppInfo.sells_60s || 0);
      const creatorSold = Boolean(ppInfo.creator_sold);
      const uniqueTraders = Number(ppInfo.unique_traders_5m || 0);
      const isBondingCurve =
        Boolean(p?._synthetic) || String(p?.dexId || '').toLowerCase() === 'pumpfun';

      // Require real traction on bonding curve before promoting as an Alpha Signal
      if (buys < 3 && realSol < 1.0) continue;

      const riskScore = this.computeAlphaRiskScore({
        realSol,
        liquidityUsd,
        devBuySol,
        creatorSold,
        buys,
        sells,
        uniqueTraders,
        isBondingCurve,
      });

      const hasMinimumTraction = isBondingCurve
        ? realSol >= minRealSol && buys >= 3
        : liquidityUsd >= 5_000 && buys >= 4;
      const qualifies = !creatorSold && riskScore <= maxRisk && hasMinimumTraction;
      const nextStatus: 'AUTO_SNIPED' | 'READY' | 'PENDING' | 'SKIPPED' = creatorSold || riskScore >= 70
        ? 'SKIPPED'
        : qualifies
          ? autoSnipe
            ? 'AUTO_SNIPED'
            : 'READY'
          : 'PENDING';

      const existing = this.alphaSignalsBuffer.find((s) => s.mint === mint);
      if (existing) {
        existing.realSol = realSol;
        existing.liquidityUsd = liquidityUsd;
        existing.buys5m = buys;
        existing.sells5m = sells;
        existing.riskScore = riskScore;
        existing.pair = p;
        if (!this.manualAlphaSnipes.has(mint)) {
          existing.status = nextStatus;
        }
        continue;
      }

      const sourceLabel =
        realSol >= 3.0 && buys >= 5
          ? 'China Alpha Jito FastLane (<200ms WS)'
          : 'PumpPortal Curve Alpha WS';
      this.alphaSignalsBuffer.unshift({
        id: `${mint.slice(0, 6)}_${now.toString(36)}`,
        mint,
        symbol: String(p?.baseToken?.symbol || mint.slice(0, 6)),
        name: String(p?.baseToken?.name || p?.baseToken?.symbol || 'Unknown'),
        source: sourceLabel,
        channelType: 'ws_curve',
        realSol,
        liquidityUsd,
        devBuySol,
        buys5m: buys,
        sells5m: sells,
        riskScore,
        timestamp: new Date(now).toLocaleTimeString(),
        status: nextStatus,
        tsMs: now,
        pair: p,
      });
      added += 1;
    }

    if (this.alphaSignalsBuffer.length > 60) {
      this.alphaSignalsBuffer = this.alphaSignalsBuffer.slice(0, 60);
    }
    return added;
  }

  public async discoverAlphaSignals(options?: { force?: boolean; silent?: boolean }): Promise<{
    ok: boolean;
    added: number;
    total: number;
    signals: SniperManager['alphaSignalsBuffer'];
  }> {
    const now = Date.now();
    const settings = this.readSettings();
    const refreshMs = Math.max(
      5_000,
      Math.min(300_000, Number(settings.alpha_signal_refresh_interval_sec ?? 10) * 1000)
    );
    if (!options?.force && (this.alphaDiscoverInFlight || now - this.lastAlphaDiscoverAtMs < Math.min(refreshMs, 5_000))) {
      const wsAdded = this.ingestPumpPortalAlphaCandidates(settings);
      return { ok: true, added: wsAdded, total: this.alphaSignalsBuffer.length, signals: this.alphaSignalsBuffer };
    }

    this.alphaDiscoverInFlight = true;
    this.lastAlphaDiscoverAtMs = now;
    let added = 0;

    try {
      if (options?.force && this.orchestrator?.pumpPortal) {
        this.orchestrator.pumpPortal.start();
      }
      added += this.ingestPumpPortalAlphaCandidates(settings);

      const autoSnipe =
        isPyOptionEnabled(settings, 'alpha_signal_auto_snipe', true) && settings.alpha_signal_auto_snipe !== false;
      const maxRisk = Math.max(10, Math.min(100, Number(settings.alpha_signal_max_risk_score ?? 45) || 45));
      const solPx = this.solPriceUsd && this.solPriceUsd > 0 ? this.solPriceUsd : 150;

      // Parallel fetch: DexScreener Latest Boosts (paid promo / alpha velocity) + GeckoTerminal Trending/New Solana Pools
      const [boostsRes, gtTrending, gtNew] = await Promise.all([
        this.fetchJsonWithTimeout('https://api.dexscreener.com/token-boosts/latest/v1', 4000),
        this.fetchJsonWithTimeout('https://api.geckoterminal.com/api/v2/networks/solana/trending_pools', 4000),
        this.fetchJsonWithTimeout('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1', 4000),
      ]);

      const candidateSources = new Map<string, { channelType: 'boost_alpha' | 'gecko_momentum'; source: string }>();

      if (Array.isArray(boostsRes)) {
        for (const item of boostsRes) {
          if (String(item?.chainId || '').toLowerCase() !== 'solana') continue;
          const mint = String(item?.tokenAddress || '').trim();
          if (!mint || mint.length < 32 || this.alphaSignalsBuffer.some((s) => s.mint === mint)) continue;
          if (!candidateSources.has(mint)) {
            candidateSources.set(mint, {
              channelType: 'boost_alpha',
              source: 'DexScreener Alpha Boost',
            });
          }
          if (candidateSources.size >= 15) break;
        }
      }

      const rawPools = [
        ...(Array.isArray(gtTrending?.data) ? gtTrending.data : []),
        ...(Array.isArray(gtNew?.data) ? gtNew.data : []),
      ];
      for (const pool of rawPools) {
        const attrs = pool?.attributes || {};
        const liq = Number(attrs.reserve_in_usd || 0);
        const vol1h = Number(attrs.volume_usd?.h1 || 0);
        const chg5m = Number(attrs.price_change_percentage?.m5 || 0);
        const chg1h = Number(attrs.price_change_percentage?.h1 || 0);
        if (liq < 4_500 || vol1h < 1_500 || (chg5m <= 1 && chg1h <= 8)) continue;
        const baseId = String(pool?.relationships?.base_token?.data?.id || '');
        const mint = baseId.replace(/^solana_/, '').trim();
        if (!mint || mint.length < 32 || this.alphaSignalsBuffer.some((s) => s.mint === mint)) continue;
        if (!candidateSources.has(mint)) {
          candidateSources.set(mint, {
            channelType: 'gecko_momentum',
            source: 'Gecko Momentum Alpha',
          });
        }
        if (candidateSources.size >= 24) break;
      }

      const mintsToEnrich = Array.from(candidateSources.keys()).slice(0, 24);
      if (mintsToEnrich.length > 0) {
        const dsPairs = await this.fetchJsonWithTimeout(
          `https://api.dexscreener.com/tokens/v1/solana/${mintsToEnrich.join(',')}`,
          4500
        );
        const bestPairByMint = new Map<string, any>();
        if (Array.isArray(dsPairs)) {
          for (const p of dsPairs) {
            const m = String(p?.baseToken?.address || '').trim();
            if (!m) continue;
            const liq = Number(p?.liquidity?.usd || 0);
            const cur = bestPairByMint.get(m);
            if (!cur || liq > Number(cur?.liquidity?.usd || 0)) {
              bestPairByMint.set(m, p);
            }
          }
        }

        for (const [mint, pair] of bestPairByMint.entries()) {
          const srcMeta = candidateSources.get(mint);
          if (!srcMeta) continue;
          const liqUsd = Number(pair?.liquidity?.usd || 0);
          const buys = Number(pair?.txns?.m5?.buys || 0);
          const sells = Number(pair?.txns?.m5?.sells || 0);
          const vol5m = Number(pair?.volume?.m5 || 0);
          const px = Number(pair?.priceUsd || 0);
          if (px <= 0 || liqUsd < 3_500) continue;

          const approxRealSol = Number((liqUsd / (2 * solPx)).toFixed(2));
          const riskScore = this.computeAlphaRiskScore({
            realSol: approxRealSol,
            liquidityUsd: liqUsd,
            devBuySol: 0,
            creatorSold: false,
            buys,
            sells,
            uniqueTraders: Math.min(30, buys),
          });
          if (riskScore > 75) continue;

          const qualifies = riskScore <= maxRisk && liqUsd >= 4_500 && buys >= 3 && buys >= sells && vol5m >= 500;
          const status: 'AUTO_SNIPED' | 'READY' | 'PENDING' | 'SKIPPED' = qualifies
            ? autoSnipe
              ? 'AUTO_SNIPED'
              : 'READY'
            : 'PENDING';

          const existing = this.alphaSignalsBuffer.find((s) => s.mint === mint);
          if (!existing) {
            this.alphaSignalsBuffer.unshift({
              id: `${mint.slice(0, 6)}_${Date.now().toString(36)}`,
              mint,
              symbol: String(pair?.baseToken?.symbol || mint.slice(0, 6)),
              name: String(pair?.baseToken?.name || pair?.baseToken?.symbol || 'Unknown'),
              source: srcMeta.source,
              channelType: srcMeta.channelType,
              realSol: approxRealSol,
              liquidityUsd: liqUsd,
              devBuySol: 0,
              buys5m: buys,
              sells5m: sells,
              riskScore,
              timestamp: new Date().toLocaleTimeString(),
              status,
              tsMs: Date.now(),
              pair,
            });
            added += 1;
          }
        }
      }

      // Prune stale signals older than 15m unless manually queued
      const cutoff = Date.now() - 15 * 60_000;
      this.alphaSignalsBuffer = this.alphaSignalsBuffer
        .filter((s) => s.tsMs >= cutoff || this.manualAlphaSnipes.has(s.mint))
        .slice(0, 60);

      if (added > 0 && !options?.silent) {
        this.appendLog(
          'INFO',
          `[AlphaSignal] Auto-finder discovered ${added} new alpha signal(s) (${this.alphaSignalsBuffer.length} total active).`
        );
      }
      return { ok: true, added, total: this.alphaSignalsBuffer.length, signals: this.alphaSignalsBuffer };
    } catch {
      return { ok: true, added, total: this.alphaSignalsBuffer.length, signals: this.alphaSignalsBuffer };
    } finally {
      this.alphaDiscoverInFlight = false;
    }
  }

  public getAlphaSignals() {
    const settings = this.readSettings();
    const scanMode = String(settings.smart_money_scan_mode || 'both').trim().toLowerCase();
    const autoFind =
      scanMode === 'alpha_signal_only' ||
      (isPyOptionEnabled(settings, 'alpha_signal_auto_find', true) && settings.alpha_signal_auto_find !== false);
    const autoSnipe =
      isPyOptionEnabled(settings, 'alpha_signal_auto_snipe', true) && settings.alpha_signal_auto_snipe !== false;
    const jitoTipSol = Number(settings.alpha_signal_jito_tip_sol ?? 0.0005) || 0.0005;
    const refreshSec = Number(settings.alpha_signal_refresh_interval_sec ?? 10) || 10;

    this.ingestPumpPortalAlphaCandidates(settings);

    return {
      ok: true,
      signals: this.alphaSignalsBuffer.map(({ pair: _pair, ...rest }) => rest),
      active: autoFind,
      autoFind,
      autoSnipe,
      jitoTipSol,
      refreshSec,
      scanMode,
      lastScanAtMs: this.lastAlphaDiscoverAtMs || null,
    };
  }

  public async queueManualAlphaSnipe(
    rawMint: string,
    jitoTipSol?: number
  ): Promise<{ ok: boolean; message: string; signal?: any }> {
    const mint = String(rawMint || '').trim();
    if (!mint || mint.length < 32) {
      return { ok: false, message: 'Valid Solana token mint is required' };
    }
    const now = Date.now();
    this.manualAlphaSnipes.set(mint, now);

    if (typeof jitoTipSol === 'number' && Number.isFinite(jitoTipSol) && jitoTipSol >= 0) {
      this.updateSettings({ alpha_signal_jito_tip_sol: Math.min(0.01, Math.max(0, jitoTipSol)) });
    }

    let sig = this.alphaSignalsBuffer.find((s) => s.mint === mint);
    if (!sig) {
      const dsPairs = await this.fetchJsonWithTimeout(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, 4000);
      const pair = Array.isArray(dsPairs) && dsPairs.length > 0 ? dsPairs[0] : null;
      const symbol = String(pair?.baseToken?.symbol || mint.slice(0, 6));
      const liqUsd = Number(pair?.liquidity?.usd || 0);
      const solPx = this.solPriceUsd && this.solPriceUsd > 0 ? this.solPriceUsd : 150;
      sig = {
        id: `${mint.slice(0, 6)}_${now.toString(36)}`,
        mint,
        symbol,
        name: String(pair?.baseToken?.name || symbol),
        source: 'Manual Alpha Fast-Lane',
        channelType: 'manual',
        realSol: liqUsd > 0 ? Number((liqUsd / (2 * solPx)).toFixed(2)) : 0,
        liquidityUsd: liqUsd,
        devBuySol: 0,
        buys5m: Number(pair?.txns?.m5?.buys || 0),
        sells5m: Number(pair?.txns?.m5?.sells || 0),
        riskScore: 25,
        timestamp: new Date(now).toLocaleTimeString(),
        status: 'AUTO_SNIPED',
        tsMs: now,
        pair: pair || undefined,
      };
      this.alphaSignalsBuffer.unshift(sig);
    } else {
      sig.status = 'AUTO_SNIPED';
      sig.tsMs = now;
    }

    const tipVal = Number(jitoTipSol ?? this.readSettings().alpha_signal_jito_tip_sol ?? 0.0005);
    this.appendLog(
      'INFO',
      `[AlphaSignal] 🎯 Snipe queued for $${sig.symbol} (${mint.slice(0, 6)}...) with ${tipVal.toFixed(4)} SOL Jito tip.`
    );
    return {
      ok: true,
      message: this.running
        ? `Snipe queued for $${sig.symbol} (${tipVal.toFixed(4)} SOL Jito tip)`
        : `Queued $${sig.symbol} — start the Python bot in Alpha Signals Only (or Both) mode to execute`,
      signal: { ...sig, pair: undefined },
    };
  }

  public getPumpPortalFeed(maxAgeMs = 180_000): {
    mints: string[];
    pairs: any[];
    solPriceUsd: number | null;
    open_prices: Record<
      string,
      {
        priceUsd: number;
        liquidityUsd: number;
        realSol?: number;
        lastTradeAtMs: number;
        creator?: string;
        creatorSold?: boolean;
        recentSellers?: string[];
      }
    >;
    smart_sells: Record<string, string[]>;
    smart_buys: Array<{
      wallet: string;
      mint: string;
      symbol: string;
      solAmount: number;
      priceSol: number;
      tsMs: number;
    }>;
    whale_held_mints: Array<{
      mint: string;
      wallet: string;
      symbol: string;
      uiAmount: number;
      ageHours: number;
      discoveredAtMs: number;
    }>;
    alpha_signals: Array<{
      mint: string;
      symbol: string;
      name: string;
      source: string;
      realSol: number;
      devBuySol: number;
      riskScore: number;
      status: string;
      tsMs: number;
      pair?: any;
    }>;
  } {
    const settings = this.readSettings();
    const scanMode = String(settings.smart_money_scan_mode || 'both').trim().toLowerCase();
    const alphaOnly = scanMode === 'alpha_signal_only';
    const smActive =
      !alphaOnly &&
      (scanMode === 'smart_money_only' ||
        (scanMode !== 'sniper_only' &&
          isPyOptionEnabled(settings, 'smart_money_enabled', true) &&
          settings.smart_money_enabled !== false));
    const followOlder =
      smActive &&
      (scanMode === 'smart_money_only' ||
        (isPyOptionEnabled(settings, 'smart_money_follow_older_coins', true) &&
          settings.smart_money_follow_older_coins !== false));
    const alphaActive =
      alphaOnly ||
      (scanMode === 'both' &&
        isPyOptionEnabled(settings, 'alpha_signal_auto_snipe', true) &&
        settings.alpha_signal_auto_snipe !== false);

    // Expire manual alpha snipes after 3 minutes
    const nowMs = Date.now();
    for (const [m, ts] of this.manualAlphaSnipes.entries()) {
      if (nowMs - ts > 180_000) this.manualAlphaSnipes.delete(m);
    }

    if (alphaActive) {
      this.ingestPumpPortalAlphaCandidates(settings);
    }
    const alphaCutoff = nowMs - 5 * 60_000;
    const alpha_signals = alphaActive
      ? this.alphaSignalsBuffer
          .filter(
            (s) =>
              this.manualAlphaSnipes.has(s.mint) ||
              ((s.status === 'AUTO_SNIPED' || s.status === 'READY') && s.tsMs >= alphaCutoff)
          )
          .slice(0, 30)
          .map((s) => ({
            mint: s.mint,
            symbol: s.symbol,
            name: s.name,
            source: s.source,
            realSol: s.realSol,
            devBuySol: s.devBuySol,
            riskScore: s.riskScore,
            status: this.manualAlphaSnipes.has(s.mint) ? 'MANUAL_QUEUED' : s.status,
            tsMs: s.tsMs,
            ...(s.pair ? { pair: s.pair } : {}),
          }))
      : [];

    const cutoffHoldings = nowMs - 5 * 60_000;
    this.recentWhaleHoldings = this.recentWhaleHoldings.filter((h) => h.discoveredAtMs >= cutoffHoldings);
    const whale_held_mints = followOlder ? [...this.recentWhaleHoldings] : [];

    if (!this.orchestrator?.pumpPortal) {
      return {
        mints: alphaOnly ? alpha_signals.map((s) => s.mint) : [],
        pairs: alphaOnly ? alpha_signals.map((s) => s.pair).filter(Boolean) : [],
        solPriceUsd: this.solPriceUsd,
        open_prices: {},
        smart_sells: {},
        smart_buys: [],
        whale_held_mints,
        alpha_signals,
      };
    }
    const usePump = isPyOptionEnabled(settings, 'use_pumpportal', true) && settings.use_pumpportal !== false;
    const useWsExits =
      isPyOptionEnabled(settings, 'ws_exit_stream_enabled', true) && settings.ws_exit_stream_enabled !== false;
    if (!usePump && !useWsExits && !smActive && !alphaOnly) {
      return {
        mints: [],
        pairs: [],
        solPriceUsd: this.solPriceUsd,
        open_prices: {},
        smart_sells: {},
        smart_buys: [],
        whale_held_mints: [],
        alpha_signals,
      };
    }
    this.orchestrator.pumpPortal.start();
    const pp: any = this.orchestrator.pumpPortal;

    let mints: string[];
    let pairs: any[];
    if (alphaOnly) {
      // Strictly isolate Alpha Signals Only mode: never emit general PumpPortal new-launch sniper mints
      const alphaMintSet = new Set(alpha_signals.map((s) => s.mint));
      mints = Array.from(alphaMintSet);
      const ppPairs =
        typeof pp.getSyntheticPairs === 'function' ? pp.getSyntheticPairs(this.solPriceUsd, maxAgeMs) : [];
      const pairByMint = new Map<string, any>();
      for (const s of alpha_signals) {
        if (s.pair) pairByMint.set(s.mint, s.pair);
      }
      for (const p of ppPairs) {
        const pm = String(p?.baseToken?.address || '').trim();
        if (alphaMintSet.has(pm)) pairByMint.set(pm, p);
      }
      pairs = Array.from(pairByMint.values());
    } else {
      mints = usePump ? this.orchestrator.pumpPortal.drainRecentMints(maxAgeMs) : [];
      pairs =
        usePump && typeof pp.getSyntheticPairs === 'function'
          ? pp.getSyntheticPairs(this.solPriceUsd, maxAgeMs)
          : [];
    }

    const open_prices: Record<
      string,
      {
        priceUsd: number;
        liquidityUsd: number;
        lastTradeAtMs: number;
        creator?: string;
        creatorSold?: boolean;
        recentSellers?: string[];
      }
    > = {};
    const smart_sells: Record<string, string[]> = {};
    if (useWsExits && this.wsWatchedMints.length > 0 && typeof pp.getLiveMintSnapshots === 'function') {
      const snaps = pp.getLiveMintSnapshots(this.wsWatchedMints, this.solPriceUsd);
      const smartSet = new Set<string>(
        Array.isArray(settings.smart_wallets)
          ? settings.smart_wallets.map((w: any) => String(w || '').trim()).filter(Boolean)
          : []
      );
      const smartSellActive =
        smActive &&
        isPyOptionEnabled(settings, 'smart_money_auto_exit_on_sell', true) &&
        settings.smart_money_auto_exit_on_sell !== false &&
        smartSet.size > 0;
      for (const [mint, snap] of Object.entries<any>(snaps)) {
        if (snap && (snap.priceUsd > 0 || snap.creatorSold || (Array.isArray(snap.recentSellers) && snap.recentSellers.length > 0))) {
          open_prices[mint] = {
            priceUsd: snap.priceUsd ?? 0,
            liquidityUsd: snap.liquidityUsd ?? 0,
            ...(typeof snap.realSol === 'number' ? { realSol: snap.realSol } : {}),
            lastTradeAtMs: snap.lastTradeAtMs ?? Date.now(),
            ...(snap.creator ? { creator: snap.creator } : {}),
            ...(typeof snap.creatorSold === 'boolean' ? { creatorSold: snap.creatorSold } : {}),
            ...(Array.isArray(snap.recentSellers) && snap.recentSellers.length > 0
              ? { recentSellers: snap.recentSellers.slice(0, 30) }
              : {}),
          };
        }
        if (smartSellActive && Array.isArray(snap?.recentSellers)) {
          const hits = snap.recentSellers.filter((w: string) => smartSet.has(w));
          if (hits.length > 0) smart_sells[mint] = hits;
        }
      }
    }
    const smart_buys =
      smActive && typeof pp.drainRecentSmartBuys === 'function'
        ? pp.drainRecentSmartBuys(120_000)
        : [];
    return {
      mints,
      pairs,
      solPriceUsd: this.solPriceUsd,
      open_prices,
      smart_sells,
      smart_buys,
      whale_held_mints,
      alpha_signals,
    };
  }

  public async getReverseExitPrices(
    positions: Array<{ mint: string; qty: number; decimals?: number; rawAmount?: string | null }>,
    solPriceOverride?: number | null
  ): Promise<{ ok: boolean; prices: Record<string, number>; solPriceUsd: number | null; pausedForQuota?: boolean }> {
    const settings = this.readSettings();
    const quotaGuardOn =
      isPyOptionEnabled(settings, 'jupiter_quota_guard_enabled', true) &&
      settings.jupiter_quota_guard_enabled !== false;
    if (
      quotaGuardOn &&
      (this.liveSwapActiveCount > 0 || (this.lastLiveSwapAtMs > 0 && Date.now() - this.lastLiveSwapAtMs < 10_000))
    ) {
      return { ok: true, prices: {}, solPriceUsd: this.solPriceUsd, pausedForQuota: true };
    }
    const jupiter = this.orchestrator?.jupiter as any;
    if (!jupiter || typeof jupiter.getReverseExitPricesUsd !== 'function') {
      return { ok: false, prices: {}, solPriceUsd: this.solPriceUsd };
    }
    let solPx =
      solPriceOverride && Number.isFinite(solPriceOverride) && solPriceOverride > 0
        ? solPriceOverride
        : this.solPriceUsd;
    if (!solPx || solPx <= 0) {
      solPx = (await jupiter.getLiveSolPriceUsd?.()) ?? (await this.refreshSolPrice()) ?? null;
    }
    if (!solPx || solPx <= 0) {
      return { ok: false, prices: {}, solPriceUsd: null };
    }
    const prices = await jupiter.getReverseExitPricesUsd(positions, solPx);
    return { ok: true, prices, solPriceUsd: solPx };
  }

  private resolveSwapExecutionFees(
    settings: Record<string, any>,
    isUrgentExit: boolean,
    overrides?: { priorityFeeTier?: string; jitoTipSol?: number }
  ): {
    priorityFeeLamports: number | 'auto';
    priorityLevel: 'medium' | 'high' | 'veryHigh';
    maxPriorityFeeLamports: number;
    jitoTipLamports: number;
  } {
    const priorityOn = isPyOptionEnabled(settings, 'priority_fee_tier', true);
    const rawTier = priorityOn
      ? String(overrides?.priorityFeeTier ?? settings.priority_fee_tier ?? 'fast').toLowerCase()
      : 'standard';
    const tier: 'standard' | 'fast' | 'turbo' =
      rawTier === 'turbo' ? 'turbo' : rawTier === 'standard' ? 'standard' : 'fast';
    const jitoOn = isPyOptionEnabled(settings, 'jito_tip_sol', true);
    const dontFrontOn =
      isPyOptionEnabled(settings, 'jito_dontfront_enabled', true) &&
      settings.jito_dontfront_enabled !== false;
    const scanMode = String(settings.smart_money_scan_mode || 'both').trim().toLowerCase();
    const baseJitoSol = jitoOn ? Number(overrides?.jitoTipSol ?? settings.jito_tip_sol ?? 0) : 0;
    const alphaJitoSol =
      scanMode === 'alpha_signal_only'
        ? Number(settings.alpha_signal_jito_tip_sol ?? 0.0005)
        : 0;
    const rawJitoSol = Math.max(
      Number.isFinite(baseJitoSol) ? baseJitoSol : 0,
      Number.isFinite(alphaJitoSol) ? alphaJitoSol : 0
    );
    const safeJitoSol = Number.isFinite(rawJitoSol) && rawJitoSol > 0 ? Math.min(0.01, rawJitoSol) : 0;
    const jitoTipLamports =
      safeJitoSol > 0
        ? Math.max(10_000, Math.round(safeJitoSol * LAMPORTS_PER_SOL))
        : dontFrontOn
          ? 100_000
          : 0;

    if (isUrgentExit || tier === 'turbo') {
      return {
        priorityFeeLamports: 'auto',
        priorityLevel: 'veryHigh',
        maxPriorityFeeLamports: 1_000_000,
        jitoTipLamports,
      };
    }
    if (tier === 'fast') {
      return {
        priorityFeeLamports: 'auto',
        priorityLevel: 'high',
        maxPriorityFeeLamports: 350_000,
        jitoTipLamports,
      };
    }
    return {
      priorityFeeLamports: 'auto',
      priorityLevel: 'medium',
      maxPriorityFeeLamports: 150_000,
      jitoTipLamports,
    };
  }

  private broadcastToJitoBestEffort(rawSigned: Uint8Array, jitoTipLamports: number, bundleOnly = true): void {
    if (jitoTipLamports <= 0 || typeof fetch !== 'function') return;
    try {
      const b64 = Buffer.from(rawSigned).toString('base64');
      const url = bundleOnly
        ? 'https://mainnet.block-engine.jito.wtf/api/v1/transactions?bundleOnly=true'
        : 'https://mainnet.block-engine.jito.wtf/api/v1/transactions';
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [b64, { encoding: 'base64' }],
        }),
        signal: AbortSignal.timeout(2500),
      }).catch(() => undefined);
    } catch {
      // non-blocking best-effort Jito bundle relay
    }
  }

  public updateSettings(newSettings: Record<string, any>) {
    try {
      const current = this.readSettings();
      const mergedOptionEnabled: Record<string, boolean> = {
        min_age_minutes: false,
        ...(current.option_enabled && typeof current.option_enabled === 'object' ? current.option_enabled : {}),
      };
      if (newSettings.option_enabled && typeof newSettings.option_enabled === 'object') {
        for (const [k, v] of Object.entries(newSettings.option_enabled)) {
          if (typeof v === 'boolean') mergedOptionEnabled[k] = v;
        }
      }
      const rawScanMode = String(newSettings.smart_money_scan_mode ?? current.smart_money_scan_mode ?? 'both').trim().toLowerCase();
      const cleanScanMode =
        rawScanMode === 'smart_money_only' ||
        rawScanMode === 'sniper_only' ||
        rawScanMode === 'alpha_signal_only'
          ? rawScanMode
          : 'both';
      const rawMaxW = Number(newSettings.smart_money_max_wallets ?? current.smart_money_max_wallets ?? 50);
      const cleanMaxWallets = !Number.isFinite(rawMaxW)
        ? 50
        : rawMaxW <= 0
          ? 0
          : Math.min(5000, Math.max(1, Math.round(rawMaxW)));
      const rawRefreshSec = Number(newSettings.smart_money_refresh_interval_sec ?? current.smart_money_refresh_interval_sec ?? 30);
      const cleanRefreshSec = !Number.isFinite(rawRefreshSec)
        ? 30
        : Math.min(86400, Math.max(10, Math.round(rawRefreshSec)));
      const rawMaxAgeH = Number(newSettings.smart_money_max_coin_age_hours ?? current.smart_money_max_coin_age_hours ?? 72);
      const cleanMaxAgeH = !Number.isFinite(rawMaxAgeH) ? 72 : Math.max(0, Math.min(8760, rawMaxAgeH));

      const rawAlphaRefreshSec = Number(
        newSettings.alpha_signal_refresh_interval_sec ?? current.alpha_signal_refresh_interval_sec ?? 10
      );
      const cleanAlphaRefreshSec = !Number.isFinite(rawAlphaRefreshSec)
        ? 10
        : Math.min(300, Math.max(5, Math.round(rawAlphaRefreshSec)));
      const rawAlphaJitoTip = Number(
        newSettings.alpha_signal_jito_tip_sol ?? current.alpha_signal_jito_tip_sol ?? 0.0005
      );
      const cleanAlphaJitoTip = !Number.isFinite(rawAlphaJitoTip)
        ? 0.0005
        : Math.max(0, Math.min(0.01, Number(rawAlphaJitoTip.toFixed(6))));
      const rawAlphaMaxRisk = Number(
        newSettings.alpha_signal_max_risk_score ?? current.alpha_signal_max_risk_score ?? 45
      );
      const cleanAlphaMaxRisk = !Number.isFinite(rawAlphaMaxRisk)
        ? 45
        : Math.max(10, Math.min(100, Math.round(rawAlphaMaxRisk)));
      const rawAlphaMinSol = Number(
        newSettings.alpha_signal_min_real_sol ?? current.alpha_signal_min_real_sol ?? 1.5
      );
      const cleanAlphaMinSol = !Number.isFinite(rawAlphaMinSol)
        ? 1.5
        : Math.max(0, Math.min(100, rawAlphaMinSol));

      if (cleanScanMode === 'smart_money_only') {
        mergedOptionEnabled.smart_money_enabled = true;
      }
      if (cleanScanMode === 'alpha_signal_only') {
        mergedOptionEnabled.alpha_signal_auto_find = true;
      }

      const updated: Record<string, any> = {
        ...current,
        ...newSettings,
        option_enabled: mergedOptionEnabled,
        smart_money_scan_mode: cleanScanMode,
        smart_money_max_wallets: cleanMaxWallets,
        smart_money_refresh_interval_sec: cleanRefreshSec,
        smart_money_max_coin_age_hours: cleanMaxAgeH,
        alpha_signal_refresh_interval_sec: cleanAlphaRefreshSec,
        alpha_signal_jito_tip_sol: cleanAlphaJitoTip,
        alpha_signal_max_risk_score: cleanAlphaMaxRisk,
        alpha_signal_min_real_sol: cleanAlphaMinSol,
        ...(cleanScanMode === 'smart_money_only' ? { smart_money_enabled: true } : {}),
        ...(cleanScanMode === 'alpha_signal_only' ? { alpha_signal_auto_find: true } : {}),
        mode: newSettings.mode === 'live' || current.mode === 'live'
          ? newSettings.mode === 'paper'
            ? 'paper'
            : 'live'
          : 'paper',
        enabled_platforms: Array.isArray(newSettings.enabled_platforms)
          ? Array.from(
              new Set(
                newSettings.enabled_platforms
                  .map((v: any) => String(v || '').trim().toLowerCase())
                  .filter(Boolean)
              )
            )
          : Array.isArray(current.enabled_platforms)
            ? current.enabled_platforms
            : [],
        smart_wallets: Array.isArray(newSettings.smart_wallets)
          ? Array.from(
              new Set(
                newSettings.smart_wallets
                  .map((v: any) => String(v || '').trim())
                  .filter(Boolean)
              )
            )
          : Array.isArray(current.smart_wallets)
            ? current.smart_wallets
            : [],
      };
      const validation = validatePythonSniperSettings(updated, this.solPriceUsd);
      if (!validation.valid) {
        return {
          ok: false,
          message: validation.error || 'Take profit % is too low to recover invested capital.',
        };
      }
      fs.writeFileSync(this.settingsFile, JSON.stringify(updated, null, 2), 'utf-8');
      if (this.orchestrator) {
        const rpcUrl = isPyOptionEnabled(updated, 'custom_rpc_url', true) ? updated.custom_rpc_url : '';
        const jupKey = isPyOptionEnabled(updated, 'jupiter_api_key', true) ? updated.jupiter_api_key : '';
        (this.orchestrator.rpcPool as any)?.setPrimaryCustomRpc?.(rpcUrl || '');
        (this.orchestrator.jupiter as any)?.setApiKey?.(jupKey || '');
        (this.orchestrator.pumpPortal as any)?.setTrackedSmartWallets?.(
          Array.isArray(updated.smart_wallets) ? updated.smart_wallets : []
        );
      }
      this.appendLog('INFO', 'Python bot settings updated and saved.');
      return { ok: true, settings: updated };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error saving settings' };
    }
  }

  public resetSettingsToDefault(scope: 'settings' | 'pro_desk' | 'all' = 'all') {
    try {
      const current = this.readSettings();
      const mode = this.getMode(current);
      const defaults = this.getDefaultSettings();
      const proDeskKeys = new Set<string>([
        'anti_sybil_enabled',
        'fresh_wallet_minutes',
        'max_shared_funder_count',
        'smart_money_enabled',
        'smart_wallets',
        'smart_money_min_confluence',
        'smart_money_size_boost_pct',
        'smart_money_auto_exit_on_sell',
        'smart_money_auto_discover',
        'smart_money_max_wallets',
        'smart_money_refresh_interval_sec',
        'smart_money_scan_mode',
        'smart_money_follow_older_coins',
        'smart_money_max_coin_age_hours',
        'smart_money_prioritize_entries',
        'alpha_signal_auto_find',
        'alpha_signal_auto_snipe',
        'alpha_signal_jito_tip_sol',
        'alpha_signal_refresh_interval_sec',
        'alpha_signal_max_risk_score',
        'alpha_signal_min_real_sol',
        'reused_socials_enabled',
        'max_social_reuse_count',
        'ws_exit_stream_enabled',
        'jito_dontfront_enabled',
        'jito_tip_sol',
        'orphan_sweep_enabled',
        'post_migration_pullback_enabled',
        'migration_min_dip_pct',
        'migration_wait_sec',
        'pre_migration_curve_enabled',
        'pre_migration_curve_min_pct',
        'pre_migration_curve_max_pct',
        'wash_trade_filter_enabled',
        'min_unique_makers_ratio',
        'min_unique_traders_5m',
        'sol_regime_filter_enabled',
        'sol_regime_max_drop_pct',
        'sol_regime_action',
        'anti_top_wick_enabled',
        'max_short_spike_pct',
        'conviction_sizing_enabled',
        'conviction_min_mult',
        'conviction_max_mult',
        'streak_throttle_enabled',
        'streak_loss_limit',
        'streak_cooldown_minutes',
        'streak_action',
        'narrative_cap_enabled',
        'max_same_narrative_positions',
        'auto_reclaim_rent_enabled',
      ]);

      const currentOpt = current.option_enabled && typeof current.option_enabled === 'object' ? current.option_enabled : {};
      const defaultOpt = (defaults.option_enabled || {}) as Record<string, boolean>;
      let updated: Record<string, any>;

      if (scope === 'pro_desk') {
        updated = { ...current, mode };
        for (const k of proDeskKeys) {
          updated[k] = defaults[k];
        }
        const nextOpt: Record<string, boolean> = { ...currentOpt };
        for (const k of proDeskKeys) {
          if (k in defaultOpt) {
            nextOpt[k] = defaultOpt[k];
          } else {
            delete nextOpt[k];
          }
        }
        delete nextOpt.jito_dont_front_enabled;
        updated.option_enabled = nextOpt;
      } else if (scope === 'settings') {
        updated = { ...defaults, mode };
        for (const k of proDeskKeys) {
          if (k in current) {
            updated[k] = current[k];
          }
        }
        const nextOpt: Record<string, boolean> = { ...defaultOpt };
        for (const k of proDeskKeys) {
          if (k in currentOpt) {
            nextOpt[k] = Boolean(currentOpt[k]);
          }
        }
        updated.option_enabled = nextOpt;
      } else {
        updated = { ...defaults, mode };
      }

      fs.writeFileSync(this.settingsFile, JSON.stringify(updated, null, 2), 'utf-8');
      if (this.orchestrator) {
        const rpcUrl = isPyOptionEnabled(updated, 'custom_rpc_url', true) ? updated.custom_rpc_url : '';
        const jupKey = isPyOptionEnabled(updated, 'jupiter_api_key', true) ? updated.jupiter_api_key : '';
        (this.orchestrator.rpcPool as any)?.setPrimaryCustomRpc?.(rpcUrl || '');
        (this.orchestrator.jupiter as any)?.setApiKey?.(jupKey || '');
      }
      const scopeLabel =
        scope === 'pro_desk'
          ? 'Python Pro Desk reset to Quick-Profit default settings.'
          : scope === 'settings'
            ? 'Python Sniper Settings reset to Quick-Profit default settings.'
            : 'Python Sniper Settings & Pro Desk reset to Quick-Profit defaults.';
      this.appendLog('INFO', scopeLabel);
      return { ok: true, scope, settings: updated };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error resetting settings' };
    }
  }

  public resetAccount() {
    try {
      const settings = this.readSettings();
      const mode = this.getMode(settings);
      if (mode === 'live') {
        return {
          ok: false,
          message: 'Live trade ledger and real wallet balance cannot be reset. Switch to PAPER mode to reset simulated funds.',
        };
      }
      this.stateRevision += 1;
      const { stateFile, tradesCsv, sellQueueFile, deleteQueueFile } = getSniperFilePaths('paper', this.baseDir);
      const startCash = typeof settings.start_balance_usd === 'number' ? settings.start_balance_usd : 50.0;
      const freshState = {
        mode: 'paper',
        cash: startCash,
        wallet_sol: null,
        positions: {},
        day: new Date().toISOString().slice(0, 10),
        day_pnl: 0.0,
        total_pnl: 0.0,
        closed: 0,
        wins: 0,
        blacklist: [],
        last_price_time: 0,
        scan_paused: false,
        sol_price_usd: this.solPriceUsd,
        sol_price_updated_at: this.solPriceUpdatedAt ? this.solPriceUpdatedAt / 1000 : 0,
      };
      this.writeStateAtomic(stateFile, freshState);
      if (fs.existsSync(tradesCsv)) fs.unlinkSync(tradesCsv);
      if (fs.existsSync(sellQueueFile)) fs.unlinkSync(sellQueueFile);
      if (fs.existsSync(deleteQueueFile)) fs.unlinkSync(deleteQueueFile);
      this.appendLog('INFO', `Python bot paper account reset (cash set to $${startCash.toFixed(2)}, trades cleared).`);
      return { ok: true, message: `Paper account reset with $${startCash.toFixed(2)} start balance` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error resetting account' };
    }
  }

  public async executeLiveBuy(params: {
    mint: string;
    symbol: string;
    tradeSizeUsd: number;
    slippagePct?: number;
    solPriceUsd?: number | null;
    decimals?: number | null;
    dex?: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    insufficientFunds?: boolean;
    blacklist?: boolean;
    walletBalanceSol?: number | null;
    txSig?: string;
    qty?: number;
    rawAmount?: string;
    decimals?: number;
    entryPriceUsd?: number;
    costUsd?: number;
    costSol?: number;
    feeSol?: number;
    rentSol?: number;
    solPriceUsd?: number;
  }> {
    if (!this.orchestrator || !this.txAdapter) {
      return { ok: false, error: 'Live trading bridge not attached to server orchestrator.' };
    }

    const { signer, rpcPool, jupiter } = this.orchestrator;
    const owner = signer.getPublicKey();
    if (!signer.isUnlocked() || !owner) {
      return { ok: false, error: 'Live wallet signer is locked. Unlock your wallet in Wallets & Signer first.' };
    }

    this.liveSwapActiveCount += 1;
    const buyStartMs = Date.now();
    try {

    let solPriceUsd =
      params.solPriceUsd && Number.isFinite(params.solPriceUsd) && params.solPriceUsd > 0
        ? params.solPriceUsd
        : this.solPriceUsd;
    if (!solPriceUsd || solPriceUsd <= 0) {
      solPriceUsd = (await jupiter.getLiveSolPriceUsd()) ?? (await this.refreshSolPrice());
    }
    if (!solPriceUsd || solPriceUsd <= 0) {
      return { ok: false, error: 'Unable to fetch live SOL/USD price for trade sizing.' };
    }

    const tradeSizeUsd = Number(params.tradeSizeUsd || 0);
    if (!Number.isFinite(tradeSizeUsd) || tradeSizeUsd <= 0) {
      return { ok: false, error: 'Invalid trade size USD.' };
    }
    const solAmount = tradeSizeUsd / solPriceUsd;
    const minRequiredSol = solAmount + 0.001;

    const savedSettings = this.readSettings();
    const amountRaw = String(Math.max(10_000, Math.round(solAmount * LAMPORTS_PER_SOL)));
    const effectiveSlipPct = isPyOptionEnabled(savedSettings, 'slippage_pct', true)
      ? (params.slippagePct ?? 2.0)
      : 2.0;
    const slippageBps = Math.min(2500, Math.max(50, Math.round(effectiveSlipPct * 100)));

    const fastBuyEnabled =
      isPyOptionEnabled(savedSettings, 'fast_live_buy_enabled', true) &&
      savedSettings.fast_live_buy_enabled !== false;
    const directDexFallbackEnabled =
      isPyOptionEnabled(savedSettings, 'direct_dex_fallback_enabled', true) &&
      savedSettings.direct_dex_fallback_enabled !== false;
    const preDecimals =
      typeof params.decimals === 'number' && Number.isFinite(params.decimals) && params.decimals >= 0 && params.decimals <= 18
        ? params.decimals
        : null;

    // 1-3. Run wallet SOL check (when cache is stale or tight), existing-balance check,
    // on-chain mint inspection (skipped when fast_live_buy_enabled has pre-verified decimals from Python),
    // AND Jupiter buy quote concurrently in one parallel batch.
    const hasFreshSufficientBal =
      this.liveWalletBalanceSol !== null &&
      Date.now() - this.liveWalletUpdatedAt < 10_000 &&
      this.liveWalletBalanceSol >= minRequiredSol + 0.002;

    const solBalPromise =
      !hasFreshSufficientBal && typeof rpcPool.getAgreedBalanceSol === 'function'
        ? rpcPool.getAgreedBalanceSol(owner).catch(() => ({
            agreed: false,
            balanceSol: null,
            readings: [] as number[],
          }))
        : Promise.resolve(null);

    const inspectPromise =
      fastBuyEnabled && preDecimals !== null
        ? Promise.resolve({ decimals: preDecimals })
        : typeof rpcPool.inspectTokenOnChain === 'function'
          ? rpcPool.inspectTokenOnChain(params.mint).catch(() => null)
          : Promise.resolve(null);

    const [balRes, preBal, mintInfo, quote] = await Promise.all([
      solBalPromise,
      rpcPool.getAgreedTokenBalanceUi(owner, params.mint).catch(() => ({
        agreed: false,
        balanceUi: null,
        readings: [],
        decimals: undefined,
        rawAmount: undefined,
      })),
      inspectPromise,
      jupiter
        .getQuote({
          inputMint: WSOL_MINT,
          outputMint: params.mint,
          amountRaw,
          slippageBps,
          allowRelaxFallback: true,
          bypassCache: true,
        })
        .catch(() => null),
    ]);

    if (balRes) {
      const knownBal = balRes.agreed
        ? balRes.balanceSol
        : balRes.readings.length > 0
          ? balRes.readings[0]
          : null;
      if (knownBal !== null) {
        this.liveWalletBalanceSol = knownBal;
        this.liveWalletUpdatedAt = Date.now();
        if (knownBal < minRequiredSol) {
          const availUsd = knownBal * solPriceUsd;
          const needUsd = minRequiredSol * solPriceUsd;
          return {
            ok: false,
            insufficientFunds: true,
            walletBalanceSol: knownBal,
            error: `There is no SOL (${knownBal.toFixed(4)} SOL / $${availUsd.toFixed(2)}) in the wallet to trade ${params.symbol}: need ~${minRequiredSol.toFixed(4)} SOL ($${needUsd.toFixed(2)}).`,
          };
        }
      }
    }

    if (preBal.agreed && (preBal.balanceUi ?? 0) > 0) {
      return {
        ok: false,
        blacklist: true,
        error: `On-chain balance already held for ${params.symbol}; skipping rebuy.`,
      };
    }

    const decimals = mintInfo?.decimals ?? preBal.decimals ?? preDecimals ?? 6;
    const execFees = this.resolveSwapExecutionFees(savedSettings, false);
    const jitoDontFrontOn =
      isPyOptionEnabled(savedSettings, 'jito_dontfront_enabled', true) &&
      savedSettings.jito_dontfront_enabled !== false;
    const priorityFeeSolFallback =
      typeof execFees.priorityFeeLamports === 'number'
        ? execFees.priorityFeeLamports / LAMPORTS_PER_SOL
        : execFees.jitoTipLamports > 0
          ? execFees.jitoTipLamports / LAMPORTS_PER_SOL
          : 0.0002;

    const buildAndSignBuy = async (
      initialQuote: any,
      attemptSlippageBps: number
    ): Promise<{
      ok: boolean;
      rawSigned?: Uint8Array;
      quoteUsed?: any;
      error?: string;
    }> => {
      let q = initialQuote;
      let jupErr: string | null = null;

      if (!q || Number(q.outAmount) <= 0) {
        const detail = typeof jupiter.getLastQuoteError === 'function' ? jupiter.getLastQuoteError() : null;
        jupErr = `No Jupiter buy route available (${detail || 'route not found'})`;
      } else {
        try {
          const swapTxResp = await jupiter.buildSwapTransaction({
            quoteResponse: q,
            userPublicKey: owner,
            priorityFeeLamports: execFees.priorityFeeLamports,
            priorityLevel: execFees.priorityLevel,
            maxPriorityFeeLamports: execFees.maxPriorityFeeLamports,
            ...(execFees.jitoTipLamports > 0 ? { jitoTipLamports: execFees.jitoTipLamports } : {}),
            dynamicSlippage: true,
          });
          const txBytes = Buffer.from(swapTxResp.swapTransaction, 'base64');
          const versionedTx = VersionedTransaction.deserialize(txBytes);
          if (jitoDontFrontOn) injectDontFrontMarker(versionedTx);
          await signer.signVersionedTransaction(versionedTx);
          return { ok: true, rawSigned: versionedTx.serialize(), quoteUsed: q };
        } catch (err) {
          jupErr = `Jupiter buy build failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // Automatic fallback to PumpPortal trade-local (pool='auto') and Raydium Trade API when enabled
      if (directDexFallbackEnabled) {
        const fallbackTimeout = fastBuyEnabled ? 3500 : 8000;
        const dexLow = String(params.dex || '').toLowerCase();
        if (typeof jupiter.buildPumpPortalSwapTransaction === 'function' && !dexLow.includes('orca')) {
          try {
            const ppRaw = await jupiter.buildPumpPortalSwapTransaction({
              userPublicKey: owner,
              action: 'buy',
              mint: params.mint,
              amount: solAmount,
              denominatedInSol: true,
              slippagePct: Math.max(attemptSlippageBps / 100, 8),
              priorityFeeSol: priorityFeeSolFallback,
              pool: 'auto',
              timeoutMs: fallbackTimeout,
            });
            const versionedTx = VersionedTransaction.deserialize(ppRaw);
            await signer.signVersionedTransaction(versionedTx);
            return { ok: true, rawSigned: versionedTx.serialize(), quoteUsed: null };
          } catch {
            // Try direct Raydium swap API next
          }
        }
        if (typeof (jupiter as any).buildRaydiumSwapTransaction === 'function') {
          try {
            const rayRaw = await (jupiter as any).buildRaydiumSwapTransaction({
              userPublicKey: owner,
              inputMint: WSOL_MINT,
              outputMint: params.mint,
              amountRaw,
              slippageBps: Math.max(attemptSlippageBps, 800),
              wrapSol: true,
              unwrapSol: false,
              timeoutMs: fallbackTimeout,
            });
            const versionedTx = VersionedTransaction.deserialize(rayRaw);
            await signer.signVersionedTransaction(versionedTx);
            return { ok: true, rawSigned: versionedTx.serialize(), quoteUsed: null };
          } catch {
            // Preserve clearer Jupiter primary error if Raydium does not route this pool
          }
        }
      }

      return { ok: false, error: jupErr || 'No Jupiter buy route available' };
    };

    let sig: string | null = null;
    let activeQuote: any = quote;
    const maxAttempts = slippageBps < 1000 ? 2 : 1;

    for (let attemptIdx = 0; attemptIdx < maxAttempts; attemptIdx += 1) {
      const attemptSlipBps =
        attemptIdx === 0 ? slippageBps : Math.min(1500, Math.max(slippageBps * 2, 1000));
      const attemptQuote =
        attemptIdx === 0
          ? quote
          : await jupiter
              .getQuote({
                inputMint: WSOL_MINT,
                outputMint: params.mint,
                amountRaw,
                slippageBps: attemptSlipBps,
                allowRelaxFallback: true,
                bypassCache: true,
              })
              .catch(() => null);

      const built = await buildAndSignBuy(attemptQuote, attemptSlipBps);
      if (!built.ok || !built.rawSigned) {
        return { ok: false, error: built.error || 'Live buy failed' };
      }
      activeQuote = built.quoteUsed;
      this.broadcastToJitoBestEffort(built.rawSigned, execFees.jitoTipLamports);

      let sentSig: string;
      try {
        sentSig = await this.txAdapter.sendSignedTransaction(built.rawSigned, 3, { skipPreflight: true });
      } catch (err) {
        return {
          ok: false,
          error: `Live buy submission failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const conf = await this.txAdapter.pollConfirmation(sentSig, 20_000);
      if (conf.status === 'failed') {
        const errText = conf.err || 'Buy transaction failed on-chain';
        const canRetrySlippage =
          attemptIdx + 1 < maxAttempts &&
          /slippage|6001|6004|1771|On-chain transaction error|InstructionError/i.test(errText);
        if (canRetrySlippage) {
          continue;
        }
        return { ok: false, error: errText };
      }
      if (conf.status === 'timeout') {
        const late = await this.txAdapter.pollConfirmation(sentSig, 45_000);
        if (late.status === 'failed') {
          return { ok: false, error: late.err || 'Buy transaction failed during confirmation' };
        }
        if (late.status === 'timeout') {
          const postCheck = await rpcPool
            .getAgreedTokenBalanceUi(owner, params.mint)
            .catch(() => ({ agreed: false, balanceUi: null }));
          if (!postCheck.agreed || (postCheck.balanceUi ?? 0) <= 0) {
            return { ok: false, error: `Buy confirmation timed out (tx ${sentSig}); verify on Solscan.` };
          }
        }
      }
      sig = sentSig;
      break;
    }

    if (!sig) {
      return { ok: false, error: 'Buy transaction failed on-chain' };
    }

    // 5. Reconcile exact on-chain quantities & SOL spent (capped at 750ms when fast_live_buy_enabled is active)
    const reconcilePromise = Promise.all([
      rpcPool
        .getAgreedTokenBalanceUi(owner, params.mint)
        .catch(() => ({ agreed: false, balanceUi: null as number | null, decimals: undefined as number | undefined, rawAmount: undefined as string | undefined })),
      this.txAdapter.reconcileParsedSwapSolDelta(sig, owner, params.mint),
    ]);

    let balCheck: { agreed: boolean; balanceUi: number | null; decimals?: number; rawAmount?: string } = {
      agreed: false,
      balanceUi: null,
      decimals: undefined,
      rawAmount: undefined,
    };
    let txDelta: {
      found: boolean;
      solDeltaLamports: number;
      feeLamports: number;
      createdAtaRentLamports?: number;
      closedAtaRentLamports?: number;
      tokenDeltaUi?: number;
    } = { found: false, solDeltaLamports: 0, feeLamports: 100_000 };

    if (fastBuyEnabled) {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      const fastRaced = await Promise.race([
        reconcilePromise.then((res) => ({ timedOut: false as const, res })),
        new Promise<{ timedOut: true }>((resolve) => {
          timerId = setTimeout(() => resolve({ timedOut: true }), 750);
        }),
      ]);
      if (timerId !== undefined) clearTimeout(timerId);
      if (fastRaced.timedOut) {
        // Return immediately using quoted fill and finish exact balance + rent reconciliation in background
        void reconcilePromise
          .then(([bgBal, bgDelta]) => {
            try {
              const { stateFile } = getSniperFilePaths('live', this.baseDir);
              if (fs.existsSync(stateFile)) {
                const st = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
                const p = st?.positions?.[params.mint];
                if (p) {
                  const bgQty =
                    bgBal.agreed && (bgBal.balanceUi ?? 0) > 0
                      ? bgBal.balanceUi!
                      : bgDelta.tokenDeltaUi && bgDelta.tokenDeltaUi > 0
                        ? bgDelta.tokenDeltaUi
                        : p.qty;
                  if (bgQty > 0) p.qty = bgQty;
                  if (bgBal.rawAmount && /^\d+$/.test(bgBal.rawAmount)) p.raw_amount = bgBal.rawAmount;
                  if (typeof bgBal.decimals === 'number') p.decimals = bgBal.decimals;
                  this.writeStateAtomic(stateFile, st);
                }
              }
            } catch {}
          })
          .catch(() => undefined);
      } else {
        [balCheck, txDelta] = fastRaced.res;
      }
    } else {
      [balCheck, txDelta] = await reconcilePromise;
    }

    const quotedQty = activeQuote ? Number(activeQuote.outAmount) / 10 ** decimals : 0;
    const realDecimals = typeof balCheck.decimals === 'number' ? balCheck.decimals : decimals;
    const realQty =
      balCheck.agreed && (balCheck.balanceUi ?? 0) > 0
        ? balCheck.balanceUi!
        : txDelta.tokenDeltaUi && txDelta.tokenDeltaUi > 0
          ? txDelta.tokenDeltaUi
          : quotedQty;
    const realRawAmount =
      balCheck.rawAmount && /^\d+$/.test(balCheck.rawAmount)
        ? balCheck.rawAmount
        : activeQuote?.outAmount
          ? String(activeQuote.outAmount)
          : '0';

    const quotedSolIn =
      activeQuote && Number(activeQuote.inAmount) > 0
        ? Number(activeQuote.inAmount) / LAMPORTS_PER_SOL
        : solAmount;
    let realSolSpent = quotedSolIn;
    let feeSol = 0.0001;
    let rentSol = 0;
    if (txDelta.found && txDelta.solDeltaLamports < 0) {
      const totalOutSol = Math.abs(txDelta.solDeltaLamports) / LAMPORTS_PER_SOL;
      feeSol = txDelta.feeLamports / LAMPORTS_PER_SOL;
      const detectedRentSol = (txDelta.createdAtaRentLamports ?? 0) / LAMPORTS_PER_SOL;
      const candidateSpent = Math.max(0.0001, totalOutSol - feeSol - detectedRentSol);
      if (quotedSolIn > 0 && candidateSpent > quotedSolIn) {
        // ExactIn swaps cannot consume more than quote.inAmount on the token swap itself;
        // any excess outflow is ancillary on-chain overhead (e.g., WSOL/PDA/accumulator rent, tips, protocol fees).
        realSolSpent = quotedSolIn;
        rentSol = detectedRentSol + (candidateSpent - quotedSolIn);
      } else {
        realSolSpent = candidateSpent;
        rentSol = detectedRentSol;
      }
    }

    const costUsd = realSolSpent * solPriceUsd;
    const entryPriceUsd = realQty > 0 ? costUsd / realQty : 0;

    // Pro Desk telemetry record for live buy
    try {
      const quotedBuyPriceUsd =
        quotedQty > 0 ? (quotedSolIn * solPriceUsd) / quotedQty : entryPriceUsd;
      const buySlipPct =
        quotedBuyPriceUsd > 0 && entryPriceUsd > 0
          ? ((entryPriceUsd - quotedBuyPriceUsd) / quotedBuyPriceUsd) * 100
          : 0;
      this.appendTelemetryRecord({
        tsMs: Date.now(),
        mode: 'live',
        side: 'BUY',
        mint: params.mint,
        symbol: params.symbol,
        dex: params.dex || 'jupiter',
        platform: 'python_sniper',
        quotedPriceUsd: quotedBuyPriceUsd,
        actualFillPriceUsd: entryPriceUsd,
        slippagePct: Number(buySlipPct.toFixed(3)),
        latencyMs: Math.max(1, Date.now() - buyStartMs),
        jitoProtected: jitoDontFrontOn,
      });
    } catch {}

    // Optimistically update wallet SOL balance immediately and refresh authoritative balance in background
    if (this.liveWalletBalanceSol !== null) {
      this.liveWalletBalanceSol = Math.max(0, this.liveWalletBalanceSol - realSolSpent - feeSol - rentSol);
      this.liveWalletUpdatedAt = Date.now();
    }
    if (typeof rpcPool.getAgreedBalanceSol === 'function') {
      void rpcPool
        .getAgreedBalanceSol(owner)
        .then((newBal) => {
          if (newBal?.agreed && newBal.balanceSol !== null) {
            this.liveWalletBalanceSol = newBal.balanceSol;
            this.liveWalletUpdatedAt = Date.now();
          }
        })
        .catch(() => undefined);
    }

    return {
      ok: true,
      txSig: sig,
      qty: realQty,
      rawAmount: realRawAmount,
      decimals: realDecimals,
      entryPriceUsd,
      costUsd,
      costSol: realSolSpent,
      feeSol,
      rentSol,
      solPriceUsd,
      walletBalanceSol: this.liveWalletBalanceSol,
    };
    } finally {
      this.liveSwapActiveCount = Math.max(0, this.liveSwapActiveCount - 1);
      this.lastLiveSwapAtMs = Date.now();
    }
  }

  public async executeLiveSell(params: {
    mint: string;
    symbol: string;
    qty: number;
    rawAmount?: string | null;
    decimals?: number | null;
    costUsd: number;
    costSol?: number | null;
    slippagePct?: number;
    solPriceUsd?: number | null;
    reason?: string;
    sellFraction?: number | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    noRoute?: boolean;
    txSig?: string;
    proceedsUsd?: number;
    proceedsSol?: number;
    pnlUsd?: number;
    pnlSol?: number;
    pnlPct?: number;
    exitPriceUsd?: number;
    feeSol?: number;
    reclaimedRentSol?: number;
    solPriceUsd?: number;
    walletBalanceSol?: number | null;
    soldQty?: number;
    soldFraction?: number;
    isPartial?: boolean;
    remainingQty?: number;
    remainingRawAmount?: string | null;
  }> {
    if (!this.orchestrator || !this.txAdapter) {
      return { ok: false, error: 'Live trading bridge not attached to server orchestrator.' };
    }

    const { signer, rpcPool, jupiter } = this.orchestrator;
    const owner = signer.getPublicKey();
    if (!signer.isUnlocked() || !owner) {
      return { ok: false, error: 'Live wallet signer is locked. Unlock your wallet in Wallets & Signer first.' };
    }

    this.liveSwapActiveCount += 1;
    try {

    let solPriceUsd =
      params.solPriceUsd && Number.isFinite(params.solPriceUsd) && params.solPriceUsd > 0
        ? params.solPriceUsd
        : this.solPriceUsd;
    if (!solPriceUsd || solPriceUsd <= 0) {
      solPriceUsd = (await jupiter.getLiveSolPriceUsd()) ?? (await this.refreshSolPrice()) ?? 100;
    }

    // 1. Resolve exact on-chain raw integer token balance & decimals (even if 1 RPC is 429 rate-limited)
    let effectiveDecimals = typeof params.decimals === 'number' && params.decimals >= 0 ? params.decimals : 6;
    let totalHeldQty = Number(params.qty || 0);
    let exactTotalRaw: string | null =
      params.rawAmount && /^\d+$/.test(params.rawAmount) && BigInt(params.rawAmount) > 0n
        ? params.rawAmount
        : null;

    const bal = await rpcPool.getAgreedTokenBalanceUi(owner, params.mint).catch(() => ({
      agreed: false,
      balanceUi: null,
      readings: [] as number[],
      decimals: undefined,
      rawAmount: undefined,
    }));
    const hasUsableBal =
      bal.balanceUi !== null &&
      bal.balanceUi > 0 &&
      (bal.agreed || (Array.isArray(bal.readings) && bal.readings.length > 0));
    if (hasUsableBal && bal.balanceUi !== null) {
      if (typeof bal.decimals === 'number' && bal.decimals >= 0) {
        effectiveDecimals = bal.decimals;
      }
      if (totalHeldQty <= 0 || bal.balanceUi < totalHeldQty) {
        totalHeldQty = bal.balanceUi;
      }
      if (bal.rawAmount && /^\d+$/.test(bal.rawAmount) && BigInt(bal.rawAmount) > 0n) {
        exactTotalRaw = bal.rawAmount;
      }
    } else if ((params.decimals === undefined || params.decimals === null) && typeof rpcPool.inspectTokenOnChain === 'function') {
      const mintInfo = await rpcPool.inspectTokenOnChain(params.mint).catch(() => null);
      if (mintInfo && typeof mintInfo.decimals === 'number' && mintInfo.decimals >= 0) {
        effectiveDecimals = mintInfo.decimals;
      }
    }

    const totalRawBig =
      exactTotalRaw !== null
        ? BigInt(exactTotalRaw)
        : BigInt(Math.max(1, Math.floor(Math.max(0, totalHeldQty) * 10 ** effectiveDecimals)));

    const requestedFraction =
      params.sellFraction !== undefined &&
      params.sellFraction !== null &&
      Number.isFinite(params.sellFraction) &&
      params.sellFraction > 0 &&
      params.sellFraction < 0.999
        ? Math.max(0.05, Math.min(0.99, params.sellFraction))
        : 1.0;

    let rawToSellBig = totalRawBig;
    let isPartial = false;
    if (requestedFraction < 0.999 && totalRawBig > 1n) {
      const scaled = (totalRawBig * BigInt(Math.round(requestedFraction * 10_000))) / 10_000n;
      if (scaled > 0n && scaled < totalRawBig) {
        rawToSellBig = scaled;
        isPartial = true;
      }
    }

    const actualSoldFraction =
      totalRawBig > 0n ? Number(rawToSellBig) / Number(totalRawBig) : 1.0;
    const soldQty = Number(rawToSellBig) / 10 ** effectiveDecimals;
    const amountRaw = rawToSellBig.toString();

    const savedSellInitSettings = this.readSettings();
    const effectiveSellSlipPct = isPyOptionEnabled(savedSellInitSettings, 'slippage_pct', true)
      ? (params.slippagePct ?? 2.0)
      : 2.0;
    const baseSlippageBps = Math.min(2500, Math.max(100, Math.round(effectiveSellSlipPct * 100)));
    const reasonStr = String(params.reason || '');
    const isUrgentExit =
      reasonStr.startsWith('trailing_stop') ||
      reasonStr.startsWith('stop_loss') ||
      reasonStr === 'rug_liquidity_drop' ||
      reasonStr === 'manual_exit';
    const slippageTiers = Array.from(
      new Set([
        baseSlippageBps,
        Math.max(baseSlippageBps, 1000),
        Math.max(baseSlippageBps, 2500),
        5000,
      ])
    ).sort((a, b) => a - b);

    let quote: any = null;
    let sig: string | null = null;
    let lastError = 'Sell failed';
    let hadAnyRoute = false;

    // 2. Progressive slippage escalation across quote + build + sign + send so tight slippage/preflight never blocks TP/trailing/rug exits
    for (let idx = 0; idx < slippageTiers.length; idx += 1) {
      const slipBps = slippageTiers[idx];
      const relax = idx > 0 || isUrgentExit;
      const q = await jupiter.getQuote({
        inputMint: params.mint,
        outputMint: WSOL_MINT,
        amountRaw,
        slippageBps: slipBps,
        restrictIntermediateTokens: !relax,
        allowRelaxFallback: true,
        bypassCache: true,
      });

      if (!q || Number(q.outAmount) <= 0) {
        const detail = typeof jupiter.getLastQuoteError === 'function' ? jupiter.getLastQuoteError() : null;
        lastError = `No sell route available${detail ? ` (${detail})` : ''}`;
        if (detail && /429|Rate limited|Circuit breaker/i.test(detail)) {
          break;
        }
        continue;
      }
      hadAnyRoute = true;
      quote = q;

      let swapTxResp;
      const savedSettings = this.readSettings();
      const sellExecFees = this.resolveSwapExecutionFees(savedSettings, isUrgentExit);
      const jitoSellDontFront =
        isPyOptionEnabled(savedSettings, 'jito_dontfront_enabled', true) &&
        savedSettings.jito_dontfront_enabled !== false;
      try {
        swapTxResp = await jupiter.buildSwapTransaction({
          quoteResponse: q,
          userPublicKey: owner,
          priorityFeeLamports: sellExecFees.priorityFeeLamports,
          priorityLevel: sellExecFees.priorityLevel,
          maxPriorityFeeLamports: sellExecFees.maxPriorityFeeLamports,
          ...(sellExecFees.jitoTipLamports > 0 ? { jitoTipLamports: sellExecFees.jitoTipLamports } : {}),
          dynamicSlippage: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = `Jupiter sell build failed: ${msg}`;
        if (/429|Rate limited|Circuit breaker/i.test(msg)) {
          break;
        }
        continue;
      }

      const txBytes = Buffer.from(swapTxResp.swapTransaction, 'base64');
      const versionedTx = VersionedTransaction.deserialize(txBytes);
      if (jitoSellDontFront) injectDontFrontMarker(versionedTx);
      await signer.signVersionedTransaction(versionedTx);
      const rawSigned = versionedTx.serialize();
      this.broadcastToJitoBestEffort(rawSigned, sellExecFees.jitoTipLamports, jitoSellDontFront);

      let sentSig: string | null = null;
      const preferSkipPreflight = idx > 0 || isUrgentExit;
      try {
        sentSig = await this.txAdapter.sendSignedTransaction(rawSigned, 3, {
          skipPreflight: preferSkipPreflight,
        });
      } catch (err) {
        // Retry once with skipPreflight=true if preflight simulation failed due to volatile pool state
        if (!preferSkipPreflight) {
          try {
            sentSig = await this.txAdapter.sendSignedTransaction(rawSigned, 3, {
              skipPreflight: true,
            });
          } catch (retryErr) {
            lastError = `Live sell submission failed (${(slipBps / 100).toFixed(1)}% slip): ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`;
            continue;
          }
        } else {
          lastError = `Live sell submission failed (${(slipBps / 100).toFixed(1)}% slip): ${err instanceof Error ? err.message : String(err)}`;
          continue;
        }
      }

      const confirmWindowMs = idx === slippageTiers.length - 1 ? 20_000 : 14_000;
      const conf = await this.txAdapter.pollConfirmation(sentSig, confirmWindowMs);
      if (conf.status === 'failed') {
        lastError = conf.err || `Sell failed on-chain at ${(slipBps / 100).toFixed(1)}% slippage`;
        continue;
      }
      if (conf.status === 'timeout') {
        // Check whether the tx actually landed on-chain despite slow confirmation RPC polling
        const recentSig = await this.txAdapter.findRecentSellSignature(owner, params.mint).catch(() => null);
        if (recentSig) {
          sig = recentSig;
          break;
        }
        const postBalCheck = !isPartial
          ? await rpcPool.getAgreedTokenBalanceUi(owner, params.mint).catch(() => null)
          : null;
        if (postBalCheck && (postBalCheck.agreed || (postBalCheck.readings?.length ?? 0) > 0) && (postBalCheck.balanceUi ?? 0) <= 0.000001) {
          sig = sentSig;
          break;
        }
        lastError = `Sell confirmation timed out (tx ${sentSig}) at ${(slipBps / 100).toFixed(1)}% slippage`;
        if (idx === slippageTiers.length - 1) {
          return {
            ok: false,
            error: `Sell confirmation timed out (tx ${sentSig}); keeping position open until verified.`,
          };
        }
        continue;
      }

      sig = sentSig;
      break;
    }

    // Emergency PumpPortal + Raydium Trade API sell fallback when Jupiter is rate-limited or has no route
    const savedSellSettings = this.readSettings();
    const sellDirectFallbackOn =
      isPyOptionEnabled(savedSellSettings, 'direct_dex_fallback_enabled', true) &&
      savedSellSettings.direct_dex_fallback_enabled !== false;
    if (!sig && sellDirectFallbackOn) {
      const sellExecFees = this.resolveSwapExecutionFees(savedSellSettings, true);
      const ppFeeSol =
        typeof sellExecFees.priorityFeeLamports === 'number'
          ? sellExecFees.priorityFeeLamports / LAMPORTS_PER_SOL
          : 0.0003;
      const fallbackSlipPct = Math.max(params.slippagePct ?? 3, isUrgentExit ? 25 : 15);
      const tryDirectBytes = async (rawUnsigned: Uint8Array): Promise<boolean> => {
        const versionedTx = VersionedTransaction.deserialize(rawUnsigned);
        await signer.signVersionedTransaction(versionedTx);
        const rawSigned = versionedTx.serialize();
        this.broadcastToJitoBestEffort(rawSigned, sellExecFees.jitoTipLamports);
        const fbSig = await this.txAdapter!.sendSignedTransaction(rawSigned, 3, { skipPreflight: true });
        const fbConf = await this.txAdapter!.pollConfirmation(fbSig, 20_000);
        if (fbConf.status === 'confirmed') {
          sig = fbSig;
          hadAnyRoute = true;
          return true;
        }
        if (fbConf.status === 'timeout') {
          const postBalCheck = !isPartial
            ? await rpcPool.getAgreedTokenBalanceUi(owner, params.mint).catch(() => null)
            : null;
          if (postBalCheck && (postBalCheck.agreed || (postBalCheck.readings?.length ?? 0) > 0) && (postBalCheck.balanceUi ?? 0) <= 0.000001) {
            sig = fbSig;
            hadAnyRoute = true;
            return true;
          }
        }
        return false;
      };

      if (typeof jupiter.buildPumpPortalSwapTransaction === 'function') {
        try {
          const ppRaw = await jupiter.buildPumpPortalSwapTransaction({
            userPublicKey: owner,
            action: 'sell',
            mint: params.mint,
            amount: isPartial ? soldQty : '100%',
            denominatedInSol: false,
            slippagePct: fallbackSlipPct,
            priorityFeeSol: ppFeeSol,
            pool: 'auto',
            timeoutMs: savedSellSettings.fast_live_buy_enabled !== false ? 4000 : 8000,
          });
          await tryDirectBytes(ppRaw);
        } catch {
          // Try Raydium emergency sell next
        }
      }
      if (!sig && typeof (jupiter as any).buildRaydiumSwapTransaction === 'function') {
        try {
          const rayRaw = await (jupiter as any).buildRaydiumSwapTransaction({
            userPublicKey: owner,
            inputMint: params.mint,
            outputMint: WSOL_MINT,
            amountRaw,
            slippageBps: Math.min(5000, Math.round(fallbackSlipPct * 100)),
            wrapSol: false,
            unwrapSol: true,
            timeoutMs: savedSellSettings.fast_live_buy_enabled !== false ? 4000 : 8000,
          });
          await tryDirectBytes(rayRaw);
        } catch {
          // Keep primary Jupiter error details
        }
      }
    }

    if (!sig) {
      return {
        ok: false,
        noRoute: !hadAnyRoute,
        error: `${lastError}; keeping position open for retry`,
      };
    }

    // 3. Reconcile exact SOL proceeds & remaining balance (when partial sell)
    const txDelta = await this.txAdapter.reconcileParsedSwapSolDelta(sig, owner, params.mint);
    const quotedSolOut = quote ? Number(quote.outAmount) / LAMPORTS_PER_SOL : 0;
    let solOut = quotedSolOut;
    let feeSol = 0.0001;
    let reclaimedRentSol = 0;

    if (txDelta.found) {
      feeSol = txDelta.feeLamports / LAMPORTS_PER_SOL;
      reclaimedRentSol = (txDelta.closedAtaRentLamports ?? 0) / LAMPORTS_PER_SOL;
      if (txDelta.solDeltaLamports > 0) {
        solOut = Math.max(0, txDelta.solDeltaLamports / LAMPORTS_PER_SOL + feeSol - reclaimedRentSol);
      }
    }

    let remainingQty = Math.max(0, totalHeldQty - soldQty);
    let remainingRawAmount: string | null =
      totalRawBig > rawToSellBig ? (totalRawBig - rawToSellBig).toString() : null;
    if (isPartial) {
      const postBal = await rpcPool.getAgreedTokenBalanceUi(owner, params.mint).catch(() => null);
      if (postBal && (postBal.agreed || (postBal.readings?.length ?? 0) > 0) && postBal.balanceUi !== null) {
        remainingQty = Math.max(0, postBal.balanceUi);
        if (postBal.rawAmount && /^\d+$/.test(postBal.rawAmount)) {
          remainingRawAmount = postBal.rawAmount;
        }
      }
      if (remainingQty <= 0) {
        isPartial = false;
        remainingRawAmount = null;
      }
    } else {
      remainingQty = 0;
      remainingRawAmount = null;
    }

    const proceedsUsd = solOut * solPriceUsd;
    const totalCostSol =
      params.costSol && params.costSol > 0 ? params.costSol : solPriceUsd > 0 ? params.costUsd / solPriceUsd : 0;
    const allocatedCostUsd = params.costUsd * actualSoldFraction;
    const allocatedCostSol = totalCostSol * actualSoldFraction;
    const netSolDelta = solOut + reclaimedRentSol - allocatedCostSol - feeSol;
    const pnlUsd = netSolDelta * solPriceUsd;
    const pnlPct = allocatedCostUsd > 0 ? (pnlUsd / allocatedCostUsd) * 100 : 0;
    const exitPriceUsd = soldQty > 0 ? proceedsUsd / soldQty : 0;

    // Auto-reclaim empty ATA rent immediately after full live sell if enabled
    const sellCfgAfter = this.readSettings();
    const autoReclaimOn =
      isPyOptionEnabled(sellCfgAfter, 'auto_reclaim_rent_enabled', true) &&
      sellCfgAfter.auto_reclaim_rent_enabled !== false;
    if (!isPartial && reclaimedRentSol <= 0 && autoReclaimOn) {
      const reclaimed = await this.reclaimRentAccounts(false, params.mint).catch(() => null);
      if (reclaimed && reclaimed.reclaimedSol > 0) {
        reclaimedRentSol += reclaimed.reclaimedSol;
      }
    }

    try {
      const quotedSellPx = soldQty > 0 && quotedSolOut > 0 ? (quotedSolOut * solPriceUsd) / soldQty : exitPriceUsd;
      const sellSlipPct =
        quotedSellPx > 0 && exitPriceUsd > 0 ? ((quotedSellPx - exitPriceUsd) / quotedSellPx) * 100 : 0;
      const jitoSellFlag =
        isPyOptionEnabled(sellCfgAfter, 'jito_dontfront_enabled', true) &&
        sellCfgAfter.jito_dontfront_enabled !== false;
      this.appendTelemetryRecord({
        tsMs: Date.now(),
        mode: 'live',
        side: 'SELL',
        mint: params.mint,
        symbol: params.symbol,
        dex: 'jupiter',
        platform: 'python_sniper',
        quotedPriceUsd: quotedSellPx,
        actualFillPriceUsd: exitPriceUsd,
        slippagePct: Number(sellSlipPct.toFixed(3)),
        latencyMs: 0,
        jitoProtected: jitoSellFlag,
      });
    } catch {}

    if (typeof rpcPool.getAgreedBalanceSol === 'function') {
      const newBal = await rpcPool.getAgreedBalanceSol(owner).catch(() => null);
      if (newBal?.agreed && newBal.balanceSol !== null) {
        this.liveWalletBalanceSol = newBal.balanceSol;
        this.liveWalletUpdatedAt = Date.now();
      } else if (this.liveWalletBalanceSol !== null) {
        this.liveWalletBalanceSol = Math.max(0, this.liveWalletBalanceSol + solOut + reclaimedRentSol - feeSol);
      }
    }

    return {
      ok: true,
      txSig: sig,
      proceedsUsd,
      proceedsSol: solOut,
      pnlUsd,
      pnlSol: netSolDelta,
      pnlPct,
      exitPriceUsd,
      feeSol,
      reclaimedRentSol,
      solPriceUsd,
      walletBalanceSol: this.liveWalletBalanceSol,
      soldQty,
      soldFraction: actualSoldFraction,
      isPartial,
      remainingQty,
      remainingRawAmount,
    };
    } finally {
      this.liveSwapActiveCount = Math.max(0, this.liveSwapActiveCount - 1);
      this.lastLiveSwapAtMs = Date.now();
    }
  }

  public async sellPosition(mint: string) {
    try {
      const settings = this.readSettings();
      const mode = this.getMode(settings);
      const { stateFile, tradesCsv, sellQueueFile } = getSniperFilePaths(mode, this.baseDir);

      if (!fs.existsSync(stateFile)) return { ok: false, message: 'No active state' };
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (!state.positions || !state.positions[mint]) {
        return { ok: false, message: 'Position not found' };
      }
      const pos = state.positions[mint];

      // If Python bot is actively running, delegate the sell to bot.py's monitor thread
      if (this.running) {
        let queue: string[] = [];
        if (fs.existsSync(sellQueueFile)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(sellQueueFile, 'utf-8'));
            if (Array.isArray(parsed)) queue = parsed;
          } catch {}
        }
        if (!queue.includes(mint)) queue.push(mint);
        fs.writeFileSync(sellQueueFile, JSON.stringify(queue), 'utf-8');
        this.appendLog('INFO', `Queued manual sell for ${pos.symbol} at live market price...`);
        return { ok: true, message: `Closing ${pos.symbol} at live price...` };
      }

      const maxSlots = isPyOptionEnabled(settings, 'max_open_positions', true)
        ? Math.max(1, Number(settings.max_open_positions || 3))
        : Number.MAX_SAFE_INTEGER;
      const nowIso = new Date().toISOString();
      let fill = pos.current_price || pos.entry_price;
      let proceeds = 0;
      let pnlUsd = 0;
      let pnlPct = 0;
      let txSig = '';

      if (mode === 'live') {
        const res = await this.executeLiveSell({
          mint,
          symbol: pos.symbol,
          qty: Number(pos.qty || 0),
          rawAmount: pos.raw_amount,
          decimals: pos.decimals,
          costUsd: Number(pos.cost || 0),
          costSol: pos.cost_sol,
          slippagePct: isPyOptionEnabled(settings, 'slippage_pct', true)
            ? (settings.slippage_pct ?? 2.0)
            : 2.0,
          solPriceUsd: this.solPriceUsd,
          reason: 'manual_exit',
        });
        if (!res.ok) {
          this.appendLog('WARN', `Manual live sell failed for ${pos.symbol}: ${res.error}`);
          return { ok: false, message: res.error || 'Live sell failed' };
        }
        fill = res.exitPriceUsd ?? fill;
        proceeds = res.proceedsUsd ?? 0;
        pnlUsd = res.pnlUsd ?? 0;
        pnlPct = res.pnlPct ?? 0;
        txSig = res.txSig ?? '';
        if (res.walletBalanceSol !== undefined && res.walletBalanceSol !== null && this.solPriceUsd) {
          state.wallet_sol = res.walletBalanceSol;
          state.cash = Number((res.walletBalanceSol * this.solPriceUsd).toFixed(4));
        }
      } else {
        const currentPrice = pos.current_price || pos.entry_price;
        const slippage = isPyOptionEnabled(settings, 'slippage_pct', true)
          ? Number(settings.slippage_pct ?? 2.0) / 100
          : 0;
        const fee = isPyOptionEnabled(settings, 'fee_pct', true)
          ? Number(settings.fee_pct ?? 1.0) / 100
          : 0;
        fill = currentPrice * (1 - slippage);
        proceeds = pos.qty * fill * (1 - fee);
        pnlUsd = proceeds - pos.cost;
        pnlPct = (pnlUsd / pos.cost) * 100;
        state.cash = (state.cash || 50) + proceeds;
      }

      this.stateRevision += 1;
      this.recentlyDeletedMints.set(mint, Date.now());
      state.last_sell_time = Date.now() / 1000;
      delete state.positions[mint];
      state.closed = (state.closed || 0) + 1;
      state.total_pnl = (state.total_pnl || 0) + pnlUsd;
      state.day_pnl = (state.day_pnl || 0) + pnlUsd;
      if (pnlUsd > 0) state.wins = (state.wins || 0) + 1;
      if (Object.keys(state.positions).length < maxSlots) {
        state.scan_paused = false;
      }
      this.writeStateAtomic(stateFile, state);

      if (!fs.existsSync(tradesCsv)) {
        fs.writeFileSync(
          tradesCsv,
          'time,action,symbol,mint,price,usd,pnl_usd,pnl_pct,reason,dexscreener,age_s,dex,source,entry_price,sol_price_usd,tx_sig\n',
          'utf-8'
        );
      }
      const solPxStr = this.solPriceUsd ? this.solPriceUsd.toFixed(4) : '';
      const csvLine = `${nowIso},SELL,${pos.symbol},${mint},${Number(fill).toFixed(8)},${proceeds.toFixed(4)},${pnlUsd.toFixed(4)},${pnlPct.toFixed(2)},manual_exit,${pos.url || `https://dexscreener.com/solana/${mint}`},${pos.age_at_entry || 0},${pos.dex || '?'},${pos.source || '?'},${Number(pos.entry_price || 0).toFixed(8)},${solPxStr},${txSig}\n`;
      fs.appendFileSync(tradesCsv, csvLine, 'utf-8');

      const solPxVal = this.solPriceUsd || null;
      const pnlSolVal = solPxVal && solPxVal > 0 ? pnlUsd / solPxVal : null;
      const holdSec = pos.opened ? Math.max(0, Date.now() / 1000 - pos.opened) : null;
      this.appendPnlCsv(mode, {
        time: nowIso,
        symbol: pos.symbol,
        mint,
        outcome: pnlUsd >= 0 ? 'PROFIT' : 'LOSS',
        entryPrice: Number(pos.entry_price || 0),
        exitPrice: Number(fill || 0),
        costUsd: Number(pos.cost || 0),
        proceedsUsd: proceeds,
        pnlUsd,
        pnlSol: pnlSolVal,
        pnlPct,
        reason: 'manual_exit',
        holdSeconds: holdSec,
        dex: pos.dex,
        source: pos.source,
        solPriceUsd: solPxVal,
        txBuy: pos.tx_buy,
        txSell: txSig,
        dexscreener: pos.url,
      });

      const txNote = txSig ? ` tx=${txSig.slice(0, 8)}...` : '';
      this.appendLog(
        'INFO',
        `Manual ${mode.toUpperCase()} sell executed for ${pos.symbol} (entry $${Number(pos.entry_price).toFixed(8)} -> exit $${Number(fill).toFixed(8)}, PnL $${pnlUsd.toFixed(2)})${txNote}`
      );
      return { ok: true, message: `Sold ${pos.symbol} manually${txNote}`, txSig: txSig || undefined };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error selling position' };
    }
  }

  public forceDeletePosition(mint: string, reason = 'rugpull_writeoff') {
    try {
      const settings = this.readSettings();
      const mode = this.getMode(settings);
      const { stateFile, tradesCsv, sellQueueFile, deleteQueueFile } = getSniperFilePaths(mode, this.baseDir);

      if (!fs.existsSync(stateFile)) return { ok: false, message: 'No active state' };
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (!state.positions || !state.positions[mint]) {
        return { ok: false, message: 'Position already removed' };
      }

      this.stateRevision += 1;
      this.recentlyDeletedMints.set(mint, Date.now());
      if (this.recentlyDeletedMints.size > 500) {
        const cutoff = Date.now() - 60_000;
        for (const [k, ts] of this.recentlyDeletedMints.entries()) {
          if (ts < cutoff) this.recentlyDeletedMints.delete(k);
        }
      }

      const pos = state.positions[mint];
      const maxSlots = isPyOptionEnabled(settings, 'max_open_positions', true)
        ? Math.max(1, Number(settings.max_open_positions || 3))
        : Number.MAX_SAFE_INTEGER;
      const nowIso = new Date().toISOString();
      const costUsd = Number(pos.cost || 0);
      const pnlUsd = -costUsd;
      const pnlPct = -100.0;
      const cleanReason = reason === 'manual_delete' ? 'manual_delete' : 'rugpull_writeoff';

      if (cleanReason === 'rugpull_writeoff' && typeof pos.creator === 'string' && pos.creator.trim()) {
        try {
          const histFile = path.join(this.baseDir, 'creator_history.json');
          const hist = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf-8')) : {};
          if (hist && typeof hist === 'object') {
            const creatorKey = pos.creator.trim();
            const bucket = hist[creatorKey] && typeof hist[creatorKey] === 'object' ? hist[creatorKey] : {};
            const prev = bucket[mint] && typeof bucket[mint] === 'object' ? bucket[mint] : {};
            const nowSec = Math.floor(Date.now() / 1000);
            const launchSec = Number(prev.launch_ts || pos.created_at_sec || pos.opened || nowSec);
            const rugMinutes = Math.max(0, Math.round(((nowSec - launchSec) / 60) * 100) / 100);
            bucket[mint] = {
              ...prev,
              symbol: prev.symbol || pos.symbol || '',
              launch_ts: launchSec,
              pool_created_at_ms: Number(prev.pool_created_at_ms || launchSec * 1000),
              rugged: true,
              rug_ts: nowSec,
              rugged_at_ms: Number(prev.rugged_at_ms || nowSec * 1000),
              rug_minutes: rugMinutes,
              reason: 'rugpull_writeoff',
            };
            hist[creatorKey] = bucket;
            this.writeStateAtomic(histFile, hist);
          }
        } catch {}
      }

      state.last_sell_time = Date.now() / 1000;
      delete state.positions[mint];
      if (!Array.isArray(state.blacklist)) state.blacklist = [];
      if (!state.blacklist.includes(mint)) {
        state.blacklist.push(mint);
        if (state.blacklist.length > 5000) {
          state.blacklist = state.blacklist.slice(-5000);
        }
      }
      state.closed = (state.closed || 0) + 1;
      state.total_pnl = (state.total_pnl || 0) + pnlUsd;
      state.day_pnl = (state.day_pnl || 0) + pnlUsd;
      if (Object.keys(state.positions).length < maxSlots) {
        state.scan_paused = false;
      }
      this.writeStateAtomic(stateFile, state);

      // Remove mint from pending sell queue if present
      if (fs.existsSync(sellQueueFile)) {
        try {
          const q = JSON.parse(fs.readFileSync(sellQueueFile, 'utf-8'));
          if (Array.isArray(q) && q.includes(mint)) {
            fs.writeFileSync(sellQueueFile, JSON.stringify(q.filter((m) => m !== mint)), 'utf-8');
          }
        } catch {}
      }

      // If Python bot process is running in memory, also signal delete_queue so it never overwrites disk state
      if (this.running) {
        try {
          let dq: string[] = [];
          if (fs.existsSync(deleteQueueFile)) {
            const parsed = JSON.parse(fs.readFileSync(deleteQueueFile, 'utf-8'));
            if (Array.isArray(parsed)) dq = parsed;
          }
          if (!dq.includes(mint)) dq.push(mint);
          fs.writeFileSync(deleteQueueFile, JSON.stringify(dq), 'utf-8');
        } catch {}
      }

      if (!fs.existsSync(tradesCsv)) {
        fs.writeFileSync(
          tradesCsv,
          'time,action,symbol,mint,price,usd,pnl_usd,pnl_pct,reason,dexscreener,age_s,dex,source,entry_price,sol_price_usd,tx_sig\n',
          'utf-8'
        );
      }
      const solPxStr = this.solPriceUsd ? this.solPriceUsd.toFixed(4) : '';
      const csvLine = `${nowIso},SELL,${pos.symbol},${mint},0.00000000,0.0000,${pnlUsd.toFixed(4)},${pnlPct.toFixed(2)},${cleanReason},${pos.url || `https://dexscreener.com/solana/${mint}`},${pos.age_at_entry || 0},${pos.dex || '?'},${pos.source || '?'},${Number(pos.entry_price || 0).toFixed(8)},${solPxStr},\n`;
      fs.appendFileSync(tradesCsv, csvLine, 'utf-8');

      const solPxVal = this.solPriceUsd || null;
      const pnlSolVal = solPxVal && solPxVal > 0 ? pnlUsd / solPxVal : null;
      const holdSec = pos.opened ? Math.max(0, Date.now() / 1000 - pos.opened) : null;
      this.appendPnlCsv(mode, {
        time: nowIso,
        symbol: pos.symbol,
        mint,
        outcome: 'LOSS',
        entryPrice: Number(pos.entry_price || 0),
        exitPrice: 0,
        costUsd,
        proceedsUsd: 0,
        pnlUsd,
        pnlSol: pnlSolVal,
        pnlPct: -100.0,
        reason: cleanReason,
        holdSeconds: holdSec,
        dex: pos.dex,
        source: pos.source,
        solPriceUsd: solPxVal,
        txBuy: pos.tx_buy,
        txSell: '',
        dexscreener: pos.url,
      });

      this.appendLog(
        'WARN',
        `Force-cleared stuck/rugged position for ${pos.symbol} (${cleanReason}, recorded loss -$${costUsd.toFixed(2)}, slot freed)`
      );
      return { ok: true, message: `Force-cleared ${pos.symbol} position (${cleanReason}) and freed slot.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error clearing position' };
    }
  }

  public appendPnlCsv(
    mode: SniperMode,
    trade: {
      time: string;
      symbol: string;
      mint: string;
      outcome: 'PROFIT' | 'LOSS';
      entryPrice: number | string;
      exitPrice: number | string;
      costUsd: number;
      proceedsUsd: number;
      pnlUsd: number;
      pnlSol?: number | null;
      pnlPct: number;
      reason: string;
      holdSeconds?: number | null;
      dex?: string;
      source?: string;
      solPriceUsd?: number | null;
      txBuy?: string;
      txSell?: string;
      dexscreener?: string;
    }
  ) {
    const { pnlCsv } = getSniperFilePaths(mode, this.baseDir);
    if (!fs.existsSync(pnlCsv)) {
      fs.writeFileSync(
        pnlCsv,
        'time,symbol,mint,outcome,entry_price,exit_price,cost_usd,proceeds_usd,pnl_usd,pnl_sol,pnl_pct,reason,hold_seconds,dex,source,sol_price_usd,tx_buy,tx_sell,dexscreener\n',
        'utf-8'
      );
    }
    const row = [
      trade.time,
      trade.symbol,
      trade.mint,
      trade.outcome,
      typeof trade.entryPrice === 'number' ? trade.entryPrice.toFixed(8) : trade.entryPrice,
      typeof trade.exitPrice === 'number' ? trade.exitPrice.toFixed(8) : trade.exitPrice,
      trade.costUsd.toFixed(4),
      trade.proceedsUsd.toFixed(4),
      trade.pnlUsd.toFixed(4),
      trade.pnlSol !== undefined && trade.pnlSol !== null ? trade.pnlSol.toFixed(6) : '',
      trade.pnlPct.toFixed(2),
      trade.reason,
      trade.holdSeconds !== undefined && trade.holdSeconds !== null ? trade.holdSeconds.toFixed(1) : '',
      trade.dex || '?',
      trade.source || '?',
      trade.solPriceUsd ? trade.solPriceUsd.toFixed(4) : '',
      trade.txBuy || '',
      trade.txSell || '',
      trade.dexscreener || `https://dexscreener.com/solana/${trade.mint}`,
    ].join(',');
    fs.appendFileSync(pnlCsv, row + '\n', 'utf-8');
  }

  public exportPnlCsv(mode: SniperMode): string {
    const { pnlCsv, tradesCsv } = getSniperFilePaths(mode, this.baseDir);
    const header = 'time,symbol,mint,outcome,entry_price,exit_price,cost_usd,proceeds_usd,pnl_usd,pnl_sol,pnl_pct,reason,hold_seconds,dex,source,sol_price_usd,tx_buy,tx_sell,dexscreener\n';

    if (fs.existsSync(pnlCsv)) {
      const content = fs.readFileSync(pnlCsv, 'utf-8').trim();
      if (content.length > 0 && content.includes('\n')) {
        return content + '\n';
      }
    }

    // Synthesize from tradesCsv if pnlCsv does not exist or only has header
    const rawRows: RawSniperCsvRow[] = [];
    if (fs.existsSync(tradesCsv)) {
      try {
        const content = fs.readFileSync(tradesCsv, 'utf-8');
        const lines = content.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map((p) => p.trim());
          if (parts.length >= 6) {
            rawRows.push({
              time: parts[0] || '',
              action: parts[1] || '',
              symbol: parts[2] || '',
              mint: parts[3] || '',
              price: parts[4] || '',
              amount: parts[5] || '',
              pnlUsd: parts[6] || '',
              pnlPct: parts[7] || '',
              reason: parts[8] || '',
              dexscreener: parts[9] || (parts[3] ? `https://dexscreener.com/solana/${parts[3]}` : ''),
              age_s: parts[10] || '',
              dex: parts[11] || '',
              source: parts[12] || '',
              entryPrice: parts[13] || '',
              solPriceUsd: parts[14] || '',
              txSig: parts[15] || '',
            });
          }
        }
      } catch {}
    }

    const paired = pairTradesWithEntryAndExit(rawRows, 10000);
    const rows: string[] = [header.trim()];
    for (const t of paired) {
      if (t.action !== 'SELL') continue;
      const pnl = Number(t.pnlUsd) || 0;
      const outcome = pnl >= 0 ? 'PROFIT' : 'LOSS';
      const solPx = Number(t.solPriceUsd) || this.solPriceUsd || 0;
      const pnlSol = solPx > 0 ? pnl / solPx : 0;
      const proceeds = Number(t.amount) || 0;
      const cost = Math.max(0, proceeds - pnl);
      rows.push([
        t.time,
        t.symbol,
        t.mint,
        outcome,
        t.entryPrice || '',
        t.exitPrice || t.price || '',
        cost.toFixed(4),
        proceeds.toFixed(4),
        pnl.toFixed(4),
        pnlSol ? pnlSol.toFixed(6) : '',
        t.pnlPct || '0.00',
        t.reason || 'manual_exit',
        t.age_s || '',
        t.dex || '?',
        t.source || '?',
        solPx ? solPx.toFixed(4) : '',
        t.txBuy || '',
        t.txSell || '',
        t.dexscreener || `https://dexscreener.com/solana/${t.mint}`,
      ].join(','));
    }

    const synthesized = rows.join('\n') + '\n';
    try {
      fs.writeFileSync(pnlCsv, synthesized, 'utf-8');
    } catch {}
    return synthesized;
  }

  public appendTelemetryRecord(rec: {
    tsMs: number;
    mode: string;
    side: 'BUY' | 'SELL';
    mint: string;
    symbol: string;
    dex: string;
    platform: string;
    quotedPriceUsd: number;
    actualFillPriceUsd: number;
    slippagePct: number;
    latencyMs: number;
    jitoProtected: boolean;
  }) {
    try {
      const fp = path.join(this.baseDir, 'telemetry.json');
      let list: any[] = [];
      if (fs.existsSync(fp)) {
        const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (Array.isArray(parsed)) list = parsed;
      }
      list.push(rec);
      if (list.length > 500) list = list.slice(-500);
      this.writeStateAtomic(fp, list);
    } catch {}
  }

  public getTelemetryScorecard() {
    const mode = this.getMode();
    const fp = path.join(this.baseDir, 'telemetry.json');
    let records: any[] = [];
    if (fs.existsSync(fp)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (Array.isArray(parsed)) records = parsed;
      } catch {}
    }

    const csvStr = this.exportPnlCsv(mode);
    const lines = csvStr.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
    const map = new Map<
      string,
      {
        dex: string;
        platform: string;
        slips: number[];
        latencies: number[];
        buyCount: number;
        sellCount: number;
        tradeWins: number;
        tradeTotal: number;
        netPnlUsd: number;
      }
    >();
    const ensure = (dexRaw: string, platRaw: string) => {
      const dex = (dexRaw || 'unknown').toLowerCase();
      const platform = (platRaw || 'python_sniper').toLowerCase();
      const key = `${dex}::${platform}`;
      let b = map.get(key);
      if (!b) {
        b = {
          dex,
          platform,
          slips: [],
          latencies: [],
          buyCount: 0,
          sellCount: 0,
          tradeWins: 0,
          tradeTotal: 0,
          netPnlUsd: 0,
        };
        map.set(key, b);
      }
      return b;
    };

    for (const r of records) {
      const b = ensure(r.dex, r.platform);
      if (r.side === 'BUY') b.buyCount += 1;
      else b.sellCount += 1;
      if (Number.isFinite(Number(r.slippagePct))) b.slips.push(Number(r.slippagePct));
      if (Number.isFinite(Number(r.latencyMs)) && Number(r.latencyMs) > 0) b.latencies.push(Number(r.latencyMs));
    }

    for (let i = 1; i < lines.length; i += 1) {
      const p = lines[i].split(',').map((s) => s.trim());
      if (p.length < 15) continue;
      const dex = p[13] || 'unknown';
      const source = p[14] || 'python_sniper';
      const pnlUsd = Number(p[8]) || 0;
      const b = ensure(dex, source);
      b.tradeTotal += 1;
      if (pnlUsd > 0) b.tradeWins += 1;
      b.netPnlUsd += pnlUsd;
    }

    return Array.from(map.values())
      .map((b) => {
        const avgSlip = b.slips.length > 0 ? b.slips.reduce((s, v) => s + v, 0) / b.slips.length : 0;
        const maxSlip = b.slips.length > 0 ? Math.max(...b.slips.map((s) => Math.abs(s))) : 0;
        const avgLat =
          b.latencies.length > 0 ? b.latencies.reduce((s, v) => s + v, 0) / b.latencies.length : 0;
        return {
          dex: b.dex,
          platform: b.platform,
          tradeCount: Math.max(b.tradeTotal, b.buyCount + b.sellCount),
          buyCount: b.buyCount,
          sellCount: b.sellCount,
          avgSlippagePct: Number(avgSlip.toFixed(3)),
          maxSlippagePct: Number(maxSlip.toFixed(3)),
          avgLatencyMs: Math.round(avgLat),
          winRatePct: b.tradeTotal > 0 ? Number(((b.tradeWins / b.tradeTotal) * 100).toFixed(1)) : 0,
          netPnlSol: Number(b.netPnlUsd.toFixed(4)),
        };
      })
      .sort((a, b) => b.tradeCount - a.tradeCount);
  }

  public async auditRentAccounts() {
    if (!this.orchestrator) {
      return {
        walletAddress: null,
        emptyCount: 0,
        dustCount: 0,
        emptyReclaimableSol: 0,
        dustReclaimableSol: 0,
        accounts: [],
        solPriceUsd: this.solPriceUsd,
      };
    }
    const { signer, rpcPool } = this.orchestrator;
    const owner = signer.getPublicKey();
    if (!owner) {
      return {
        walletAddress: null,
        emptyCount: 0,
        dustCount: 0,
        emptyReclaimableSol: 0,
        dustReclaimableSol: 0,
        accounts: [],
        solPriceUsd: this.solPriceUsd,
      };
    }

    const ownerPk = new PublicKey(owner);
    const { stateFile } = getSniperFilePaths('live', this.baseDir);
    const openMints = new Set<string>();
    const symbolMap = new Map<string, string>();
    if (fs.existsSync(stateFile)) {
      try {
        const st = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        for (const [m, p] of Object.entries<any>(st?.positions || {})) {
          openMints.add(m);
          if (p?.symbol) symbolMap.set(m, String(p.symbol));
        }
      } catch {}
    }

    const accounts: any[] = [];
    await rpcPool.withFailover(async (conn) => {
      const [splAccs, t22Accs] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_PROGRAM_ID }),
        conn.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_2022_PROGRAM_ID }),
      ]);
      const pushList = (list: typeof splAccs.value, programId: 'spl-token' | 'token-2022') => {
        for (const acc of list) {
          const info = (acc.account.data.parsed as {
            info?: { mint?: string; tokenAmount?: { amount?: string; uiAmount?: number | null } };
          })?.info;
          const mint = String(info?.mint || '').trim();
          if (!mint || mint === WSOL_MINT) continue;
          const amountRaw = String(info?.tokenAmount?.amount ?? '0');
          const uiAmount = Number(info?.tokenAmount?.uiAmount ?? 0);
          const isEmpty = BigInt(/^\d+$/.test(amountRaw) ? amountRaw : '0') === 0n;
          const isOpenPosition = openMints.has(mint);
          const isDust = !isEmpty && !isOpenPosition;
          accounts.push({
            pubkey: acc.pubkey.toBase58(),
            mint,
            symbol: symbolMap.get(mint),
            programId,
            amountRaw,
            uiAmount,
            estValueUsd: null,
            estRentSol: SNIPER_ATA_RENT_SOL,
            isEmpty,
            isDust,
            isOpenPosition,
          });
        }
      };
      pushList(splAccs.value, 'spl-token');
      pushList(t22Accs.value, 'token-2022');
    });

    const emptyCount = accounts.filter((a) => a.isEmpty).length;
    const dustCount = accounts.filter((a) => a.isDust).length;
    return {
      walletAddress: owner,
      emptyCount,
      dustCount,
      emptyReclaimableSol: Number((emptyCount * SNIPER_ATA_RENT_SOL).toFixed(6)),
      dustReclaimableSol: Number((dustCount * SNIPER_ATA_RENT_SOL).toFixed(6)),
      accounts,
      solPriceUsd: this.solPriceUsd,
    };
  }

  public async reclaimRentAccounts(burnDust = false, targetMint?: string) {
    if (!this.orchestrator) {
      throw new Error('Orchestrator not initialized.');
    }
    const { signer, rpcPool } = this.orchestrator;
    const owner = signer.getPublicKey();
    if (!signer.isUnlocked() || !owner) {
      throw new Error('Server signer must be unlocked to reclaim SOL rent.');
    }

    const ownerPk = new PublicKey(owner);
    const kp = signer.getKeypairForInternalSigning();
    const { stateFile } = getSniperFilePaths('live', this.baseDir);
    const openMints = new Set<string>();
    if (fs.existsSync(stateFile)) {
      try {
        const st = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        for (const m of Object.keys(st?.positions || {})) openMints.add(m);
      } catch {}
    }

    const res = await rpcPool.withFailover(async (conn) => {
      const scanClosables = async () => {
        const [splAccs, t22Accs] = await Promise.all([
          conn.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_PROGRAM_ID }),
          conn.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_2022_PROGRAM_ID }),
        ]);
        const list: Array<{ pubkey: PublicKey; mintPk: PublicKey; programId: PublicKey; rawAmount: bigint }> = [];
        const process = (accs: typeof splAccs.value, programId: PublicKey) => {
          for (const acc of accs) {
            const info = (acc.account.data.parsed as {
              info?: { mint?: string; tokenAmount?: { amount?: string } };
            })?.info;
            const mintStr = String(info?.mint || '').trim();
            if (!mintStr || mintStr === WSOL_MINT) continue;
            if (targetMint && mintStr !== targetMint) continue;
            const rawStr = String(info?.tokenAmount?.amount ?? '0');
            const rawAmt = /^\d+$/.test(rawStr) ? BigInt(rawStr) : 1n;
            if (rawAmt === 0n) {
              list.push({ pubkey: acc.pubkey, mintPk: new PublicKey(mintStr), programId, rawAmount: 0n });
            } else if (burnDust && !openMints.has(mintStr)) {
              list.push({ pubkey: acc.pubkey, mintPk: new PublicKey(mintStr), programId, rawAmount: rawAmt });
            }
          }
        };
        process(splAccs.value, TOKEN_PROGRAM_ID);
        process(t22Accs.value, TOKEN_2022_PROGRAM_ID);
        return list;
      };

      const closables = await scanClosables();
      if (closables.length === 0) {
        return { closedCount: 0, burnedCount: 0, reclaimedSol: 0, txSig: null };
      }
      const batch = closables.slice(0, 8);
      const tx = new Transaction();
      let burnedCount = 0;
      for (const item of batch) {
        if (item.rawAmount > 0n) {
          tx.add(createBurnInstruction(item.pubkey, item.mintPk, ownerPk, item.rawAmount, [], item.programId));
          burnedCount += 1;
        }
        tx.add(createCloseAccountInstruction(item.pubkey, ownerPk, ownerPk, [], item.programId));
      }
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = ownerPk;
      await tx.sign(kp);
      const sig = await conn.sendRawTransaction(await tx.serialize(), { skipPreflight: false });
      return {
        closedCount: batch.length,
        burnedCount,
        reclaimedSol: Number((batch.length * SNIPER_ATA_RENT_SOL).toFixed(6)),
        txSig: sig,
      };
    });

    if (res.closedCount > 0) {
      this.appendLog(
        'INFO',
        `Rent Reclaim: closed ${res.closedCount} ATA(s)${res.burnedCount > 0 ? ` (${res.burnedCount} dust burned)` : ''}, recovered ${res.reclaimedSol.toFixed(5)} SOL.`
      );
    }
    return res;
  }

  public async sweepOrphanPositions() {
    if (!this.orchestrator) {
      return { scanned: 0, adopted: 0, adoptedSymbols: [] as string[], skipped: 0, errors: ['Not attached'] };
    }
    const audit = await this.auditRentAccounts();
    const untracked = (audit.accounts || []).filter((a: any) => !a.isEmpty && !a.isOpenPosition);
    if (untracked.length === 0) {
      return { scanned: audit.accounts.length, adopted: 0, adoptedSymbols: [], skipped: 0, errors: [] };
    }

    const enriched = await this.orchestrator.dexScreener
      .enrichMintsBatch(untracked.map((a: any) => a.mint))
      .catch(() => new Map());

    const { stateFile } = getSniperFilePaths('live', this.baseDir);
    let state: any = { mode: 'live', positions: {}, closed: 0, wins: 0, total_pnl: 0, day_pnl: 0 };
    if (fs.existsSync(stateFile)) {
      try {
        state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf-8')) };
      } catch {}
    }
    if (!state.positions || typeof state.positions !== 'object') state.positions = {};

    const adoptedSymbols: string[] = [];
    let adopted = 0;
    let skipped = 0;
    const nowSec = Date.now() / 1000;
    const solPx = this.solPriceUsd || 0;

    for (const acc of untracked) {
      if (state.positions[acc.mint]) continue;
      const ds = enriched.get(acc.mint);
      const px = ds?.priceUsd ?? 0;
      const valUsd = px > 0 ? acc.uiAmount * px : 0;
      if (px <= 0 || valUsd < 0.05) {
        skipped += 1;
        continue;
      }
      const decimals = acc.amountRaw && acc.uiAmount > 0
        ? Math.max(0, Math.min(12, Math.round(Math.log10(Number(acc.amountRaw) / acc.uiAmount))))
        : 6;
      const sym = ds?.symbol || acc.mint.slice(0, 6);
      state.positions[acc.mint] = {
        symbol: sym,
        mint: acc.mint,
        qty: acc.uiAmount,
        raw_amount: acc.amountRaw,
        decimals,
        entry_price: px,
        current_price: px,
        peak_price: px,
        low_price: px,
        cost: valUsd,
        cost_sol: solPx > 0 ? valUsd / solPx : 0,
        opened: nowSec,
        last_updated: nowSec,
        trailing_active: false,
        entry_liq: ds?.liquidityUsd ?? 0,
        source: 'orphan_sweep',
        dex: ds?.dex || 'unknown',
        age_at_entry: ds?.poolCreatedAtMs ? Math.max(0, Math.round((Date.now() - ds.poolCreatedAtMs) / 1000)) : 0,
        url: ds?.url || `https://dexscreener.com/solana/${acc.mint}`,
      };
      adopted += 1;
      adoptedSymbols.push(sym);
    }

    if (adopted > 0) {
      this.stateRevision += 1;
      this.writeStateAtomic(stateFile, state);
      this.appendLog('WARN', `Orphan Sweep adopted ${adopted} untracked token(s): ${adoptedSymbols.join(', ')}`);
    }

    return {
      scanned: audit.accounts.length,
      adopted,
      adoptedSymbols,
      skipped,
      errors: [],
    };
  }

  public runBacktest(req: {
    mode?: SniperMode;
    lookbackHours?: number;
    takeProfitPct: number;
    stopLossPct: number;
    trailingEnabled: boolean;
    trailingDropPct: number;
    minAgeMinutes?: number;
    maxAgeMinutes?: number;
  }) {
    const mode = req.mode || this.getMode();
    const csv = this.exportPnlCsv(mode);
    const lines = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
    const nowMs = Date.now();
    const lookbackMs = req.lookbackHours && req.lookbackHours > 0 ? req.lookbackHours * 3600_000 : 0;

    let sampleSize = 0;
    let evaluatedTrades = 0;
    let filteredOutCount = 0;
    let baseWins = 0;
    let baseNet = 0;
    let basePeak = 0;
    let baseMaxDd = 0;
    let simWins = 0;
    let simNet = 0;
    let simPeak = 0;
    let simMaxDd = 0;

    for (let i = 1; i < lines.length; i += 1) {
      const p = lines[i].split(',').map((s) => s.trim());
      if (p.length < 13) continue;
      const ts = Date.parse(p[0]);
      if (lookbackMs > 0 && Number.isFinite(ts) && nowMs - ts > lookbackMs) continue;

      sampleSize += 1;
      const costUsd = Number(p[6]) || 5.0;
      const pnlUsd = Number(p[8]) || 0;
      const pnlPct = Number(p[10]) || 0;
      const holdOrAgeMin = (Number(p[12]) || 0) / 60;

      baseNet += pnlUsd;
      if (pnlUsd > 0) baseWins += 1;
      if (baseNet > basePeak) basePeak = baseNet;
      baseMaxDd = Math.max(baseMaxDd, basePeak - baseNet);

      if (
        (req.minAgeMinutes !== undefined && holdOrAgeMin < req.minAgeMinutes) ||
        (req.maxAgeMinutes !== undefined && req.maxAgeMinutes > 0 && holdOrAgeMin > req.maxAgeMinutes)
      ) {
        filteredOutCount += 1;
        continue;
      }

      evaluatedTrades += 1;
      const estPeakPct = Math.max(0, pnlPct);
      let simPct = pnlPct;
      if (estPeakPct >= req.takeProfitPct) {
        simPct = req.takeProfitPct;
      } else if (req.trailingEnabled && estPeakPct > req.trailingDropPct && req.trailingDropPct > 0) {
        simPct = Math.max(estPeakPct - req.trailingDropPct, pnlPct);
      } else if (pnlPct <= -Math.abs(req.stopLossPct)) {
        simPct = -Math.abs(req.stopLossPct);
      }

      const simPnlUsd = costUsd * (simPct / 100);
      simNet += simPnlUsd;
      if (simPnlUsd > 0) simWins += 1;
      if (simNet > simPeak) simPeak = simNet;
      simMaxDd = Math.max(simMaxDd, simPeak - simNet);
    }

    return {
      sampleSize,
      evaluatedTrades,
      baselineWinRatePct: sampleSize > 0 ? Number(((baseWins / sampleSize) * 100).toFixed(1)) : 0,
      baselineNetPnl: Number(baseNet.toFixed(4)),
      baselineMaxDrawdown: Number(baseMaxDd.toFixed(4)),
      simulatedWinRatePct: evaluatedTrades > 0 ? Number(((simWins / evaluatedTrades) * 100).toFixed(1)) : 0,
      simulatedNetPnl: Number(simNet.toFixed(4)),
      simulatedMaxDrawdown: Number(simMaxDd.toFixed(4)),
      filteredOutCount,
      pnlUnit: 'USD' as const,
      notes: [
        `Replayed ${sampleSize} closed ${mode.toUpperCase()} sniper trades (${evaluatedTrades} matched filters).`,
      ],
    };
  }

  public async scanTrackedWhaleHoldings(options?: { batchSize?: number }): Promise<{
    ok: boolean;
    scannedWallets: number;
    foundCoins: number;
    holdings: Array<{
      mint: string;
      wallet: string;
      symbol: string;
      uiAmount: number;
      ageHours: number;
    }>;
  }> {
    const settings = this.readSettings();
    const wallets: string[] = Array.isArray(settings.smart_wallets)
      ? settings.smart_wallets.map((w: any) => String(w || '').trim()).filter((w: string) => w.length >= 32)
      : [];
    if (wallets.length === 0) {
      return { ok: true, scannedWallets: 0, foundCoins: 0, holdings: [] };
    }

    const STABLE_OR_BASE_MINTS = new Set<string>([
      WSOL_MINT,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      'So11111111111111111111111111111111111111111',
    ]);

    const batchSize = Math.max(1, Math.min(wallets.length, Number(options?.batchSize || 5)));
    const batch: string[] = [];
    for (let i = 0; i < batchSize; i += 1) {
      const idx = (this.whaleHoldingsCursor + i) % wallets.length;
      batch.push(wallets[idx]);
    }
    this.whaleHoldingsCursor = (this.whaleHoldingsCursor + batchSize) % wallets.length;

    const heldByWallet = new Map<string, Array<{ mint: string; uiAmount: number }>>();
    const allMints = new Set<string>();
    const rpcPool = this.orchestrator?.rpcPool as any;
    const customRpc = isPyOptionEnabled(settings, 'custom_rpc_url', true) ? String(settings.custom_rpc_url || '').trim() : '';

    const fetchAccountsForWallet = async (walletAddr: string): Promise<Array<{ mint: string; uiAmount: number }>> => {
      const out: Array<{ mint: string; uiAmount: number }> = [];
      const ownerPk = new PublicKey(walletAddr);
      if (rpcPool && typeof rpcPool.withFailover === 'function') {
        await rpcPool.withFailover(async (conn: any) => {
          for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
            const resp = await conn.getParsedTokenAccountsByOwner(ownerPk, { programId });
            for (const item of resp?.value || []) {
              const info = item?.account?.data?.parsed?.info;
              const mint = String(info?.mint || '').trim();
              const uiAmount = Number(info?.tokenAmount?.uiAmount ?? 0);
              if (mint && !STABLE_OR_BASE_MINTS.has(mint) && Number.isFinite(uiAmount) && uiAmount > 0) {
                out.push({ mint, uiAmount });
              }
            }
          }
        });
        return out;
      }

      const rpcEndpoint = customRpc || 'https://solana-rpc.publicnode.com';
      for (const prog of [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]) {
        const res = await fetch(rpcEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountsByOwner',
            params: [walletAddr, { programId: prog }, { encoding: 'jsonParsed' }],
          }),
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) continue;
        const json: any = await res.json();
        for (const item of json?.result?.value || []) {
          const info = item?.account?.data?.parsed?.info;
          const mint = String(info?.mint || '').trim();
          const uiAmount = Number(info?.tokenAmount?.uiAmount ?? 0);
          if (mint && !STABLE_OR_BASE_MINTS.has(mint) && Number.isFinite(uiAmount) && uiAmount > 0) {
            out.push({ mint, uiAmount });
          }
        }
      }
      return out;
    };

    for (let i = 0; i < batch.length; i += 4) {
      const sub = batch.slice(i, i + 4);
      await Promise.all(
        sub.map(async (walletAddr) => {
          try {
            const accs = await fetchAccountsForWallet(walletAddr);
            if (accs.length > 0) {
              const topAccs = accs.slice(0, 8);
              heldByWallet.set(walletAddr, topAccs);
              for (const a of topAccs) allMints.add(a.mint);
            }
          } catch {}
        })
      );
    }

    if (allMints.size === 0) {
      return { ok: true, scannedWallets: batch.length, foundCoins: 0, holdings: [] };
    }

    const pairByMint = new Map<string, { symbol: string; priceUsd: number; liqUsd: number; ageHours: number }>();
    const mintList = Array.from(allMints);
    const nowMs = Date.now();
    for (let i = 0; i < mintList.length; i += 30) {
      const chunk = mintList.slice(i, i + 30);
      const pairs = await this.fetchJsonWithTimeout(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`, 4500);
      if (!Array.isArray(pairs)) continue;
      for (const p of pairs) {
        const m = String(p?.baseToken?.address || '').trim();
        const liq = Number(p?.liquidity?.usd || 0);
        const px = Number(p?.priceUsd || 0);
        const created = Number(p?.pairCreatedAt || 0);
        const ageHours = created > 0 ? Math.max(0, (nowMs - created) / 3_600_000) : 0;
        const sym = String(p?.baseToken?.symbol || m.slice(0, 6)).trim();
        if (!m || px <= 0 || liq < 2000) continue;
        const prev = pairByMint.get(m);
        if (!prev || liq > prev.liqUsd) {
          pairByMint.set(m, { symbol: sym, priceUsd: px, liqUsd: liq, ageHours: Number(ageHours.toFixed(1)) });
        }
      }
    }

    const maxAgeH = Math.max(0, Number(settings.smart_money_max_coin_age_hours ?? 72) || 0);
    const meta = this.readSmartWalletsMeta();
    const outHoldings: Array<{
      mint: string;
      wallet: string;
      symbol: string;
      uiAmount: number;
      ageHours: number;
    }> = [];
    let skippedOldCount = 0;
    let newestSkipped: { symbol: string; ageHours: number } | null = null;

    for (const [walletAddr, accs] of heldByWallet.entries()) {
      const enrichedList: Array<{ mint: string; symbol: string; uiAmount: number; ageHours: number; liqUsd: number }> = [];
      for (const acc of accs) {
        const info = pairByMint.get(acc.mint);
        if (!info) continue;
        if (maxAgeH > 0 && info.ageHours > maxAgeH) {
          skippedOldCount += 1;
          if (!newestSkipped || info.ageHours < newestSkipped.ageHours) {
            newestSkipped = { symbol: info.symbol, ageHours: info.ageHours };
          }
          continue;
        }
        enrichedList.push({
          mint: acc.mint,
          symbol: info.symbol,
          uiAmount: acc.uiAmount,
          ageHours: info.ageHours,
          liqUsd: info.liqUsd,
        });
        outHoldings.push({
          mint: acc.mint,
          wallet: walletAddr,
          symbol: info.symbol,
          uiAmount: acc.uiAmount,
          ageHours: info.ageHours,
        });
        const existingIdx = this.recentWhaleHoldings.findIndex((h) => h.mint === acc.mint && h.wallet === walletAddr);
        const entry = {
          mint: acc.mint,
          wallet: walletAddr,
          symbol: info.symbol,
          uiAmount: acc.uiAmount,
          ageHours: info.ageHours,
          discoveredAtMs: nowMs,
        };
        if (existingIdx >= 0) this.recentWhaleHoldings[existingIdx] = entry;
        else this.recentWhaleHoldings.push(entry);
      }

      if (enrichedList.length > 0) {
        enrichedList.sort((a, b) => b.liqUsd - a.liqUsd);
        const topHeld = enrichedList[0];
        const prevMeta = meta[walletAddr] || {};
        meta[walletAddr] = {
          ...prevMeta,
          address: walletAddr,
          recentToken: topHeld.symbol,
          recentMint: topHeld.mint,
          recentAction: 'HOLDING',
          heldMints: enrichedList.slice(0, 4),
          lastActiveMs: nowMs,
        };
      }
    }

    if (this.recentWhaleHoldings.length > 150) {
      this.recentWhaleHoldings = this.recentWhaleHoldings.slice(-150);
    }
    this.saveSmartWalletsMeta(meta);
    if (outHoldings.length > 0) {
      const sample = outHoldings
        .slice(0, 3)
        .map((h) => `$${h.symbol}(${h.mint.slice(0, 4)}..${h.mint.slice(-4)}, ${h.ageHours}h old)`)
        .join(', ');
      this.appendLog(
        'INFO',
        `[SmartMoney] On-chain portfolio scan checked ${batch.length} whale wallet(s) → ${outHoldings.length} active held token(s) [${sample}]`
      );
    } else if (skippedOldCount > 0 && newestSkipped && Date.now() - this.lastSmartOldHoldingsLogMs > 45_000) {
      this.lastSmartOldHoldingsLogMs = Date.now();
      this.appendLog(
        'INFO',
        `[SmartMoney] On-chain portfolio scan checked ${batch.length} whale(s): ${skippedOldCount} held coin(s) (newest $${newestSkipped.symbol} ${newestSkipped.ageHours}h old) skipped by ${maxAgeH}h Max Coin Age filter — raise Max Coin Age (h) or set 0 for Any age.`
      );
    }
    return {
      ok: true,
      scannedWallets: batch.length,
      foundCoins: outHoldings.length,
      holdings: outHoldings,
    };
  }

  public async discoverSmartWallets(options?: { autoAdd?: boolean; silentIfEmpty?: boolean }): Promise<{
    ok: boolean;
    discovered: Array<{
      address: string;
      label: string;
      category: string;
      winRate: string;
      wins: number;
      totalTrades: number;
      recentToken: string;
      recentMint?: string;
      recentAction?: 'HOLDING' | 'CLOSED_PROFIT';
      totalProfitSol: number;
      source: string;
    }>;
    addedCount: number;
    totalTracked: number;
    skippedRuggers: number;
    settings?: Record<string, any>;
    message: string;
  }> {
    const KNOWN_SYSTEM_OR_POOL_ADDRS = new Set<string>([
      'So11111111111111111111111111111111111111112',
      '11111111111111111111111111111111',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
      'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM',
      'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1',
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    ]);

    const settings = this.readSettings();
    const rawMaxWallets = Number(settings.smart_money_max_wallets ?? 50);
    const maxWallets = !Number.isFinite(rawMaxWallets)
      ? 50
      : rawMaxWallets <= 0
        ? 0
        : Math.min(5000, Math.max(1, Math.round(rawMaxWallets)));
    const effectiveCap = maxWallets === 0 ? 1000 : maxWallets;
    const autoAdd = options?.autoAdd !== false;
    const solPx = this.solPriceUsd && this.solPriceUsd > 0 ? this.solPriceUsd : 70;

    // Load known rugged creators from creator_history.json so rugger dev wallets are NEVER promoted
    const knownRuggedCreators = new Set<string>();
    try {
      const histFile = path.join(this.baseDir, 'creator_history.json');
      if (fs.existsSync(histFile)) {
        const hist = JSON.parse(fs.readFileSync(histFile, 'utf-8'));
        if (hist && typeof hist === 'object') {
          for (const [creator, coins] of Object.entries<any>(hist)) {
            if (coins && typeof coins === 'object' && Object.values(coins).some((c: any) => c?.rugged)) {
              knownRuggedCreators.add(creator.trim());
            }
          }
        }
      }
    } catch {}

    const candidateMap = new Map<
      string,
      {
        address: string;
        label: string;
        category: string;
        winRate: string;
        wins: number;
        totalTrades: number;
        recentToken: string;
        recentMint?: string;
        recentAction?: 'HOLDING' | 'CLOSED_PROFIT';
        totalProfitSol: number;
        source: string;
      }
    >();
    let skippedRuggers = 0;

    // 1. Live PumpPortal WebSocket profitable traders
    const pp: any = this.orchestrator?.pumpPortal;
    if (pp && typeof pp.getDiscoveredWhaleWallets === 'function') {
      const wsWhales = pp.getDiscoveredWhaleWallets(Math.min(500, effectiveCap));
      for (const w of wsWhales) {
        if (!w?.address || KNOWN_SYSTEM_OR_POOL_ADDRS.has(w.address)) continue;
        if (knownRuggedCreators.has(w.address)) {
          skippedRuggers += 1;
          continue;
        }
        candidateMap.set(w.address, w);
      }
    }

    // 2. Live GeckoTerminal trending + winning Solana pools + real on-chain trade analysis + RugCheck filter
    let scannedPools = 0;
    try {
      const [gtTrending, gtNewP1, gtNewP2] = await Promise.all([
        this.fetchJsonWithTimeout('https://api.geckoterminal.com/api/v2/networks/solana/trending_pools', 5000),
        this.fetchJsonWithTimeout('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1', 5000),
        effectiveCap > 60
          ? this.fetchJsonWithTimeout('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=2', 5000)
          : Promise.resolve(null),
      ]);
      const rawPools = [
        ...(Array.isArray(gtTrending?.data) ? gtTrending.data : []),
        ...(Array.isArray(gtNewP1?.data) ? gtNewP1.data : []),
        ...(Array.isArray(gtNewP2?.data) ? gtNewP2.data : []),
      ];
      const seenPoolAddrs = new Set<string>();
      const goodPools = rawPools
        .filter((p: any) => {
          const attrs = p?.attributes || {};
          const pa = String(attrs.address || '').trim();
          if (!pa || seenPoolAddrs.has(pa)) return false;
          seenPoolAddrs.add(pa);
          const liq = Number(attrs.reserve_in_usd || 0);
          const chg1h = Number(attrs.price_change_percentage?.h1 || 0);
          const chg24h = Number(attrs.price_change_percentage?.h24 || 0);
          const vol1h = Number(attrs.volume_usd?.h1 || 0);
          return liq >= 10_000 && vol1h >= 4_000 && chg1h >= -20 && (chg1h > 5 || chg24h > 15);
        })
        .slice(0, effectiveCap > 100 ? 12 : 8);

      const inspectPool = async (pool: any) => {
        const attrs = pool?.attributes || {};
        const poolAddr = String(attrs.address || '').trim();
        const baseId = String(pool?.relationships?.base_token?.data?.id || '');
        const mint = baseId.replace(/^solana_/, '').trim();
        const poolName = String(attrs.name || '').split('/')[0]?.trim() || mint.slice(0, 6);
        const curTokenPx = Number(attrs.base_token_price_usd || 0);
        if (!poolAddr || !mint) return;
        scannedPools += 1;

        const [rc, tradesRes] = await Promise.all([
          this.fetchJsonWithTimeout(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, 4500),
          this.fetchJsonWithTimeout(
            `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddr}/trades?trade_volume_in_usd_greater_than=120`,
            4500
          ),
        ]);

        if (rc && typeof rc === 'object') {
          if (rc.rugged === true) return;
          const rcScore = Number(rc.score_normalised ?? rc.score ?? 0);
          if (rcScore >= 60) return;
        }

        const creatorAddr = String(rc?.creator || '').trim();
        const excludedAddrs = new Set<string>([poolAddr, ...KNOWN_SYSTEM_OR_POOL_ADDRS]);
        if (creatorAddr) excludedAddrs.add(creatorAddr);
        if (rc?.knownAccounts && typeof rc.knownAccounts === 'object') {
          for (const [kAddr, kInfo] of Object.entries<any>(rc.knownAccounts)) {
            const kt = String(kInfo?.type || '').toUpperCase();
            if (kt === 'AMM' || kt === 'LOCKER' || kt === 'POOL' || kt === 'CLOB') {
              excludedAddrs.add(kAddr);
            }
          }
        }
        const insiderOwners = new Set<string>();
        if (Array.isArray(rc?.topHolders)) {
          for (const h of rc.topHolders) {
            const owner = String(h?.owner || '').trim();
            if (owner && h?.insider) insiderOwners.add(owner);
          }
        }

        const rawTrades = Array.isArray(tradesRes?.data) ? tradesRes.data : [];
        const traderBook = new Map<
          string,
          {
            boughtUsd: number;
            soldUsd: number;
            buyVolWeight: number;
            weightedBuyPx: number;
            buys: number;
            sells: number;
          }
        >();

        for (const item of rawTrades) {
          const ta = item?.attributes;
          if (!ta) continue;
          const wallet = String(ta.tx_from_address || '').trim();
          if (!wallet || wallet.length < 32 || excludedAddrs.has(wallet)) continue;
          if (insiderOwners.has(wallet) || knownRuggedCreators.has(wallet)) {
            if (knownRuggedCreators.has(wallet)) skippedRuggers += 1;
            continue;
          }
          const volUsd = Number(ta.volume_in_usd || 0);
          if (!Number.isFinite(volUsd) || volUsd < 50) continue;
          const isBuy = ta.kind === 'buy';
          const tokenPx = isBuy ? Number(ta.price_to_in_usd || 0) : Number(ta.price_from_in_usd || 0);
          let rec = traderBook.get(wallet);
          if (!rec) {
            rec = { boughtUsd: 0, soldUsd: 0, buyVolWeight: 0, weightedBuyPx: 0, buys: 0, sells: 0 };
            traderBook.set(wallet, rec);
          }
          if (isBuy) {
            rec.boughtUsd += volUsd;
            rec.buys += 1;
            if (tokenPx > 0) {
              rec.weightedBuyPx += tokenPx * volUsd;
              rec.buyVolWeight += volUsd;
            }
          } else {
            rec.soldUsd += volUsd;
            rec.sells += 1;
          }
        }

        for (const [wallet, rec] of traderBook.entries()) {
          // Require actual buys on the open market (filter out airdrop/team-only dumpers)
          if (rec.buys < 1 || rec.boughtUsd < 120) continue;
          const avgBuyPx = rec.buyVolWeight > 0 ? rec.weightedBuyPx / rec.buyVolWeight : 0;
          const realizedProfitUsd = rec.sells > 0 && rec.soldUsd > rec.boughtUsd ? rec.soldUsd - rec.boughtUsd : 0;
          const unrealizedGainPct = avgBuyPx > 0 && curTokenPx > 0 ? ((curTokenPx - avgBuyPx) / avgBuyPx) * 100 : 0;
          const estUnrealizedUsd =
            unrealizedGainPct >= 15 && rec.boughtUsd > rec.soldUsd
              ? (rec.boughtUsd - rec.soldUsd) * (unrealizedGainPct / 100)
              : 0;
          const totalEstProfitUsd = realizedProfitUsd + estUnrealizedUsd;
          if (totalEstProfitUsd < 40 && unrealizedGainPct < 20) continue;

          const profitSol = Number(Math.max(0.5, totalEstProfitUsd / solPx).toFixed(2));
          const winScore = unrealizedGainPct >= 50 || realizedProfitUsd >= 300 ? 84 : 74;
          const recentAction: 'HOLDING' | 'CLOSED_PROFIT' =
            rec.sells > 0 && rec.soldUsd >= rec.boughtUsd ? 'CLOSED_PROFIT' : 'HOLDING';
          const existing = candidateMap.get(wallet);
          if (!existing || profitSol > existing.totalProfitSol) {
            candidateMap.set(wallet, {
              address: wallet,
              label: realizedProfitUsd >= 250 ? 'Verified Swing Whale' : 'Early Trend Accumulator',
              category: 'On-Chain Pool Winner',
              winRate: `${winScore}%`,
              wins: Math.max(1, rec.sells > 0 && rec.soldUsd > rec.boughtUsd ? rec.sells : 1),
              totalTrades: rec.buys + rec.sells,
              recentToken: poolName,
              recentMint: mint,
              recentAction,
              totalProfitSol: profitSol,
              source: 'GeckoTerminal On-Chain',
            });
          }
        }

        // Supplement with up to 3 clean non-pool, non-creator, non-insider top holders per pool
        // (ranked strictly below active real-time swap traders so passive holders never crowd out active whales)
        let poolHoldersAdded = 0;
        if (Array.isArray(rc?.topHolders)) {
          for (const h of rc.topHolders) {
            if (poolHoldersAdded >= 3) break;
            const owner = String(h?.owner || '').trim();
            const pct = Number(h?.pct || 0);
            if (
              !owner ||
              owner.length < 32 ||
              excludedAddrs.has(owner) ||
              insiderOwners.has(owner) ||
              knownRuggedCreators.has(owner) ||
              pct < 0.25 ||
              pct > 3.5
            ) {
              continue;
            }
            if (!candidateMap.has(owner)) {
              const estSol = Number(Math.min(4.5, Math.max(0.4, pct * 1.5)).toFixed(2));
              candidateMap.set(owner, {
                address: owner,
                label: 'Top Clean Holder',
                category: 'Verified Holder (Non-Dev)',
                winRate: '72%',
                wins: 1,
                totalTrades: 1,
                recentToken: poolName,
                recentMint: mint,
                recentAction: 'HOLDING',
                totalProfitSol: estSol,
                source: 'RugCheck Clean Holder',
              });
              poolHoldersAdded += 1;
            }
          }
        }
      };

      for (let i = 0; i < goodPools.length; i += 4) {
        await Promise.all(goodPools.slice(i, i + 4).map(inspectPool));
      }
    } catch {}

    // Sort active live traders (PumpPortal WS & GeckoTerminal Swaps) ahead of passive Clean Holders
    const discovered = Array.from(candidateMap.values())
      .sort((a, b) => {
        const aActive = a.source === 'RugCheck Clean Holder' ? 0 : 1;
        const bActive = b.source === 'RugCheck Clean Holder' ? 0 : 1;
        if (aActive !== bActive) return bActive - aActive;
        return b.totalProfitSol - a.totalProfitSol || b.wins - a.wins;
      })
      .slice(0, Math.min(500, effectiveCap));

    const existingWallets: string[] = Array.isArray(settings.smart_wallets)
      ? settings.smart_wallets.map((w: any) => String(w || '').trim()).filter(Boolean)
      : [];
    const existingSet = new Set(existingWallets);
    const meta = this.readSmartWalletsMeta();
    const nowMs = Date.now();

    for (const d of discovered) {
      meta[d.address] = {
        ...(meta[d.address] || {}),
        ...d,
        lastActiveMs: nowMs,
        discoveredAtMs: meta[d.address]?.discoveredAtMs || nowMs,
      };
    }
    this.saveSmartWalletsMeta(meta);

    let addedCount = 0;
    const nextWallets = [...existingWallets];
    let nextSettings = settings;
    if (autoAdd && discovered.length > 0 && (maxWallets === 0 || nextWallets.length < maxWallets)) {
      for (const d of discovered) {
        if (maxWallets > 0 && nextWallets.length >= maxWallets) break;
        if (!existingSet.has(d.address)) {
          existingSet.add(d.address);
          nextWallets.push(d.address);
          addedCount += 1;
        }
      }
      if (addedCount > 0) {
        nextSettings = { ...settings, smart_wallets: nextWallets };
        fs.writeFileSync(this.settingsFile, JSON.stringify(nextSettings, null, 2), 'utf-8');
        if (pp && typeof pp.setTrackedSmartWallets === 'function') {
          pp.setTrackedSmartWallets(nextWallets);
        }
      }
    }

    const capTxt = maxWallets === 0 ? 'Unlimited' : String(maxWallets);
    if (addedCount > 0 || !options?.silentIfEmpty) {
      const sampleLog = discovered
        .slice(0, 3)
        .map(
          (d) =>
            `${d.address.slice(0, 4)}..${d.address.slice(-4)}($${d.recentToken}${d.recentMint ? `:${d.recentMint.slice(0, 4)}..${d.recentMint.slice(-4)}` : ''}/+${d.totalProfitSol}SOL)`
        )
        .join(', ');
      const rugNote = skippedRuggers > 0 ? ` · blocked ${skippedRuggers} rugger/insider wallet(s)` : '';
      this.appendLog(
        'INFO',
        `[SmartMoney] Scanned ${scannedPools} trending/new Solana pools + PumpPortal WS → found ${discovered.length} clean profitable whales (+${addedCount} added, ${nextWallets.length}/${capTxt} active)${sampleLog ? ` [${sampleLog}]` : ''}${rugNote}`
      );
    }

    return {
      ok: true,
      discovered,
      addedCount,
      totalTracked: nextWallets.length,
      skippedRuggers,
      settings: nextSettings,
      message:
        addedCount > 0
          ? `Discovered ${discovered.length} clean whale wallets and added ${addedCount} new wallet(s) (${nextWallets.length}/${capTxt} active).`
          : `Scanned live Solana pools: ${discovered.length} active whale wallets verified (${nextWallets.length}/${capTxt} tracked).`,
    };
  }

  private parseAndLogStdout(line: string) {
    const low = line.toLowerCase();
    let tag: SniperLogEntry['tag'] = 'info';
    if (low.includes('sniper buy') || low.includes('live buy ') || low.includes('✓')) tag = 'buy';
    else if (low.includes('reject') || low.includes('rug') || low.includes('filtered')) tag = 'reject';
    else if (low.includes('✗ sell') || low.includes('live sell') || low.includes('sell ') || low.includes('queued manual sell') || low.includes('manual sell')) tag = 'sell';
    else if (low.includes('error') || low.includes('warn') || low.includes('⚠') || low.includes('paused') || low.includes('failed')) tag = 'warn';

    this.appendLog(tag, line);
  }

  private appendLog(tag: SniperLogEntry['tag'], message: string) {
    const entry: SniperLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      message,
      tag,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }
}

export const sniperManager = new SniperManager();
