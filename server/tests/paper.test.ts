import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { executeRealisticPaperBuy, executeRealisticPaperSell } from '../engine/paperEngine';
import type { JupiterQuoteResponse } from '../providers/jupiter';
import { WSOL_MINT } from '../providers/jupiter';
import type { CandidateToken, ExplanationRecord } from '../types';

function makeToken(nowMs: number): CandidateToken {
  return {
    mint: 'PaperMint1111111111111111111111111111111111',
    symbol: 'PAPR',
    name: 'Paper Coin',
    source: 'geckoterminal',
    dex: 'raydium',
    pairAddress: 'PairPaper',
    poolCreatedAtMs: nowMs - 2 * 3600_000, // 2h old (< 24h so competition penalty applies)
    priceUsd: 0.1,
    priceSol: 0.0005,
    liquidityUsd: 60_000,
    volume24hUsd: 150_000,
    fdvUsd: 600_000,
    txCount24h: 500,
    buys24h: 320,
    sells24h: 180,
    uniqueTraders24h: 250,
    priceChange1hPct: 5,
    priceChange24hPct: 12,
    tokenDecimals: 6,
    rawUpdatedAtMs: nowMs,
  };
}

function makeExplanation(token: CandidateToken): ExplanationRecord {
  return {
    mint: token.mint,
    symbol: token.symbol,
    tokenClass: 'meme',
    qualityScore: 78,
    tradeScore: 75,
    combinedScore: 76,
    sizeMultiplier: 0.5,
    decision: 'BUY',
    reasons: [],
    warnings: [],
    qualityBreakdown: {},
    tradeBreakdown: {},
    evaluatedAtMs: Date.now(),
  };
}

test('paper realism: uses Jupiter quote + worst price inside delay window, and lower P&L than naive quote fill', async () => {
  const now = 1_760_000_000_000;
  const token = makeToken(now);
  const solPriceUsd = 200;
  const solAmount = 0.05; // $10 -> quoted 100 tokens @ $0.10

  const initialQuote: JupiterQuoteResponse = {
    inputMint: WSOL_MINT,
    inAmount: String(solAmount * 1e9),
    outputMint: token.mint,
    outAmount: String(100 * 1e6),
    slippageBps: 150,
    priceImpactPct: '0.004',
    routePlan: [{ swapInfo: { label: 'Raydium' }, percent: 100 }],
  };

  let sampleIdx = 0;
  const buyWindowPrices = [0.102, 0.106, 0.104]; // worst is 0.106!

  const buyRes = await executeRealisticPaperBuy({
    mode: 'paper',
    token,
    solAmount,
    solPriceUsd,
    settings: { ...DEFAULT_SETTINGS, paperBuyFailChancePct: 0 },
    explanation: makeExplanation(token),
    initialQuote,
    measuredLiveGapPct: 0,
    nowMs: now,
    hooks: {
      random: () => 0.5,
      sleepMs: async () => undefined,
      sampleBuyWindow: async () => {
        const p = buyWindowPrices[sampleIdx % buyWindowPrices.length];
        sampleIdx += 1;
        return { priceUsd: p, liquidityUsd: 60_000, quote: null };
      },
    },
  });

  assert.equal(buyRes.executed, true);
  assert.ok(buyRes.position);
  assert.equal(buyRes.quotedPriceUsd, 0.1);
  assert.equal(buyRes.worstWindowPriceUsd, 0.106);
  // Competition penalty (+1% for <24h old coin) makes effective fill higher than 0.106
  assert.ok(buyRes.effectiveFillPriceUsd > 0.106);

  // Now simulate selling at market $0.12 with worst exit window price $0.114
  const sellWindowPrices = [0.119, 0.114, 0.117];
  let sellIdx = 0;
  const sellRes = await executeRealisticPaperSell({
    position: { ...buyRes.position, currentPriceUsd: 0.12 },
    exitReason: 'TAKE_PROFIT',
    solPriceUsd,
    settings: { ...DEFAULT_SETTINGS, paperSellFailChancePct: 0 },
    measuredLiveGapPct: 0,
    nowMs: now + 60_000,
    hooks: {
      random: () => 0.5,
      sleepMs: async () => undefined,
      sampleSellWindow: async () => {
        const p = sellWindowPrices[sellIdx % sellWindowPrices.length];
        sellIdx += 1;
        return {
          priceUsd: p,
          liquidityUsd: 60_000,
          quote: {
            inputMint: token.mint,
            inAmount: '100000000',
            outputMint: WSOL_MINT,
            outAmount: String(Math.floor(((buyRes.position!.quantity * p) / solPriceUsd) * 1e9)),
            slippageBps: 150,
            priceImpactPct: '0.004',
            routePlan: [{ swapInfo: { label: 'Raydium' }, percent: 100 }],
          },
        };
      },
    },
  });

  assert.equal(sellRes.executed, true);
  assert.ok(sellRes.trade);
  assert.equal(sellRes.trade.confirmed, 'simulated');

  // Naive fill at quoted $0.10 -> $0.12 would be +20% (+0.01 SOL)
  const naivePnlSol = solAmount * (0.12 / 0.1 - 1);
  assert.ok(
    sellRes.trade.pnlSol < naivePnlSol,
    `Realistic paper P&L (${sellRes.trade.pnlSol}) must be lower than naive quoted P&L (${naivePnlSol})`
  );
});

