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
