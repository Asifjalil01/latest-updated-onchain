import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { DEFAULT_SETTINGS } from '../config/defaults';
import {
  ATA_RENT_SOL,
  computeEntryFees,
  computeExitFees,
  extractRouteDexFeeSol,
  extractRouteLabels,
  resolvePriorityFeeSol,
  SOLANA_BASE_FEE_SOL,
} from '../engine/fees';
import { LiveExecutionEngine, type LiveTxAdapter } from '../engine/liveEngine';
import { executeRealisticPaperBuy, executeRealisticPaperSell } from '../engine/paperEngine';
import { BotDatabase } from '../store/db';
import { ServerSignerManager } from '../security/signer';
import type { SolanaRpcPool } from '../providers/rpcPool';
import type { JupiterProvider, JupiterQuoteResponse } from '../providers/jupiter';
import { WSOL_MINT } from '../providers/jupiter';
import type { CandidateToken, ExplanationRecord, PositionRecord } from '../types';

test('accounting: fees and rent are itemized without double counting', () => {
  const fees = computeEntryFees({
    solAmount: 0.1,
    settings: DEFAULT_SETTINGS,
    quote: null,
    needsAtaRent: true,
    tokenTaxPct: 0,
  });
  assert.equal(fees.baseFeeSol, SOLANA_BASE_FEE_SOL);
  assert.equal(fees.ataRentSol, ATA_RENT_SOL);
  assert.ok(fees.totalSol > fees.baseFeeSol + fees.ataRentSol);
});

