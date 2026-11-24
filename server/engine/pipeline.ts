import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import type {
  BotRunState,
  BotSettings,
  BotStatusSnapshot,
  BacktestRequest,
  BacktestResult,
  CandidateToken,
  DexScorecardRow,
  ExecutionMode,
  ExitReason,
  ExplanationRecord,
  LogSeverity,
  OrphanSweepResult,
  PositionRecord,
  RentAuditReport,
  SecurityReport,
  SourceHealthRecord,
  SseEventPayload,
  TradeRecord,
  WalletDiagnostics,
} from '../types';
import type { BotDatabase } from '../store/db';
import type { ServerSignerManager } from '../security/signer';
import { hashSettingsSnapshot, maskAddress } from '../security/crypto';
import type { SolanaRpcPool } from '../providers/rpcPool';
import type { JupiterProvider, JupiterQuoteResponse } from '../providers/jupiter';
import { WSOL_MINT } from '../providers/jupiter';
import type { DexScreenerProvider } from '../providers/dexscreener';
import type { GeckoTerminalProvider } from '../providers/geckoterminal';
import type { RugCheckProvider } from '../providers/rugcheck';
import type { PumpPortalTradeTick, PumpPortalWsProvider } from '../providers/pumpportal';
import {
  SolRegimeTracker,
  MarketStructureTracker,
  evaluateLosingStreakThrottle,
  calculateConvictionMultiplier,
  extractTickerStem,
  runSpotBacktest,
} from '../providers/proSignals';
import { evaluateHardFilters, validateCandidateData } from './filters';
import { runSecurityChecks } from './security';
import { scoreCandidate } from './scoring';
import { calculatePositionSize } from './sizing';
import { evaluatePositionExit, findSlotRotationCandidate } from './exits';
import { executeRealisticPaperBuy, executeRealisticPaperSell } from './paperEngine';
import { LiveExecutionEngine, type ExecutionProgressEvent } from './liveEngine';
import { isOptionEnabled } from '../config/defaults';

export interface ConnectedBrowserWallet {
  provider: 'phantom' | 'solflare' | 'watch_only' | 'none';
  address: string | null;
  balanceSol: number | null;
}

export class BotOrchestrator {
  // Always starts in Paper mode, stopped!
  private mode: ExecutionMode = 'paper';
  private runState: BotRunState = 'stopped';
  private liveConfirmed = true;
  private liveConfirmedSettingsHash: string | null = null;
  private lastScanAtMs: number | null = null;

  private solPriceUsd: number | null = null;
  private solPriceSource = 'unavailable';

  private browserWallet: ConnectedBrowserWallet = {
    provider: 'none',
    address: null,
    balanceSol: null,
  };

  private liveBalanceSol: number | null = null;
  private lastWalletSyncMs = 0;
  private walletSyncState: 'synced' | 'degraded' | 'unavailable' = 'unavailable';

  private funnel = {
    discovered: 0,
    validated: 0,
    filtered: 0,
    securityPassed: 0,
    scored: 0,
    bought: 0,
  };

  resetFunnel(): void {
    this.funnel = {
      discovered: 0,
      validated: 0,
      filtered: 0,
      securityPassed: 0,
      scored: 0,
      bought: 0,
    };
  }

  private sseClients = new Set<(payload: SseEventPayload) => void>();
  private scanTimer: NodeJS.Timeout | null = null;
  private exitTimer: NodeJS.Timeout | null = null;
  private priceMonitorTimer: NodeJS.Timeout | null = null;
  private scanInFlight = false;
  private exitTickInFlight = false;
  private priceMonitorTickInFlight = false;
  private lastSolPriceRefreshMs = 0;
  private readonly lastLiveBalanceSyncByPos = new Map<string, number>();
  private readonly sellingPositionIds = new Set<string>();
  private readonly youngPoolWatchlist = new Map<string, number>();
  private readonly liveEngine: LiveExecutionEngine;
  private readonly solRegimeTracker = new SolRegimeTracker();
  private readonly marketStructure = new MarketStructureTracker();
  private lastOrphanSweepMs = 0;
  private pumpTradeUnsub: (() => void) | null = null;

  constructor(
    public readonly db: BotDatabase,
    public readonly signer: ServerSignerManager,
    public readonly rpcPool: SolanaRpcPool,
    public readonly jupiter: JupiterProvider,
    public readonly dexScreener: DexScreenerProvider,
    public readonly geckoTerminal: GeckoTerminalProvider,
    public readonly rugCheck: RugCheckProvider,
    public readonly pumpPortal: PumpPortalWsProvider
  ) {
    this.liveEngine = new LiveExecutionEngine(
      db,
      signer,
      rpcPool,
      jupiter,
      (ev: ExecutionProgressEvent) => this.broadcast({ type: 'execution_progress', data: ev })
    );
    this.priceMonitorTimer = setInterval(() => {
      if (this.runState === 'stopped') {
        void this.refreshOpenPositionPricesTick();
      }
    }, 1000);
    if (typeof this.priceMonitorTimer.unref === 'function') {
      this.priceMonitorTimer.unref();
    }
    this.log('INFO', 'SYSTEM', 'Solana Spot Bot initialized in PAPER mode (stopped). Trading can lose all of your money.');
  }

  subscribeSse(listener: (payload: SseEventPayload) => void): () => void {
    this.sseClients.add(listener);
    return () => {
      this.sseClients.delete(listener);
    };
  }

  private broadcast(payload: SseEventPayload): void {
    for (const listener of this.sseClients) {
      try {
        listener(payload);
      } catch {
        // ignore broken SSE stream
      }
    }
  }

  log(severity: LogSeverity, category: string, message: string, meta?: unknown): void {
    const entry = this.db.insertLog(severity, category, message, meta);
    this.broadcast({ type: 'log', data: entry });
  }

  getLiveCriticalSettingsHash(settings = this.db.getSettings()): string {
    return hashSettingsSnapshot(
      JSON.stringify({
        takeProfitPct: settings.takeProfitPct,
        stopLossPct: settings.stopLossPct,
        tradeSizeSol: settings.tradeSizeSol,
        maxWalletExposureSol: settings.maxWalletExposureSol,
        dailyLossLimitSol: settings.dailyLossLimitSol,
      })
    );
  }

  invalidateLiveConfirmationIfCriticalChanged(_newSettings: BotSettings): void {
    // ENABLE LIVE confirmation box/gate disabled per user request; changing settings no longer forces Live stop or re-confirmation.
    this.liveConfirmed = true;
    this.liveConfirmedSettingsHash = this.getLiveCriticalSettingsHash(_newSettings);
  }

  async refreshSolPrice(): Promise<number | null> {
    this.lastSolPriceRefreshMs = Date.now();
    const jupPrice = await this.jupiter.getLiveSolPriceUsd().catch(() => null);
    if (jupPrice && jupPrice > 0) {
      this.solPriceUsd = jupPrice;
      this.solPriceSource = 'jupiter_v3';
      this.solRegimeTracker.record(jupPrice);
      return jupPrice;
    }
    const dsPrice = await this.dexScreener.getLiveSolPriceUsd().catch(() => null);
    if (dsPrice && dsPrice > 0) {
      this.solPriceUsd = dsPrice;
      this.solPriceSource = 'dexscreener_fallback';
      this.solRegimeTracker.record(dsPrice);
      return dsPrice;
    }
    if (this.solPriceUsd === null) {
      this.solPriceSource = 'unavailable';
    }
    return this.solPriceUsd;
  }

  async refreshWalletDiagnostics(): Promise<WalletDiagnostics> {
    await this.refreshSolPrice().catch(() => null);
    const settings = this.db.getSettings();
    const serverPubkey = this.signer.getPublicKey();
    const activeAddress = serverPubkey || this.browserWallet.address;
    const provider: WalletDiagnostics['provider'] = serverPubkey
      ? 'server_signer'
      : this.browserWallet.provider;

    let balanceSol: number | null = null;
    if (activeAddress) {
      const agreedBal = await this.rpcPool.getAgreedBalanceSol(activeAddress).catch(() => ({
        agreed: false,
        balanceSol: null,
        readings: [],
      }));
      if (agreedBal.agreed && agreedBal.balanceSol !== null) {
        balanceSol = agreedBal.balanceSol;
        this.walletSyncState = 'synced';
        if (serverPubkey) {
          this.liveBalanceSol = balanceSol;
          this.db.setModeBalanceSol('live', balanceSol);
        } else {
          this.browserWallet.balanceSol = balanceSol;
        }
      } else {
        this.walletSyncState = 'degraded';
      }
    } else {
      this.walletSyncState = 'unavailable';
    }

    this.lastWalletSyncMs = Date.now();

    // Auto-recover RPC health snapshot if fewer than 2 RPCs currently read healthy
    let healthyRpcs = this.rpcPool.getHealthSnapshot().filter((r) => r.healthy).length;
    if (healthyRpcs < 2 && typeof this.rpcPool.checkAllEndpoints === 'function') {
      const checked = await this.rpcPool.checkAllEndpoints().catch(() => []);
      for (const r of checked) {
        this.db.upsertRpcHealth(r);
      }
      healthyRpcs = checked.filter((r) => r.healthy).length;
    }

    const liveNotReadyReasons: string[] = [];
    if (!this.signer.isUnlocked()) {
      liveNotReadyReasons.push('Server-side encrypted signer is locked or not configured.');
    }
    if (provider !== 'server_signer') {
      liveNotReadyReasons.push(
        'Browser popup wallets (Phantom/Solflare) cannot be used for automated Live exits.'
      );
    }
    // Trade size + gas reserve & ENABLE LIVE confirmation gates removed:
    // User can shift to Live mode cleanly and will receive an alert when buying a coin if wallet has no SOL / $.
    if (this.solPriceUsd === null) {
      liveNotReadyReasons.push('Live SOL/USD price unavailable.');
    }
    if (healthyRpcs < 2) {
      liveNotReadyReasons.push(`Need >= 2 healthy Solana RPC endpoints (currently ${healthyRpcs}).`);
    }
    /* ENABLE LIVE confirmation requirement commented out per user request:
    const currentHash = this.getLiveCriticalSettingsHash(settings);
    if (!this.liveConfirmed || this.liveConfirmedSettingsHash !== currentHash) {
      liveNotReadyReasons.push('Explicit "ENABLE LIVE" confirmation required for current risk settings.');
    }
    */

    const signingCapability: WalletDiagnostics['signingCapability'] = this.signer.isUnlocked()
      ? 'automated_server'
      : this.browserWallet.provider === 'phantom' || this.browserWallet.provider === 'solflare'
        ? 'manual_browser_only'
        : this.browserWallet.provider === 'watch_only'
          ? 'read_only'
          : 'none';

    return {
      provider,
      network: this.mode === 'testnet' ? 'testnet' : 'mainnet-beta',
      address: activeAddress,
      maskedAddress: maskAddress(activeAddress),
      balanceSol,
      balanceUsd:
        balanceSol !== null && this.solPriceUsd !== null ? balanceSol * this.solPriceUsd : null,
      signingCapability,
      syncState: this.walletSyncState,
      liveReady: liveNotReadyReasons.length === 0,
      liveNotReadyReasons,
      signerUnlocked: this.signer.isUnlocked(),
      keystoreExists: this.signer.hasKeystoreFile(),
      lastRefreshedMs: this.lastWalletSyncMs,
    };
  }

