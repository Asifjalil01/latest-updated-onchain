import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { runDeterministicReplay, type ReplayCandidateSnapshot } from '../engine/replay';

test('replay: deterministic backtest harness filters bad coins and trades clean coins', async () => {
  const baseTime = 1_760_000_000_000;

  const snapshots: ReplayCandidateSnapshot[] = [
    // Candidate 1: Too young (60s) -> rejected in HARD_FILTER
    {
      token: {
        mint: 'YoungMint1111111111111111111111111111111111',
        symbol: 'YNG',
        name: 'Young',
        source: 'pumpportal',
        dex: 'pump',
        pairAddress: 'PairY',
        poolCreatedAtMs: baseTime - 60_000,
        priceUsd: 0.01,
        priceSol: 0.00005,
        liquidityUsd: 40_000,
        volume24hUsd: 80_000,
        fdvUsd: 300_000,
        txCount24h: 300,
        buys24h: 180,
        sells24h: 120,
        uniqueTraders24h: 150,
        priceChange1hPct: 5,
        priceChange24hPct: 10,
        rawUpdatedAtMs: baseTime,
      },
      solPriceUsd: 200,
      plannedBuyImpactPct: 0.3,
      security: {
        onChain: null,
        rugCheck: null,
        sellRouteExists: false,
        sellQuoteImpactPct: null,
      },
      pricePathUsd: [],
    },
    // Candidate 2: Mature, clean, hits +19% take-profit
    {
      token: {
        mint: 'GoodMint11111111111111111111111111111111111',
        symbol: 'GOOD',
        name: 'Good Mature',
        source: 'dexscreener',
        dex: 'raydium',
        pairAddress: 'PairG',
        poolCreatedAtMs: baseTime - 5 * 3600_000,
        priceUsd: 1.0,
        priceSol: 0.005,
        liquidityUsd: 150_000,
        volume24hUsd: 420_000,
        fdvUsd: 2_500_000,
        txCount24h: 1200,
        buys24h: 760,
        sells24h: 440,
        uniqueTraders24h: 550,
        priceChange1hPct: 6.5,
        priceChange24hPct: 18.0,
        tokenDecimals: 6,
        rawUpdatedAtMs: baseTime,
      },
      solPriceUsd: 200,
      plannedBuyImpactPct: 0.25,
      security: {
        onChain: {
          mint: 'GoodMint11111111111111111111111111111111111',
          decimals: 6,
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          isToken2022: false,
          mintAuthorityRevoked: true,
          freezeAuthorityRevoked: true,
          disallowedExtensions: [],
          supplyUi: 10_000_000,
          top10HoldersPct: 19,
          singleMaxHolderPct: 4.5,
          holders: [],
        },
        rugCheck: {
          available: true,
          normalizedRiskScore: 8,
          rugged: false,
          lpLockedOrBurnedPct: 98,
          riskNames: [],
          criticalRisks: [],
          creator: 'CleanCreator11111111111111111111111111111',
        },
        sellRouteExists: true,
        sellQuoteImpactPct: 0.4,
      },
      pricePathUsd: [
        { offsetSeconds: 30, priceUsd: 1.04, liquidityUsd: 152_000 },
        { offsetSeconds: 90, priceUsd: 1.12, liquidityUsd: 158_000 },
        { offsetSeconds: 150, priceUsd: 1.21, liquidityUsd: 165_000 },
      ],
    },
  ];

  const report = await runDeterministicReplay({
    snapshots,
    settings: DEFAULT_SETTINGS,
    startingBalanceSol: 10,
    baseTimeMs: baseTime,
  });

  assert.equal(report.totalCandidates, 2);
  assert.equal(report.rejectedCount, 1);
  assert.equal(report.passedPipeline, 1);
  assert.equal(report.trades.length, 1);
  assert.equal(report.trades[0].exitReason, 'TAKE_PROFIT');
  assert.ok(report.analytics.netPnlSol > 0);
});
