import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  usdToSol,
  fmtSolAmount,
  fmtSolPrice,
  fmtSignedUsdAndSol,
  fmtUnsignedUsdAndSol,
  pairTradesWithEntryAndExit,
  orderLogsNewestFirst,
} from '../../src/utils/sniperFormat.ts';
import {
  SniperManager,
  getSniperFilePaths,
  isStopFlagActive,
  clearStopSignal,
} from '../sniperManager.ts';
import { ServerSignerManager } from '../security/signer';
import type { LiveTxAdapter } from '../engine/liveEngine';
import type { BotOrchestrator } from '../engine/pipeline';
import type { JupiterQuoteResponse } from '../providers/jupiter';

function createBase64MockTx(kp: Keypair): string {
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: '11111111111111111111111111111111' as unknown as ConstructorParameters<
      typeof TransactionMessage
    >[0]['recentBlockhash'],
    instructions: [],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  return Buffer.from(vtx.serialize()).toString('base64');
}

test('usdToSol converts USD to SOL accurately when live SOL price is available', () => {
  assert.equal(usdToSol(150, 150), 1);
  assert.equal(usdToSol(75, 150), 0.5);
  assert.equal(usdToSol(50, null), null);
  assert.equal(usdToSol(50, 0), null);
});

test('fmtSignedUsdAndSol and fmtUnsignedUsdAndSol format USD and SOL side by side', () => {
  const signedPos = fmtSignedUsdAndSol(15, 150, 2);
  assert.equal(signedPos.usdText, '+$15.00');
  assert.equal(signedPos.solText, '+0.1000 SOL');

  const signedNeg = fmtSignedUsdAndSol(-7.5, 150, 2);
  assert.equal(signedNeg.usdText, '-$7.50');
  assert.equal(signedNeg.solText, '-0.0500 SOL');

  const unsigned = fmtUnsignedUsdAndSol(300, 150, 2);
  assert.equal(unsigned.usdText, '$300.00');
  assert.equal(unsigned.solText, '2.000 SOL');

  const missingSol = fmtSignedUsdAndSol(10, null, 2);
  assert.equal(missingSol.usdText, '+$10.00');
  assert.equal(missingSol.solText, '— SOL');
});

test('fmtSolAmount and fmtSolPrice handle microcap token prices', () => {
  assert.equal(fmtSolAmount(0.033333), '0.0333 SOL');
  assert.equal(fmtSolPrice(0.000015, 150), '0.0000001000 SOL');
  assert.equal(fmtSolPrice(1.5, 150), '0.010000 SOL');
});

test('pairTradesWithEntryAndExit pairs chronological BUY -> SELL rows with entryPrice, exitPrice & tx signatures', () => {
  const rows = [
    {
      time: '2026-11-19T06:06:29+00:00',
      action: 'BUY',
      symbol: 'DCTY',
      mint: 'mintDCTY',
      price: '0.00000590',
      amount: '5.0',
      pnlUsd: '',
      pnlPct: '',
      reason: 'sniper_entry',
      txSig: 'txBuyDCTY111',
    },
    {
      time: '2026-11-19T06:07:52+00:00',
      action: 'SELL',
      symbol: 'DCTY',
      mint: 'mintDCTY',
      price: '0.00000867',
      amount: '7.2086',
      pnlUsd: '2.2086',
      pnlPct: '44.17',
      reason: 'take_profit_50',
      txSig: 'txSellDCTY222',
    },
    {
      time: '2026-11-19T06:10:25+00:00',
      action: 'BUY',
      symbol: 'COCO',
      mint: 'mintCOCO',
      price: '0.00001210',
      amount: '5.0',
      pnlUsd: '',
      pnlPct: '',
      reason: 'sniper_entry',
      txSig: 'txBuyCOCO333',
    },
  ];

  const paired = pairTradesWithEntryAndExit(rows);
  assert.equal(paired.length, 3);
  // Newest first
  assert.equal(paired[0].symbol, 'COCO');
  assert.equal(paired[0].action, 'BUY');
  assert.equal(paired[0].entryPrice, '0.00001210');
  assert.equal(paired[0].exitPrice, '');
  assert.equal(paired[0].txBuy, 'txBuyCOCO333');
  assert.equal(paired[0].txSell, undefined);

  assert.equal(paired[1].symbol, 'DCTY');
  assert.equal(paired[1].action, 'SELL');
  assert.equal(paired[1].entryPrice, '0.00000590');
  assert.equal(paired[1].exitPrice, '0.00000867');
  assert.equal(paired[1].txBuy, 'txBuyDCTY111');
  assert.equal(paired[1].txSell, 'txSellDCTY222');

  assert.equal(paired[2].symbol, 'DCTY');
  assert.equal(paired[2].action, 'BUY');
  assert.equal(paired[2].entryPrice, '0.00000590');
  assert.equal(paired[2].exitPrice, '');
  assert.equal(paired[2].txBuy, 'txBuyDCTY111');
});