  getStatusSnapshot(): BotStatusSnapshot {
    const settings = this.db.getSettings();
    const openPositions = this.db.getPositions(this.mode, false);
    const currentExposureSol = openPositions.reduce((sum, p) => sum + p.solIn, 0);
    const dailyRealizedPnlSol = this.db.getDailyRealizedPnlSol(this.mode);
    const dailyLossLimitHit =
      isOptionEnabled(settings, 'dailyLossLimitSol') &&
      dailyRealizedPnlSol <= -Math.abs(settings.dailyLossLimitSol);

    return {
      mode: this.mode,
      runState: this.runState,
      solPriceUsd: this.solPriceUsd,
      solPriceSource: this.solPriceSource,
      paperBalanceSol: this.db.getModeBalanceSol(this.mode === 'testnet' ? 'testnet' : 'paper'),
      liveBalanceSol: this.liveBalanceSol,
      openPositionsCount: openPositions.length,
      currentExposureSol,
      dailyRealizedPnlSol,
      dailyLossLimitHit,
      liveConfirmed: true,
      liveConfirmedSettingsHash: this.liveConfirmedSettingsHash ?? this.getLiveCriticalSettingsHash(settings),
      lastScanAtMs: this.lastScanAtMs,
      funnel: { ...this.funnel },
      averagePaperLiveGapPct: this.db.getAveragePaperLiveGapPct(),
    };
  }

  private broadcastStatus(): void {
    this.broadcast({ type: 'status', data: this.getStatusSnapshot() });
  }

  setBrowserWallet(wallet: ConnectedBrowserWallet): void {
    this.browserWallet = wallet;
    this.log(
      'INFO',
      'WALLET',
      wallet.address
        ? `Wallet connected (${wallet.provider}: ${maskAddress(wallet.address)})`
        : 'Browser wallet disconnected'
    );
  }

  confirmLiveMode(_confirmationText: string): { ok: boolean; error?: string } {
    this.liveConfirmed = true;
    this.liveConfirmedSettingsHash = this.getLiveCriticalSettingsHash();
    this.broadcastStatus();
    return { ok: true };
  }

