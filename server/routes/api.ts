import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  SETTINGS_PRESETS,
  SPOT_PRO_DESK_DEFAULT_SETTINGS,
  SPOT_QUICK_PROFIT_DEFAULT_SETTINGS,
  WALLET_FEE_PROFILES,
} from '../config/defaults';
import { createApiTokenMiddleware, constantTimeTokenEqual } from '../auth/middleware';
import { computeAnalyticsSummary } from '../engine/fees';
import type { BotOrchestrator } from '../engine/pipeline';
import type { BotSettings, ExecutionMode, LogSeverity, SseEventPayload } from '../types';
import { sniperManager } from '../sniperManager';

function readPackageVersion(): string {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

const APP_VERSION = readPackageVersion();

const settingsPatchSchema = z
  .object({
    tradeSizeSol: z.number().min(0).optional(),
    maxPositionSizeSol: z.number().positive().optional(),
    maxWalletExposureSol: z.number().min(0).optional(),
    gasReserveSol: z.number().min(0).optional(),
    dailyLossLimitSol: z.number().min(0).optional(),
    maxOpenPositions: z.number().int().min(0).max(10).optional(),
    cooldownMinutes: z.number().int().min(0).max(1440).optional(),
    allowSlotRotation: z.boolean().optional(),
    slotRotationMinScoreDelta: z.number().min(5).max(50).optional(),
    autoReclaimRent: z.boolean().optional(),
    priorityFeePreset: z.enum(['auto', 'standard', 'high', 'ultra', 'custom']).optional(),
    customPriorityFeeSol: z.number().min(0).max(0.05).optional(),
    maxPriorityFeeSol: z.number().min(0.0001).max(0.05).optional(),
    slippageBps: z.number().int().min(0).max(1000).optional(),
    minPoolAgeMinutes: z.number().min(0).optional(),
    maxPoolAgeDays: z.number().min(1).max(3650).optional(),
    customAgeWindowEnabled: z.boolean().optional(),
    customMinPoolAgeMinutes: z.number().min(0).optional(),
    customMaxPoolAgeMinutes: z.number().min(0).optional(),
    newLaunchOnlyEnabled: z.boolean().optional(),
    newLaunchMinAgeSeconds: z.number().min(0).optional(),
    newLaunchMaxAgeSeconds: z.number().min(0).optional(),
    minLiquidityUsd: z.number().min(0).optional(),
    minVolume24hUsd: z.number().min(0).optional(),
    minTx24h: z.number().int().min(0).optional(),
    minUniqueTraders24h: z.number().int().min(0).optional(),
    maxVolumeLiquidityRatio: z.number().positive().optional(),
    maxFdvLiquidityRatio: z.number().positive().optional(),
    minPriceChange1hPct: z.number().optional(),
    minPriceChange24hPct: z.number().optional(),
    maxPriceChange1hPct: z.number().positive().optional(),
    minBuyRatio: z.number().min(0).max(1).optional(),
    maxPlannedPriceImpactPct: z.number().positive().max(25).optional(),
    maxRugCheckRiskScore: z.number().min(0).max(100).optional(),
    minLpLockedOrBurnedPct: z.number().min(0).max(100).optional(),
    enforceMaxTop10Holders: z.boolean().optional(),
    maxTop10HoldersPct: z.number().min(0).max(100).optional(),
    maxSingleHolderPct: z.number().min(0).max(100).optional(),
    maxSellRouteImpactPct: z.number().min(0.1).max(25).optional(),
    creatorHistoryEnabled: z.boolean().optional(),
    maxCreatorLaunches: z.number().int().min(0).max(500).optional(),
    maxCreatorRuggedCoins: z.number().int().min(0).max(100).optional(),
    creatorFastRugWindowMinutes: z.number().min(0).max(10080).optional(),
    enforceMinScores: z.boolean().optional(),
    minQualityScore: z.number().min(0).max(100).optional(),
    minTradeScore: z.number().min(0).max(100).optional(),
    enableDexScreenerBoosts: z.boolean().optional(),
    enablePumpPortalWs: z.boolean().optional(),
    scanIntervalSeconds: z.number().int().min(10).max(600).optional(),
    stopLossEnabled: z.boolean().optional(),
    stopLossPct: z.number().min(0).optional(),
    stopLossTiers: z
      .array(
        z.object({
          triggerDropPct: z.number().min(0.5),
          sellPct: z.number().min(1).max(100),
        })
      )
      .optional(),
    takeProfitPct: z.number().min(0).optional(),
    trailingEnabled: z.boolean().optional(),
    trailingLadder: z
      .array(z.object({ peakGainPct: z.number().positive(), allowedDropPct: z.number().positive() }))
      .optional(),
    breakEvenRecoveryEnabled: z.boolean().optional(),
    maxHoldMinutes: z.number().int().min(0).max(10080).optional(),
    maxHoldStagnationEnabled: z.boolean().optional(),
    stagnationMinGainPct: z.number().optional(),
    emergencyLiquidityFloorUsd: z.number().min(0).optional(),
    emergencyLiquidityDrainPct: z.number().min(5).max(95).optional(),
    emergencyMaxSellTaxPct: z.number().min(1).max(50).optional(),
    paperDelayMinSec: z.number().min(0).max(30).optional(),
    paperDelayMaxSec: z.number().min(0).max(60).optional(),
    paperDefaultDelaySec: z.number().min(0).max(30).optional(),
    paperBuyFailChancePct: z.number().min(0).max(100).optional(),
    paperSellFailChancePct: z.number().min(0).max(100).optional(),
    paperCompetitionPenaltyPct: z.number().min(0).max(20).optional(),
    applyMeasuredGapToPaper: z.boolean().optional(),
    paperInitialBalanceSol: z.number().min(0.1).max(10000).optional(),
    shadowCompareEnabled: z.boolean().optional(),
    shadowLiveSizeSol: z.number().min(0.005).max(0.5).optional(),
    // Pro Desk — Group 1: Deeper Wallet & Scam Intelligence
    antiSybilEnabled: z.boolean().optional(),
    freshWalletMinutes: z.number().min(1).max(1440).optional(),
    maxSharedFunderCount: z.number().int().min(2).max(20).optional(),
    smartMoneyEnabled: z.boolean().optional(),
    smartWallets: z.array(z.string()).optional(),
    smartMoneyMinConfluence: z.number().int().min(1).max(10).optional(),
    smartMoneySizeBoostPct: z.number().min(0).max(200).optional(),
    smartMoneyAutoExitOnSell: z.boolean().optional(),
    reusedSocialsEnabled: z.boolean().optional(),
    maxSocialReuseCount: z.number().int().min(1).max(50).optional(),
    // Pro Desk — Group 2: Zero-Lag Exits & MEV / Wallet Sweep
    wsExitStreamEnabled: z.boolean().optional(),
    jitoDontFrontEnabled: z.boolean().optional(),
    jitoTipSol: z.number().min(0).max(0.05).optional(),
    orphanSweepEnabled: z.boolean().optional(),
    // Pro Desk — Group 3: Market Structure & Entry Timing
    postMigrationPullbackEnabled: z.boolean().optional(),
    migrationMinDipPct: z.number().min(1).max(90).optional(),
    migrationWaitSec: z.number().min(5).max(600).optional(),
    preMigrationCurveEnabled: z.boolean().optional(),
    preMigrationCurveMinPct: z.number().min(0).max(99).optional(),
    preMigrationCurveMaxPct: z.number().min(1).max(100).optional(),
    washTradeFilterEnabled: z.boolean().optional(),
    minUniqueMakersRatio: z.number().min(0.05).max(1).optional(),
    minUniqueTraders5m: z.number().int().min(1).max(500).optional(),
    solRegimeFilterEnabled: z.boolean().optional(),
    solRegimeMaxDropPct: z.number().min(0.1).max(50).optional(),
    solRegimeAction: z.enum(['pause', 'half_size']).optional(),
    antiTopWickEnabled: z.boolean().optional(),
    maxShortSpikePct: z.number().min(5).max(500).optional(),
    // Pro Desk — Group 4: Dynamic Sizing & Capital Efficiency
    convictionSizingEnabled: z.boolean().optional(),
    convictionMinMult: z.number().min(0.1).max(2.0).optional(),
    convictionMaxMult: z.number().min(0.5).max(3.0).optional(),
    streakThrottleEnabled: z.boolean().optional(),
    streakLossLimit: z.number().int().min(1).max(20).optional(),
    streakCooldownMinutes: z.number().min(1).max(1440).optional(),
    streakAction: z.enum(['half_size', 'pause']).optional(),
    narrativeCapEnabled: z.boolean().optional(),
    maxSameNarrativePositions: z.number().int().min(1).max(10).optional(),
    optionToggles: z.record(z.string(), z.boolean()).optional(),
    applyToOpenPositions: z.boolean().optional(),
  })
  .strict();

function csvEscape(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function createApiRouter(orchestrator: BotOrchestrator, apiToken: string): express.Router {
  const router = express.Router();
  const requireToken = createApiTokenMiddleware(apiToken);
  sniperManager.attachOrchestrator(orchestrator);

  // Public health & auth setup routes
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, version: APP_VERSION, mode: orchestrator.getStatusSnapshot().mode });
  });

  router.get('/auth/status', (_req: Request, res: Response) => {
    res.json({
      requiresToken: true,
      configured: true,
    });
  });

  router.post('/auth/verify', (req: Request, res: Response) => {
    const token =
      req.header('x-api-token') ||
      (typeof req.body?.token === 'string' ? req.body.token : '');
    if (!token || !constantTimeTokenEqual(token, apiToken)) {
      res.status(401).json({ valid: false, error: 'Invalid API token' });
      return;
    }
    res.json({ valid: true });
  });

  router.post('/auth/claim-local-token', (req: Request, res: Response) => {
    const host = req.hostname || '';
    const isLocal =
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '::1' ||
      process.env.ALLOW_LOCAL_SETUP_CLAIM !== 'false';
    if (!isLocal) {
      res.status(403).json({ error: 'Local token claim disabled for non-local hosts' });
      return;
    }
    orchestrator.log('INFO', 'AUTH', 'Local UI session claimed API token.');
    res.json({ apiToken });
  });

  // SSE stream (accepts ?token= or x-api-token)
  router.get('/stream', (req: Request, res: Response) => {
    const token =
      req.header('x-api-token') || (typeof req.query.token === 'string' ? req.query.token : '');
    if (!token || !constantTimeTokenEqual(token, apiToken)) {
      res.status(401).json({ error: 'Unauthorized SSE stream' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (payload: SseEventPayload) => {
      res.write(`event: ${payload.type}\n`);
      res.write(`data: ${JSON.stringify(payload.data)}\n\n`);
    };

    sendEvent({ type: 'status', data: orchestrator.getStatusSnapshot() });
    const unsub = orchestrator.subscribeSse(sendEvent);
    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 20_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsub();
    });
  });

  // CSV export (supports ?token= for browser download link or x-api-token)
  router.get('/export/trades_log.csv', (req: Request, res: Response) => {
    const token =
      req.header('x-api-token') || (typeof req.query.token === 'string' ? req.query.token : '');
    if (!token || !constantTimeTokenEqual(token, apiToken)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const modeParam = typeof req.query.mode === 'string' ? (req.query.mode as ExecutionMode) : undefined;
    const trades = orchestrator.db.getTrades(modeParam, false);
    const header = [
      'trade_id',
      'mode',
      'opened_at',
      'closed_at',
      'symbol',
      'mint',
      'source',
      'dex',
      'token_age_at_entry',
      'entry_price',
      'exit_price',
      'quantity',
      'sol_in',
      'sol_out',
      'fees_sol',
      'rent_sol',
      'pnl_sol',
      'pnl_usd',
      'pnl_pct',
      'peak_pct',
      'hold_seconds',
      'exit_reason',
      'confirmed',
      'tx_buy',
      'tx_sell',
    ].join(',');

    const lines = trades.map((t) =>
      [
        t.tradeId,
        t.mode,
        t.openedAt,
        t.closedAt,
        t.symbol,
        t.mint,
        t.source,
        t.dex,
        t.tokenAgeAtEntry,
        t.entryPrice,
        t.exitPrice,
        t.quantity,
        t.solIn,
        t.solOut,
        t.feesSol,
        t.rentSol,
        t.pnlSol,
        t.pnlUsd,
        t.pnlPct,
        t.peakPct,
        t.holdSeconds,
        t.exitReason,
        t.confirmed,
        t.txBuy ?? '',
        t.txSell ?? '',
      ]
        .map(csvEscape)
        .join(',')
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="trades_log.csv"');
    res.send([header, ...lines].join('\n'));
  });

  // Sniper PnL CSV export (supports ?token= for browser download or x-api-token)
  router.get('/sniper/export/trades.csv', (req: Request, res: Response) => {
    const token =
      req.header('x-api-token') || (typeof req.query.token === 'string' ? req.query.token : '');
    if (!token || !constantTimeTokenEqual(token, apiToken)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const mode = req.query.mode === 'live' ? 'live' : 'paper';
    const csvContent = sniperManager.exportPnlCsv(mode);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sniper_${mode}_pnl_${dateStr}.csv"`);
    res.send(csvContent);
  });

  // Protect all remaining routes with x-api-token
  router.use(requireToken);

  router.get('/status', (_req: Request, res: Response) => {
    res.json(orchestrator.getStatusSnapshot());
  });

  router.get('/positions', (req: Request, res: Response) => {
    const modeParam =
      typeof req.query.mode === 'string'
        ? (req.query.mode as ExecutionMode)
        : orchestrator.getStatusSnapshot().mode;
    const includeClosed = req.query.includeClosed === 'true';
    res.json({ positions: orchestrator.db.getPositions(modeParam, includeClosed) });
  });

  router.get('/trades', (req: Request, res: Response) => {
    const modeParam =
      typeof req.query.mode === 'string' ? (req.query.mode as ExecutionMode) : undefined;
    res.json({ trades: orchestrator.db.getTrades(modeParam, false) });
  });

  router.get('/logs', (req: Request, res: Response) => {
    const limit = Math.min(500, Number(req.query.limit || 200));
    const severity =
      typeof req.query.severity === 'string' ? (req.query.severity as LogSeverity) : undefined;
    res.json({ logs: orchestrator.db.getLogs(limit, severity) });
  });

  router.delete('/logs', (_req: Request, res: Response) => {
    orchestrator.db.clearLogs();
    orchestrator.log('INFO', 'LOGS', 'Event logs cleared.');
    res.json({ ok: true });
  });

  router.get('/scanner/state', (_req: Request, res: Response) => {
    res.json({
      seenTokens: orchestrator.db.getSeenTokens(300),
      rejections: orchestrator.db.getRejections(200),
      funnel: orchestrator.getStatusSnapshot().funnel,
    });
  });

  router.get('/shadow-compare', (_req: Request, res: Response) => {
    const paperTrades = orchestrator.db.getTrades('paper', false);
    const liveTrades = orchestrator.db.getTrades('live', false);
    const gaps = orchestrator.db.getPaperVsLiveGaps(100);
    const averageGapPct = orchestrator.db.getAveragePaperLiveGapPct();
    res.json({
      paperAnalytics: computeAnalyticsSummary(paperTrades),
      liveAnalytics: computeAnalyticsSummary(liveTrades),
      paperTrades: paperTrades.slice(0, 50),
      liveTrades: liveTrades.slice(0, 50),
      gaps,
      averageGapPct,
    });
  });

  router.get('/analytics', (req: Request, res: Response) => {
    const modeParam =
      typeof req.query.mode === 'string'
        ? (req.query.mode as ExecutionMode)
        : orchestrator.getStatusSnapshot().mode;
    const trades = orchestrator.db.getTrades(modeParam, false);
    res.json(computeAnalyticsSummary(trades));
  });

  router.get('/source-health', async (_req: Request, res: Response) => {
    const rpcs = orchestrator.rpcPool.getHealthSnapshot();
    res.json({
      sources: orchestrator.getAllSourceHealth(),
      rpcs,
    });
  });

  router.post('/rpc/check', async (_req: Request, res: Response) => {
    const rpcs = await orchestrator.rpcPool.checkAllEndpoints();
    for (const r of rpcs) orchestrator.db.upsertRpcHealth(r);
    res.json({ rpcs });
  });

  router.get('/settings', (_req: Request, res: Response) => {
    res.json({
      settings: orchestrator.db.getSettings(),
      history: orchestrator.db.getSettingsHistory(100),
    });
  });

  router.post('/settings', (req: Request, res: Response) => {
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      const details: string[] = [];
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        const msg = issue.message;
        details.push(key ? `${key}: ${msg}` : msg);
        if (key && !fieldErrors[key]) {
          fieldErrors[key] = msg;
        }
      }
      res.status(400).json({
        error: 'Invalid settings schema',
        details,
        fieldErrors,
      });
      return;
    }

    const { applyToOpenPositions, ...settingsPatch } = parsed.data;
    const previous = orchestrator.db.getSettings();
    const result = orchestrator.db.updateSettings(settingsPatch as Partial<BotSettings>);
    if (!result.valid) {
      res.status(400).json({
        error: 'Settings validation failed',
        errors: result.errors,
        fieldErrors: result.fieldErrors,
      });
      return;
    }

    if (previous.enforceMinScores && !result.settings.enforceMinScores) {
      const cleared = orchestrator.db.clearScoreStageRejections();
      if (cleared > 0) {
        orchestrator.log(
          'INFO',
          'SCANNER',
          `Cleared ${cleared} stale [SCORE] rejection entries after Min Quality / Trade Score gate was disabled.`
        );
      }
    }

    orchestrator.invalidateLiveConfirmationIfCriticalChanged(result.settings);
    if (applyToOpenPositions === true) {
      const mode = orchestrator.getStatusSnapshot().mode;
      orchestrator.db.syncOpenPositionsExitParams(mode, result.settings);
      orchestrator.log(
        'INFO',
        'SETTINGS',
        'Bot settings updated and applied to active open positions.'
      );
    } else {
      orchestrator.log(
        'INFO',
        'SETTINGS',
        'Bot settings updated (applies to new positions only).'
      );
    }
    res.json({
      settings: result.settings,
      history: orchestrator.db.getSettingsHistory(100),
    });
  });

  router.post('/positions/sync-settings', (_req: Request, res: Response) => {
    const mode = orchestrator.getStatusSnapshot().mode;
    const settings = orchestrator.db.getSettings();
    const syncedCount = orchestrator.db.syncOpenPositionsExitParams(mode, settings);
    orchestrator.log(
      'INFO',
      'SETTINGS',
      `Synced updated exit rules (SL, TP, trailing ladder) to ${syncedCount} open positions.`
    );
    res.json({ success: true, syncedCount });
  });

  router.post('/settings/preset', (req: Request, res: Response) => {
    const presetName = req.body?.preset as keyof typeof SETTINGS_PRESETS;
    if (!presetName || !(presetName in SETTINGS_PRESETS)) {
      res.status(400).json({ error: 'Unknown preset (safe | balanced | aggressive | quick_profit)' });
      return;
    }
    const result = orchestrator.db.updateSettings(SETTINGS_PRESETS[presetName]);
    if (!result.valid) {
      res.status(400).json({ error: 'Preset validation failed', errors: result.errors });
      return;
    }
    orchestrator.invalidateLiveConfirmationIfCriticalChanged(result.settings);
    if (req.body?.applyToOpenPositions === true) {
      const mode = orchestrator.getStatusSnapshot().mode;
      orchestrator.db.syncOpenPositionsExitParams(mode, result.settings);
    }
    orchestrator.log('INFO', 'SETTINGS', `Applied "${presetName}" preset.`);
    res.json({
      settings: result.settings,
      history: orchestrator.db.getSettingsHistory(100),
    });
  });

  router.post('/settings/reset', (req: Request, res: Response) => {
    const scopeRaw = String(req.body?.scope || 'all').trim().toLowerCase();
    const scope = scopeRaw === 'settings' || scopeRaw === 'pro_desk' ? scopeRaw : 'all';
    const current = orchestrator.db.getSettings();
    const currentToggles = { ...(current.optionToggles || {}) };
    const proDeskToggleKeys = [
      'antiSybilEnabled',
      'smartMoneyEnabled',
      'reusedSocialsEnabled',
      'wsExitStreamEnabled',
      'jitoDontFrontEnabled',
      'orphanSweepEnabled',
      'postMigrationPullbackEnabled',
      'preMigrationCurveEnabled',
      'washTradeFilterEnabled',
      'solRegimeFilterEnabled',
      'antiTopWickEnabled',
      'convictionSizingEnabled',
      'streakThrottleEnabled',
      'narrativeCapEnabled',
      'autoReclaimRent',
    ];
    let patch: Partial<BotSettings>;
    if (scope === 'pro_desk') {
      for (const k of proDeskToggleKeys) {
        delete currentToggles[k];
      }
      patch = {
        ...SPOT_PRO_DESK_DEFAULT_SETTINGS,
        optionToggles: currentToggles,
      };
    } else if (scope === 'settings') {
      const nextToggles: Record<string, boolean> = {};
      for (const k of proDeskToggleKeys) {
        if (k in currentToggles) {
          nextToggles[k] = currentToggles[k];
        }
      }
      patch = {
        ...SPOT_QUICK_PROFIT_DEFAULT_SETTINGS,
        optionToggles: nextToggles,
      };
    } else {
      patch = {
        ...SPOT_QUICK_PROFIT_DEFAULT_SETTINGS,
        ...SPOT_PRO_DESK_DEFAULT_SETTINGS,
        optionToggles: {},
      };
    }
    const result = orchestrator.db.updateSettings(patch);
    if (!result.valid) {
      res.status(400).json({ error: 'Reset validation failed', errors: result.errors });
      return;
    }
    orchestrator.invalidateLiveConfirmationIfCriticalChanged(result.settings);
    if (req.body?.applyToOpenPositions === true) {
      const mode = orchestrator.getStatusSnapshot().mode;
      orchestrator.db.syncOpenPositionsExitParams(mode, result.settings);
    }
    orchestrator.log(
      'INFO',
      'SETTINGS',
      scope === 'pro_desk'
        ? 'Reset Pro Desk settings to Quick-Profit defaults.'
        : scope === 'settings'
          ? 'Reset Bot & Risk settings to Quick-Profit defaults.'
          : 'Reset all Bot & Pro Desk settings to Quick-Profit defaults.'
    );
    res.json({
      scope,
      settings: result.settings,
      history: orchestrator.db.getSettingsHistory(100),
    });
  });

  router.get('/wallets', async (_req: Request, res: Response) => {
    const diagnostics = await orchestrator.refreshWalletDiagnostics();
    res.json({
      diagnostics,
      feeProfiles: WALLET_FEE_PROFILES,
    });
  });

  router.get('/wallet/diagnostics', async (_req: Request, res: Response) => {
    const diagnostics = await orchestrator.refreshWalletDiagnostics();
    res.json(diagnostics);
  });

  router.post('/wallet/connect', async (req: Request, res: Response) => {
    let rawAddress = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
    // If user accidentally passed their private key (base58 or byte array), safely extract public key
    if (rawAddress.startsWith('[') || rawAddress.length > 50) {
      try {
        const { parseSolanaSecretKey } = await import('../security/crypto');
        const { Keypair } = await import('@solana/web3.js');
        const bytes = parseSolanaSecretKey(rawAddress);
        const kp = await Keypair.fromSecretKey(bytes);
        rawAddress = kp.publicKey.toBase58();
        bytes.fill(0);
      } catch {
        // Fall through to validation
      }
    }

    const schema = z.object({
      provider: z.enum(['phantom', 'solflare', 'watch_only']),
      address: z.string().min(32).max(64),
    });
    const parsed = schema.safeParse({
      provider: req.body?.provider,
      address: rawAddress,
    });
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid wallet connection payload' });
      return;
    }
    orchestrator.setBrowserWallet({
      provider: parsed.data.provider,
      address: parsed.data.address,
      balanceSol: null,
    });
    const diagnostics = await orchestrator.refreshWalletDiagnostics();
    res.json({ diagnostics });
  });

  router.post('/wallet/disconnect', async (_req: Request, res: Response) => {
    orchestrator.setBrowserWallet({ provider: 'none', address: null, balanceSol: null });
    const diagnostics = await orchestrator.refreshWalletDiagnostics();
    res.json({ diagnostics });
  });

  router.post('/wallet/complete-tx', (req: Request, res: Response) => {
    const schema = z.object({
      txSig: z.string().min(32),
      mint: z.string().min(32),
      symbol: z.string().min(1),
      side: z.enum(['BUY', 'SELL']),
      solAmount: z.number().positive(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid browser-signed tx payload' });
      return;
    }
    orchestrator.log(
      'INFO',
      'MANUAL_BROWSER_TX',
      `Manual browser-signed ${parsed.data.side} recorded for ${parsed.data.symbol}: ${parsed.data.txSig}`
    );
    res.json({ ok: true });
  });

  // Server signer routes
  router.get('/signer/status', (_req: Request, res: Response) => {
    res.json({
      unlocked: orchestrator.signer.isUnlocked(),
      keystoreExists: orchestrator.signer.hasKeystoreFile(),
      maskedPublicKey: orchestrator.signer.getMaskedPublicKey(),
      source: orchestrator.signer.getSource(),
    });
  });

  router.post('/signer/set', async (req: Request, res: Response) => {
    const schema = z.object({
      privateKey: z.string().min(20),
      passphrase: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Private key and >= 8 char passphrase required.' });
      return;
    }
    try {
      const { publicKey } = await orchestrator.signer.saveEncryptedKeystore(
        parsed.data.privateKey,
        parsed.data.passphrase
      );
      orchestrator.log('INFO', 'SIGNER', `Encrypted keystore created for ${publicKey.slice(0, 4)}...${publicKey.slice(-4)}.`);
      res.json({
        ok: true,
        unlocked: true,
        maskedPublicKey: orchestrator.signer.getMaskedPublicKey(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to encrypt key' });
    }
  });

  router.post('/signer/unlock', async (req: Request, res: Response) => {
    const passphrase = typeof req.body?.passphrase === 'string' ? req.body.passphrase : '';
    try {
      await orchestrator.signer.unlockWithPassphrase(passphrase);
      orchestrator.log('INFO', 'SIGNER', 'Server-side signer unlocked.');
      res.json({
        ok: true,
        unlocked: true,
        maskedPublicKey: orchestrator.signer.getMaskedPublicKey(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unlock failed' });
    }
  });

  router.post('/signer/lock', (_req: Request, res: Response) => {
    orchestrator.signer.lockMemorySigner();
    if (orchestrator.getStatusSnapshot().mode === 'live') {
      orchestrator.stop();
    }
    orchestrator.log('INFO', 'SIGNER', 'Server-side signer locked.');
    res.json({ ok: true, unlocked: false });
  });

  router.post('/signer/clear', (_req: Request, res: Response) => {
    if (orchestrator.getStatusSnapshot().runState !== 'stopped') {
      res.status(400).json({ error: 'Stop bot before clearing signer keystore.' });
      return;
    }
    orchestrator.signer.clearKeystore();
    orchestrator.log('WARN', 'SIGNER', 'Encrypted signer keystore cleared.');
    res.json({ ok: true, unlocked: false, keystoreExists: false });
  });

  // Bot lifecycle & control routes
  router.post('/mode', async (req: Request, res: Response) => {
    const targetMode = req.body?.mode as ExecutionMode;
    if (!['paper', 'testnet', 'live'].includes(targetMode)) {
      res.status(400).json({ error: 'Invalid mode' });
      return;
    }
    const autoStop = req.body?.autoStop === true;
    const result = await orchestrator.switchMode(targetMode, autoStop);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ status: orchestrator.getStatusSnapshot() });
  });

  router.post('/live/confirm', (req: Request, res: Response) => {
    const confirmationText =
      typeof req.body?.confirmationText === 'string' ? req.body.confirmationText : '';
    const result = orchestrator.confirmLiveMode(confirmationText);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ status: orchestrator.getStatusSnapshot() });
  });

  router.post('/start', async (_req: Request, res: Response) => {
    const result = await orchestrator.start();
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ status: orchestrator.getStatusSnapshot() });
  });

  router.post('/stop', (_req: Request, res: Response) => {
    orchestrator.stop();
    res.json({ status: orchestrator.getStatusSnapshot() });
  });

  router.post('/kill', async (_req: Request, res: Response) => {
    const result = await orchestrator.killSwitch();
    res.json({ ...result, status: orchestrator.getStatusSnapshot() });
  });

  router.post('/scan-once', async (_req: Request, res: Response) => {
    const result = await orchestrator.scanOnce();
    res.json({ ...result, status: orchestrator.getStatusSnapshot() });
  });

  router.post('/sell/:id', async (req: Request, res: Response) => {
    const posId = String(req.params.id);
    const result = await orchestrator.sellPosition(posId, 'MANUAL_SELL', false);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  router.post('/sell-all', async (_req: Request, res: Response) => {
    const result = await orchestrator.sellAll('MANUAL_SELL');
    res.json(result);
  });

  router.post('/positions/:id/resolve', (req: Request, res: Response) => {
    const posId = String(req.params.id);
    const resolution = req.body?.resolution;
    if (resolution !== 'mark_closed_external' && resolution !== 'restore_open') {
      res.status(400).json({ error: 'Invalid resolution action' });
      return;
    }
    const result = orchestrator.resolveNeedsReviewPosition(posId, resolution);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  router.get('/rent/audit', async (_req: Request, res: Response) => {
    try {
      res.json(await orchestrator.auditRentAccounts());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rent audit failed' });
    }
  });

  router.post('/rent/reclaim', async (req: Request, res: Response) => {
    try {
      const targetMint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : undefined;
      const burnDust = req.body?.burnDust === true;
      const result = await orchestrator.reclaimRent(targetMint || undefined, burnDust);
      orchestrator.log(
        'INFO',
        'RENT',
        `Reclaimed ${result.reclaimedSol} SOL from ${result.closedCount} token accounts.`
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rent reclaim failed' });
    }
  });

  router.post('/rent/reclaim-all', async (req: Request, res: Response) => {
    try {
      const targetMint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : undefined;
      const burnDust = req.body?.burnDust === true;
      const result = await orchestrator.reclaimRent(targetMint || undefined, burnDust);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rent reclaim failed' });
    }
  });

  router.post('/wallet/sweep-orphans', async (_req: Request, res: Response) => {
    try {
      res.json(await orchestrator.sweepOrphanPositions());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Orphan sweep failed' });
    }
  });

  router.get('/telemetry/scorecard', (req: Request, res: Response) => {
    const modeParam =
      typeof req.query.mode === 'string' && ['paper', 'testnet', 'live'].includes(req.query.mode)
        ? (req.query.mode as ExecutionMode)
        : undefined;
    res.json({ scorecard: orchestrator.getDexScorecard(modeParam) });
  });

  router.post('/backtest', (req: Request, res: Response) => {
    const schema = z.object({
      mode: z.enum(['paper', 'testnet', 'live']).optional(),
      lookbackHours: z.number().min(0).max(8760).optional(),
      takeProfitPct: z.number().min(1).max(5000),
      stopLossPct: z.number().min(1).max(99),
      trailingEnabled: z.boolean(),
      trailingDropPct: z.number().min(0.1).max(90),
      minAgeMinutes: z.number().min(0).optional(),
      maxAgeMinutes: z.number().min(0).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid backtest parameters' });
      return;
    }
    res.json(orchestrator.runBacktest(parsed.data));
  });

  router.post('/probe', async (req: Request, res: Response) => {
    const mint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : '';
    if (mint.length < 32) {
      res.status(400).json({ error: 'Valid Solana mint address required' });
      return;
    }
    const result = await orchestrator.probeMint(mint);
    res.json(result);
  });

  router.post('/seen-tokens/reset', (_req: Request, res: Response) => {
    orchestrator.db.clearSeenTokensCache();
    orchestrator.resetFunnel();
    orchestrator.log('INFO', 'SCANNER', 'Seen tokens cache and funnel counters reset.');
    res.json({ ok: true, status: orchestrator.getStatusSnapshot() });
  });

  router.post('/account/reset', (req: Request, res: Response) => {
    const currentMode = orchestrator.getStatusSnapshot().mode;
    const requestedMode = req.body?.mode === 'testnet' ? 'testnet' : 'paper';
    if (currentMode === 'live' && req.body?.mode !== 'paper' && req.body?.mode !== 'testnet') {
      res.status(400).json({ error: 'Live ledger cannot be reset or deleted.' });
      return;
    }
    if (orchestrator.getStatusSnapshot().runState !== 'stopped') {
      res.status(400).json({ error: 'Stop the bot before archiving and resetting Paper account.' });
      return;
    }
    const initialBal = orchestrator.db.getSettings().paperInitialBalanceSol;
    const archiveId = orchestrator.db.archiveAndResetPaperAccount(initialBal, requestedMode);
    orchestrator.log(
      'INFO',
      'ACCOUNT',
      `${requestedMode.toUpperCase()} ledger archived (${archiveId}) and reset to ${initialBal} SOL. Live rows untouched.`
    );
    res.json({ ok: true, archiveId, status: orchestrator.getStatusSnapshot() });
  });

  router.get('/sniper/status', (_req: Request, res: Response) => {
    res.json(sniperManager.getStatus());
  });

  router.post('/sniper/mode', async (req: Request, res: Response) => {
    const mode = req.body?.mode === 'live' ? 'live' : req.body?.mode === 'paper' ? 'paper' : null;
    if (!mode) {
      res.status(400).json({ error: 'Invalid mode (expected paper | live)' });
      return;
    }
    res.json(await sniperManager.switchMode(mode));
  });

  router.get('/sniper/live-wallet', async (req: Request, res: Response) => {
    const force = req.query.force === 'true';
    res.json(await sniperManager.refreshLiveWalletInfo(force));
  });

  router.post('/sniper/live-buy', async (req: Request, res: Response) => {
    const mint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : '';
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '?';
    const tradeSizeUsd = Number(req.body?.tradeSizeUsd || 0);
    if (!mint || !Number.isFinite(tradeSizeUsd) || tradeSizeUsd <= 0) {
      res.status(400).json({ ok: false, error: 'mint and positive tradeSizeUsd required' });
      return;
    }
    const result = await sniperManager.executeLiveBuy({
      mint,
      symbol,
      tradeSizeUsd,
      slippagePct: req.body?.slippagePct !== undefined ? Number(req.body.slippagePct) : undefined,
      solPriceUsd: req.body?.solPriceUsd !== undefined ? Number(req.body.solPriceUsd) : undefined,
      decimals:
        req.body?.decimals !== undefined && req.body?.decimals !== null && Number.isFinite(Number(req.body.decimals))
          ? Number(req.body.decimals)
          : undefined,
      dex: typeof req.body?.dex === 'string' ? req.body.dex : undefined,
    });
    res.json(result);
  });

  router.post('/sniper/live-sell', async (req: Request, res: Response) => {
    const mint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : '';
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '?';
    if (!mint) {
      res.status(400).json({ ok: false, error: 'mint required' });
      return;
    }
    const result = await sniperManager.executeLiveSell({
      mint,
      symbol,
      qty: Number(req.body?.qty || 0),
      rawAmount: typeof req.body?.rawAmount === 'string' ? req.body.rawAmount : null,
      decimals: req.body?.decimals !== undefined && req.body?.decimals !== null ? Number(req.body.decimals) : null,
      costUsd: Number(req.body?.costUsd || 0),
      costSol: req.body?.costSol !== undefined && req.body?.costSol !== null ? Number(req.body.costSol) : null,
      slippagePct: req.body?.slippagePct !== undefined ? Number(req.body.slippagePct) : undefined,
      solPriceUsd: req.body?.solPriceUsd !== undefined ? Number(req.body.solPriceUsd) : undefined,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : 'sniper_exit',
      sellFraction:
        req.body?.sellFraction !== undefined && req.body?.sellFraction !== null
          ? Number(req.body.sellFraction)
          : undefined,
    });
    res.json(result);
  });

  router.post('/sniper/control', (req: Request, res: Response) => {
    const action = req.body?.action;
    if (action === 'start') {
      res.json(sniperManager.start());
    } else if (action === 'stop') {
      res.json(sniperManager.stop());
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  });

  router.post('/sniper/settings', (req: Request, res: Response) => {
    const settings = req.body?.settings;
    if (!settings || typeof settings !== 'object') {
      res.status(400).json({ error: 'Invalid settings payload' });
      return;
    }
    res.json(sniperManager.updateSettings(settings));
  });

  router.post('/sniper/settings/reset', (req: Request, res: Response) => {
    const scopeRaw = String(req.body?.scope || 'all').trim().toLowerCase();
    const scope =
      scopeRaw === 'settings' || scopeRaw === 'pro_desk' || scopeRaw === 'pulse'
        ? scopeRaw
        : 'all';
    res.json(sniperManager.resetSettingsToDefault(scope));
  });

  router.post('/sniper/reset', (_req: Request, res: Response) => {
    res.json(sniperManager.resetAccount());
  });

  router.post('/sniper/sell', async (req: Request, res: Response) => {
    const mint = req.body?.mint;
    if (!mint) {
      res.status(400).json({ error: 'Mint required' });
      return;
    }
    res.json(await sniperManager.sellPosition(mint));
  });

  router.post('/sniper/delete-position', (req: Request, res: Response) => {
    const mint = req.body?.mint;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'rugpull_writeoff';
    if (!mint) {
      res.status(400).json({ error: 'Mint required' });
      return;
    }
    res.json(sniperManager.forceDeletePosition(mint, reason));
  });

  router.post('/sniper/logs/clear', (_req: Request, res: Response) => {
    res.json(sniperManager.clearLogs());
  });

  router.post('/sniper/smart-money/discover', async (req: Request, res: Response) => {
    const autoAdd = req.body?.autoAdd !== false;
    const disc = await sniperManager.discoverSmartWallets({ autoAdd });
    let holdingsScan: any = null;
    if (req.body?.scanHoldings !== false) {
      holdingsScan = await sniperManager.scanTrackedWhaleHoldings({ batchSize: 5 }).catch(() => null);
    }
    res.json({ ...disc, holdingsScan });
  });

  router.get('/sniper/alpha-signals', async (req: Request, res: Response) => {
    const discover = req.query?.discover === '1' || req.query?.discover === 'true';
    if (discover) {
      await sniperManager.discoverAlphaSignals({ force: true });
    }
    res.json(sniperManager.getAlphaSignals());
  });

  router.post('/sniper/alpha-signals/discover', async (_req: Request, res: Response) => {
    const disc = await sniperManager.discoverAlphaSignals({ force: true });
    res.json({ ...sniperManager.getAlphaSignals(), added: disc.added });
  });

  router.post('/sniper/alpha-signals/snipe', async (req: Request, res: Response) => {
    const mint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : '';
    const jitoTipSol = req.body?.jitoTipSol !== undefined ? Number(req.body.jitoTipSol) : undefined;
    if (!mint) {
      res.status(400).json({ ok: false, message: 'Mint is required' });
      return;
    }
    const result = await sniperManager.queueManualAlphaSnipe(mint, jitoTipSol);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get('/sniper/pulse-signals', async (req: Request, res: Response) => {
    const discover = req.query?.discover === '1' || req.query?.discover === 'true';
    if (discover) {
      await sniperManager.discoverPulseSignals({ force: true });
    }
    res.json(sniperManager.getPulseSignals());
  });

  router.post('/sniper/pulse-signals/discover', async (_req: Request, res: Response) => {
    const disc = await sniperManager.discoverPulseSignals({ force: true });
    res.json({ ...sniperManager.getPulseSignals(), added: disc.added });
  });

  router.post('/sniper/pulse-signals/buy', async (req: Request, res: Response) => {
    const mint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : '';
    const jitoTipSol = req.body?.jitoTipSol !== undefined ? Number(req.body.jitoTipSol) : undefined;
    if (!mint) {
      res.status(400).json({ ok: false, message: 'Mint is required' });
      return;
    }
    const result = await sniperManager.queueManualPulseBuy(mint, jitoTipSol);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.get('/sniper/pumpportal-mints', (_req: Request, res: Response) => {
    const feed = sniperManager.getPumpPortalFeed();
    res.json({
      ok: true,
      mints: feed.mints,
      pairs: feed.pairs,
      solPriceUsd: feed.solPriceUsd,
      open_prices: feed.open_prices,
      smart_sells: feed.smart_sells,
      smart_buys: feed.smart_buys,
      whale_held_mints: feed.whale_held_mints,
      alpha_signals: feed.alpha_signals,
      pulse_signals: feed.pulse_signals,
    });
  });

  router.post('/sniper/ws-watch', (req: Request, res: Response) => {
    const mints = Array.isArray(req.body?.mints) ? req.body.mints : [];
    const creators =
      req.body?.creators && typeof req.body.creators === 'object' ? req.body.creators : undefined;
    res.json(sniperManager.setWsWatchedMints(mints, creators));
  });

  router.post('/sniper/reverse-quotes', async (req: Request, res: Response) => {
    const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
    const solPriceUsd = req.body?.solPriceUsd !== undefined ? Number(req.body.solPriceUsd) : undefined;
    res.json(await sniperManager.getReverseExitPrices(positions, solPriceUsd));
  });

  router.get('/sniper/rent/audit', async (_req: Request, res: Response) => {
    try {
      res.json(await sniperManager.auditRentAccounts());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rent audit failed' });
    }
  });

  router.post('/sniper/rent/reclaim', async (req: Request, res: Response) => {
    try {
      const burnDust = req.body?.burnDust === true;
      const targetMint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : undefined;
      res.json(await sniperManager.reclaimRentAccounts(burnDust, targetMint || undefined));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rent reclaim failed' });
    }
  });

  router.post('/sniper/sweep-orphans', async (_req: Request, res: Response) => {
    try {
      res.json(await sniperManager.sweepOrphanPositions());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Orphan sweep failed' });
    }
  });

  router.get('/sniper/telemetry', (_req: Request, res: Response) => {
    res.json({ ok: true, scorecard: sniperManager.getTelemetryScorecard() });
  });

  router.post('/sniper/backtest', (req: Request, res: Response) => {
    const schema = z.object({
      mode: z.enum(['paper', 'live']).optional(),
      lookbackHours: z.number().min(0).max(8760).optional(),
      takeProfitPct: z.number().min(1).max(5000),
      stopLossPct: z.number().min(1).max(99),
      trailingEnabled: z.boolean(),
      trailingDropPct: z.number().min(0.1).max(90),
      minAgeMinutes: z.number().min(0).optional(),
      maxAgeMinutes: z.number().min(0).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid sniper backtest parameters' });
      return;
    }
    res.json(sniperManager.runBacktest(parsed.data));
  });

  return router;
}
