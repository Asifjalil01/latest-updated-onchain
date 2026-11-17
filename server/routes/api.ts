import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { SETTINGS_PRESETS, WALLET_FEE_PROFILES } from '../config/defaults';
import { createApiTokenMiddleware, constantTimeTokenEqual } from '../auth/middleware';
import { computeAnalyticsSummary } from '../engine/fees';
import type { BotOrchestrator } from '../engine/pipeline';
import type { BotSettings, ExecutionMode, LogSeverity, SseEventPayload } from '../types';

const settingsPatchSchema = z
  .object({
    tradeSizeSol: z.number().positive().optional(),
    maxPositionSizeSol: z.number().positive().optional(),
    maxWalletExposureSol: z.number().positive().optional(),
    gasReserveSol: z.number().min(0.01).optional(),
    dailyLossLimitSol: z.number().positive().optional(),
    maxOpenPositions: z.number().int().min(1).max(10).optional(),
    cooldownMinutes: z.number().int().min(0).max(1440).optional(),
    allowSlotRotation: z.boolean().optional(),
    slotRotationMinScoreDelta: z.number().min(5).max(50).optional(),
    autoReclaimRent: z.boolean().optional(),
    priorityFeePreset: z.enum(['standard', 'high', 'ultra', 'custom']).optional(),
    customPriorityFeeSol: z.number().min(0).max(0.05).optional(),
    maxPriorityFeeSol: z.number().min(0.0001).max(0.05).optional(),
    slippageBps: z.number().int().min(10).max(1000).optional(),
    minPoolAgeMinutes: z.number().min(30).optional(),
    maxPoolAgeDays: z.number().min(1).max(3650).optional(),
    customAgeWindowEnabled: z.boolean().optional(),
    customMinPoolAgeMinutes: z.number().min(0).optional(),
    customMaxPoolAgeMinutes: z.number().positive().optional(),
    minLiquidityUsd: z.number().min(10000).optional(),
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
    maxTop10HoldersPct: z.number().min(1).max(50).optional(),
    maxSingleHolderPct: z.number().min(1).max(20).optional(),
    maxSellRouteImpactPct: z.number().min(0.1).max(25).optional(),
    minQualityScore: z.number().min(50).max(100).optional(),
    minTradeScore: z.number().min(50).max(100).optional(),
    enableDexScreenerBoosts: z.boolean().optional(),
    enablePumpPortalWs: z.boolean().optional(),
    scanIntervalSeconds: z.number().int().min(10).max(600).optional(),
    stopLossEnabled: z.boolean().optional(),
    stopLossPct: z.number().min(0.5).optional(),
    stopLossTiers: z
      .array(
        z.object({
          triggerDropPct: z.number().min(0.5),
          sellPct: z.number().min(1).max(100),
        })
      )
      .optional(),
    takeProfitPct: z.number().min(1.5).optional(),
    trailingEnabled: z.boolean().optional(),
    trailingLadder: z
      .array(z.object({ peakGainPct: z.number().positive(), allowedDropPct: z.number().positive() }))
      .optional(),
    breakEvenRecoveryEnabled: z.boolean().optional(),
    maxHoldMinutes: z.number().int().min(5).max(10080).optional(),
    maxHoldStagnationEnabled: z.boolean().optional(),
    stagnationMinGainPct: z.number().optional(),
    emergencyLiquidityFloorUsd: z.number().min(1000).optional(),
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

  // Public health & auth setup routes
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, mode: orchestrator.getStatusSnapshot().mode });
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

    const result = orchestrator.db.updateSettings(parsed.data as Partial<BotSettings>);
    if (!result.valid) {
      res.status(400).json({
        error: 'Settings validation failed',
        errors: result.errors,
        fieldErrors: result.fieldErrors,
      });
      return;
    }

    orchestrator.invalidateLiveConfirmationIfCriticalChanged(result.settings);
    orchestrator.log(
      'INFO',
      'SETTINGS',
      'Bot settings updated (applies to new positions only).'
    );
    res.json({
      settings: result.settings,
      history: orchestrator.db.getSettingsHistory(100),
    });
  });

  router.post('/settings/preset', (req: Request, res: Response) => {
    const presetName = req.body?.preset as keyof typeof SETTINGS_PRESETS;
    if (!presetName || !(presetName in SETTINGS_PRESETS)) {
      res.status(400).json({ error: 'Unknown preset (safe | balanced | aggressive)' });
      return;
    }
    const result = orchestrator.db.updateSettings(SETTINGS_PRESETS[presetName]);
    if (!result.valid) {
      res.status(400).json({ error: 'Preset validation failed', errors: result.errors });
      return;
    }
    orchestrator.invalidateLiveConfirmationIfCriticalChanged(result.settings);
    orchestrator.log('INFO', 'SETTINGS', `Applied "${presetName}" preset (new positions only).`);
    res.json({
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
    const schema = z.object({
      provider: z.enum(['phantom', 'solflare', 'watch_only']),
      address: z.string().min(32).max(64),
    });
    const parsed = schema.safeParse(req.body);
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
    const result = await orchestrator.switchMode(targetMode);
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

  router.post('/rent/reclaim', async (_req: Request, res: Response) => {
    try {
      const result = await orchestrator.reclaimRent();
      orchestrator.log(
        'INFO',
        'RENT',
        `Reclaimed ${result.reclaimedSol} SOL from ${result.closedCount} empty token accounts.`
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rent reclaim failed' });
    }
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
    orchestrator.log('INFO', 'SCANNER', 'Seen tokens cache cleared.');
    res.json({ ok: true });
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

  return router;
}
