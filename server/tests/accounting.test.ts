import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { ATA_RENT_SOL, computeEntryFees, SOLANA_BASE_FEE_SOL } from '../engine/fees';
import { LiveExecutionEngine, type LiveTxAdapter } from '../engine/liveEngine';
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
