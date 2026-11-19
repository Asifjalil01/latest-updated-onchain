import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { LiveExecutionEngine, type LiveTxAdapter } from '../engine/liveEngine';
import { calculatePositionSize } from '../engine/sizing';
import { BotDatabase } from '../store/db';
import { ServerSignerManager } from '../security/signer';
import type { SolanaRpcPool } from '../providers/rpcPool';
import { JupiterProvider, WSOL_MINT, type JupiterQuoteResponse } from '../providers/jupiter';
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
      exitParams: { ...openPos.exitParams, takeProfitPct: 100 },
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

test('execution: Jupiter 400 route errors do not trip circuit breaker and relaxed fallback + on-chain rawAmount fix live sells', async () => {
  const origFetch = globalThis.fetch;
  const seenUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seenUrls.push(url);
    if (url.includes('BadMint')) {
      return new Response(JSON.stringify({ error: 'Could not find any route' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!url.includes('restrictIntermediateTokens=false')) {
      return new Response(JSON.stringify({ error: 'Route not found without intermediate' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        inputMint: 'GoodToken111111111111111111111111111111111',
        inAmount: '99500000000',
        outputMint: WSOL_MINT,
        outAmount: '25000000',
        slippageBps: 500,
        priceImpactPct: '0.01',
        routePlan: [{ percent: 100, swapInfo: { label: 'PumpSwap' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const jup = new JupiterProvider();
    // Simulate 6 HTTP 400 route errors on bad tokens: circuit breaker MUST remain CLOSED
    for (let i = 0; i < 6; i += 1) {
      const bad = await jup.getQuote({
        inputMint: `BadMint${i}1111111111111111111111111111111111`,
        outputMint: WSOL_MINT,
        amountRaw: '1000000',
        slippageBps: 500,
        allowRelaxFallback: false,
      });
      assert.equal(bad, null);
    }
    const swapHealth = jup.getHealth().find((h) => h.source === 'jupiter_swap');
    assert.equal(swapHealth?.circuitState, 'CLOSED');

    // Now test live sell using real on-chain rawAmount (decimals=9 while position recorded decimals=6) + relaxed fallback
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-rawsell-'));
    const db = new BotDatabase(path.join(tmpDir, 'test.db'));
    const kp = await Keypair.generate();
    const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
    await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));
    try {
      const msg = new TransactionMessage({
        payerKey: kp.publicKey,
        recentBlockhash: '11111111111111111111111111111111' as unknown as ConstructorParameters<
          typeof TransactionMessage
        >[0]['recentBlockhash'],
        instructions: [],
      }).compileToV0Message();
      const dummySwapB64 = Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');

      // Override fetch temporarily for POST /swap as well
      const prevMockFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/swap/v1/swap')) {
          return new Response(JSON.stringify({ swapTransaction: dummySwapB64 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return prevMockFetch(input, init);
      }) as typeof fetch;

      const mockRpcPool = {
        getAgreedTokenBalanceUi: async () => ({
          agreed: true,
          balanceUi: 99.5,
          readings: [99.5, 99.5],
          decimals: 9,
          rawAmount: '99500000000',
        }),
      } as unknown as SolanaRpcPool;

      const mockAdapter: LiveTxAdapter = {
        sendSignedTransaction: async () => 'sig_sell_1',
        pollConfirmation: async () => ({ status: 'confirmed' }),
        reconcileParsedSwapSolDelta: async () => ({
          found: true,
          solDeltaLamports: 25_000_000 - 5000,
          feeLamports: 5000,
          closedAtaRentLamports: 0,
        }),
        findRecentSellSignature: async () => null,
      };

      const engine = new LiveExecutionEngine(db, signer, mockRpcPool, jup, () => undefined, mockAdapter);
      const pos: PositionRecord = {
        id: 'live_coin_1',
        mode: 'live',
        mint: 'GoodToken111111111111111111111111111111111',
        symbol: '1',
        name: 'Coin 1',
        source: 'dexscreener',
        dex: 'pumpswap',
        tokenClass: 'early_stage',
        status: 'OPEN',
        openedAtMs: Date.now() - 60_000,
        updatedAtMs: Date.now(),
        tokenAgeAtEntryMin: 15,
        decimals: 6, // intentionally stale vs on-chain 9 decimals
        quantity: 100, // intentionally slightly > actual 99.5 on-chain
        entryPriceUsd: 0.001,
        entryPriceSol: 0.001 / 75,
        currentPriceUsd: 0.0012,
        currentPriceSol: 0.0012 / 75,
        breakEvenPriceUsd: 0.00105,
        breakEvenPriceSol: 0.00105 / 75,
        entryLiquidityUsd: 25_000,
        currentLiquidityUsd: 25_000,
        solIn: 0.015,
        entryFeesSol: 0.0001,
        entryRentSol: 0,
        solPriceUsdAtEntry: 75,
        peakPriceUsd: 0.0012,
        peakPnlPct: 20,
        trailingFloorPct: null,
        trailingArmed: false,
        gapDownTriggered: false,
        exitParams: {
          stopLossEnabled: true,
          stopLossPct: 10,
          stopLossTiers: DEFAULT_SETTINGS.stopLossTiers,
          takeProfitPct: 50,
          trailingEnabled: false,
          trailingLadder: [],
          breakEvenRecoveryEnabled: false,
          maxHoldMinutes: 240,
          maxHoldStagnationEnabled: false,
          stagnationMinGainPct: 2,
          emergencyLiquidityFloorUsd: 1000,
          emergencyLiquidityDrainPct: 40,
          emergencyMaxSellTaxPct: 15,
          roundTripCostPct: 1.5,
        },
        txBuy: 'sig_buy_1',
        confirmationLabel: 'confirmed',
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
      db.upsertPosition(pos);

      const res = await engine.executeLiveSell({
        position: pos,
        exitReason: 'MANUAL_SELL',
        solPriceUsd: 75,
        settings: DEFAULT_SETTINGS,
        isEmergency: false,
      });
      assert.equal(res.ok, true, `Expected live sell to succeed via exact rawAmount + relaxed fallback, got error: ${res.error}`);
      assert.ok(seenUrls.some((u) => u.includes('amount=99500000000') && u.includes('restrictIntermediateTokens=false')));
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('execution: direct Live switch/start without ENABLE LIVE or gas reserve recovers RPCs and alerts SOL+$ when wallet empty on buy', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-live-nobal-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  const kp = await Keypair.generate();
  const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
  await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));

  try {
    let probeCount = 0;
    let rpcsHealthy = false;
    const mockRpcPool = {
      getHealthSnapshot: () => [
        { url: 'https://rpc1', label: 'RPC1', healthy: rpcsHealthy, latencyMs: 20, slot: 1, errorCount: 0, lastCheckedMs: 1, lastError: null },
        { url: 'https://rpc2', label: 'RPC2', healthy: rpcsHealthy, latencyMs: 25, slot: 1, errorCount: 0, lastCheckedMs: 1, lastError: null },
      ],
      checkAllEndpoints: async () => {
        probeCount += 1;
        rpcsHealthy = true;
        return [
          { url: 'https://rpc1', label: 'RPC1', healthy: true, latencyMs: 20, slot: 100, errorCount: 0, lastCheckedMs: Date.now(), lastError: null },
          { url: 'https://rpc2', label: 'RPC2', healthy: true, latencyMs: 25, slot: 100, errorCount: 0, lastCheckedMs: Date.now(), lastError: null },
        ];
      },
      getAgreedBalanceSol: async () => ({ agreed: true, balanceSol: 0, readings: [0, 0] }),
      getAgreedTokenBalanceUi: async () => ({ agreed: true, balanceUi: 0, readings: [0, 0] }),
    } as unknown as SolanaRpcPool;

    const mockJupiter = {
      getLiveSolPriceUsd: async () => 75,
      getLivePricesUsd: async () => ({}),
      getHealth: () => [],
    } as unknown as JupiterProvider;

    const mockDex = {
      getLiveSolPriceUsd: async () => 75,
      discoverMints: async () => ({ mints: [], candidates: [] }),
      enrichMintsBatch: async () => new Map(),
      getHealth: () => ({ source: 'dexscreener', itemsCount: 0, lastOkMs: null, errorCount: 0, lastError: null, recentErrors: [], rateLimitedUntilMs: null, circuitState: 'CLOSED' }),
    } as unknown as DexScreenerProvider;

    const mockGecko = {
      discoverPools: async () => [],
      getHealth: () => ({ source: 'geckoterminal', itemsCount: 0, lastOkMs: null, errorCount: 0, lastError: null, recentErrors: [], rateLimitedUntilMs: null, circuitState: 'CLOSED' }),
    } as unknown as GeckoTerminalProvider;

    const orch = new BotOrchestrator(
      db,
      signer,
      mockRpcPool,
      mockJupiter,
      mockDex,
      mockGecko,
      { getHealth: () => ({ source: 'rugcheck', itemsCount: 0, lastOkMs: null, errorCount: 0, lastError: null, recentErrors: [], rateLimitedUntilMs: null, circuitState: 'CLOSED' }) } as unknown as RugCheckProvider,
      { start: () => undefined, stop: () => undefined, drainRecentMints: () => [], getHealth: () => ({ source: 'pumpportal', itemsCount: 0, lastOkMs: null, errorCount: 0, lastError: null, recentErrors: [], rateLimitedUntilMs: null, circuitState: 'CLOSED' }) } as unknown as PumpPortalWsProvider
    );

    // 1. Live mode switch succeeds cleanly WITHOUT calling confirmLiveMode('ENABLE LIVE') and with 0.0000 SOL
    const sw = await orch.switchMode('live', true);
    assert.equal(sw.ok, true);
    assert.equal(orch.getStatusSnapshot().mode, 'live');
    assert.ok(probeCount >= 1, 'Expected refreshWalletDiagnostics to auto-recover RPC health');

    // 2. Live start succeeds even with 0.0000 SOL (no trade size + gas reserve block)
    const st = await orch.start();
    assert.equal(st.ok, true, `Expected Live start to succeed at 0 SOL, got: ${st.error}`);
    orch.stop();

    // 3. Attempting to size/buy a coin at 0 SOL reports explicit SOL + $ alert
    const sizing = calculatePositionSize({
      settings: { ...DEFAULT_SETTINGS, tradeSizeSol: 0.02 },
      availableBalanceSol: 0,
      currentExposureSol: 0,
      openPositionsCount: 0,
      dailyRealizedPnlSol: 0,
      poolLiquidityUsd: 50_000,
      solPriceUsd: 75,
      tokenClassMultiplier: 1,
    });
    assert.equal(sizing.approved, false);
    assert.equal(sizing.cappedBy, 'INSUFFICIENT_WALLET_SOL');
    assert.match(sizing.reason || '', /no SOL.*0\.0000 SOL.*\$0\.00/i);

    // 4. Direct liveEngine.executeLiveBuy at 0 SOL also returns explicit SOL + $ error
    const liveEngine = new LiveExecutionEngine(db, signer, mockRpcPool, mockJupiter, () => undefined);
    const buyFail = await liveEngine.executeLiveBuy({
      token: {
        mint: 'EmptyWalletMint111111111111111111111111111',
        symbol: 'TEST',
        name: 'Test',
        source: 'dexscreener',
        dex: 'raydium',
        pairAddress: 'P1',
        poolCreatedAtMs: Date.now() - 3600_000,
        priceUsd: 0.01,
        priceSol: 0.01 / 75,
        liquidityUsd: 50_000,
        volume24hUsd: 80_000,
        fdvUsd: 200_000,
        txCount24h: 200,
        buys24h: 120,
        sells24h: 80,
        uniqueTraders24h: 100,
        priceChange1hPct: 4,
        priceChange24hPct: 8,
        rawUpdatedAtMs: Date.now(),
      },
      solAmount: 0.02,
      solPriceUsd: 75,
      settings: DEFAULT_SETTINGS,
      explanation: {
        mint: 'EmptyWalletMint111111111111111111111111111',
        symbol: 'TEST',
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
        inAmount: '20000000',
        outputMint: 'EmptyWalletMint111111111111111111111111111',
        outAmount: '1000000',
        slippageBps: 150,
        priceImpactPct: '0.001',
        routePlan: [],
      },
    });
    assert.equal(buyFail.ok, false);
    assert.match(buyFail.error || '', /no enough SOL \(\$0\.00\) in the wallet to trade TEST/i);

    orch.shutdown();
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
