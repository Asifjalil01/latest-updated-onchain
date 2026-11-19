import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { LiveExecutionEngine, type LiveTxAdapter } from '../engine/liveEngine';
import { BotDatabase } from '../store/db';
import { ServerSignerManager } from '../security/signer';
import type { SolanaRpcPool } from '../providers/rpcPool';
import type { JupiterProvider, JupiterQuoteResponse } from '../providers/jupiter';
import { WSOL_MINT } from '../providers/jupiter';
import { BotOrchestrator } from '../engine/pipeline';
import type { DexScreenerProvider } from '../providers/dexscreener';
import type { GeckoTerminalProvider } from '../providers/geckoterminal';
import type { RugCheckProvider } from '../providers/rugcheck';
import type { PumpPortalWsProvider } from '../providers/pumpportal';
import type { CandidateToken, ExplanationRecord, PositionRecord } from '../types';

test('execution: confirmation timeout followed by late success creates exactly one position and blocks second buy', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-exec-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  const kp = await Keypair.generate();
  const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
  await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));

  try {
    // Build a valid minimal VersionedTransaction base64 for Jupiter mock
    const msg = new TransactionMessage({
      payerKey: kp.publicKey,
      recentBlockhash: '11111111111111111111111111111111' as unknown as ConstructorParameters<
        typeof TransactionMessage
      >[0]['recentBlockhash'],
      instructions: [],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(msg);
    const base64Tx = Buffer.from(vtx.serialize()).toString('base64');

    let tokenBalOnChain = 0;
    const mockRpcPool = {
      getAgreedTokenBalanceUi: async () => ({
        agreed: true,
        balanceUi: tokenBalOnChain,
        readings: [tokenBalOnChain, tokenBalOnChain],
      }),
    } as unknown as SolanaRpcPool;

    const mockJupiter = {
      buildSwapTransaction: async () => ({ swapTransaction: base64Tx }),
    } as unknown as JupiterProvider;

    let pollCount = 0;
    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => 'sig_timeout_then_lands',
      pollConfirmation: async () => {
        pollCount += 1;
        if (pollCount === 1) return { status: 'timeout' };
        tokenBalOnChain = 1234.5;
        return { status: 'confirmed' };
      },
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        solDeltaLamports: -52_044_280,
        feeLamports: 5000,
      }),
      findRecentSellSignature: async () => null,
    };

    const engine = new LiveExecutionEngine(
      db,
      signer,
      mockRpcPool,
      mockJupiter,
      () => undefined,
      mockAdapter
    );

    const token: CandidateToken = {
      mint: 'MintTimeout1111111111111111111111111111111',
      symbol: 'LATE',
      name: 'Late Confirm',
      source: 'dexscreener',
      dex: 'raydium',
      pairAddress: 'Pair1',
      poolCreatedAtMs: Date.now() - 3600_000,
      priceUsd: 0.01,
      priceSol: 0.00005,
      liquidityUsd: 50_000,
      volume24hUsd: 100_000,
      fdvUsd: 500_000,
      txCount24h: 400,
      buys24h: 250,
      sells24h: 150,
      uniqueTraders24h: 200,
      priceChange1hPct: 3,
      priceChange24hPct: 5,
      rawUpdatedAtMs: Date.now(),
    };

    const explanation: ExplanationRecord = {
      mint: token.mint,
      symbol: token.symbol,
      tokenClass: 'early_stage',
      qualityScore: 80,
      tradeScore: 76,
      combinedScore: 78,
      sizeMultiplier: 0.7,
      decision: 'BUY',
      reasons: [],
      warnings: [],
      qualityBreakdown: {},
      tradeBreakdown: {},
      evaluatedAtMs: Date.now(),
    };

    const quote: JupiterQuoteResponse = {
      inputMint: WSOL_MINT,
      inAmount: '50000000',
      outputMint: token.mint,
      outAmount: '1000000000',
      slippageBps: 150,
      priceImpactPct: '0.003',
      routePlan: [],
    };

    const firstBuy = await engine.executeLiveBuy({
      token,
      solAmount: 0.05,
      solPriceUsd: 200,
      settings: DEFAULT_SETTINGS,
      explanation,
      decimals: 6,
      quote,
      confirmationWaitMs: 10,
    });

    assert.equal(firstBuy.ok, true);
    assert.ok(firstBuy.position);
    assert.equal(firstBuy.position.status, 'OPEN');
    assert.equal(firstBuy.position.quantity, 1234.5);
    assert.equal(db.getPositions('live', false).length, 1);

    // Attempt second buy of same mint -> MUST be blocked
    const secondBuy = await engine.executeLiveBuy({
      token,
      solAmount: 0.05,
      solPriceUsd: 200,
      settings: DEFAULT_SETTINGS,
      explanation,
      decimals: 6,
      quote,
      confirmationWaitMs: 10,
    });
    assert.equal(secondBuy.ok, false);
    assert.equal(db.getPositions('live', false).length, 1);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('balance: one empty RPC read does not clear a position (requires 3 consecutive zero reads from 2 RPCs + tx)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-bal-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  const kp = await Keypair.generate();
  const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
  await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));

  try {
    let agreedReturn = { agreed: true, balanceUi: 0 as number | null, readings: [0, 0] };
    const mockRpcPool = {
      getAgreedTokenBalanceUi: async () => agreedReturn,
    } as unknown as SolanaRpcPool;

    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => 'sig',
      pollConfirmation: async () => ({ status: 'confirmed' }),
      reconcileParsedSwapSolDelta: async () => ({ found: false, solDeltaLamports: 0, feeLamports: 5000 }),
      findRecentSellSignature: async () => null, // No sell tx found
    };

    const engine = new LiveExecutionEngine(
      db,
      signer,
      mockRpcPool,
      {} as JupiterProvider,
      () => undefined,
      mockAdapter
    );

    const pos: PositionRecord = {
      id: 'live_pos_bal',
      mode: 'live',
      mint: 'MintBalCheck1111111111111111111111111111111',
      symbol: 'BAL',
      name: 'Balance Check',
      source: 'dexscreener',
      dex: 'raydium',
      tokenClass: 'early_stage',
      status: 'OPEN',
      openedAtMs: Date.now() - 60_000,
      updatedAtMs: Date.now(),
      tokenAgeAtEntryMin: 90,
      decimals: 6,
      quantity: 100,
      entryPriceUsd: 0.1,
      entryPriceSol: 0.0005,
      currentPriceUsd: 0.1,
      currentPriceSol: 0.0005,
      breakEvenPriceUsd: 0.102,
      breakEvenPriceSol: 0.00051,
      entryLiquidityUsd: 60_000,
      currentLiquidityUsd: 60_000,
      solIn: 0.05,
      entryFeesSol: 0.0002,
      entryRentSol: 0.00203928,
      solPriceUsdAtEntry: 200,
      peakPriceUsd: 0.1,
      peakPnlPct: 0,
      trailingFloorPct: null,
      trailingArmed: false,
      gapDownTriggered: false,
      exitParams: {
        stopLossEnabled: true,
        stopLossPct: 8,
        stopLossTiers: DEFAULT_SETTINGS.stopLossTiers,
        takeProfitPct: 18,
        trailingEnabled: true,
        trailingLadder: DEFAULT_SETTINGS.trailingLadder,
        breakEvenRecoveryEnabled: true,
        maxHoldMinutes: 240,
        maxHoldStagnationEnabled: true,
        stagnationMinGainPct: 2,
        emergencyLiquidityFloorUsd: 10000,
        emergencyLiquidityDrainPct: 40,
        emergencyMaxSellTaxPct: 15,
        roundTripCostPct: 1.5,
      },
      txBuy: 'sig_buy',
      confirmationLabel: 'confirmed',
      qualityScore: 80,
      tradeScore: 76,
      explanationJson: '{}',
      sellAttempts: 0,
      firstSellFailureAtMs: null,
      lastSellError: null,
      consecutiveZeroBalanceReads: 0,
      reviewReason: null,
      isStaleData: false,
      priceHistory: [0.1],
    };
    db.upsertPosition(pos);

    // 1st zero read -> still OPEN, consecutiveZeroBalanceReads = 1
    const after1 = await engine.verifyBalanceAndExternalSell(pos);
    assert.equal(after1.status, 'OPEN');
    assert.equal(after1.consecutiveZeroBalanceReads, 1);

    // 2nd zero read -> still OPEN, consecutiveZeroBalanceReads = 2
    const after2 = await engine.verifyBalanceAndExternalSell(after1);
    assert.equal(after2.status, 'OPEN');
    assert.equal(after2.consecutiveZeroBalanceReads, 2);

    // 3rd zero read WITHOUT matching sell tx -> NEEDS_REVIEW (never silently cleared!)
    const after3 = await engine.verifyBalanceAndExternalSell(after2);
    assert.equal(after3.status, 'NEEDS_REVIEW');

    // Also test RPC disagreement leaves position OPEN
    agreedReturn = { agreed: false, balanceUi: null, readings: [0] };
    const disagreed = await engine.verifyBalanceAndExternalSell(pos);
    assert.equal(disagreed.status, 'OPEN');
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execution: concurrent evaluateOpenPositionsTick and sellPosition calls execute only once', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-conc-sell-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));

  try {
    db.updateSettings({
      paperDelayMinSec: 0.05,
      paperDelayMaxSec: 0.05,
      paperDefaultDelaySec: 0.05,
      paperSellFailChancePct: 0,
      applyMeasuredGapToPaper: false,
    });
    const startBalance = 1.0;
    db.setModeBalanceSol('paper', startBalance);

    const mockRpcPool = {
      getHealth: () => [],
    } as unknown as SolanaRpcPool;

    const mockJupiter = {
      getLiveSolPriceUsd: async () => 200,
      getLivePricesUsd: async () => ({ MintConc111111111111111111111111111111111: 1.2 }),
      getQuote: async () => ({
        inputMint: 'MintConc111111111111111111111111111111111',
        inAmount: '1000000',
        outputMint: WSOL_MINT,
        outAmount: '60000000',
        slippageBps: 150,
        priceImpactPct: '0.002',
        routePlan: [],
      }),
    } as unknown as JupiterProvider;

    const mockDex = {
      getLiveSolPriceUsd: async () => 200,
      enrichMintsBatch: async () =>
        new Map([
          [
            'MintConc111111111111111111111111111111111',
            { priceUsd: 1.2, liquidityUsd: 120_000 },
          ],
        ]),
    } as unknown as DexScreenerProvider;

    const orchestrator = new BotOrchestrator(
      db,
      signer,
      mockRpcPool,
      mockJupiter,
      mockDex,
      {} as GeckoTerminalProvider,
      {} as RugCheckProvider,
      { start: () => undefined, stop: () => undefined } as unknown as PumpPortalWsProvider
    );

    const pos: PositionRecord = {
      id: 'paper_pos_conc_1',
      mode: 'paper',
      mint: 'MintConc111111111111111111111111111111111',
      symbol: 'CLAUDIA',
      name: 'Claudia Test',
      source: 'dexscreener',
      dex: 'raydium',
      tokenClass: 'early_stage',
      status: 'OPEN',
      openedAtMs: Date.now() - 120_000,
      updatedAtMs: Date.now() - 1_000,
      tokenAgeAtEntryMin: 120,
      decimals: 6,
      quantity: 10,
      entryPriceUsd: 1.0,
      entryPriceSol: 0.005,
      currentPriceUsd: 1.0,
      currentPriceSol: 0.005,
      breakEvenPriceUsd: 1.055,
      breakEvenPriceSol: 0.005275,
      entryLiquidityUsd: 120_000,
      currentLiquidityUsd: 120_000,
      solIn: 0.05,
      entryFeesSol: 0.00025,
      entryRentSol: 0.00203928,
      solPriceUsdAtEntry: 200,
      peakPriceUsd: 1.0,
      peakPnlPct: 0,
      trailingFloorPct: null,
      trailingArmed: false,
      gapDownTriggered: false,
      exitParams: {
        stopLossEnabled: true,
        stopLossPct: 8,
        stopLossTiers: DEFAULT_SETTINGS.stopLossTiers,
        takeProfitPct: 18,
        trailingEnabled: true,
        trailingLadder: DEFAULT_SETTINGS.trailingLadder,
        breakEvenRecoveryEnabled: true,
        maxHoldMinutes: 240,
        maxHoldStagnationEnabled: true,
        stagnationMinGainPct: 2,
        emergencyLiquidityFloorUsd: 10000,
        emergencyLiquidityDrainPct: 40,
        emergencyMaxSellTaxPct: 15,
        roundTripCostPct: 5.5,
      },
      txBuy: 'sim_buy_conc',
      confirmationLabel: 'simulated',
      qualityScore: 80,
      tradeScore: 80,
      explanationJson: '{}',
      sellAttempts: 0,
      firstSellFailureAtMs: null,
      lastSellError: null,
      consecutiveZeroBalanceReads: 0,
      reviewReason: null,
      isStaleData: false,
      priceHistory: [1.0],
    };
    db.upsertPosition(pos);

    // Fire 5 overlapping sellPosition calls AND 3 overlapping exit ticks simultaneously
    const sellPromises = [
      orchestrator.sellPosition(pos.id, 'TRAILING_STOP'),
      orchestrator.sellPosition(pos.id, 'TRAILING_STOP'),
      orchestrator.sellPosition(pos.id, 'TRAILING_STOP'),
      orchestrator.evaluateOpenPositionsTick(),
      orchestrator.evaluateOpenPositionsTick(),
      orchestrator.sellPosition(pos.id, 'MANUAL_SELL'),
    ];
    await Promise.all(sellPromises);

    const trades = db.getTrades('paper');
    assert.equal(trades.length, 1, `Expected exactly 1 trade record, found ${trades.length}`);
    const loadedPos = db.getPositionById(pos.id);
    assert.equal(loadedPos?.status, 'CLOSED');

    // Balance should be credited only once (1.0 + solOut)
    const endBalance = db.getModeBalanceSol('paper');
    assert.ok(
      Math.abs(endBalance - (startBalance + trades[0].solOut)) < 1e-6,
      `Expected balance ${startBalance + trades[0].solOut}, got ${endBalance}`
    );
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execution: hasTradedMint blocks rebuy after coin sells, 1s pricing stays fresh, and live balance checks throttle to 20s', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-rebuy-throttle-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  const kp = await Keypair.generate();
  const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
  await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));

  try {
    const mint = 'NoRebuyMint11111111111111111111111111111111';
    // Record a closed live trade -> hasTradedMint must return true and liveEngine.executeLiveBuy must block it
    db.insertTrade({
      tradeId: 'tr_rebuy_check',
      mode: 'live',
      openedAt: new Date(Date.now() - 60_000).toISOString(),
      closedAt: new Date().toISOString(),
      symbol: 'SOLD1',
      mint,
      source: 'dexscreener',
      dex: 'pumpswap',
      tokenAgeAtEntry: 15,
      entryPrice: 0.001,
      exitPrice: 0.0012,
      quantity: 100,
      solIn: 0.01,
      solOut: 0.012,
      feesSol: 0.0002,
      rentSol: 0,
      grossPnlSol: 0.002,
      pnlSol: 0.0018,
      pnlUsd: 0.135,
      pnlPct: 18,
      peakPct: 20,
      holdSeconds: 60,
      exitReason: 'TAKE_PROFIT',
      confirmed: 'confirmed',
      txBuy: 'sig_b1',
      txSell: 'sig_s1',
      solPriceUsd: 75,
      feeBreakdownJson: '{}',
      archivedSessionId: null,
    });
    assert.equal(db.hasTradedMint(mint, 'live'), true);
    assert.equal(db.hasTradedMint(mint, 'paper'), false);

    let balCalls = 0;
    const mockRpcPool = {
      getAgreedTokenBalanceUi: async () => {
        balCalls += 1;
        return { agreed: true, balanceUi: 100, readings: [100, 100] };
      },
    } as unknown as SolanaRpcPool;

    let priceTick = 1;
    const mockJupiter = {
      getLiveSolPriceUsd: async () => 75,
      getLivePricesUsd: async () => {
        priceTick += 1;
        return { [mint]: 0.001 + priceTick * 0.0001 };
      },
      getQuote: async () => null,
    } as unknown as JupiterProvider;

    const mockDex = {
      getLiveSolPriceUsd: async () => 75,
      enrichMintsBatch: async () => new Map(),
    } as unknown as DexScreenerProvider;

    const liveEngine = new LiveExecutionEngine(
      db,
      signer,
      mockRpcPool,
      mockJupiter,
      () => undefined
    );

    const blockedRebuy = await liveEngine.executeLiveBuy({
      token: {
        mint,
        symbol: 'SOLD1',
        name: 'Sold Once',
        source: 'dexscreener',
        dex: 'pumpswap',
        pairAddress: 'PairSold1',
        poolCreatedAtMs: Date.now() - 600_000,
        priceUsd: 0.001,
        priceSol: 0.001 / 75,
        liquidityUsd: 40_000,
        volume24hUsd: 80_000,
        fdvUsd: 200_000,
        txCount24h: 200,
        buys24h: 120,
        sells24h: 80,
        uniqueTraders24h: 90,
        priceChange1hPct: 5,
        priceChange24hPct: 10,
        rawUpdatedAtMs: Date.now(),
      },
      solAmount: 0.01,
      solPriceUsd: 75,
      settings: DEFAULT_SETTINGS,
      explanation: {
        mint,
        symbol: 'SOLD1',
        tokenClass: 'early_stage',
        qualityScore: 80,
        tradeScore: 80,
        combinedScore: 80,
        sizeMultiplier: 1,
        decision: 'BUY',
        reasons: [],
        warnings: [],
        qualityBreakdown: {},
        tradeBreakdown: {},
        evaluatedAtMs: Date.now(),
      },
      decimals: 6,
      quote: {
        inputMint: WSOL_MINT,
        inAmount: '10000000',
        outputMint: mint,
        outAmount: '100000000',
        slippageBps: 150,
        priceImpactPct: '0.002',
        routePlan: [],
      },
    });
    assert.equal(blockedRebuy.ok, false);
    assert.match(blockedRebuy.error || '', /already attempted or traded/i);

    // Check stopped-mode price monitor updates prices without triggering sells & live balance checks throttle to 20s
    const orchestrator = new BotOrchestrator(
      db,
      signer,
      mockRpcPool,
      mockJupiter,
      mockDex,
      {} as GeckoTerminalProvider,
      {} as RugCheckProvider,
      { start: () => undefined, stop: () => undefined } as unknown as PumpPortalWsProvider
    );

    const openPos: PositionRecord = {
      id: 'paper_stopped_mon_1',
      mode: 'paper',
      mint,
      symbol: 'SOLD1',
      name: 'Stopped Monitor',
      source: 'dexscreener',
      dex: 'pumpswap',
      tokenClass: 'early_stage',
      status: 'OPEN',
      openedAtMs: Date.now() - 30_000,
      updatedAtMs: Date.now() - 2_000,
      tokenAgeAtEntryMin: 15,
      decimals: 6,
      quantity: 100,
      entryPriceUsd: 0.001,
      entryPriceSol: 0.001 / 75,
      currentPriceUsd: 0.001,
      currentPriceSol: 0.001 / 75,
      breakEvenPriceUsd: 0.00105,
      breakEvenPriceSol: 0.00105 / 75,
      entryLiquidityUsd: 40_000,
      currentLiquidityUsd: 40_000,
      solIn: 0.01,
      entryFeesSol: 0.00016,
      entryRentSol: 0.00203928,
      solPriceUsdAtEntry: 75,
      peakPriceUsd: 0.001,
      peakPnlPct: 0,
      trailingFloorPct: null,
      trailingArmed: false,
      gapDownTriggered: false,
      exitParams: {
        stopLossEnabled: true,
        stopLossPct: 10,
        stopLossTiers: DEFAULT_SETTINGS.stopLossTiers,
        takeProfitPct: 1, // deliberately <= live price delta so stopped monitor proves it NEVER sells
        trailingEnabled: false,
        trailingLadder: [],
        breakEvenRecoveryEnabled: true,
        maxHoldMinutes: 240,
        maxHoldStagnationEnabled: false,
        stagnationMinGainPct: 2,
        emergencyLiquidityFloorUsd: 1000,
        emergencyLiquidityDrainPct: 40,
        emergencyMaxSellTaxPct: 15,
        roundTripCostPct: 1.5,
      },
      txBuy: 'sim_b_mon',
      confirmationLabel: 'simulated',
      qualityScore: 80,
      tradeScore: 80,
      explanationJson: '{}',
      sellAttempts: 0,
      firstSellFailureAtMs: null,
      lastSellError: null,
      consecutiveZeroBalanceReads: 0,
      reviewReason: null,
      isStaleData: false,
      priceHistory: [0.001],
    };
    db.upsertPosition(openPos);

    await orchestrator.refreshOpenPositionPricesTick();
    const afterStopTick1 = db.getPositionById(openPos.id)!;
    assert.equal(afterStopTick1.status, 'OPEN');
    assert.ok(afterStopTick1.currentPriceUsd > 0.001);

    await orchestrator.refreshOpenPositionPricesTick();
    const afterStopTick2 = db.getPositionById(openPos.id)!;
    assert.ok(afterStopTick2.currentPriceUsd > afterStopTick1.currentPriceUsd);

    // Check evaluateOpenPositionsTick throttles verifyBalanceAndExternalSell when in live mode
    db.upsertPosition({
      ...openPos,
      id: 'live_throttle_pos',
      mode: 'live',
      status: 'OPEN',
      confirmationLabel: 'confirmed',
      exitParams: { ...openPos.exitParams, takeProfitPct: 60 },
    });
    (orchestrator as unknown as { mode: string }).mode = 'live';
    balCalls = 0;
    await orchestrator.evaluateOpenPositionsTick();
    await orchestrator.evaluateOpenPositionsTick();
    await orchestrator.evaluateOpenPositionsTick();
    assert.equal(balCalls, 1, `Expected verifyBalanceAndExternalSell to run once per 20s window, got ${balCalls}`);

    orchestrator.shutdown();
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