test('orderLogsNewestFirst places newest log entries at index 0 without mutating original array', () => {
  const input = [{ id: '1' }, { id: '2' }, { id: '3' }];
  const ordered = orderLogsNewestFirst(input);
  assert.deepEqual(
    ordered.map((x) => x.id),
    ['3', '2', '1']
  );
  assert.deepEqual(
    input.map((x) => x.id),
    ['1', '2', '3']
  );
});

test('getSniperFilePaths isolates paper and live ledger files', () => {
  const base = '/tmp/sniper-test';
  const paper = getSniperFilePaths('paper', base);
  const live = getSniperFilePaths('live', base);
  assert.equal(paper.stateFile, path.join(base, 'state.json'));
  assert.equal(paper.tradesCsv, path.join(base, 'trades.csv'));
  assert.equal(paper.sellQueueFile, path.join(base, 'sell_queue.json'));
  assert.equal(live.stateFile, path.join(base, 'live_state.json'));
  assert.equal(live.tradesCsv, path.join(base, 'live_trades.csv'));
  assert.equal(live.sellQueueFile, path.join(base, 'live_sell_queue.json'));
});

test('SniperManager stop writes stop.flag, clears bot.pid, switchMode toggles modes, and live reset is blocked', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-mgr-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    assert.equal(mgr.getMode(), 'paper');

    // Simulate stale bot.pid left behind and stop()
    fs.writeFileSync(path.join(tmpDir, 'bot.pid'), JSON.stringify({ pid: 999999, run_id: 'old' }), 'utf-8');
    const stopRes = mgr.stop();
    assert.equal(stopRes.ok, true);
    assert.equal(isStopFlagActive(tmpDir), true);
    assert.equal(fs.existsSync(path.join(tmpDir, 'bot.pid')), false);

    clearStopSignal(tmpDir);
    assert.equal(isStopFlagActive(tmpDir), false);

    // Switch to live
    const liveSwitch = await mgr.switchMode('live');
    assert.equal(liveSwitch.ok, true);
    assert.equal(mgr.getMode(), 'live');

    // Updating non-mode setting preserves live mode
    const upd = mgr.updateSettings({ trade_size_usd: 12.5 });
    assert.equal(upd.ok, true);
    assert.equal(mgr.getMode(), 'live');

    // Live reset must be blocked
    const resetInLive = mgr.resetAccount();
    assert.equal(resetInLive.ok, false);
    assert.match(resetInLive.message, /Live trade ledger/i);

    // Switch back to paper and reset
    await mgr.switchMode('paper');
    assert.equal(mgr.getMode(), 'paper');
    const resetInPaper = mgr.resetAccount();
    assert.equal(resetInPaper.ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SniperManager live buy alerts explicitly on insufficient SOL and executes full swap when funded', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-live-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const kp = await Keypair.generate();
    const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
    await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));

    const mockTxBase64 = createBase64MockTx(kp);
    let walletBalanceSol = 0.0;
    let tokenBalUi = 0;
    let tokenRaw = '0';
    let lastQuoteParams: any = null;

    const mockOrchestrator = {
      signer,
      rpcPool: {
        getHealthSnapshot: () => [{ healthy: true }, { healthy: true }],
        checkAllEndpoints: async () => [{ healthy: true }, { healthy: true }],
        getAgreedBalanceSol: async () => ({
          agreed: true,
          balanceSol: walletBalanceSol,
          readings: [walletBalanceSol, walletBalanceSol],
        }),
        getAgreedTokenBalanceUi: async () => ({
          agreed: true,
          balanceUi: tokenBalUi,
          rawAmount: tokenRaw,
          decimals: 6,
          readings: [tokenBalUi, tokenBalUi],
        }),
        inspectTokenOnChain: async () => ({ decimals: 6 }),
      },
      jupiter: {
        getLiveSolPriceUsd: async () => 100,
        getLastQuoteError: () => 'NO_ROUTES_FOUND',
        getQuote: async (params: any) => {
          lastQuoteParams = params;
          if (params.inputMint === 'MintEmptyRoute11111111111111111111111111') {
            return null;
          }
          const quote: JupiterQuoteResponse = {
            inputMint: params.inputMint,
            inAmount: params.amountRaw,
            outputMint: params.outputMint,
            outAmount: params.outputMint === 'So11111111111111111111111111111111111111112' ? '80000000' : '250000000',
            slippageBps: params.slippageBps,
            priceImpactPct: '0.002',
            routePlan: [],
          };
          return quote;
        },
        buildSwapTransaction: async () => ({ swapTransaction: mockTxBase64 }),
      },
    } as unknown as BotOrchestrator;

    let buyCalled = false;
    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => {
        if (!buyCalled) {
          buyCalled = true;
          tokenBalUi = 250;
          tokenRaw = '250000000';
          return 'sigBuyLive111';
        }
        return 'sigSellLive222';
      },
      pollConfirmation: async () => ({ status: 'confirmed' }),
      reconcileParsedSwapSolDelta: async (sig) => {
        if (sig === 'sigBuyLive111') {
          return {
            found: true,
            solDeltaLamports: -52_049_280,
            feeLamports: 10_000,
            createdAtaRentLamports: 2_039_280,
            tokenDeltaUi: 250,
          };
        }
        return {
          found: true,
          solDeltaLamports: 82_029_280,
          feeLamports: 10_000,
          closedAtaRentLamports: 2_039_280,
        };
      },
      findRecentSellSignature: async () => null,
    };

    mgr.attachOrchestrator(mockOrchestrator, mockAdapter);

    // 1. Insufficient wallet balance -> explicit SOL + $ alert, ok=false, insufficientFunds=true
    const lowBalRes = await mgr.executeLiveBuy({
      mint: 'MintLiveToken1111111111111111111111111111',
      symbol: 'SNIP',
      tradeSizeUsd: 5.0,
      solPriceUsd: 100,
    });
    assert.equal(lowBalRes.ok, false);
    assert.equal(lowBalRes.insufficientFunds, true);
    assert.match(lowBalRes.error || '', /0\.0000 SOL \/ \$0\.00/);

    // 2. Fund wallet -> buy succeeds with reconciled on-chain qty, rawAmount, entryPriceUsd & txSig
    walletBalanceSol = 0.5;
    tokenBalUi = 0;
    tokenRaw = '0';
    const buyRes = await mgr.executeLiveBuy({
      mint: 'MintLiveToken1111111111111111111111111111',
      symbol: 'SNIP',
      tradeSizeUsd: 5.0,
      solPriceUsd: 100,
    });
    assert.equal(buyRes.ok, true);
    assert.equal(buyRes.txSig, 'sigBuyLive111');
    assert.equal(buyRes.rawAmount, '250000000');
    assert.equal(buyRes.decimals, 6);
    assert.equal(buyRes.qty, 250);
    assert.ok((buyRes.costUsd || 0) > 4.9 && (buyRes.costUsd || 0) < 5.1);

    // 3. No sell route -> returns ok=false keeping position open
    const failSell = await mgr.executeLiveSell({
      mint: 'MintEmptyRoute11111111111111111111111111',
      symbol: 'NOROUTE',
      qty: 100,
      costUsd: 5,
      solPriceUsd: 100,
    });
    assert.equal(failSell.ok, false);
    assert.match(failSell.error || '', /No sell route available/i);

    // 4. Live sell succeeds using exact rawAmount & confirmed SOL delta
    const sellRes = await mgr.executeLiveSell({
      mint: 'MintLiveToken1111111111111111111111111111',
      symbol: 'SNIP',
      qty: 250,
      rawAmount: '250000000',
      decimals: 6,
      costUsd: buyRes.costUsd!,
      costSol: buyRes.costSol,
      solPriceUsd: 100,
      reason: 'take_profit_50',
    });
    assert.equal(sellRes.ok, true);
    assert.equal(sellRes.txSig, 'sigSellLive222');
    assert.equal(lastQuoteParams.amountRaw, '250000000');
    assert.ok((sellRes.pnlUsd || 0) > 2.5);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SniperManager records pnl_history.csv and exports formatted CSV with outcome and SOL delta', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-pnl-test-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const { pnlCsv } = getSniperFilePaths('paper', tmpDir);

    // 1. Append trade
    mgr.appendPnlCsv('paper', {
      time: '2026-11-19T10:00:00Z',
      symbol: 'ANTS',
      mint: 'ANTSMint1111111111111111111111111111111111111',
      outcome: 'PROFIT',
      entryPrice: 0.011,
      exitPrice: 0.017,
      costUsd: 5.0,
      proceedsUsd: 7.7,
      pnlUsd: 2.7,
      pnlSol: 0.027,
      pnlPct: 54.0,
      reason: 'take_profit_50',
      holdSeconds: 120,
      dex: 'meteora',
      source: 'gecko',
      solPriceUsd: 100,
      txBuy: 'sigBuy111',
      txSell: 'sigSell222',
      dexscreener: 'https://dexscreener.com/solana/ANTSMint1111111111111111111111111111111111111',
    });

    assert.equal(fs.existsSync(pnlCsv), true);
    const content = fs.readFileSync(pnlCsv, 'utf-8');
    assert.match(content, /^time,symbol,mint,outcome,entry_price,exit_price/);
    assert.match(content, /ANTS,ANTSMint1111111111111111111111111111111111111,PROFIT/);
    assert.match(content, /take_profit_50,120.0,meteora,gecko,100.0000/);

    // 2. Export method returns the CSV content
    const exported = mgr.exportPnlCsv('paper');
    assert.match(exported, /PROFIT/);
    assert.match(exported, /2.7000/);
    assert.match(exported, /54.00/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SniperManager calculates cooldown_remaining_sec from rescan_delay_after_sell_sec and last_sell_time', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-cooldown-test-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const { stateFile } = getSniperFilePaths('paper', tmpDir);

    // Default setting: 60 seconds delay
    mgr.updateSettings({ rescan_delay_after_sell_sec: 60 });

    // Recent sell 20 seconds ago -> remaining should be ~40 seconds
    const nowSec = Date.now() / 1000;
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        positions: {},
        last_sell_time: nowSec - 20,
      }),
      'utf-8'
    );

    const status1 = mgr.getStatus();
    assert.ok(status1.cooldown_remaining_sec >= 38 && status1.cooldown_remaining_sec <= 41);
    assert.equal(status1.scan_paused, true);
    assert.equal(status1.rescan_delay_sec, 60);

    // Sell 70 seconds ago -> delay expired
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        positions: {},
        last_sell_time: nowSec - 70,
      }),
      'utf-8'
    );

    const status2 = mgr.getStatus();
    assert.equal(status2.cooldown_remaining_sec, 0);
    assert.equal(status2.scan_paused, false);

    // Setting disabled (0s delay)
    mgr.updateSettings({ rescan_delay_after_sell_sec: 0 });
    const status3 = mgr.getStatus();
    assert.equal(status3.cooldown_remaining_sec, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SniperManager executeLiveBuy caps ExactIn swap cost at quote.inAmount so ancillary PumpSwap/WSOL rent does not inflate entry price', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-exactin-test-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const kp = await Keypair.generate();
    const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
    await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));
    const mockTxBase64 = createBase64MockTx(kp);

    const solPriceUsd = 72.22;
    const tradeSizeUsd = 0.5;
    // Mirror exact Cowboy Cat screenshot values: 0.00692329 SOL ($0.50) -> 31,936.708013 tokens
    const exactQty = 31936.708013;
    const exactRaw = '31936708013';
    const quotedInLamports = Math.round((tradeSizeUsd / solPriceUsd) * 1e9); // 6,923,290 lamports

    let tokenBalUi = 0;
    let tokenRaw = '0';

    const mockOrchestrator = {
      signer,
      rpcPool: {
        getAgreedBalanceSol: async () => ({ agreed: true, balanceSol: 0.18, readings: [0.18, 0.18] }),
        getAgreedTokenBalanceUi: async () => ({
          agreed: true,
          balanceUi: tokenBalUi,
          rawAmount: tokenRaw,
          decimals: 6,
          readings: [tokenBalUi, tokenBalUi],
        }),
        inspectTokenOnChain: async () => ({ decimals: 6 }),
      },
      jupiter: {
        getLiveSolPriceUsd: async () => solPriceUsd,
        getLastQuoteError: () => null,
        getQuote: async (params: any) => ({
          inputMint: params.inputMint,
          inAmount: String(quotedInLamports),
          outputMint: params.outputMint,
          outAmount: exactRaw,
          slippageBps: params.slippageBps,
          priceImpactPct: '0.001',
          routePlan: [],
        }),
        buildSwapTransaction: async () => ({ swapTransaction: mockTxBase64 }),
      },
    } as unknown as BotOrchestrator;

    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => {
        tokenBalUi = exactQty;
        tokenRaw = exactRaw;
        return '3gqzxB7LiveBuySig11111111111111111111111111';
      },
      pollConfirmation: async () => ({ status: 'confirmed' }),
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        // Total wallet SOL outflow: 0.00692329 swap + 0.00203928 token ATA + 0.00297743 PumpSwap PDA/WSOL overhead + 0.00010000 fee
        solDeltaLamports: -(quotedInLamports + 2_039_280 + 2_977_430 + 100_000),
        feeLamports: 100_000,
        createdAtaRentLamports: 2_039_280,
        tokenDeltaUi: exactQty,
      }),
      findRecentSellSignature: async () => null,
    };

    mgr.attachOrchestrator(mockOrchestrator, mockAdapter);

    const buyRes = await mgr.executeLiveBuy({
      mint: 'AjshMJAXCowboyCat1111111111111111111111KkS6',
      symbol: 'Cowboy Cat',
      tradeSizeUsd,
      solPriceUsd,
    });

    assert.equal(buyRes.ok, true);
    // Entry cost & price must reflect the $0.50 (0.006923 SOL) swap, NOT 0.0099 SOL / $0.72!
    assert.ok(
      Math.abs((buyRes.costSol ?? 0) - quotedInLamports / 1e9) < 1e-8,
      `Expected costSol ~0.006923, got ${buyRes.costSol}`
    );
    assert.ok(
      Math.abs((buyRes.costUsd ?? 0) - 0.5) < 0.002,
      `Expected costUsd ~$0.50, got ${buyRes.costUsd}`
    );
    assert.ok(
      Math.abs((buyRes.entryPriceUsd ?? 0) - 0.000015656) < 0.00000005,
      `Expected entryPriceUsd ~$0.000015656, got ${buyRes.entryPriceUsd}`
    );
    // Ancillary PumpSwap/WSOL PDA rent must be isolated in rentSol rather than corrupting entry price
    assert.ok((buyRes.rentSol ?? 0) > 0.0049, `Expected rentSol to capture ATA+PDA overhead, got ${buyRes.rentSol}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