  async switchMode(targetMode: ExecutionMode, autoStop = false): Promise<{ ok: boolean; error?: string }> {
    if (this.runState !== 'stopped') {
      if (autoStop) {
        this.stop();
        this.log('INFO', 'MODE', `Bot stopped automatically to switch mode to ${targetMode.toUpperCase()}.`);
      } else {
        return { ok: false, error: 'Cannot switch execution mode while the bot is running.' };
      }
    }
    if (targetMode === 'live') {
      const diag = await this.refreshWalletDiagnostics().catch(() => null);
      if (!this.signer.isUnlocked()) {
        this.log(
          'WARN',
          'MODE',
          'Switched to LIVE mode. Server-side signer is currently locked — unlock it in Wallets & Signer before starting live trades.'
        );
      } else if (diag?.balanceSol !== null && diag?.balanceSol !== undefined && diag.balanceSol <= 0) {
        this.log(
          'WARN',
          'MODE',
          `Switched to LIVE mode (wallet balance ${diag.balanceSol.toFixed(4)} SOL / $0.00).`
        );
      }
    }
    this.mode = targetMode;
    this.lastLiveBalanceSyncByPos.clear();
    this.log('WARN', 'MODE', `Execution mode switched to ${targetMode.toUpperCase()}.`);
    this.broadcastStatus();
    return { ok: true };
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.runState === 'running') {
      return { ok: true };
    }
    if (this.mode === 'live') {
      const diag = await this.refreshWalletDiagnostics();
      if (!diag.liveReady) {
        return {
          ok: false,
          error: `Live start blocked: ${diag.liveNotReadyReasons.join(' | ')}`,
        };
      }
      if (diag.balanceSol !== null && diag.balanceSol < 0.005) {
        const usdStr = diag.balanceUsd !== null ? `$${diag.balanceUsd.toFixed(2)}` : '$0.00';
        this.log(
          'WARN',
          'WALLET',
          `Live bot started with ${diag.balanceSol.toFixed(4)} SOL (${usdStr}) — attempting to buy a coin will alert that there is no SOL / $ in the wallet to trade.`
        );
      }
    }

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.exitTimer) {
      clearInterval(this.exitTimer);
      this.exitTimer = null;
    }

    this.runState = 'running';
    const settings = this.db.getSettings();
    const wsExitsOn = Boolean(settings.wsExitStreamEnabled && isOptionEnabled(settings, 'wsExitStreamEnabled'));
    if (settings.enablePumpPortalWs || wsExitsOn) {
      this.pumpPortal.start();
    }
    if (this.pumpTradeUnsub) {
      this.pumpTradeUnsub();
      this.pumpTradeUnsub = null;
    }
    if (wsExitsOn && typeof this.pumpPortal.onTrade === 'function') {
      this.pumpTradeUnsub = this.pumpPortal.onTrade((tick) => {
        void this.handleLiveTradeTick(tick);
      });
    }
    this.syncPinnedWsMints();

    this.log('INFO', 'ENGINE', `Bot started in ${this.mode.toUpperCase()} mode.`);
    this.broadcastStatus();

    // Immediate scan + interval loops
    void this.runDiscoveryAndEntryPass();
    this.scanTimer = setInterval(() => {
      void this.runDiscoveryAndEntryPass();
    }, Math.max(10, settings.scanIntervalSeconds) * 1000);

    this.exitTimer = setInterval(() => {
      void this.evaluateOpenPositionsTick();
    }, 1000);

    return { ok: true };
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.exitTimer) {
      clearInterval(this.exitTimer);
      this.exitTimer = null;
    }
    if (this.pumpTradeUnsub) {
      this.pumpTradeUnsub();
      this.pumpTradeUnsub = null;
    }
    if (typeof this.pumpPortal?.setPinnedOpenMints === 'function') {
      this.pumpPortal.setPinnedOpenMints([]);
    }
    this.pumpPortal.stop();
    this.runState = 'stopped';
    this.log('INFO', 'ENGINE', 'Bot stopped.');
    this.broadcastStatus();
  }

  shutdown(): void {
    this.stop();
    if (this.priceMonitorTimer) {
      clearInterval(this.priceMonitorTimer);
      this.priceMonitorTimer = null;
    }
  }

  async killSwitch(): Promise<{ closedCount: number; errors: string[] }> {
    this.runState = 'killing';
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.exitTimer) {
      clearInterval(this.exitTimer);
      this.exitTimer = null;
    }
    if (this.pumpTradeUnsub) {
      this.pumpTradeUnsub();
      this.pumpTradeUnsub = null;
    }
    if (typeof this.pumpPortal?.setPinnedOpenMints === 'function') {
      this.pumpPortal.setPinnedOpenMints([]);
    }
    this.pumpPortal.stop();
    this.log('CRITICAL', 'KILL_SWITCH', 'KILL SWITCH ACTIVATED: stopping bot and exiting all open positions.');
    this.broadcastStatus();

    const open = this.db.getPositions(this.mode, false);
    const errors: string[] = [];
    let closedCount = 0;

    for (const pos of open) {
      const res = await this.sellPosition(pos.id, 'KILL_SWITCH', true);
      if (res.ok) closedCount += 1;
      else if (res.error) errors.push(`${pos.symbol}: ${res.error}`);
    }

    this.runState = 'stopped';
    this.broadcastStatus();
    return { closedCount, errors };
  }

  async scanOnce(): Promise<{ evaluated: number; bought: number }> {
    return this.runDiscoveryAndEntryPass();
  }

  async probeMint(mint: string): Promise<{
    candidate: CandidateToken | null;
    security: SecurityReport | null;
    explanation: ExplanationRecord;
  }> {
    const solPrice = await this.refreshSolPrice();
    const settings = this.db.getSettings();
    const enriched = await this.dexScreener.enrichMintsBatch([mint]);
    const candidate = enriched.get(mint) ?? null;

    if (!candidate) {
      return {
        candidate: null,
        security: null,
        explanation: {
          mint,
          symbol: 'UNKNOWN',
          tokenClass: 'high_risk_micro',
          qualityScore: 0,
          tradeScore: 0,
          combinedScore: 0,
          sizeMultiplier: 0,
          decision: 'REJECT',
          stageFailed: 'DISCOVER',
          reasons: ['Token pool data not found on DexScreener'],
          warnings: [],
          qualityBreakdown: {},
          tradeBreakdown: {},
          evaluatedAtMs: Date.now(),
        },
      };
    }

    const valid = validateCandidateData(candidate, settings);
    if (!valid.valid) {
      return {
        candidate,
        security: null,
        explanation: {
          mint,
          symbol: candidate.symbol,
          tokenClass: 'high_risk_micro',
          qualityScore: 0,
          tradeScore: 0,
          combinedScore: 0,
          sizeMultiplier: 0,
          decision: 'REJECT',
          stageFailed: 'DATA_VALIDATE',
          reasons: [valid.reason || 'Validation failed'],
          warnings: [],
          qualityBreakdown: {},
          tradeBreakdown: {},
          evaluatedAtMs: Date.now(),
        },
      };
    }

    const probeTradeSizeSol = isOptionEnabled(settings, 'tradeSizeSol')
      ? settings.tradeSizeSol
      : Math.min(0.05, settings.maxPositionSizeSol || 0.05);
    const probeSlippageBps = isOptionEnabled(settings, 'slippageBps') ? settings.slippageBps : 150;

    let buyImpactPct: number | null = null;
    if (solPrice && solPrice > 0) {
      const lamports = String(Math.floor(probeTradeSizeSol * LAMPORTS_PER_SOL));
      const quote = await this.jupiter.getQuote({
        inputMint: WSOL_MINT,
        outputMint: mint,
        amountRaw: lamports,
        slippageBps: probeSlippageBps,
      });
      if (quote) {
        buyImpactPct = Math.abs(Number(quote.priceImpactPct || 0)) * 100;
      }
    }

    const filterResult = evaluateHardFilters(candidate, settings, buyImpactPct);
    const wsSnap =
      typeof this.pumpPortal.getLiveMintSnapshots === 'function'
        ? this.pumpPortal.getLiveMintSnapshots([mint], solPrice)[mint]
        : undefined;
    const security = await runSecurityChecks({
      mint,
      symbol: candidate.symbol,
      priceUsd: candidate.priceUsd,
      solPriceUsd: solPrice ?? 0,
      testSizeSol: probeTradeSizeSol,
      poolCreatedAtMs: candidate.poolCreatedAtMs,
      socialUrls: candidate.socialUrls,
      smartWalletBuyers: wsSnap?.recentBuyers ?? candidate.smartWalletBuyers,
      settings,
      rpcPool: this.rpcPool,
      rugCheckProvider: this.rugCheck,
      jupiterProvider: this.jupiter,
      dexScreenerProvider: this.dexScreener,
      db: this.db,
    });

    const explanation = scoreCandidate({
      token: candidate,
      filterResult,
      securityReport: security,
      settings,
    });

    this.db.upsertSeenToken({
      mint: candidate.mint,
      symbol: candidate.symbol,
      name: candidate.name,
      source: 'manual_probe',
      dex: candidate.dex,
      lastScannedMs: Date.now(),
      lastQualityScore: explanation.qualityScore,
      lastTradeScore: explanation.tradeScore,
      lastDecision: explanation.decision,
      lastReason: explanation.reasons[0] || 'Passed all pipeline gates',
      liquidityUsd: candidate.liquidityUsd,
      priceUsd: candidate.priceUsd,
      explanationJson: JSON.stringify({ explanation, security, filterResult }),
      nowMs: Date.now(),
    });

    return { candidate, security, explanation };
  }

  private async runDiscoveryAndEntryPass(): Promise<{ evaluated: number; bought: number }> {
    if (this.scanInFlight) return { evaluated: 0, bought: 0 };
    this.scanInFlight = true;
    this.lastScanAtMs = Date.now();

    let evaluated = 0;
    let bought = 0;

    try {
      const settings = this.db.getSettings();
      const openPositions = this.db.getPositions(this.mode, false);
      if (
        isOptionEnabled(settings, 'maxOpenPositions') &&
        openPositions.length >= settings.maxOpenPositions &&
        !settings.allowSlotRotation
      ) {
        this.log(
          'INFO',
          'SCAN',
          `Max open positions slots filled (${openPositions.length}/${settings.maxOpenPositions}). Scanner paused until a position is sold/closed.`
        );
        this.broadcastStatus();
        return { evaluated: 0, bought: 0 };
      }

      const solPriceUsd = await this.refreshSolPrice();
      if (!solPriceUsd) {
        this.log('WARN', 'PRICE', 'Live SOL/USD price unavailable from Jupiter & DexScreener; skipping buy pass.');
        this.broadcastStatus();
        return { evaluated: 0, bought: 0 };
      }

      // Pro Desk Group 3C: SOL Market Regime Filter ("Red Market Pause")
      const regime = this.solRegimeTracker.evaluate(settings);
      if (regime.pauseEntries) {
        this.log(
          'WARN',
          'PRO_REGIME',
          `SOL 15m drop -${regime.dropPct15m.toFixed(2)}% >= ${settings.solRegimeMaxDropPct}% cap — pausing fresh entries.`
        );
        this.broadcastStatus();
        return { evaluated: 0, bought: 0 };
      }

      // Pro Desk Group 4B: Drawdown / Losing-Streak Throttle
      const recentClosed = this.db.getTrades(this.mode, false);
      const streak = evaluateLosingStreakThrottle(recentClosed, settings);
      if (streak.pauseEntries) {
        this.log(
          'WARN',
          'PRO_STREAK',
          `Losing-streak throttle (${streak.consecutiveLosses} losses) active — pausing entries for ${streak.cooldownRemainingSec}s.`
        );
        this.broadcastStatus();
        return { evaluated: 0, bought: 0 };
      }

      if (this.mode === 'live' && (this.liveBalanceSol === null || Date.now() - this.lastWalletSyncMs > 10_000)) {
        const owner = this.signer.getPublicKey();
        if (owner && typeof this.rpcPool.getAgreedBalanceSol === 'function') {
          const bal = await this.rpcPool.getAgreedBalanceSol(owner).catch(() => ({
            agreed: false,
            balanceSol: null,
            readings: [],
          }));
          if (bal.agreed && bal.balanceSol !== null) {
            this.liveBalanceSol = bal.balanceSol;
            this.lastWalletSyncMs = Date.now();
            this.walletSyncState = 'synced';
            this.db.setModeBalanceSol('live', bal.balanceSol);
          }
        }
      }
      let insufficientWalletAlertSent = false;

      // Stage 1: DISCOVER
      const preferNewPoolsOnly = settings.newLaunchOnlyEnabled;
      const preferYoungPools =
        preferNewPoolsOnly ||
        (settings.customAgeWindowEnabled && settings.customMaxPoolAgeMinutes <= 60);
      const [dsDisc, geckoPools, jupRecent] = await Promise.all([
        this.dexScreener.discoverMints(settings.enableDexScreenerBoosts),
        this.geckoTerminal.discoverPools({ preferYoungPools, preferNewPoolsOnly }),
        this.jupiter.fetchRecentTokens(),
      ]);
      const pumpMaxAgeMs = preferNewPoolsOnly
        ? Math.max(90_000, settings.newLaunchMaxAgeSeconds * 1000 + 60_000)
        : 45 * 60_000;
      const pumpMints = settings.enablePumpPortalWs
        ? this.pumpPortal.drainRecentMints(pumpMaxAgeMs)
        : [];

      const nowMs = Date.now();
      const rawCandidates = new Map<string, CandidateToken>();
      const searchCandidateMints = new Set<string>();

      for (const c of dsDisc.candidates) {
        searchCandidateMints.add(c.mint);
        const existing = rawCandidates.get(c.mint);
        if (!existing || c.liquidityUsd > existing.liquidityUsd) {
          rawCandidates.set(c.mint, c);
        }
      }
      for (const c of [...geckoPools, ...jupRecent]) {
        const existing = rawCandidates.get(c.mint);
        if (!existing || c.liquidityUsd > existing.liquidityUsd) {
          rawCandidates.set(c.mint, c);
        }
      }

      // Track newly seen young pools in a rolling watchlist so <5m launches get re-checked cleanly
      const watchMaxAgeMs = preferNewPoolsOnly
        ? Math.max(120_000, settings.newLaunchMaxAgeSeconds * 1000 + 90_000)
        : Math.max(75, (settings.customMaxPoolAgeMinutes || 30) + 15) * 60_000;
      for (const [mint, createdAt] of this.youngPoolWatchlist.entries()) {
        if (nowMs - createdAt > watchMaxAgeMs) {
          this.youngPoolWatchlist.delete(mint);
        }
      }
      for (const mint of pumpMints.slice(0, 80)) {
        if (!this.youngPoolWatchlist.has(mint)) {
          this.youngPoolWatchlist.set(mint, nowMs);
        }
      }
      for (const c of [...geckoPools, ...jupRecent, ...dsDisc.candidates]) {
        if (c.poolCreatedAtMs > 0 && nowMs - c.poolCreatedAtMs <= watchMaxAgeMs) {
          if (!this.youngPoolWatchlist.has(c.mint)) {
            this.youngPoolWatchlist.set(c.mint, c.poolCreatedAtMs);
          }
        }
      }
      if (this.youngPoolWatchlist.size > 250) {
        const sortedWatch = Array.from(this.youngPoolWatchlist.entries()).sort((a, b) => b[1] - a[1]);
        this.youngPoolWatchlist.clear();
        for (const [mint, createdAt] of sortedWatch.slice(0, 250)) {
          this.youngPoolWatchlist.set(mint, createdAt);
        }
      }

      // Prioritize mints needing DexScreener batch metrics (PumpPortal launches, Gecko new pools, Jupiter 5m/recent, watchlist)
      const mintsToEnrich = new Set<string>();
      if (preferNewPoolsOnly) {
        for (const m of pumpMints) mintsToEnrich.add(m);
        for (const c of geckoPools) mintsToEnrich.add(c.mint);
        for (const c of jupRecent) mintsToEnrich.add(c.mint);
      } else {
        for (const c of geckoPools) mintsToEnrich.add(c.mint);
        for (const m of pumpMints) mintsToEnrich.add(m);
        for (const c of jupRecent) mintsToEnrich.add(c.mint);
      }
      for (const [mint, createdAt] of this.youngPoolWatchlist.entries()) {
        if (preferNewPoolsOnly) {
          const ageSec = (nowMs - createdAt) / 1000;
          if (ageSec <= settings.newLaunchMaxAgeSeconds + 45) {
            mintsToEnrich.add(mint);
          }
        } else {
          const ageMin = (nowMs - createdAt) / 60_000;
          const targetMin = settings.customAgeWindowEnabled
            ? settings.customMinPoolAgeMinutes
            : (isOptionEnabled(settings, 'minPoolAgeMinutes') ? settings.minPoolAgeMinutes : 0);
          const targetMax = settings.customAgeWindowEnabled ? settings.customMaxPoolAgeMinutes : 75;
          if (ageMin >= Math.max(0, targetMin - 1) && ageMin <= targetMax + 2) {
            mintsToEnrich.add(mint);
          }
        }
      }
      for (const m of dsDisc.mints) {
        if (!searchCandidateMints.has(m)) {
          mintsToEnrich.add(m);
        }
      }

      const enriched = await this.dexScreener.enrichMintsBatch(Array.from(mintsToEnrich).slice(0, 180));
      for (const [mint, c] of enriched.entries()) {
        const existing = rawCandidates.get(mint);
        if (!existing || c.liquidityUsd >= existing.liquidityUsd * 0.9) {
          rawCandidates.set(mint, {
            ...c,
            source: existing ? `${existing.source}+dexscreener` : c.source,
          });
        }
      }

      const candidates = Array.from(rawCandidates.values());
      const liveWsSnapshots =
        typeof this.pumpPortal.getLiveMintSnapshots === 'function'
          ? this.pumpPortal.getLiveMintSnapshots(
              candidates.map((c) => c.mint),
              solPriceUsd
            )
          : {};
      this.funnel.discovered += candidates.length;
      this.broadcastStatus();

      for (const candidate of candidates) {
        if (this.runState === 'killing') break;

        // Exclude already held, in cooldown, previously attempted, or already traded
        if (this.db.getOpenPositionByMint(this.mode, candidate.mint)) continue;
        if (isOptionEnabled(settings, 'cooldownMinutes') && this.db.isInCooldown(candidate.mint, this.mode)) continue;
        if (this.db.isMintAttempted(candidate.mint, this.mode)) continue;
        if (this.db.hasTradedMint(candidate.mint, this.mode)) continue;

        const liveSnap = liveWsSnapshots[candidate.mint];
        if (liveSnap) {
          if (liveSnap.uniqueTraders5m > 0 && candidate.uniqueTraders5m === undefined) {
            candidate.uniqueTraders5m = liveSnap.uniqueTraders5m;
          }
          if (liveSnap.realSol > 0 && candidate.realSolInCurve === undefined) {
            candidate.realSolInCurve = liveSnap.realSol;
          }
          if (liveSnap.recentBuyers.length > 0) {
            candidate.smartWalletBuyers = Array.from(
              new Set([...(candidate.smartWalletBuyers ?? []), ...liveSnap.recentBuyers])
            );
          }
        }

        evaluated += 1;

        // Stage 2: DATA VALIDATE
        const valid = validateCandidateData(candidate, settings);
        if (!valid.valid) {
          this.recordRejection(candidate, 'DATA_VALIDATE', valid.reason || 'Invalid data', 0, 0, {
            valid,
          });
          continue;
        }
        this.funnel.validated += 1;

        // Pre-screen local hard filters before spending a Jupiter quote call
        const preFilter = evaluateHardFilters(candidate, settings, 0);
        if (!preFilter.passed) {
          this.recordRejection(
            candidate,
            'HARD_FILTER',
            preFilter.reasons[0] || 'Hard filter rejected',
            0,
            0,
            { filterResult: preFilter }
          );
          continue;
        }

        // Pro Desk Group 3: Market-Structure / Entry-Timing Guards (Post-Migration Pullback, Pre-Migration Curve, Wash Trade, Anti-Top-Wick)
        const timingCheck = this.marketStructure.evaluateEntryTiming(candidate, settings);
        if (!timingCheck.passed) {
          this.recordRejection(
            candidate,
            'PRO_TIMING',
            timingCheck.reasons[0] || 'Pro market-structure guard blocked entry',
            0,
            0,
            { timingCheck }
          );
          continue;
        }

        // Planned quote price impact for Hard Filter (fail closed if quote unavailable)
        const effectiveTradeSizeSol = isOptionEnabled(settings, 'tradeSizeSol')
          ? settings.tradeSizeSol
          : Math.min(0.05, settings.maxPositionSizeSol || 0.05);
        const effectiveSlippageBps = isOptionEnabled(settings, 'slippageBps') ? settings.slippageBps : 150;
        const lamports = String(Math.floor(effectiveTradeSizeSol * LAMPORTS_PER_SOL));
        const buyQuote = await this.jupiter.getQuote({
          inputMint: WSOL_MINT,
          outputMint: candidate.mint,
          amountRaw: lamports,
          slippageBps: effectiveSlippageBps,
        });
        const plannedImpactPct = buyQuote
          ? Math.abs(Number(buyQuote.priceImpactPct || 0)) * 100
          : null;

        // Stage 3: HARD FILTER (with real Jupiter buy quote impact)
        const filterResult = evaluateHardFilters(candidate, settings, plannedImpactPct);
        if (!filterResult.passed) {
          this.recordRejection(
            candidate,
            'HARD_FILTER',
            filterResult.reasons[0] || 'Hard filter rejected',
            0,
            0,
            { filterResult }
          );
          continue;
        }
        this.funnel.filtered += 1;

        // Stage 4 & 5: SECURITY & SELL-ROUTE TEST (includes Anti-Sybil, Reused Socials, Smart Money matching)
        const securityReport = await runSecurityChecks({
          mint: candidate.mint,
          symbol: candidate.symbol,
          priceUsd: candidate.priceUsd,
          solPriceUsd,
          testSizeSol: effectiveTradeSizeSol,
          poolCreatedAtMs: candidate.poolCreatedAtMs,
          socialUrls: candidate.socialUrls,
          smartWalletBuyers: candidate.smartWalletBuyers,
          settings,
          rpcPool: this.rpcPool,
          rugCheckProvider: this.rugCheck,
          jupiterProvider: this.jupiter,
          dexScreenerProvider: this.dexScreener,
          db: this.db,
        });

        if (!securityReport.passed) {
          this.recordRejection(
            candidate,
            'SECURITY',
            securityReport.reasons[0] || 'Security check failed',
            0,
            0,
            { filterResult, securityReport }
          );
          continue;
        }
        this.funnel.securityPassed += 1;

        // Stage 6: SCORE
        const explanation = scoreCandidate({
          token: candidate,
          filterResult,
          securityReport,
          settings,
        });
        this.funnel.scored += 1;

        this.db.upsertSeenToken({
          mint: candidate.mint,
          symbol: candidate.symbol,
          name: candidate.name,
          source: candidate.source,
          dex: candidate.dex,
          lastScannedMs: Date.now(),
          lastQualityScore: explanation.qualityScore,
          lastTradeScore: explanation.tradeScore,
          lastDecision: explanation.decision,
          lastReason: explanation.reasons[0] || 'Passed pipeline',
          liquidityUsd: candidate.liquidityUsd,
          priceUsd: candidate.priceUsd,
          explanationJson: JSON.stringify({ explanation, securityReport, filterResult }),
          nowMs: Date.now(),
        });

        if (explanation.decision !== 'BUY') {
          this.recordRejection(
            candidate,
            'SCORE',
            explanation.reasons[0] || 'Score below threshold',
            explanation.qualityScore,
            explanation.tradeScore,
            { explanation, securityReport, filterResult }
          );
          continue;
        }

        // Stage 7: RISK/SIZE
        let openPositions = this.db.getPositions(this.mode, false);
        const availableBalance =
          this.mode === 'live'
            ? (this.liveBalanceSol ?? 0)
            : this.db.getModeBalanceSol(this.mode);
        const currentExposure = openPositions.reduce((s, p) => s + p.solIn, 0);
        const dailyPnl = this.db.getDailyRealizedPnlSol(this.mode);

        // Optional slot rotation if at max positions
        if (
          isOptionEnabled(settings, 'maxOpenPositions') &&
          openPositions.length >= settings.maxOpenPositions &&
          settings.allowSlotRotation
        ) {
          const rotTarget = findSlotRotationCandidate(
            openPositions,
            explanation.combinedScore,
            settings.slotRotationMinScoreDelta
          );
          if (rotTarget) {
            this.log(
              'INFO',
              'ROTATION',
              `Slot rotation: closing stagnant ${rotTarget.symbol} for stronger candidate ${candidate.symbol}`
            );
            await this.sellPosition(rotTarget.id, 'SLOT_ROTATION', false);
            openPositions = this.db.getPositions(this.mode, false);
          }
        }

        // Pro Desk Group 4C: Meta / Narrative Duplicate Guard
        if (settings.narrativeCapEnabled && isOptionEnabled(settings, 'narrativeCapEnabled')) {
          const stem = extractTickerStem(candidate.symbol);
          const maxSame = Math.max(1, settings.maxSameNarrativePositions || 1);
          const sameNarrativeCount = openPositions.filter(
            (p) => extractTickerStem(p.symbol) === stem
          ).length;
          if (sameNarrativeCount >= maxSame) {
            this.recordRejection(
              candidate,
              'RISK_SIZE',
              `Meta narrative cap: already holding ${sameNarrativeCount}/${maxSame} position(s) in "${stem}"`,
              explanation.qualityScore,
              explanation.tradeScore,
              { stem, sameNarrativeCount, maxSame }
            );
            continue;
          }
        }

        // Pro Desk Group 4A + Regime + Streak Multiplier
        const smartMatchesCount = securityReport.smartMoneyBuyers?.length ?? 0;
        const convictionMult = calculateConvictionMultiplier({
          token: candidate,
          settings,
          smartWalletMatches: smartMatchesCount,
        });
        const proSizeMultiplier = Number(
          (convictionMult * regime.sizeMultiplier * streak.sizeMultiplier).toFixed(3)
        );

        const sizing = calculatePositionSize({
          settings,
          availableBalanceSol: availableBalance,
          currentExposureSol: currentExposure,
          openPositionsCount: openPositions.length,
          dailyRealizedPnlSol: dailyPnl,
          poolLiquidityUsd: candidate.liquidityUsd,
          solPriceUsd,
          tokenClassMultiplier: explanation.sizeMultiplier,
          proSizeMultiplier,
        });

        if (!sizing.approved) {
          if (sizing.cappedBy === 'INSUFFICIENT_WALLET_SOL') {
            const msg = sizing.reason || `There is no SOL ($0.00) in the wallet to trade ${candidate.symbol}.`;
            this.log('WARN', 'WALLET', `${candidate.symbol}: ${msg}`);
            if (!insufficientWalletAlertSent) {
              insufficientWalletAlertSent = true;
              this.broadcast({
                type: 'wallet_insufficient',
                data: {
                  symbol: candidate.symbol,
                  availableSol: availableBalance,
                  availableUsd: availableBalance * solPriceUsd,
                  requiredSol: settings.tradeSizeSol,
                  requiredUsd: settings.tradeSizeSol * solPriceUsd,
                  message: msg,
                },
              });
            }
          }
          this.recordRejection(
            candidate,
            'RISK_SIZE',
            sizing.reason || 'Risk/size limit rejected',
            explanation.qualityScore,
            explanation.tradeScore,
            { explanation, sizing }
          );
          continue;
        }

        if (!buyQuote) continue;

        // Stage 8: EXECUTE
        const resolvedDecimals = securityReport.tokenDecimals ?? candidate.tokenDecimals ?? 6;
        if (this.mode === 'live') {
          const res = await this.liveEngine.executeLiveBuy({
            token: candidate,
            solAmount: sizing.solAmount,
            solPriceUsd,
            settings,
            explanation,
            decimals: resolvedDecimals,
            quote: buyQuote,
          });
          if (res.ok && res.position) {
            bought += 1;
            this.funnel.bought += 1;
            this.syncPinnedWsMints();
            this.broadcast({ type: 'trade_event', data: { kind: 'BUY', position: res.position } });
            const latestOpenCount = this.db.getPositions(this.mode, false).length;
            if (
              isOptionEnabled(settings, 'maxOpenPositions') &&
              latestOpenCount >= settings.maxOpenPositions &&
              !settings.allowSlotRotation
            ) {
              this.log(
                'INFO',
                'SCAN',
                `Max open positions slots filled (${latestOpenCount}/${settings.maxOpenPositions}). Pausing scan until a slot opens.`
              );
              break;
            }
          } else if (!res.ok && res.error) {
            this.log('WARN', 'LIVE_BUY', `${candidate.symbol}: ${res.error}`);
            if (!insufficientWalletAlertSent && res.error.toLowerCase().includes('no enough sol')) {
              insufficientWalletAlertSent = true;
              this.broadcast({
                type: 'wallet_insufficient',
                data: {
                  symbol: candidate.symbol,
                  availableSol: availableBalance,
                  availableUsd: availableBalance * solPriceUsd,
                  requiredSol: sizing.solAmount,
                  requiredUsd: sizing.solAmount * solPriceUsd,
                  message: res.error,
                },
              });
            }
          }
        } else {
          this.db.markMintAttempted(candidate.mint, this.mode, 'PAPER_SIMULATING');
          const paperCandidate: CandidateToken = {
            ...candidate,
            tokenDecimals: resolvedDecimals,
          };
          const autoPriority =
            isOptionEnabled(settings, 'priorityFeePreset') &&
            settings.priorityFeePreset === 'auto' &&
            typeof this.jupiter.estimateLivePriorityFeeSol === 'function'
              ? await this.jupiter.estimateLivePriorityFeeSol(this.rpcPool, settings.maxPriorityFeeSol)
              : null;
          const paperSlippageBps = isOptionEnabled(settings, 'slippageBps') ? settings.slippageBps : 150;
          const paperBuyStartMs = Date.now();
          const paperBuy = await executeRealisticPaperBuy({
            mode: this.mode,
            token: paperCandidate,
            solAmount: sizing.solAmount,
            solPriceUsd,
            settings,
            explanation,
            initialQuote: buyQuote,
            measuredLiveGapPct: this.db.getAveragePaperLiveGapPct(),
            jupiterProvider: this.jupiter,
            liveAutoPriorityFeeSol: autoPriority?.sol,
            priorityFeeSource: autoPriority?.source,
            hooks: {
              sampleBuyWindow: async () => {
                const fresh = await this.dexScreener.enrichMintsBatch([candidate.mint]);
                const f = fresh.get(candidate.mint);
                const q = await this.jupiter.getQuote({
                  inputMint: WSOL_MINT,
                  outputMint: candidate.mint,
                  amountRaw: String(Math.floor(sizing.solAmount * LAMPORTS_PER_SOL)),
                  slippageBps: paperSlippageBps,
                });
                return {
                  priceUsd: f?.priceUsd ?? candidate.priceUsd,
                  liquidityUsd: f?.liquidityUsd ?? candidate.liquidityUsd,
                  quote: q,
                };
              },
            },
          });

          if (paperBuy.executed && paperBuy.position) {
            this.db.upsertPosition(paperBuy.position);
            this.db.setModeBalanceSol(this.mode, availableBalance - paperBuy.totalSpentSol);
            if (typeof this.db.recordExecutionTelemetry === 'function') {
              const quotedBuyPx =
                Number(buyQuote.outAmount) > 0
                  ? (sizing.solAmount / (Number(buyQuote.outAmount) / 10 ** resolvedDecimals)) * solPriceUsd
                  : candidate.priceUsd;
              const slipPct =
                quotedBuyPx > 0
                  ? ((paperBuy.effectiveFillPriceUsd - quotedBuyPx) / quotedBuyPx) * 100
                  : 0;
              this.db.recordExecutionTelemetry({
                tradeId: paperBuy.position.id,
                mode: this.mode,
                side: 'BUY',
                mint: candidate.mint,
                symbol: candidate.symbol,
                dex: candidate.dex || 'jupiter',
                platform: candidate.source || 'spot_bot',
                quotedPriceUsd: quotedBuyPx,
                actualFillPriceUsd: paperBuy.effectiveFillPriceUsd,
                slippagePct: Number(slipPct.toFixed(3)),
                latencyMs: Math.max(1, Date.now() - paperBuyStartMs),
                jitoProtected: false,
                createdAtMs: Date.now(),
              });
            }
            bought += 1;
            this.funnel.bought += 1;
            this.syncPinnedWsMints();
            this.log(
              'INFO',
              'PAPER_BUY',
              `Simulated buy ${paperBuy.position.symbol} (${sizing.solAmount.toFixed(4)} SOL @ $${paperBuy.effectiveFillPriceUsd.toFixed(6)})`
            );
            this.broadcast({
              type: 'trade_event',
              data: { kind: 'BUY', position: paperBuy.position },
            });

            // Optional Shadow Compare: NEVER auto-enabled; requires Live unlocked + confirmed!
            if (
              this.mode === 'paper' &&
              settings.shadowCompareEnabled &&
              this.liveConfirmed &&
              this.signer.isUnlocked()
            ) {
              const shadowSol = Math.min(settings.shadowLiveSizeSol, sizing.solAmount);
              const shadowQuote = await this.jupiter.getQuote({
                inputMint: WSOL_MINT,
                outputMint: candidate.mint,
                amountRaw: String(Math.floor(shadowSol * LAMPORTS_PER_SOL)),
                slippageBps: paperSlippageBps,
              });
              if (shadowQuote) {
                const inspection = await this.rpcPool.inspectTokenOnChain(candidate.mint);
                await this.liveEngine.executeLiveBuy({
                  token: candidate,
                  solAmount: shadowSol,
                  solPriceUsd,
                  settings,
                  explanation,
                  decimals: inspection.decimals,
                  quote: shadowQuote,
                });
              }
            }

            const latestOpenCount = this.db.getPositions(this.mode, false).length;
            if (
              isOptionEnabled(settings, 'maxOpenPositions') &&
              latestOpenCount >= settings.maxOpenPositions &&
              !settings.allowSlotRotation
            ) {
              this.log(
                'INFO',
                'SCAN',
                `Max open positions slots filled (${latestOpenCount}/${settings.maxOpenPositions}). Pausing scan until a slot opens.`
              );
              break;
            }
          } else {
            this.recordRejection(
              candidate,
              'PAPER_EXECUTE',
              paperBuy.cancelledReason || 'Simulated buy cancelled',
              explanation.qualityScore,
              explanation.tradeScore,
              { paperBuy }
            );
          }
        }
      }
    } catch (err) {
      this.log(
        'ERROR',
        'SCANNER',
        `Discovery/entry pass error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      this.scanInFlight = false;
      this.broadcastStatus();
    }

    return { evaluated, bought };
  }

  private recordRejection(
    token: CandidateToken,
    stage: string,
    reason: string,
    qualityScore: number,
    tradeScore: number,
    details: unknown
  ): void {
    const rej = this.db.insertRejection({
      mint: token.mint,
      symbol: token.symbol,
      source: token.source,
      stage,
      reason,
      qualityScore,
      tradeScore,
      createdAtMs: Date.now(),
      detailsJson: JSON.stringify(details),
    });
    this.db.upsertSeenToken({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      source: token.source,
      dex: token.dex,
      lastScannedMs: Date.now(),
      lastQualityScore: qualityScore,
      lastTradeScore: tradeScore,
      lastDecision: 'REJECT',
      lastReason: `[${stage}] ${reason}`,
      liquidityUsd: token.liquidityUsd,
      priceUsd: token.priceUsd,
      explanationJson: JSON.stringify(details),
      nowMs: Date.now(),
    });
    this.broadcast({ type: 'rejection', data: rej });
  }

  async refreshOpenPositionPricesTick(): Promise<void> {
    if (this.runState !== 'stopped' || this.priceMonitorTickInFlight || this.exitTickInFlight) {
      return;
    }
    this.priceMonitorTickInFlight = true;
    try {
      const openPositions = this.db
        .getPositions(this.mode, false)
        .filter((p) => p.status === 'OPEN' && !this.sellingPositionIds.has(p.id));
      if (openPositions.length === 0) return;

      const shouldRefreshSol =
        !this.solPriceUsd || Date.now() - this.lastSolPriceRefreshMs >= 10_000;
      const solPriceUsd = shouldRefreshSol
        ? await this.refreshSolPrice()
        : this.solPriceUsd;
      if (!solPriceUsd) return;

      const mints = openPositions.map((p) => p.mint);
      const [jupPrices, dsMap] = await Promise.all([
        this.jupiter.getLivePricesUsd(mints).catch(() => ({} as Record<string, number>)),
        this.dexScreener.enrichMintsBatch(mints).catch(() => new Map()),
      ]);

      const deltas: Array<{
        id: string;
        currentPriceUsd: number;
        currentLiquidityUsd: number;
        peakPnlPct: number;
        trailingArmed: boolean;
        trailingFloorPct: number | null;
        isStaleData: boolean;
      }> = [];

      const nowMs = Date.now();
      for (const pos of openPositions) {
        const ds = dsMap.get(pos.mint);
        const livePrice = jupPrices[pos.mint] ?? ds?.priceUsd ?? pos.currentPriceUsd;
        const liveLiquidity = ds?.liquidityUsd ?? pos.currentLiquidityUsd;
        const isStale = !jupPrices[pos.mint] && !ds;

        const nextHistory =
          livePrice !== pos.currentPriceUsd
            ? [...pos.priceHistory, livePrice].slice(-60)
            : pos.priceHistory;

        this.db.upsertPosition({
          ...pos,
          currentPriceUsd: livePrice,
          currentPriceSol: livePrice / solPriceUsd,
          currentLiquidityUsd: liveLiquidity,
          isStaleData: isStale,
          updatedAtMs: nowMs,
          priceHistory: nextHistory,
        });

        deltas.push({
          id: pos.id,
          currentPriceUsd: livePrice,
          currentLiquidityUsd: liveLiquidity,
          peakPnlPct: pos.peakPnlPct,
          trailingArmed: pos.trailingArmed,
          trailingFloorPct: pos.trailingFloorPct,
          isStaleData: isStale,
        });
      }

      if (deltas.length > 0) {
        this.broadcast({ type: 'positions_batch_update', data: deltas });
      }
      if (shouldRefreshSol) {
        this.broadcastStatus();
      }
    } catch {
      // Stopped-mode price monitor should stay silent on transient provider hiccups
    } finally {
      this.priceMonitorTickInFlight = false;
    }
  }

  private syncPinnedWsMints(): void {
    const settings = this.db.getSettings();
    const wsOn = Boolean(settings.wsExitStreamEnabled && isOptionEnabled(settings, 'wsExitStreamEnabled'));
    if (!wsOn) {
      if (typeof this.pumpPortal.setPinnedOpenMints === 'function') {
        this.pumpPortal.setPinnedOpenMints([]);
      }
      return;
    }
    const open = this.db
      .getPositions(this.mode, false)
      .filter((p) => p.status === 'OPEN')
      .map((p) => p.mint);
    if (typeof this.pumpPortal.setPinnedOpenMints === 'function') {
      this.pumpPortal.setPinnedOpenMints(open);
    }
  }

  private async handleLiveTradeTick(tick: PumpPortalTradeTick): Promise<void> {
    if (this.runState !== 'running') return;
    const settings = this.db.getSettings();
    if (!settings.wsExitStreamEnabled || !isOptionEnabled(settings, 'wsExitStreamEnabled')) return;
    const pos = this.db.getOpenPositionByMint(this.mode, tick.mint);
    if (!pos || pos.status !== 'OPEN' || this.sellingPositionIds.has(pos.id)) return;
    const solPriceUsd = this.solPriceUsd;
    if (!solPriceUsd || solPriceUsd <= 0) return;

    // Auto-exit immediately if a tracked Smart Money wallet sells this mint
    if (
      tick.side === 'sell' &&
      tick.trader &&
      settings.smartMoneyEnabled &&
      isOptionEnabled(settings, 'smartMoneyEnabled') &&
      settings.smartMoneyAutoExitOnSell &&
      isOptionEnabled(settings, 'smartMoneyAutoExitOnSell') &&
      (settings.smartWallets || []).includes(tick.trader)
    ) {
      this.log(
        'WARN',
        'SMART_MONEY',
        `${pos.symbol}: Tracked Smart Wallet ${tick.trader.slice(0, 6)}... sold via WS stream (<200ms) — exiting immediately.`
      );
      await this.sellPosition(pos.id, 'SMART_MONEY_SELL', true);
      return;
    }

    const tickPriceUsd = tick.priceSol > 0 ? tick.priceSol * solPriceUsd : 0;
    const tickLiqUsd = tick.vSol > 0 ? tick.vSol * 2 * solPriceUsd : pos.currentLiquidityUsd;
    if (tickPriceUsd <= 0) return;

    const evalExit = evaluatePositionExit(pos, {
      currentPriceUsd: tickPriceUsd,
      currentLiquidityUsd: tickLiqUsd,
    });
    if (evalExit.shouldExit && evalExit.reason) {
      this.log(
        'INFO',
        'WS_EXIT',
        `${pos.symbol}: Sub-second WS exit trigger (${evalExit.reason}) @ $${tickPriceUsd.toFixed(6)}`
      );
      await this.sellPosition(
        pos.id,
        evalExit.reason,
        evalExit.isEmergency,
        evalExit.sellFraction ?? 1,
        evalExit.triggeredStopLossTier
      );
    }
  }

  async evaluateOpenPositionsTick(): Promise<void> {
    if (this.exitTickInFlight) return;
    this.exitTickInFlight = true;
    try {
      const settings = this.db.getSettings();
      this.syncPinnedWsMints();

      // Pro Desk Group 2C: Periodic Orphan Wallet Position Sweep (live mode, every ~25s)
      if (
        this.mode === 'live' &&
        settings.orphanSweepEnabled &&
        isOptionEnabled(settings, 'orphanSweepEnabled') &&
        Date.now() - this.lastOrphanSweepMs >= 25_000
      ) {
        this.lastOrphanSweepMs = Date.now();
        void this.sweepOrphanPositions().catch(() => undefined);
      }

      const openPositions = this.db
        .getPositions(this.mode, false)
        .filter((p) => p.status === 'OPEN' && !this.sellingPositionIds.has(p.id));
      if (openPositions.length === 0) return;

      const shouldRefreshSol =
        !this.solPriceUsd || Date.now() - this.lastSolPriceRefreshMs >= 10_000;
      const solPriceUsd = shouldRefreshSol
        ? await this.refreshSolPrice()
        : this.solPriceUsd;
      if (!solPriceUsd) return;

      const mints = openPositions.map((p) => p.mint);
      const [jupPrices, dsMap] = await Promise.all([
        this.jupiter.getLivePricesUsd(mints).catch(() => ({} as Record<string, number>)),
        this.dexScreener.enrichMintsBatch(mints).catch(() => new Map()),
      ]);
      const wsSnapshots =
        settings.wsExitStreamEnabled &&
        isOptionEnabled(settings, 'wsExitStreamEnabled') &&
        typeof this.pumpPortal.getLiveMintSnapshots === 'function'
          ? this.pumpPortal.getLiveMintSnapshots(mints, solPriceUsd)
          : {};

      const deltas: Array<{
        id: string;
        currentPriceUsd: number;
        currentLiquidityUsd: number;
        peakPnlPct: number;
        trailingArmed: boolean;
        trailingFloorPct: number | null;
        isStaleData: boolean;
      }> = [];

      for (const pos of openPositions) {
        if (this.runState === 'killing') break;
        if (this.sellingPositionIds.has(pos.id)) continue;

        if (this.mode === 'live') {
          const lastSync = this.lastLiveBalanceSyncByPos.get(pos.id) ?? 0;
          if (Date.now() - lastSync >= 20_000) {
            this.lastLiveBalanceSyncByPos.set(pos.id, Date.now());
            try {
              const reconciled = await this.liveEngine.verifyBalanceAndExternalSell(pos);
              if (reconciled.status !== 'OPEN') continue;
            } catch (err) {
              this.log(
                'WARN',
                'RECONCILE',
                `Live balance sync error for ${pos.symbol}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        }

        const ds = dsMap.get(pos.mint);
        const ws = wsSnapshots[pos.mint];
        const wsFresh = Boolean(ws && ws.priceUsd > 0 && Date.now() - ws.lastTradeAtMs <= 4_000);
        let livePrice =
          (wsFresh ? ws.priceUsd : undefined) ??
          jupPrices[pos.mint] ??
          ds?.priceUsd ??
          pos.currentPriceUsd;
        const liveLiquidity =
          (wsFresh && ws.liquidityUsd > 0 ? ws.liquidityUsd : undefined) ??
          ds?.liquidityUsd ??
          pos.currentLiquidityUsd;
        const isStale = !wsFresh && !jupPrices[pos.mint] && !ds;

        // Smart Money seller exit fallback on polling tick
        if (
          ws &&
          settings.smartMoneyEnabled &&
          isOptionEnabled(settings, 'smartMoneyEnabled') &&
          settings.smartMoneyAutoExitOnSell &&
          isOptionEnabled(settings, 'smartMoneyAutoExitOnSell')
        ) {
          const smartSet = new Set(settings.smartWallets || []);
          const sellerHit = ws.recentSellers.find((s) => smartSet.has(s));
          if (sellerHit) {
            this.log(
              'WARN',
              'SMART_MONEY',
              `${pos.symbol}: Tracked Smart Wallet ${sellerHit.slice(0, 6)}... sold — triggering immediate exit.`
            );
            await this.sellPosition(pos.id, 'SMART_MONEY_SELL', true);
            continue;
          }
        }

        let evalExit = evaluatePositionExit(pos, {
          currentPriceUsd: livePrice,
          currentLiquidityUsd: liveLiquidity,
        });

        let verifiedSellQuote: JupiterQuoteResponse | null = null;
        if (
          evalExit.shouldExit &&
          (evalExit.reason === 'TAKE_PROFIT' || evalExit.reason === 'TRAILING_STOP') &&
          pos.quantity > 0
        ) {
          const rawUnits = Math.max(1, Math.floor(pos.quantity * 10 ** pos.decimals));
          const verifySlippageBps = isOptionEnabled(settings, 'slippageBps') ? settings.slippageBps : 150;
          const sellQuote = await this.jupiter
            .getQuote({
              inputMint: pos.mint,
              outputMint: WSOL_MINT,
              amountRaw: String(rawUnits),
              slippageBps: verifySlippageBps,
            })
            .catch(() => null);
          if (sellQuote && Number(sellQuote.outAmount) > 0) {
            const execSol = Number(sellQuote.outAmount) / LAMPORTS_PER_SOL;
            const execPriceUsd = (execSol / pos.quantity) * solPriceUsd;
            const quoteEval = evaluatePositionExit(pos, {
              currentPriceUsd: execPriceUsd,
              currentLiquidityUsd: liveLiquidity,
            });
            livePrice = execPriceUsd;
            if (quoteEval.shouldExit && quoteEval.reason) {
              verifiedSellQuote = sellQuote;
              evalExit = quoteEval;
            } else {
              this.log(
                'INFO',
                'EXIT_VERIFY',
                `${pos.symbol}: Spot feed signaled ${evalExit.reason}, but Jupiter executable sell quote is $${execPriceUsd.toFixed(6)} — holding.`
              );
              evalExit = quoteEval;
            }
          }
        }

        const nextHistory = [...pos.priceHistory, livePrice].slice(-60);
        const updatedPos: PositionRecord = {
          ...pos,
          currentPriceUsd: livePrice,
          currentPriceSol: livePrice / solPriceUsd,
          currentLiquidityUsd: liveLiquidity,
          peakPriceUsd: evalExit.updatedPeakPriceUsd,
          peakPnlPct: evalExit.updatedPeakPnlPct,
          trailingArmed: evalExit.updatedTrailingArmed,
          trailingFloorPct: evalExit.updatedTrailingFloorPct,
          gapDownTriggered: evalExit.updatedGapDownTriggered,
          isStaleData: isStale,
          updatedAtMs: Date.now(),
          priceHistory: nextHistory,
        };
        this.db.upsertPosition(updatedPos);

        deltas.push({
          id: pos.id,
          currentPriceUsd: livePrice,
          currentLiquidityUsd: liveLiquidity,
          peakPnlPct: evalExit.updatedPeakPnlPct,
          trailingArmed: evalExit.updatedTrailingArmed,
          trailingFloorPct: evalExit.updatedTrailingFloorPct,
          isStaleData: isStale,
        });

        if (evalExit.shouldExit && evalExit.reason) {
          this.log('INFO', 'EXIT_SIGNAL', `${pos.symbol}: ${evalExit.message || evalExit.reason}`);
          await this.sellPosition(
            pos.id,
            evalExit.reason,
            evalExit.isEmergency,
            evalExit.sellFraction ?? 1,
            evalExit.triggeredStopLossTier,
            verifiedSellQuote
          );
        }
      }

      if (deltas.length > 0) {
        this.broadcast({ type: 'positions_batch_update', data: deltas });
      }
      if (shouldRefreshSol) {
        this.broadcastStatus();
      }
    } catch (err) {
      this.log(
        'WARN',
        'EXIT_TICK',
        `Monitor tick recovered from transient error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      this.exitTickInFlight = false;
    }
  }

  async sellPosition(
    positionId: string,
    reason: ExitReason,
    isEmergency = false,
    sellFraction = 1,
    triggeredStopLossTier?: number,
    preVerifiedQuote?: JupiterQuoteResponse | null
  ): Promise<{ ok: boolean; trade?: TradeRecord; error?: string }> {
    if (this.sellingPositionIds.has(positionId)) {
      return { ok: false, error: 'Sell already in progress for position' };
    }
    this.sellingPositionIds.add(positionId);
    try {
      const pos = this.db.getPositionById(positionId);
      if (!pos || pos.status === 'CLOSED') {
        return { ok: false, error: 'Position not found or already closed' };
      }

      const solPriceUsd = this.solPriceUsd ?? (await this.refreshSolPrice());
      if (!solPriceUsd) {
        return { ok: false, error: 'Live SOL price unavailable; cannot value exit' };
      }

      const settings = this.db.getSettings();
      const clampedFraction = Math.min(1, Math.max(0.01, sellFraction));
      const isPartial = clampedFraction < 0.999;

      if (pos.mode === 'live') {
        const dsMap = await this.dexScreener.enrichMintsBatch([pos.mint]);
        const dsLiq = dsMap.get(pos.mint)?.liquidityUsd ?? null;
        const res = await this.liveEngine.executeLiveSell({
          position: pos,
          exitReason: reason,
          solPriceUsd,
          settings,
          isEmergency,
          sellFraction: clampedFraction,
          triggeredStopLossTier,
          liquiditySource1Usd: dsLiq,
          liquiditySource2Usd: pos.currentLiquidityUsd,
        });
        if (res.ok && res.trade) {
          if (
            reason === 'EMERGENCY_LIQUIDITY_DRAIN' ||
            reason === 'EMERGENCY_LIQUIDITY_FLOOR' ||
            reason === 'WRITE_OFF_UNSELLABLE'
          ) {
            if (typeof this.db.markMintRuggedForCreator === 'function') {
              this.db.markMintRuggedForCreator(pos.mint, reason);
            }
            if (typeof this.db.markMintRuggedSocials === 'function') {
              this.db.markMintRuggedSocials(pos.mint);
            }
          }
          this.lastLiveBalanceSyncByPos.delete(positionId);
          this.syncPinnedWsMints();
          this.broadcast({ type: 'trade_event', data: { kind: 'SELL', trade: res.trade } });
          this.broadcastStatus();
        }
        return { ok: res.ok, trade: res.trade, error: res.error };
      }

      const sellPos: PositionRecord = isPartial
        ? {
            ...pos,
            quantity: pos.quantity * clampedFraction,
            solIn: pos.solIn * clampedFraction,
            entryFeesSol: pos.entryFeesSol * clampedFraction,
            entryRentSol: 0,
          }
        : pos;

      const autoExitPriority =
        isOptionEnabled(settings, 'priorityFeePreset') &&
        settings.priorityFeePreset === 'auto' &&
        typeof this.jupiter.estimateLivePriorityFeeSol === 'function'
          ? await this.jupiter.estimateLivePriorityFeeSol(this.rpcPool, settings.maxPriorityFeeSol)
          : null;
      const exitSlippageBps = isOptionEnabled(settings, 'slippageBps') ? settings.slippageBps : 150;

      // Paper or Testnet simulated realistic exit
      const paperSellStartMs = Date.now();
      const res = await executeRealisticPaperSell({
        position: sellPos,
        exitReason: reason,
        solPriceUsd,
        settings,
        measuredLiveGapPct: this.db.getAveragePaperLiveGapPct(),
        jupiterProvider: this.jupiter,
        initialQuote: preVerifiedQuote ?? null,
        liveAutoPriorityFeeSol: autoExitPriority?.sol,
        priorityFeeSource: autoExitPriority?.source,
        hooks: {
          sampleSellWindow: async (p) => {
            const fresh = await this.dexScreener.enrichMintsBatch([p.mint]);
            const f = fresh.get(p.mint);
            const rawUnits = Math.max(1, Math.floor(p.quantity * 10 ** p.decimals));
            const q = await this.jupiter.getQuote({
              inputMint: p.mint,
              outputMint: WSOL_MINT,
              amountRaw: String(rawUnits),
              slippageBps: exitSlippageBps,
            });
            return {
              priceUsd: f?.priceUsd ?? p.currentPriceUsd,
              liquidityUsd: f?.liquidityUsd ?? p.currentLiquidityUsd,
              quote: q,
            };
          },
        },
      });

      if (!res.executed || !res.trade) {
        const failedPos: PositionRecord = {
          ...pos,
          sellAttempts: pos.sellAttempts + 1,
          firstSellFailureAtMs: pos.firstSellFailureAtMs ?? Date.now(),
          lastSellError: res.failureReason || 'Simulated sell failed',
          updatedAtMs: Date.now(),
        };
        this.db.upsertPosition(failedPos);
        this.log(
          'WARN',
          'PAPER_SELL_FAIL',
          `${pos.symbol} simulated sell failed (${failedPos.lastSellError}); position remains OPEN.`
        );
        return { ok: false, error: failedPos.lastSellError ?? 'Sell failed' };
      }

      const nextTriggeredTiers =
        triggeredStopLossTier !== undefined
          ? Array.from(new Set([...(pos.triggeredStopLossTiers ?? []), triggeredStopLossTier]))
          : pos.triggeredStopLossTiers;

      const remainingQty = Math.max(0, pos.quantity - sellPos.quantity);
      if (isPartial && remainingQty > 0) {
        const partialPos: PositionRecord = {
          ...pos,
          status: 'OPEN',
          quantity: remainingQty,
          solIn: Math.max(0, pos.solIn - sellPos.solIn),
          entryFeesSol: Math.max(0, pos.entryFeesSol - sellPos.entryFeesSol),
          triggeredStopLossTiers: nextTriggeredTiers,
          currentPriceUsd: res.trade.exitPrice,
          currentPriceSol: res.trade.exitPrice / solPriceUsd,
          updatedAtMs: Date.now(),
        };
        this.db.upsertPosition(partialPos);
        this.db.insertTrade(res.trade);

        const curBal = this.db.getModeBalanceSol(pos.mode);
        this.db.setModeBalanceSol(pos.mode, curBal + res.solReturnedNet);

        this.log(
          'INFO',
          'PAPER_PARTIAL_SELL',
          `Simulated partial sell ${pos.symbol} (${Math.round(clampedFraction * 100)}%, ${reason}): net ${res.trade.pnlSol >= 0 ? '+' : ''}${res.trade.pnlSol.toFixed(4)} SOL`
        );
        this.broadcast({ type: 'trade_event', data: { kind: 'SELL', trade: res.trade } });
        this.broadcastStatus();
        return { ok: true, trade: res.trade };
      }

      const closedPos: PositionRecord = {
        ...pos,
        status: 'CLOSED',
        triggeredStopLossTiers: nextTriggeredTiers,
        currentPriceUsd: res.trade.exitPrice,
        currentPriceSol: res.trade.exitPrice / solPriceUsd,
        updatedAtMs: Date.now(),
      };
      this.db.upsertPosition(closedPos);
      this.db.insertTrade(res.trade);
      if (isOptionEnabled(settings, 'cooldownMinutes')) {
        this.db.setCooldown(pos.mint, pos.mode, settings.cooldownMinutes);
      }
      if (reason === 'EMERGENCY_LIQUIDITY_DRAIN' || reason === 'EMERGENCY_LIQUIDITY_FLOOR') {
        if (typeof this.db.markMintRuggedForCreator === 'function') {
          this.db.markMintRuggedForCreator(pos.mint, reason);
        }
        if (typeof this.db.markMintRuggedSocials === 'function') {
          this.db.markMintRuggedSocials(pos.mint);
        }
      }

      if (typeof this.db.recordExecutionTelemetry === 'function') {
        const qPx = pos.currentPriceUsd > 0 ? pos.currentPriceUsd : res.trade.exitPrice;
        const fillPx = res.trade.exitPrice;
        const slip = qPx > 0 ? ((qPx - fillPx) / qPx) * 100 : 0;
        this.db.recordExecutionTelemetry({
          tradeId: res.trade.tradeId,
          mode: pos.mode,
          side: 'SELL',
          mint: pos.mint,
          symbol: pos.symbol,
          dex: pos.dex || 'jupiter',
          platform: pos.source || 'spot_bot',
          quotedPriceUsd: qPx,
          actualFillPriceUsd: fillPx,
          slippagePct: Number(slip.toFixed(3)),
          latencyMs: Math.max(1, Date.now() - paperSellStartMs),
          jitoProtected: false,
          createdAtMs: Date.now(),
        });
      }

      const curBal = this.db.getModeBalanceSol(pos.mode);
      this.db.setModeBalanceSol(pos.mode, curBal + res.solReturnedNet);
      this.syncPinnedWsMints();

      this.log(
        'INFO',
        'PAPER_SELL',
        `Simulated sell ${pos.symbol} (${reason}): net ${res.trade.pnlSol >= 0 ? '+' : ''}${res.trade.pnlSol.toFixed(4)} SOL`
      );
      this.broadcast({ type: 'trade_event', data: { kind: 'SELL', trade: res.trade } });
      this.broadcastStatus();
      return { ok: true, trade: res.trade };
    } finally {
      this.sellingPositionIds.delete(positionId);
    }
  }

  async sellAll(reason: ExitReason = 'MANUAL_SELL'): Promise<{ closed: number; errors: string[] }> {
    const open = this.db.getPositions(this.mode, false);
    let closed = 0;
    const errors: string[] = [];
    for (const p of open) {
      const r = await this.sellPosition(p.id, reason, reason === 'KILL_SWITCH');
      if (r.ok) closed += 1;
      else if (r.error) errors.push(`${p.symbol}: ${r.error}`);
    }
    return { closed, errors };
  }

  resolveNeedsReviewPosition(
    positionId: string,
    resolution: 'mark_closed_external' | 'restore_open'
  ): { ok: boolean; error?: string } {
    const pos = this.db.getPositionById(positionId);
    if (!pos) return { ok: false, error: 'Position not found' };

    if (resolution === 'restore_open') {
      this.db.upsertPosition({
        ...pos,
        status: 'OPEN',
        consecutiveZeroBalanceReads: 0,
        reviewReason: null,
        updatedAtMs: Date.now(),
      });
      this.log('INFO', 'RECONCILE', `${pos.symbol} manually restored to OPEN.`);
      return { ok: true };
    }

    const closedAtMs = Date.now();
    const trade: TradeRecord = {
      tradeId: `manual_res_${closedAtMs}_${pos.mint.slice(0, 6)}`,
      mode: pos.mode,
      openedAt: new Date(pos.openedAtMs).toISOString(),
      closedAt: new Date(closedAtMs).toISOString(),
      symbol: pos.symbol,
      mint: pos.mint,
      source: pos.source,
      dex: pos.dex,
      tokenAgeAtEntry: pos.tokenAgeAtEntryMin,
      entryPrice: pos.entryPriceUsd,
      exitPrice: pos.currentPriceUsd,
      quantity: pos.quantity,
      solIn: pos.solIn,
      solOut: pos.quantity * pos.currentPriceSol,
      feesSol: pos.entryFeesSol,
      rentSol: pos.entryRentSol,
      grossPnlSol: pos.quantity * pos.currentPriceSol - pos.solIn,
      pnlSol: pos.quantity * pos.currentPriceSol - (pos.solIn + pos.entryFeesSol + pos.entryRentSol),
      pnlUsd:
        (pos.quantity * pos.currentPriceSol - (pos.solIn + pos.entryFeesSol + pos.entryRentSol)) *
        pos.solPriceUsdAtEntry,
      pnlPct:
        pos.solIn > 0
          ? ((pos.quantity * pos.currentPriceSol - pos.solIn) / pos.solIn) * 100
          : 0,
      peakPct: pos.peakPnlPct,
      holdSeconds: Math.max(1, Math.round((closedAtMs - pos.openedAtMs) / 1000)),
      exitReason: 'SOLD_EXTERNALLY',
      confirmed: pos.mode === 'live' ? 'confirmed' : 'simulated',
      txBuy: pos.txBuy,
      txSell: null,
      solPriceUsd: pos.solPriceUsdAtEntry,
      feeBreakdownJson: JSON.stringify({ note: 'Manually resolved NEEDS_REVIEW' }),
      archivedSessionId: null,
    };
    this.db.upsertPosition({
      ...pos,
      status: 'CLOSED',
      reviewReason: 'Manually resolved as closed external',
      updatedAtMs: closedAtMs,
    });
    this.db.insertTrade(trade);
    return { ok: true };
  }

  async auditRentAccounts(): Promise<RentAuditReport> {
    const solPrice = this.solPriceUsd ?? (await this.refreshSolPrice().catch(() => null));
    return this.liveEngine.auditTokenAccounts(solPrice);
  }

  async reclaimRent(
    targetMint?: string,
    burnDust = false
  ): Promise<{ closedCount: number; burnedCount: number; reclaimedSol: number; txSig: string | null }> {
    const res = await this.liveEngine.reclaimEmptyTokenAccounts(targetMint, { burnDust });
    if (res.closedCount > 0) {
      this.log(
        'INFO',
        'RENT_RECLAIM',
        `Closed ${res.closedCount} ATA(s)${res.burnedCount > 0 ? ` (burned ${res.burnedCount} dust account(s))` : ''}, reclaimed ${res.reclaimedSol.toFixed(5)} SOL.`
      );
    }
    return res;
  }

  async sweepOrphanPositions(): Promise<OrphanSweepResult> {
    const solPrice = this.solPriceUsd ?? (await this.refreshSolPrice().catch(() => null));
    const settings = this.db.getSettings();
    const res = await this.liveEngine.detectAndAdoptOrphanPositions({
      dexScreener: this.dexScreener,
      solPriceUsd: solPrice,
      settings,
    });
    if (res.adopted > 0) {
      this.log(
        'WARN',
        'ORPHAN_SWEEP',
        `Auto-adopted ${res.adopted} untracked wallet token(s) into TP/SL monitor: ${res.adoptedSymbols.join(', ')}`
      );
      this.syncPinnedWsMints();
      this.broadcastStatus();
    }
    return res;
  }

  getDexScorecard(mode?: ExecutionMode): DexScorecardRow[] {
    return this.db.getDexTelemetryScorecard(mode ?? this.mode);
  }

  runBacktest(req: BacktestRequest): BacktestResult {
    const targetMode = req.mode ?? this.mode;
    const trades = this.db.getTrades(targetMode, false);
    return runSpotBacktest(trades, req);
  }

  getAllSourceHealth(): SourceHealthRecord[] {
    return [
      ...this.jupiter.getHealth(),
      this.dexScreener.getHealth(),
      this.geckoTerminal.getHealth(),
      this.rugCheck.getHealth(),
      this.pumpPortal.getHealth(),
    ];
  }
}