test('paper realism: liquidity drop below floor during delay cancels buy', async () => {
  const now = 1_760_000_000_000;
  const token = makeToken(now);
  const initialQuote: JupiterQuoteResponse = {
    inputMint: WSOL_MINT,
    inAmount: '50000000',
    outputMint: token.mint,
    outAmount: '100000000',
    slippageBps: 150,
    priceImpactPct: '0.004',
    routePlan: [],
  };

  const buyRes = await executeRealisticPaperBuy({
    mode: 'paper',
    token,
    solAmount: 0.05,
    solPriceUsd: 200,
    settings: { ...DEFAULT_SETTINGS, paperBuyFailChancePct: 0 },
    explanation: makeExplanation(token),
    initialQuote,
    measuredLiveGapPct: 0,
    nowMs: now,
    hooks: {
      random: () => 0.5,
      sleepMs: async () => undefined,
      sampleBuyWindow: async () => ({
        priceUsd: 0.101,
        liquidityUsd: 9_500, // dropped below $25,000 floor!
        quote: null,
      }),
    },
  });

  assert.equal(buyRes.executed, false);
  assert.ok(buyRes.cancelledReason?.toLowerCase().includes('liquidity dropped'));
});

test('paper realism: paper sell can fail with no route and leave position open', async () => {
  const now = 1_760_000_000_000;
  const token = makeToken(now);
  const initialQuote: JupiterQuoteResponse = {
    inputMint: WSOL_MINT,
    inAmount: '50000000',
    outputMint: token.mint,
    outAmount: '100000000',
    slippageBps: 150,
    priceImpactPct: '0.004',
    routePlan: [],
  };

  const buyRes = await executeRealisticPaperBuy({
    mode: 'paper',
    token,
    solAmount: 0.05,
    solPriceUsd: 200,
    settings: { ...DEFAULT_SETTINGS, paperBuyFailChancePct: 0, paperDelayMinSec: 0, paperDelayMaxSec: 0 },
    explanation: makeExplanation(token),
    initialQuote,
    measuredLiveGapPct: 0,
    nowMs: now,
    hooks: { random: () => 0.5, sleepMs: async () => undefined },
  });
  assert.ok(buyRes.position);

  const sellRes = await executeRealisticPaperSell({
    position: buyRes.position,
    exitReason: 'STOP_LOSS',
    solPriceUsd: 200,
    settings: { ...DEFAULT_SETTINGS, paperSellFailChancePct: 100 },
    measuredLiveGapPct: 0,
    hooks: { random: () => 0.1, sleepMs: async () => undefined },
  });

  assert.equal(sellRes.executed, false);
  assert.ok(sellRes.failureReason?.toLowerCase().includes('no route'));
});