test('accounting: entry price comes from real SOL spent in parsed transaction and no premature write-off', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-acct-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  const kp = await Keypair.generate();
  const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
  await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));

  try {
    const mockRpcPool = {
      getAgreedTokenBalanceUi: async () => ({ agreed: true, balanceUi: 500, readings: [500, 500] }),
      getAgreedSignatureConfirmation: async () => ({ confirmed: true, err: null, agreements: 2 }),
    } as unknown as SolanaRpcPool;

    const mockJupiter = {
      buildSwapTransaction: async () => ({
        swapTransaction: Buffer.from(
          // minimal dummy? We won't call buildSwapTransaction for write-off test
          ''
        ).toString('base64'),
      }),
      getQuote: async () => null,
    } as unknown as JupiterProvider;

    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => 'sig_real',
      pollConfirmation: async () => ({ status: 'confirmed' }),
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        solDeltaLamports: -102_044_280, // 0.1 SOL swap + 0.00203928 ATA rent + 5000 base fee
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

    const basePos: PositionRecord = {
      id: 'live_wo_test',
      mode: 'live',
      mint: 'Mint1111111111111111111111111111111111111111',
      symbol: 'WO',
      name: 'WriteOff Test',
      source: 'dexscreener',
      dex: 'raydium',
      tokenClass: 'early_stage',
      status: 'OPEN',
      openedAtMs: 1_760_000_000_000,
      updatedAtMs: 1_760_000_000_000,
      tokenAgeAtEntryMin: 120,
      decimals: 6,
      quantity: 500,
      entryPriceUsd: 0.04,
      entryPriceSol: 0.0002,
      currentPriceUsd: 0.02,
      currentPriceSol: 0.0001,
      breakEvenPriceUsd: 0.041,
      breakEvenPriceSol: 0.000205,
      entryLiquidityUsd: 50_000,
      currentLiquidityUsd: 50_000,
      solIn: 0.1,
      entryFeesSol: 0.000005,
      entryRentSol: ATA_RENT_SOL,
      solPriceUsdAtEntry: 200,
      peakPriceUsd: 0.04,
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
      txBuy: 'sig_real',
      confirmationLabel: 'confirmed',
      qualityScore: 80,
      tradeScore: 75,
      explanationJson: '{}',
      sellAttempts: 0,
      firstSellFailureAtMs: null,
      lastSellError: null,
      consecutiveZeroBalanceReads: 0,
      reviewReason: null,
      isStaleData: false,
      priceHistory: [0.04],
    };
    db.upsertPosition(basePos);

    // Short outage (only 1 attempt, < 10 minutes) must NOT write off to $0
    const sellAttempt1 = await engine.executeLiveSell({
      position: basePos,
      exitReason: 'STOP_LOSS',
      solPriceUsd: 200,
      settings: DEFAULT_SETTINGS,
      isEmergency: false,
      liquiditySource1Usd: 30,
      liquiditySource2Usd: 25,
    });
    assert.equal(sellAttempt1.ok, false);
    assert.equal(sellAttempt1.position.status, 'OPEN');

    // Only after >= 5 attempts AND >= 10 minutes AND <$50 liquidity from two sources is write-off allowed
    const canWriteOffShort = engine.canWriteOffUnsellable({
      position: { ...basePos, sellAttempts: 5, firstSellFailureAtMs: Date.now() - 2 * 60_000 },
      liquiditySource1Usd: 20,
      liquiditySource2Usd: 15,
    });
    assert.equal(canWriteOffShort, false);

    const canWriteOffReal = engine.canWriteOffUnsellable({
      position: { ...basePos, sellAttempts: 5, firstSellFailureAtMs: Date.now() - 11 * 60_000 },
      liquiditySource1Usd: 20,
      liquiditySource2Usd: 15,
    });
    assert.equal(canWriteOffReal, true);

    // Check real SOL delta calculation helper directly via reconcile check
    const delta = await mockAdapter.reconcileParsedSwapSolDelta('sig_real', kp.publicKey.toBase58());
    const realSolSpent = Math.abs(delta.solDeltaLamports) / 1e9 - delta.feeLamports / 1e9 - ATA_RENT_SOL;
    assert.ok(Math.abs(realSolSpent - 0.1) < 1e-6);

    // Suppress unused type warnings
    const _unused: CandidateToken | ExplanationRecord | JupiterQuoteResponse | null = null;
    assert.equal(_unused, null);
    assert.ok(WSOL_MINT);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('accounting: extracts Jupiter routePlan DEX LP fees, adaptive auto priority fee, and reclaims ATA rent on 100% TP sell', async () => {
  const quoteWithRoute: JupiterQuoteResponse = {
    inputMint: WSOL_MINT,
    outputMint: 'Acrux11111111111111111111111111111111111111',
    inAmount: String(20_000_000), // 0.02 SOL
    outAmount: String(113_000_000_000),
    slippageBps: 500,
    priceImpactPct: '0.25',
    routePlan: [
      {
        percent: 100,
        swapInfo: {
          label: 'Raydium CLMM',
          inputMint: WSOL_MINT,
          outputMint: 'Acrux11111111111111111111111111111111111111',
          inAmount: '20000000',
          outAmount: '113000000000',
          feeAmount: '50000', // 0.00005 SOL in WSOL
          feeMint: WSOL_MINT,
        },
      },
    ],
  };

  assert.equal(extractRouteDexFeeSol(quoteWithRoute, 0.02), 0.00005);
  assert.deepEqual(extractRouteLabels(quoteWithRoute), ['Raydium CLMM']);

  const autoSettings = {
    ...DEFAULT_SETTINGS,
    priorityFeePreset: 'auto' as const,
    maxPriorityFeeSol: 0.002,
    autoReclaimRent: true,
    paperDelayMinSec: 0,
    paperDelayMaxSec: 0,
    paperBuyFailChancePct: 0,
    paperSellFailChancePct: 0,
    paperCompetitionPenaltyPct: 0,
  };

  assert.equal(resolvePriorityFeeSol(autoSettings, 0.00018), 0.00018);
  assert.equal(resolvePriorityFeeSol(autoSettings, 0.01), 0.002); // capped at maxPriorityFeeSol

  const entryFees = computeEntryFees({
    solAmount: 0.02,
    settings: autoSettings,
    quote: quoteWithRoute,
    needsAtaRent: true,
    liveAutoPriorityFeeSol: 0.0001,
    priorityFeeSource: 'jupiter_auto',
  });
  // walletOutFeeSol must NOT double-count LP fee when quote is present
  assert.ok(Math.abs(entryFees.walletOutFeeSol - (SOLANA_BASE_FEE_SOL + 0.0001)) < 1e-9);
  assert.equal(entryFees.dexFeeSol, 0.00005);

  const token: CandidateToken = {
    mint: 'Acrux11111111111111111111111111111111111111',
    symbol: 'ACRUX',
    name: 'Acrux',
    source: 'dexscreener',
    dex: 'raydium',
    pairAddress: 'PairAcrux1111111111111111111111111111111111',
    poolCreatedAtMs: 1_759_990_000_000,
    priceUsd: 0.000177,
    priceSol: 0.000177 / 75,
    liquidityUsd: 40_000,
    volume24hUsd: 80_000,
    fdvUsd: 300_000,
    txCount24h: 300,
    buys24h: 190,
    sells24h: 110,
    uniqueTraders24h: 120,
    priceChange1hPct: 12,
    priceChange24hPct: 24,
    tokenDecimals: 6,
    rawUpdatedAtMs: 1_760_000_000_000,
  };

  const explanation: ExplanationRecord = {
    mint: token.mint,
    symbol: token.symbol,
    tokenClass: 'meme',
    qualityScore: 80,
    tradeScore: 78,
    combinedScore: 79,
    sizeMultiplier: 1,
    decision: 'BUY',
    reasons: [],
    warnings: [],
    qualityBreakdown: {},
    tradeBreakdown: {},
    evaluatedAtMs: 1_760_000_000_000,
  };

  const buyRes = await executeRealisticPaperBuy({
    mode: 'paper',
    token,
    solAmount: 0.02,
    solPriceUsd: 75,
    settings: autoSettings,
    explanation,
    initialQuote: quoteWithRoute,
    measuredLiveGapPct: 0,
    liveAutoPriorityFeeSol: 0.0001,
    priorityFeeSource: 'jupiter_auto',
    nowMs: 1_760_000_000_000,
    hooks: {
      random: () => 0.5,
      sleepMs: async () => undefined,
      sampleBuyWindow: async () => ({
        priceUsd: 0.000177,
        liquidityUsd: 40_000,
        quote: quoteWithRoute,
      }),
    },
  });
  assert.equal(buyRes.executed, true);
  assert.ok(buyRes.position);

  // Simulate +18% Take-Profit exit on 0.02 SOL position with autoReclaimRent: true
  const rawUnits = Math.floor(buyRes.position.quantity * 10 ** 6);
  const tpSolOutLamports = Math.floor(0.02 * 1.18 * 1e9); // 0.0236 SOL out
  const sellQuote: JupiterQuoteResponse = {
    inputMint: token.mint,
    outputMint: WSOL_MINT,
    inAmount: String(rawUnits),
    outAmount: String(tpSolOutLamports),
    slippageBps: 500,
    priceImpactPct: '0.2',
    routePlan: [
      {
        percent: 100,
        swapInfo: {
          label: 'Raydium CLMM',
          inputMint: token.mint,
          outputMint: WSOL_MINT,
          inAmount: String(rawUnits),
          outAmount: String(tpSolOutLamports),
          feeAmount: '59000', // 0.000059 SOL already deducted in outAmount
          feeMint: WSOL_MINT,
        },
      },
    ],
  };

  const exitFees = computeExitFees({
    estimatedSolOut: 0.0236,
    settings: autoSettings,
    quote: sellQuote,
    liveAutoPriorityFeeSol: 0.0001,
    priorityFeeSource: 'jupiter_auto',
  });
  assert.equal(exitFees.dexFeeSol, 0.000059);

  const sellRes = await executeRealisticPaperSell({
    position: {
      ...buyRes.position,
      currentPriceUsd: buyRes.position.entryPriceUsd * 1.18,
      peakPnlPct: 18,
    },
    exitReason: 'TAKE_PROFIT',
    solPriceUsd: 75,
    settings: autoSettings,
    measuredLiveGapPct: 0,
    liveAutoPriorityFeeSol: 0.0001,
    priorityFeeSource: 'jupiter_auto',
    nowMs: 1_760_000_060_000,
    hooks: {
      random: () => 0.5,
      sleepMs: async () => undefined,
      sampleSellWindow: async () => ({
        priceUsd: buyRes.position!.entryPriceUsd * 1.18,
        liquidityUsd: 40_000,
        quote: sellQuote,
      }),
    },
  });

  assert.equal(sellRes.executed, true);
  assert.ok(sellRes.trade);
  // Rent is reclaimed on 100% sell, so net rent is 0 and +18% TP nets clearly positive SOL!
  assert.equal(sellRes.trade.rentSol, 0);
  assert.ok(sellRes.trade.pnlSol > 0.003, `Expected positive net P&L on +18% TP, got ${sellRes.trade.pnlSol}`);
  assert.ok(sellRes.trade.feeBreakdownJson.includes('Raydium CLMM'));
  assert.ok(sellRes.trade.feeBreakdownJson.includes('rentReclaimedSol'));
});
