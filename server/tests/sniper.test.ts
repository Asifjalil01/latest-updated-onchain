import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  usdToSol,
  fmtSolAmount,
  fmtSolPrice,
  fmtSignedUsdAndSol,
  fmtUnsignedUsdAndSol,
  pairTradesWithEntryAndExit,
  consolidateSniperTrades,
  orderLogsNewestFirst,
  formatBotUptime,
  formatTrailingModeHint,
  calcMinRecoveryTakeProfitPct,
  isPyOptionEnabled,
  validatePythonSniperSettings,
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

test('formatBotUptime formats elapsed seconds as HH:MM:SS cleanly', () => {
  assert.equal(formatBotUptime(0), '00:00:00');
  assert.equal(formatBotUptime(-5), '00:00:00');
  assert.equal(formatBotUptime(65), '00:01:05');
  assert.equal(formatBotUptime(3661), '01:01:01');
});

test('SniperManager clearLogs wipes scan logs, reports uptime_sec, and bridges PumpPortal mints', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-logs-pp-test-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });

    // 1. Add logs via public updateSettings, then clearLogs()
    mgr.updateSettings({ max_age_minutes: 1.5 });
    const before = mgr.getStatus();
    assert.ok(before.logs.length >= 1);
    assert.equal(before.uptime_sec, 0);
    assert.equal(before.started_at_ms, null);

    const cleared = mgr.clearLogs();
    assert.equal(cleared.ok, true);
    assert.equal(mgr.getStatus().logs.length, 0);

    // 2. Attach mock orchestrator with PumpPortal WS buffer and verify getPumpPortalMints()
    let ppStarted = false;
    const mockOrchestrator = {
      pumpPortal: {
        start: () => {
          ppStarted = true;
        },
        drainRecentMints: () => ['MintPP11111111111111111111111111111111111111'],
      },
      signer: {
        isUnlocked: () => false,
        getPublicKey: () => null,
        getMaskedPublicKey: () => 'Locked',
      },
      rpcPool: {
        getHealthSnapshot: () => [],
      },
    } as unknown as BotOrchestrator;

    mgr.attachOrchestrator(mockOrchestrator);
    const ppMints = mgr.getPumpPortalMints();
    assert.equal(ppStarted, true);
    assert.deepEqual(ppMints, ['MintPP11111111111111111111111111111111111111']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('formatTrailingModeHint describes TP + Trailing, Trail-only, TP-only, and Disabled modes', () => {
  assert.equal(
    formatTrailingModeHint(50, 15),
    'Arms at +50% · exits -15% from peak PnL (profit only)'
  );
  assert.equal(
    formatTrailingModeHint(0, 15),
    'Arms at +20% · profit-only trail (-15% peak PnL)'
  );
  assert.equal(formatTrailingModeHint(50, 0), 'Fixed TP at +50% (trailing off)');
  assert.equal(formatTrailingModeHint(0, 0), 'Disabled');
});

test('Python sniper evaluate_exit_signal waits for TP before arming trailing stop, exits on peak PnL drop, and never sells at a loss', () => {
  const pyScript = [
    'import sys, types, json',
    'req = types.ModuleType("requests")',
    'req.Session = lambda: None',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'ev = bot.TradingAccount.evaluate_exit_signal',
    'cases = {}',
    // 1. mihao screenshot regression: entry 0.00000833, peaked +12%, dropped to 0.00000781 (-6.24%) with TP=50, Trail=15 -> MUST HOLD (None, trailing_active=False)
    'cases["mihao_no_loss_sell"] = ev(0.00000833, 0.00000781, 0.00000833 * 1.12, 50, 15, 0.5, 12000)',
    // 2. APCY screenshot regression: entry 0.00000737, peak +52.5%, returned to 0.00000986 (+33.78%) -> drop 18.72% >= 15% -> MUST SELL trailing_stop_15
    'cases["apcy_peak52_5_to_33_78"] = ev(0.00000737, 0.00000986, 0.00000737 * 1.525, 50, 15, 4.0, 12000)',
    // 3. Reaches +50% (arm threshold) with TP=50, Trail=15 -> MUST NOT sell at +50%, trailing arms!
    'cases["arms_at_tp50"] = ev(1.0, 1.50, 1.50, 50, 15, 1.0, 12000)',
    // 4. Rides to +120% (2.20), pulls back 10 PnL% to +110% (2.10) -> still holds (floor is +105%)
    'cases["rides_above_tp"] = ev(1.0, 2.10, 2.20, 50, 15, 2.0, 12000)',
    // 5. From +120% peak (2.20), drops exact 15 PnL% to +105% (2.05) -> MUST SELL trailing_stop_15
    'cases["sells_15pct_from_peak"] = ev(1.0, 2.05, 2.20, 50, 15, 2.1, 12000)',
    // 6. Armed at +50% then flash crash below entry (-5%) -> MUST NOT sell in a loss via trailing_stop
    'cases["flash_crash_no_loss_trail"] = ev(1.0, 0.95, 1.55, 50, 15, 2.5, 12000)',
    // 7. Trail disabled (trail=0), TP=50 -> hits +50% -> immediate take_profit_50
    'cases["fixed_tp_when_trail_off"] = ev(1.0, 1.50, 1.50, 50, 0, 1.0, 12000)',
    // 8. TP disabled (tp=0), Trail=15 -> peak +12% then drop 15% (-3% loss) -> MUST NOT sell
    'cases["trail_only_blocks_loss"] = ev(1.0, 0.97, 1.12, 0, 15, 1.0, 12000)',
    // 9. TP disabled (tp=0), Trail=15 -> peak +30% then drop 15% (+15% profit) -> MUST SELL trailing_stop_15
    'cases["trail_only_sells_in_profit"] = ev(1.0, 1.15, 1.30, 0, 15, 1.0, 12000)',
    'print(json.dumps(cases))',
  ].join('\n');

  const raw = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const res = JSON.parse(raw) as Record<string, [string | null, boolean, number]>;

  assert.equal(res.mihao_no_loss_sell[0], null);
  assert.equal(res.mihao_no_loss_sell[1], false);

  assert.equal(res.apcy_peak52_5_to_33_78[0], 'trailing_stop_15');
  assert.equal(res.apcy_peak52_5_to_33_78[1], true);

  assert.equal(res.arms_at_tp50[0], null);
  assert.equal(res.arms_at_tp50[1], true);

  assert.equal(res.rides_above_tp[0], null);
  assert.equal(res.rides_above_tp[1], true);

  assert.equal(res.sells_15pct_from_peak[0], 'trailing_stop_15');
  assert.equal(res.sells_15pct_from_peak[1], true);

  assert.equal(res.flash_crash_no_loss_trail[0], null);
  assert.equal(res.flash_crash_no_loss_trail[1], true);

  assert.equal(res.fixed_tp_when_trail_off[0], 'take_profit_50');
  assert.equal(res.fixed_tp_when_trail_off[1], false);

  assert.equal(res.trail_only_blocks_loss[0], null);
  assert.equal(res.trail_only_blocks_loss[1], false);

  assert.equal(res.trail_only_sells_in_profit[0], 'trailing_stop_15');
  assert.equal(res.trail_only_sells_in_profit[1], true);
});

test('calcMinRecoveryTakeProfitPct and validatePythonSniperSettings block saving/starting when TP cannot cover investment + fees', () => {
  // Paper mode: $5 trade, 50% sell, 1% fee, 2% slippage => retention 0.99 * 0.98 * 0.99 = 0.960498
  // Needed TP = (1 / (0.5 * 0.960498) - 1) * 100 = 108.225% -> rounded up to +108.3%
  const paperCalc = calcMinRecoveryTakeProfitPct({
    tradeSizeUsd: 5,
    recoverSellPct: 50,
    feePct: 1,
    slippagePct: 2,
    mode: 'paper',
  });
  assert.equal(paperCalc.minTpPct, 108.3);
  assert.equal(paperCalc.targetRecoveryUsd, 5);

  const invalidRes = validatePythonSniperSettings({
    mode: 'paper',
    trade_size_usd: 5,
    take_profit_pct: 50,
    recover_principal_enabled: true,
    recover_principal_sell_pct: 50,
    fee_pct: 1,
    slippage_pct: 2,
  });
  assert.equal(invalidRes.valid, false);
  assert.match(invalidRes.error || '', /\$5\.00/);
  assert.match(invalidRes.error || '', /108\.3%/);

  const validRes = validatePythonSniperSettings({
    mode: 'paper',
    trade_size_usd: 5,
    take_profit_pct: 108.3,
    recover_principal_enabled: true,
    recover_principal_sell_pct: 50,
    fee_pct: 1,
    slippage_pct: 2,
  });
  assert.equal(validRes.valid, true);
  assert.equal(validRes.error, null);

  // Disabled recovery allows any TP
  const disabledRes = validatePythonSniperSettings({
    mode: 'paper',
    trade_size_usd: 5,
    take_profit_pct: 20,
    recover_principal_enabled: false,
    recover_principal_sell_pct: 50,
  });
  assert.equal(disabledRes.valid, true);
});

test('pairTradesWithEntryAndExit preserves entryPrice & txBuy across partial principal_recovery and scale_out sells', () => {
  const rows = [
    {
      time: '2026-11-20T10:00:00Z',
      action: 'BUY',
      symbol: 'MOON',
      mint: 'mintMOON',
      price: '0.00010000',
      amount: '5.00',
      pnlUsd: '',
      pnlPct: '',
      reason: 'sniper_entry',
      txSig: 'txBuyMoon1',
    },
    {
      time: '2026-11-20T10:01:00Z',
      action: 'SELL',
      symbol: 'MOON',
      mint: 'mintMOON',
      price: '0.00022000',
      amount: '5.20',
      pnlUsd: '2.70',
      pnlPct: '108.00',
      reason: 'principal_recovery_50pct',
      txSig: 'txRecMoon2',
    },
    {
      time: '2026-11-20T10:02:00Z',
      action: 'SELL',
      symbol: 'MOON',
      mint: 'mintMOON',
      price: '0.00032000',
      amount: '2.00',
      pnlUsd: '1.38',
      pnlPct: '220.00',
      reason: 'scale_out_25pct',
      txSig: 'txScaleMoon3',
    },
    {
      time: '2026-11-20T10:03:00Z',
      action: 'SELL',
      symbol: 'MOON',
      mint: 'mintMOON',
      price: '0.00030500',
      amount: '5.50',
      pnlUsd: '3.63',
      pnlPct: '194.00',
      reason: 'trailing_stop_15',
      txSig: 'txTrailMoon4',
    },
  ];

  const paired = pairTradesWithEntryAndExit(rows);
  assert.equal(paired.length, 4);
  // Newest first: final trailing_stop, scale_out, principal_recovery, BUY
  assert.equal(paired[0].reason, 'trailing_stop_15');
  assert.equal(paired[0].entryPrice, '0.00010000');
  assert.equal(paired[0].txBuy, 'txBuyMoon1');
  assert.equal(paired[0].txSell, 'txTrailMoon4');

  assert.equal(paired[1].reason, 'scale_out_25pct');
  assert.equal(paired[1].entryPrice, '0.00010000');
  assert.equal(paired[1].txBuy, 'txBuyMoon1');
  assert.equal(paired[1].txSell, 'txScaleMoon3');

  assert.equal(paired[2].reason, 'principal_recovery_50pct');
  assert.equal(paired[2].entryPrice, '0.00010000');
  assert.equal(paired[2].txBuy, 'txBuyMoon1');
  assert.equal(paired[2].txSell, 'txRecMoon2');
});

test('SniperManager Force Delete does not resurrect position during slow refreshStoppedOpenPositions & blocks invalid recovery settings', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-forcedel-race-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    await mgr.switchMode('live');
    const { stateFile, tradesCsv } = getSniperFilePaths('live', tmpDir);

    const rugMint = '3q8rM96dFRugPin1111111111111111111111111111';
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        mode: 'live',
        cash: 12.2,
        positions: {
          [rugMint]: {
            symbol: 'Clawd Pin',
            qty: 46600,
            entry_price: 0.00001072,
            current_price: 0.00001409,
            cost: 0.5,
            opened: Date.now() / 1000 - 300,
            url: `https://dexscreener.com/solana/${rugMint}`,
            dex: 'meteora',
            source: 'gecko',
          },
        },
        blacklist: [],
        closed: 0,
        wins: 0,
        total_pnl: 0,
        day_pnl: 0,
      }),
      'utf-8'
    );

    // Simulate slow background quote refresh that started BEFORE Force Delete
    let resolveFetch!: (val: Record<string, number>) => void;
    const slowRefreshPromise = mgr.refreshStoppedOpenPositions(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    // User clicks Force Delete while async price fetch is in flight
    const del1 = mgr.forceDeletePosition(rugMint, 'rugpull_writeoff');
    assert.equal(del1.ok, true);

    // Second click must report already removed and not duplicate CSV rows
    const del2 = mgr.forceDeletePosition(rugMint, 'rugpull_writeoff');
    assert.equal(del2.ok, false);

    // Complete slow price fetch AFTER delete
    resolveFetch({ [rugMint]: 0.000015 });
    await slowRefreshPromise;

    // Position must remain deleted on disk AND in getStatus(), and only 1 writeoff row written
    const afterState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.equal(Object.keys(afterState.positions || {}).length, 0);
    assert.equal(afterState.blacklist.includes(rugMint), true);
    const status = mgr.getStatus();
    assert.equal(Object.keys(status.state.positions || {}).length, 0);
    assert.equal(status.trades.length, 1);
    assert.equal(status.trades[0].reason, 'rugpull_writeoff');
    assert.equal(fs.existsSync(tradesCsv), true);

    // Validation blocks saving invalid recovery TP < minTpPct
    const badSave = mgr.updateSettings({
      trade_size_usd: 5,
      take_profit_pct: 50,
      recover_principal_enabled: true,
      recover_principal_sell_pct: 50,
      fee_pct: 1,
      slippage_pct: 2,
    });
    assert.equal(badSave.ok, false);
    assert.match(badSave.message || '', /recover your money/i);

    // Valid TP succeeds
    const goodSave = mgr.updateSettings({
      trade_size_usd: 5,
      take_profit_pct: 115,
      recover_principal_enabled: true,
      recover_principal_sell_pct: 50,
      scale_out_sell_pct: 25,
      scale_out_step_gain_pct: 100,
      fee_pct: 1,
      slippage_pct: 2,
    });
    assert.equal(goodSave.ok, true);

    // If settings.json has invalid TP manually written, start() also blocks starting
    fs.writeFileSync(path.join(tmpDir, 'bot.py'), '# test stub\n', 'utf-8');
    const settingsPath = path.join(tmpDir, 'settings.json');
    const curSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    curSettings.take_profit_pct = 40;
    fs.writeFileSync(settingsPath, JSON.stringify(curSettings, null, 2), 'utf-8');
    const startBlocked = mgr.start();
    assert.equal(startBlocked.ok, false);
    assert.match(startBlocked.message || '', /recover your money/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SniperManager executeLiveSell supports partial sellFraction (50%) and prorates remaining cost & qty', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-partial-live-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const kp = await Keypair.generate();
    const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
    await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));
    const mockTxBase64 = createBase64MockTx(kp);

    let quotedInRaw = '';
    let tokenBalUi = 250;
    let tokenRaw = '250000000';

    const mockOrchestrator = {
      signer,
      rpcPool: {
        getAgreedBalanceSol: async () => ({ agreed: true, balanceSol: 0.5, readings: [0.5, 0.5] }),
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
        getLastQuoteError: () => null,
        getQuote: async (params: any) => {
          quotedInRaw = params.amountRaw;
          return {
            inputMint: params.inputMint,
            inAmount: params.amountRaw,
            outputMint: params.outputMint,
            outAmount: '52000000', // 0.052 SOL ($5.20 at $100/SOL)
            slippageBps: params.slippageBps,
            priceImpactPct: '0.001',
            routePlan: [],
          };
        },
        buildSwapTransaction: async () => ({ swapTransaction: mockTxBase64 }),
      },
    } as unknown as BotOrchestrator;

    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => {
        tokenBalUi = 125;
        tokenRaw = '125000000';
        return 'sigPartialSell50';
      },
      pollConfirmation: async () => ({ status: 'confirmed' }),
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        solDeltaLamports: 52_000_000,
        feeLamports: 10_000,
      }),
      findRecentSellSignature: async () => null,
    };

    mgr.attachOrchestrator(mockOrchestrator, mockAdapter);

    const res = await mgr.executeLiveSell({
      mint: 'MintLivePartial111111111111111111111111111',
      symbol: 'MOON',
      qty: 250,
      rawAmount: '250000000',
      decimals: 6,
      costUsd: 5.0,
      costSol: 0.05,
      solPriceUsd: 100,
      reason: 'principal_recovery_50pct',
      sellFraction: 0.5,
    });

    assert.equal(res.ok, true);
    assert.equal(quotedInRaw, '125000000');
    assert.equal(res.isPartial, true);
    assert.equal(res.remainingQty, 125);
    assert.equal(res.remainingRawAmount, '125000000');
    assert.ok(Math.abs((res.soldFraction || 0) - 0.5) < 0.001);
    // Prorated cost of 50% sold is $2.50, proceeds $5.20 -> pnlUsd ~$2.70
    assert.ok((res.proceedsUsd || 0) > 5.1);
    assert.ok((res.pnlUsd || 0) > 2.6);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Python bot principal recovery + scale-out ladder + trailing stop + young-coin rug check', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-py-ladder-'));
  try {
    const pyScript = [
      'import sys, types, json, os, time',
      'req = types.ModuleType("requests")',
      'class DummySess:',
      '    def get(self, *a, **k): raise RuntimeError("no net")',
      'req.Session = lambda: DummySess()',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      'bot.log = lambda *a, **k: None',
      `base = ${JSON.stringify(tmpDir)}`,
      'bot._base_dir = lambda: base',
      'bot.SETTINGS_PATH = os.path.join(base, "settings.json")',
      'cfg = dict(bot.CONFIG)',
      'cfg.update({',
      '  "mode": "paper",',
      '  "start_balance_usd": 50.0,',
      '  "trade_size_usd": 5.0,',
      '  "take_profit_pct": 115.0,',
      '  "trailing_stop_pct": 15.0,',
      '  "recover_principal_enabled": True,',
      '  "recover_principal_sell_pct": 50.0,',
      '  "scale_out_sell_pct": 25.0,',
      '  "scale_out_step_gain_pct": 100.0,',
      '  "fee_pct": 1.0,',
      '  "slippage_pct": 2.0,',
      '  "max_hold_minutes": 120,',
      '  "max_top10_holder_pct": 60.0,',
      '})',
      'with open(bot.SETTINGS_PATH, "w") as f: json.dump(cfg, f)',
      'acct = bot.TradingAccount(cfg, mode="paper")',
      'acct.buy("MintLadder1", "LAD", 1.0, meta={"age_s": 10, "dex": "raydium", "source": "gecko"})',
      'entry = acct.state["positions"]["MintLadder1"]["entry_price"]',
      // 1. At +50% (below +115% TP): must NOT trigger recovery or trailing
      'acct.check_exits({"MintLadder1": entry * 1.50})',
      'pos_after_50 = dict(acct.state["positions"]["MintLadder1"])',
      // 2. At +115%: triggers principal_recovery_50pct, leaves 50% bag open & marks principal_recovered
      'acct.check_exits({"MintLadder1": entry * 2.15})',
      'pos_after_rec = dict(acct.state["positions"]["MintLadder1"])',
      // 3. Pumps +220% (>= next_scale_out_pct 215%): triggers scale_out_25pct of remaining (25% of 50% = 12.5% original)
      'acct.check_exits({"MintLadder1": entry * 3.20})',
      'pos_after_scale = dict(acct.state["positions"]["MintLadder1"])',
      // 4. Drops -16% PnL from +220% peak to +204% (entry * 3.04): triggers trailing_stop_15 closing remaining position & incrementing wins
      'acct.check_exits({"MintLadder1": entry * 3.04})',
      'remaining_count = len(acct.state["positions"])',
      // 5. Young coin (age_s=15) with 85% top-10 concentration (> max_top10_holder_pct 60%) MUST BE REJECTED
      'bot._rpc_mint_account_info = lambda m: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
      'bot._rpc_mint_authorities = lambda m: (True, None, None)',
      'bot.get_json = lambda url, params=None, headers=None, timeout=8: {"score_normalised": 10, "risks": [{"level": "warn", "name": "Top 10 holders high ownership", "description": "Top 10 holders hold 85% of supply"}]} if "rugcheck" in url else None',
      'rug_ok, rug_reason = bot.hard_rug_check("MintConcentrated1", cfg, age_s=15)',
      'print(json.dumps({',
      '  "pos_after_50_recovered": pos_after_50["principal_recovered"],',
      '  "pos_after_rec_recovered": pos_after_rec["principal_recovered"],',
      '  "pos_after_rec_qty_ratio": round(pos_after_rec["qty"] / pos_after_50["qty"], 4),',
      '  "pos_after_rec_recovered_usd": pos_after_rec["recovered_usd"],',
      '  "pos_after_rec_next_scale": pos_after_rec["next_scale_out_pct"],',
      '  "pos_after_scale_count": pos_after_scale["scale_out_count"],',
      '  "pos_after_scale_qty_ratio": round(pos_after_scale["qty"] / pos_after_rec["qty"], 4),',
      '  "remaining_count": remaining_count,',
      '  "closed": acct.state["closed"],',
      '  "wins": acct.state["wins"],',
      '  "rug_ok": rug_ok,',
      '  "rug_reason": rug_reason,',
      '}))',
    ].join('\n');

    const raw = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const lastLine = raw.trim().split('\n').pop() || '{}';
    const out = JSON.parse(lastLine);
    assert.equal(out.pos_after_50_recovered, false);
    assert.equal(out.pos_after_rec_recovered, true);
    assert.equal(out.pos_after_rec_qty_ratio, 0.5);
    assert.ok(out.pos_after_rec_recovered_usd >= 5.0, `Expected >= $5 recovered, got ${out.pos_after_rec_recovered_usd}`);
    assert.equal(out.pos_after_rec_next_scale, 215);
    assert.equal(out.pos_after_scale_count, 1);
    assert.equal(out.pos_after_scale_qty_ratio, 0.75);
    assert.equal(out.remaining_count, 0);
    assert.equal(out.closed, 1);
    assert.equal(out.wins, 1);
    assert.equal(out.rug_ok, false);
    assert.match(out.rug_reason, /85% > 60% limit/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.32.0: afk +73.1% -> +25.36% trailing stop fires even with recover_principal_enabled, plus stop-loss, LP-drain rug exit & fail-closed anti-rug filters', () => {
  const pyScript = [
    'import sys, types, json, time',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'ev = bot.TradingAccount.evaluate_exit_signal',
    'out = {}',
    // 1. Exact afk screenshot regression: TP=50, Trail=15, Peak=+73.1%, Now=+25.36% with recover_principal_enabled=True & principal_recovered=False
    'out["afk_trail_fix"] = ev(1.0, 1.2536, 1.731, 50, 15, 4.0, 12000, recover_principal_enabled=True, principal_recovered=False)',
    // 2. When trail=0 and principal_recovered=True, trailing_active must be False
    'out["trail_zero_inactive"] = ev(1.0, 1.50, 1.50, 50, 0, 1.0, 12000, recover_principal_enabled=True, principal_recovered=True)',
    // 3. Stop loss 35% fires at -36%
    'out["stop_loss_fires"] = ev(1.0, 0.64, 1.02, 50, 15, 2.0, 12000, stop_loss_pct=35)',
    // 4. Emergency LP drain auto-rug exit triggers when liquidity plunges >= 60%
    'out["lp_drain_fires"] = ev(1.0, 0.90, 1.05, 50, 15, 1.0, 12000, stop_loss_pct=35, auto_rug_exit=True, rug_liq_drop_pct=60, entry_liquidity_usd=5000, current_liquidity_usd=1500)',
    // 5. passes_filters: honeypot pattern (12 buys / 0 sells after 30s) & no grace bypass at grace=0
    'now_ms = int(time.time() * 1000)',
    'honeypot_pair = {"pairCreatedAt": now_ms - 45000, "priceUsd": "0.001", "liquidity": {"usd": 5000}, "volume": {"m5": 3000}, "txns": {"m5": {"buys": 14, "sells": 0}}}',
    'out["honeypot_filter"] = bot.passes_filters(honeypot_pair, dict(bot.CONFIG, enabled_platforms=[]), now_ms)',
    'low_liq_young = {"pairCreatedAt": now_ms - 5000, "priceUsd": "0.001", "liquidity": {"usd": 400}, "volume": {"m5": 2000}, "txns": {"m5": {"buys": 10, "sells": 2}}}',
    'out["no_grace_bypass"] = bot.passes_filters(low_liq_young, dict(bot.CONFIG, enabled_platforms=[]), now_ms)',
    // 6. hard_rug_check: Token-2022 disallowed extension rejection
    'cfg = dict(bot.CONFIG)',
    'bot._check_sell_route = lambda *a, **k: (True, "ok")',
    'bot._rpc_mint_account_info = lambda m: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": ["PermanentDelegate"]}',
    'out["t22_reject"] = bot.hard_rug_check("MintT22Bad", cfg, age_s=20)',
    // 7. hard_rug_check: Fail closed on missing RugCheck report even at <180s
    'bot._rpc_mint_account_info = lambda m: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
    'bot.get_json = lambda *a, **k: None',
    'out["missing_report_young"] = bot.hard_rug_check("MintNoReport", cfg, age_s=20)',
    // 8. hard_rug_check: Reject unlocked LP on AMM pool when require_lp_locked is enabled
    'bot.get_json = lambda url, **k: {"score_normalised": 5, "risks": [], "markets": [{"pubkey": "Pool1", "lp": {"lpLockedPct": 0, "lpBurned": False}}], "topHolders": [{"address": "Pool1", "owner": "Pool1", "pct": 70.0}, {"address": "W1", "owner": "W1", "pct": 5.0}]} if "rugcheck" in url else None',
    'out["unlocked_lp_reject"] = bot.hard_rug_check("MintUnlockedLP", dict(cfg, require_lp_locked=True), age_s=25, pair={"dexId": "raydium", "pairAddress": "Pool1", "liquidity": {"usd": 5000}})',
    // 9. hard_rug_check: Reject non-pool Top-10 concentration > 35%
    'bot.get_json = lambda url, **k: {"score_normalised": 5, "risks": [], "markets": [{"pubkey": "Pool1", "lp": {"lpLockedPct": 100, "lpBurned": True}}], "topHolders": [{"address": "Pool1", "owner": "Pool1", "pct": 50.0}, {"address": "W1", "owner": "W1", "pct": 25.0}, {"address": "W2", "owner": "W2", "pct": 18.0}]} if "rugcheck" in url else None',
    'out["non_pool_top10_reject"] = bot.hard_rug_check("MintWhaleTop10", cfg, age_s=25, pair={"dexId": "raydium", "pairAddress": "Pool1", "liquidity": {"usd": 5000}})',
    'print(json.dumps(out))',
  ].join('\n');

  const raw = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const out = JSON.parse(raw.trim().split('\n').pop() || '{}');

  assert.equal(out.afk_trail_fix[0], 'trailing_stop_15');
  assert.equal(out.afk_trail_fix[1], true);

  assert.equal(out.trail_zero_inactive[0], null);
  assert.equal(out.trail_zero_inactive[1], false);

  assert.equal(out.stop_loss_fires[0], 'stop_loss_35');
  assert.equal(out.lp_drain_fires[0], 'rug_liquidity_drop');

  assert.equal(out.honeypot_filter[0], false);
  assert.equal(out.honeypot_filter[1], 'honeypot pattern');

  assert.equal(out.no_grace_bypass[0], false);
  assert.equal(out.no_grace_bypass[1], 'low liquidity');

  assert.equal(out.t22_reject[0], false);
  assert.match(out.t22_reject[1], /PermanentDelegate/i);

  assert.equal(out.missing_report_young[0], false);
  assert.match(out.missing_report_young[1], /fail closed/i);

  assert.equal(out.unlocked_lp_reject[0], false);
  assert.match(out.unlocked_lp_reject[1], /LP burned\/locked/i);

  assert.equal(out.non_pool_top10_reject[0], false);
  assert.match(out.non_pool_top10_reject[1], /top-10 non-pool holders/i);
});

test('v1.32.0: executeLiveSell uses bypassCache, retries simulation failure with skipPreflight, and recovers on confirmation timeout', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-live-sell-v132-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const kp = await Keypair.generate();
    const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
    await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));
    const mockTxBase64 = createBase64MockTx(kp);

    const bypassCacheSeen: boolean[] = [];
    const skipPreflightCalls: Array<boolean | undefined> = [];
    let attemptCount = 0;

    const mockOrchestrator = {
      signer,
      rpcPool: {
        getAgreedBalanceSol: async () => ({ agreed: true, balanceSol: 0.5, readings: [0.5, 0.5] }),
        getAgreedTokenBalanceUi: async () => ({
          agreed: false,
          balanceUi: 100,
          rawAmount: '100000000',
          decimals: 6,
          readings: [100],
        }),
        inspectTokenOnChain: async () => ({ decimals: 6 }),
      },
      jupiter: {
        getLiveSolPriceUsd: async () => 100,
        getLastQuoteError: () => null,
        getQuote: async (params: any) => {
          bypassCacheSeen.push(Boolean(params.bypassCache));
          return {
            inputMint: params.inputMint,
            inAmount: params.amountRaw,
            outputMint: params.outputMint,
            outAmount: '7500000',
            slippageBps: params.slippageBps,
            priceImpactPct: '0.002',
            routePlan: [],
          };
        },
        buildSwapTransaction: async () => ({ swapTransaction: mockTxBase64 }),
      },
    } as unknown as BotOrchestrator;

    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async (_tx, _maxRetries, options) => {
        attemptCount++;
        skipPreflightCalls.push(options?.skipPreflight);
        if (attemptCount === 1) {
          throw new Error('Simulation failed: custom program error: 0x1771');
        }
        return 'sigSkipPreflightRecovered111';
      },
      pollConfirmation: async () => ({ status: 'timeout' }),
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        solDeltaLamports: 7_500_000,
        feeLamports: 10_000,
      }),
      findRecentSellSignature: async () => 'sigSkipPreflightRecovered111',
    };

    mgr.attachOrchestrator(mockOrchestrator, mockAdapter);

    // Non-urgent exit starts with skipPreflight=false and falls back to skipPreflight=true after simulation error
    const resTp = await mgr.executeLiveSell({
      mint: 'MintAfkSell1111111111111111111111111111111',
      symbol: 'AFK',
      qty: 100,
      costUsd: 0.5,
      solPriceUsd: 100,
      reason: 'take_profit_50',
    });

    assert.equal(resTp.ok, true);
    assert.equal(resTp.txSig, 'sigSkipPreflightRecovered111');
    assert.ok(bypassCacheSeen.length >= 1 && bypassCacheSeen.every(Boolean));
    assert.equal(skipPreflightCalls[0], false);
    assert.equal(skipPreflightCalls[1], true);

    // Urgent trailing_stop exit skips preflight immediately on first attempt
    skipPreflightCalls.length = 0;
    const resTrail = await mgr.executeLiveSell({
      mint: 'MintAfkSell1111111111111111111111111111111',
      symbol: 'AFK',
      qty: 100,
      costUsd: 0.5,
      solPriceUsd: 100,
      reason: 'trailing_stop_15',
    });
    assert.equal(resTrail.ok, true);
    assert.equal(skipPreflightCalls[0], true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.32.1: getAgreedSignatureConfirmation early-resolves without waiting for lagging 3rd RPC & accepts single healthy confirmation', async () => {
  const { SolanaRpcPool } = await import('../providers/rpcPool.ts');
  const pool = new SolanaRpcPool([
    'https://rpc1.example.invalid',
    'https://rpc2.example.invalid',
    'https://rpc3.example.invalid',
  ]);
  const connMap = (pool as any).connections as Map<string, any>;
  const urls = pool.getOrderedConnections().slice(0, 3).map((x) => x.ep.url);

  // Case 1: 2 RPCs confirm immediately while 3rd hangs for 800ms -> resolves well under 300ms
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  connMap.set(urls[0], {
    getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }),
  });
  connMap.set(urls[1], {
    getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'finalized' }] }),
  });
  connMap.set(urls[2], {
    getSignatureStatuses: () =>
      new Promise((resolve) => {
        slowTimer = setTimeout(() => resolve({ value: [null] }), 800);
      }),
  });

  const t0 = Date.now();
  const fastRes = await pool.getAgreedSignatureConfirmation('sigFastEarlyResolve111');
  const elapsedMs = Date.now() - t0;
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  assert.equal(fastRes.confirmed, true);
  assert.equal(fastRes.err, null);
  assert.equal(fastRes.agreements, 2);
  assert.ok(elapsedMs < 300, `Expected early resolution < 300ms, took ${elapsedMs}ms`);

  // Case 2: 1 RPC confirms cleanly while other 2 reject -> accepts single healthy confirmation
  connMap.set(urls[0], {
    getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }),
  });
  connMap.set(urls[1], {
    getSignatureStatuses: async () => {
      throw new Error('429 rate limited');
    },
  });
  connMap.set(urls[2], {
    getSignatureStatuses: async () => {
      throw new Error('503 busy');
    },
  });
  const singleRes = await pool.getAgreedSignatureConfirmation('sigSingleHealthy111');
  assert.equal(singleRes.confirmed, true);
  assert.equal(singleRes.agreements, 1);
});

test('v1.32.1: executeLiveBuy runs quote & token checks in parallel, uses skipPreflight, and skips post-buy balance wait', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-fast-buy-v1321-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const kp = await Keypair.generate();
    const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
    await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));
    const mockTxBase64 = createBase64MockTx(kp);

    let balanceCalls = 0;
    let quoteStartedWhileInspectPending = false;
    let inspectPending = false;
    let buySkipPreflight: boolean | undefined;

    const mockOrchestrator = {
      signer,
      rpcPool: {
        getAgreedBalanceSol: async () => {
          balanceCalls++;
          if (balanceCalls >= 2) {
            await new Promise((r) => setTimeout(r, 800));
          }
          return { agreed: true, balanceSol: 0.5, readings: [0.5, 0.5] };
        },
        getAgreedTokenBalanceUi: async () => ({
          agreed: true,
          balanceUi: 0,
          rawAmount: '0',
          decimals: 6,
          readings: [0, 0],
        }),
        inspectTokenOnChain: async () => {
          inspectPending = true;
          await new Promise((r) => setTimeout(r, 50));
          inspectPending = false;
          return { decimals: 6 };
        },
      },
      jupiter: {
        getLiveSolPriceUsd: async () => 100,
        getLastQuoteError: () => null,
        getQuote: async (params: any) => {
          if (inspectPending) quoteStartedWhileInspectPending = true;
          return {
            inputMint: params.inputMint,
            inAmount: params.amountRaw,
            outputMint: params.outputMint,
            outAmount: '250000000',
            slippageBps: params.slippageBps,
            priceImpactPct: '0.001',
            routePlan: [],
          };
        },
        buildSwapTransaction: async () => ({ swapTransaction: mockTxBase64 }),
      },
    } as unknown as BotOrchestrator;

    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async (_tx, _maxRetries, options) => {
        buySkipPreflight = options?.skipPreflight;
        return 'sigFastBuy111';
      },
      pollConfirmation: async () => ({ status: 'confirmed' }),
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        solDeltaLamports: -52_049_280,
        feeLamports: 10_000,
        createdAtaRentLamports: 2_039_280,
        tokenDeltaUi: 250,
      }),
      findRecentSellSignature: async () => null,
    };

    mgr.attachOrchestrator(mockOrchestrator, mockAdapter);
    const t0 = Date.now();
    const res = await mgr.executeLiveBuy({
      mint: 'MintFastBuy11111111111111111111111111111',
      symbol: 'FAST',
      tradeSizeUsd: 5.0,
      solPriceUsd: 100,
    });
    const elapsedMs = Date.now() - t0;

    assert.equal(res.ok, true);
    assert.equal(quoteStartedWhileInspectPending, true);
    assert.equal(buySkipPreflight, true);
    assert.ok(elapsedMs < 400, `Expected non-blocking post-buy balance refresh (<400ms), took ${elapsedMs}ms`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.32.1: bot.py parallel hard_rug_check allows clean <2m score 52 under default 55 limit & _pending_dex_retry re-queues unindexed mints in ~2s', () => {
  const pyScript = [
    'import sys, types, json, time',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'out = {"default_rc": bot.CONFIG["rugcheck_max_score"]}',
    'cfg = dict(bot.CONFIG)',
    'def slow_rpc(m): time.sleep(0.15); return {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
    'def slow_rc(url, **k): time.sleep(0.15); return {"score_normalised": 52, "risks": [], "markets": [{"pubkey": "Pool1", "lp": {"lpLockedPct": 100, "lpBurned": True}}], "topHolders": [{"address": "Pool1", "owner": "Pool1", "pct": 70.0}, {"address": "W1", "owner": "W1", "pct": 8.0}]} if "rugcheck" in url else None',
    'def slow_sell(*a, **k): time.sleep(0.15); return (True, "ok")',
    'bot._rpc_mint_account_info = slow_rpc',
    'bot.get_json = slow_rc',
    'bot._check_sell_route = slow_sell',
    't0 = time.time()',
    'ok_52, reason_52 = bot.hard_rug_check("MintYoungScore52", cfg, age_s=40, pair={"dexId": "pumpswap", "pairAddress": "Pool1", "priceUsd": "0.0001", "liquidity": {"usd": 5000}})',
    'out["elapsed_ms"] = round((time.time() - t0) * 1000)',
    'out["score_52_res"] = [ok_52, reason_52]',
    'bot._pending_dex_retry.clear()',
    'bot._update_pending_dex_mints(["MintNewLaunch111"], {})',
    'out["retry_immediate"] = bot._get_due_pending_dex_mints(set())',
    'bot._pending_dex_retry["MintNewLaunch111"] = (time.time() - 2.0, time.time() - 2.0)',
    'out["retry_after_2s"] = bot._get_due_pending_dex_mints(set())',
    'bot._update_pending_dex_mints(["MintNewLaunch111"], {"MintNewLaunch111": (5000, {})})',
    'out["retry_after_found"] = list(bot._pending_dex_retry.keys())',
    'print(json.dumps(out))',
  ].join('\n');

  const raw = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const out = JSON.parse(raw.trim().split('\n').pop() || '{}');

  assert.equal(out.default_rc, 55);
  assert.equal(out.score_52_res[0], true);
  assert.ok(out.elapsed_ms < 320, `Expected parallel hard_rug_check (<320ms vs 450ms sequential), took ${out.elapsed_ms}ms`);
  assert.deepEqual(out.retry_immediate, []);
  assert.deepEqual(out.retry_after_2s, ['MintNewLaunch111']);
  assert.deepEqual(out.retry_after_found, []);
});

test('v1.33.0: PumpPortalWsProvider tracks live trades, curve reserves, creator sells, and builds synthetic pairs', async () => {
  const { PumpPortalWsProvider } = await import('../providers/pumpportal.ts');
  const pp = new PumpPortalWsProvider();
  const baseNow = 1_700_000_000_000;
  const mintA = 'MintPumpLive111111111111111111111111111111';
  const creatorA = 'CreatorWallet1111111111111111111111111111';

  pp.ingestFrame(
    {
      mint: mintA,
      symbol: 'FAST',
      name: 'Fast Launch',
      txType: 'create',
      traderPublicKey: creatorA,
      initialBuy: 1.5,
      bondingCurveKey: 'CurveKey111',
      vSolInBondingCurve: 31.5,
      vTokensInBondingCurve: 950_000_000,
      marketCapSol: 33.15,
    },
    baseNow - 15_000
  );

  for (let i = 0; i < 4; i += 1) {
    pp.ingestFrame(
      {
        mint: mintA,
        txType: 'buy',
        traderPublicKey: `BuyerWallet${i}1111111111111111111111111111`,
        solAmount: 2.0,
        vSolInBondingCurve: 31.5 + (i + 1) * 2.0,
        vTokensInBondingCurve: 900_000_000 - i * 20_000_000,
      },
      baseNow - (10 - i) * 1000
    );
  }

  pp.ingestFrame(
    {
      mint: mintA,
      txType: 'sell',
      traderPublicKey: creatorA,
      solAmount: 1.0,
      vSolInBondingCurve: 38.5,
      vTokensInBondingCurve: 860_000_000,
    },
    baseNow - 2000
  );

  const pairs = pp.getSyntheticPairs(100, 180_000, baseNow);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].baseToken.address, mintA);
  assert.equal(pairs[0].baseToken.symbol, 'FAST');
  assert.equal(pairs[0].dexId, 'pumpfun');
  assert.ok(Number(pairs[0].priceUsd) > 0);
  assert.ok(pairs[0].liquidity.usd > 7000);
  assert.equal(pairs[0]._pumpportal.buys_60s, 5);
  assert.equal(pairs[0]._pumpportal.sells_60s, 1);
  assert.equal(pairs[0]._pumpportal.creator_sold, true);
  assert.ok(pairs[0]._pumpportal.sol_vol_60s >= 10);
});

test('v1.33.0: custom primary RPC, priority/Jito swap options, and reverse swap exit quotes work end-to-end', async () => {
  const { SolanaRpcPool } = await import('../providers/rpcPool.ts');
  const pool = new SolanaRpcPool();
  const changed = pool.setPrimaryCustomRpc('https://private-helius.example.invalid/?api-key=test');
  assert.equal(changed, true);
  assert.equal(pool.getOrderedConnections()[0].ep.url, 'https://private-helius.example.invalid/?api-key=test');
  pool.setPrimaryCustomRpc('');
  assert.ok(!pool.getEndpoints().some((e) => e.url.includes('private-helius')));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1330-exec-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    mgr.updateSettings({
      mode: 'live',
      priority_fee_tier: 'turbo',
      jito_tip_sol: 0.0002,
      use_real_swap_quotes: true,
    });

    const kp = await Keypair.generate();
    const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
    await signer.initFromEnv(JSON.stringify(Array.from(kp.secretKey)));
    const mockTxBase64 = createBase64MockTx(kp);
    let capturedSwapParams: any = null;

    const mockOrchestrator = {
      signer,
      rpcPool: {
        setPrimaryCustomRpc: () => true,
        checkAllEndpoints: async () => [],
        getHealthSnapshot: () => [],
        getAgreedBalanceSol: async () => ({ agreed: true, balanceSol: 1.0, readings: [1.0, 1.0] }),
        getAgreedTokenBalanceUi: async () => ({
          agreed: true,
          balanceUi: 100,
          rawAmount: '100000000',
          decimals: 6,
          readings: [100, 100],
        }),
        inspectTokenOnChain: async () => ({ decimals: 6 }),
      },
      jupiter: {
        setApiKey: () => {},
        getLiveSolPriceUsd: async () => 100,
        getLastQuoteError: () => null,
        getQuote: async (params: any) => ({
          inputMint: params.inputMint,
          inAmount: params.amountRaw,
          outputMint: params.outputMint,
          outAmount: '50000000',
          slippageBps: params.slippageBps,
          priceImpactPct: '0.001',
          routePlan: [],
        }),
        buildSwapTransaction: async (params: any) => {
          capturedSwapParams = params;
          return { swapTransaction: mockTxBase64 };
        },
        getReverseExitPricesUsd: async (positions: any[], solPx: number) => {
          const res: Record<string, number> = {};
          for (const p of positions) {
            res[p.mint] = (0.05 * solPx) / p.qty;
          }
          return res;
        },
      },
    } as unknown as BotOrchestrator;

    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => 'sigV1330Sell111',
      pollConfirmation: async () => ({ status: 'confirmed' }),
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        solDeltaLamports: 50_000_000,
        feeLamports: 10_000,
        closedAtaRentLamports: 0,
      }),
      findRecentSellSignature: async () => null,
    };

    mgr.attachOrchestrator(mockOrchestrator, mockAdapter);

    const rev = await mgr.getReverseExitPrices(
      [{ mint: 'MintReverse111111111111111111111111111111', qty: 100, decimals: 6 }],
      100
    );
    assert.equal(rev.ok, true);
    assert.equal(rev.prices['MintReverse111111111111111111111111111111'], 0.05);

    const sellRes = await mgr.executeLiveSell({
      mint: 'MintReverse111111111111111111111111111111',
      symbol: 'REV',
      qty: 100,
      rawAmount: '100000000',
      decimals: 6,
      costUsd: 3.0,
      costSol: 0.03,
      reason: 'trailing_stop_12',
      solPriceUsd: 100,
    });
    assert.equal(sellRes.ok, true);
    assert.equal(capturedSwapParams.priorityLevel, 'veryHigh');
    assert.equal(capturedSwapParams.jitoTipLamports, 200_000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.33.0: bot.py blocks bundled insider RugCheck reports, creator holds/dumps, enforces 60s velocity & $5k/1.5x defaults, and ranks strongest momentum first', () => {
  const pyScript = [
    'import sys, types, json, time, tempfile, shutil',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'out = {}',
    'out["defaults"] = {"liq": bot.CONFIG["min_liquidity_usd"], "ratio": bot.CONFIG["min_buy_sell_ratio_m5"], "bundles": bot.CONFIG["block_insider_bundles"]}',
    'cfg = dict(bot.CONFIG, enabled_platforms=[])',
    'now_ms = int(time.time() * 1000)',
    'slow_pair = {"baseToken": {"address": "M1", "symbol": "SLOW"}, "pairCreatedAt": now_ms - 25000, "priceUsd": "0.0001", "liquidity": {"usd": 6500}, "txns": {"m5": {"buys": 12, "sells": 5}}, "volume": {"m5": 3000}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 1, "sells_60s": 0}}',
    'out["low_vel"] = list(bot.passes_filters(slow_pair, cfg, now_ms))',
    'good_pair = {"baseToken": {"address": "M2", "symbol": "GOOD"}, "pairCreatedAt": now_ms - 25000, "priceUsd": "0.0001", "liquidity": {"usd": 6500}, "txns": {"m5": {"buys": 20, "sells": 4}}, "volume": {"m5": 5000}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 8, "sells_60s": 2, "sol_vol_60s": 6.0}}',
    'out["good_vel"] = list(bot.passes_filters(good_pair, cfg, now_ms))',
    'bot._rpc_mint_account_info = lambda m, c=None: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
    'bot._check_sell_route = lambda *a, **k: (True, "ok")',
    'tmp_dir = tempfile.mkdtemp()',
    'orig_base = bot._base_dir',
    'bot._base_dir = lambda: tmp_dir',
    'try:',
    '    bot.get_json = lambda u, **k: {"score_normalised": 15, "insiderNetworks": [{"id": "net1", "size": 12}], "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    '    out["insider_net"] = list(bot.hard_rug_check("MintIns1", cfg, age_s=20, pair=good_pair))',
    '    bot.get_json = lambda u, **k: {"score_normalised": 15, "creator": "Dev1", "creatorBalance": 90000, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    '    out["dev_hold"] = list(bot.hard_rug_check("MintDev1", cfg, age_s=20, pair=good_pair))',
    '    bot.get_json = lambda u, **k: {"score_normalised": 15, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    '    dump_pair = dict(good_pair); dump_pair["_pumpportal"] = {"has_trade_stream": True, "buys_60s": 6, "sells_60s": 2, "creator_sold": True}',
    '    out["creator_sold"] = list(bot.hard_rug_check("MintDump1", cfg, age_s=20, pair=dump_pair))',
    '    mint_weak = "MintWeakAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
    '    mint_strong = "MintStrongBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"',
    '    weak_pair = {"baseToken": {"address": mint_weak, "symbol": "WEAK"}, "dexId": "pumpfun", "pairCreatedAt": now_ms - 50000, "priceUsd": "0.0001", "liquidity": {"usd": 6000}, "txns": {"m5": {"buys": 10, "sells": 6}}, "volume": {"m5": 2200}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 3, "sells_60s": 2, "sol_vol_60s": 0.8}}',
    '    strong_pair = {"baseToken": {"address": mint_strong, "symbol": "STRG"}, "dexId": "pumpfun", "pairCreatedAt": now_ms - 12000, "priceUsd": "0.0002", "liquidity": {"usd": 8000}, "txns": {"m5": {"buys": 35, "sells": 5}}, "volume": {"m5": 14000}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 14, "sells_60s": 1, "sol_vol_60s": 8.0}}',
    '    bot._pumpportal_pairs.clear()',
    '    bot._pumpportal_pairs[mint_weak] = weak_pair',
    '    bot._pumpportal_pairs[mint_strong] = strong_pair',
    '    bot.fetch_candidate_mints = lambda c, force=False: [mint_weak, mint_strong]',
    '    bot.get_json = lambda u, **k: {"score_normalised": 10, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    '    rcfg = dict(cfg, max_open_positions=1, max_age_minutes=3)',
    '    acct = bot.TradingAccount(rcfg, mode="paper")',
    '    bot.scan_and_buy(acct, rcfg)',
    '    out["bought_mints"] = list(acct.state["positions"].keys())',
    'finally:',
    '    bot._base_dir = orig_base',
    '    shutil.rmtree(tmp_dir, ignore_errors=True)',
    'print(json.dumps(out))',
  ].join('\n');

  const raw = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const out = JSON.parse(raw.trim().split('\n').pop() || '{}');

  assert.equal(out.defaults.liq, 5000);
  assert.equal(out.defaults.ratio, 1.5);
  assert.equal(out.defaults.bundles, true);
  assert.equal(out.low_vel[0], false);
  assert.equal(out.low_vel[1], 'low 60s velocity');
  assert.equal(out.good_vel[0], true);
  assert.equal(out.insider_net[0], false);
  assert.match(out.insider_net[1], /bundled insider wallets/i);
  assert.equal(out.dev_hold[0], false);
  assert.match(out.dev_hold[1], /creator\/dev holds/i);
  assert.equal(out.creator_sold[0], false);
  assert.match(out.creator_sold[1], /creator\/dev already sold/i);
  assert.deepEqual(out.bought_mints, ['MintStrongBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB']);
});

test('v1.33.1: prevents false rug_liquidity_drop sells on Pump.fun curves, missing DexScreener liquidity, PumpPortal recalibration & mild dips when SL/Trail are 0', () => {
  const pyScript = [
    'import sys, types, json, time, tempfile, shutil',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'out = {}',
    'tmp_dir = tempfile.mkdtemp()',
    'orig_base = bot._base_dir',
    'bot._base_dir = lambda: tmp_dir',
    'try:',
    '    cfg = dict(bot.CONFIG, take_profit_pct=45.0, stop_loss_pct=0.0, trailing_stop_pct=0.0, auto_rug_exit=True, rug_liq_drop_pct=50.0, slippage_pct=0.0, fee_pct=0.0, use_jupiter_price=False, use_real_swap_quotes=False)',
    '    acct = bot.TradingAccount(cfg, mode="paper")',
    '    # 1. Pump.fun bonding curve coin (whallet regression): must NEVER exit via rug_liquidity_drop on -16% dip or 0/missing liq',
    '    acct.buy("MintPump1", "WHAL", 0.00000430, meta={"dex": "pumpfun", "liquidity_usd": 4200.0, "liq_source": "pumpportal"})',
    '    acct.check_exits({"MintPump1": 0.00000364}, liquidities={"MintPump1": 0.0})',
    '    acct.check_exits({"MintPump1": 0.00000364}, liquidities={"MintPump1": 100.0})',
    '    out["pumpfun_kept_open"] = "MintPump1" in acct.state["positions"]',
    '    # Price recovers to 0.000005757 (+33.9%) -> stays open waiting for fixed TP +45%, then sells at TP',
    '    acct.check_exits({"MintPump1": 0.000005757}, liquidities={"MintPump1": 4500.0})',
    '    out["still_open_at_5757"] = "MintPump1" in acct.state["positions"]',
    '    acct.check_exits({"MintPump1": 0.00000630}, liquidities={"MintPump1": 4800.0})',
    '    out["closed_at_tp"] = "MintPump1" not in acct.state["positions"]',
    '    # 2. AMM coin entered via PumpPortal synthetic liquidity -> first DexScreener poll recalibrates baseline cleanly; mild -16% dip with healthy quote never triggers',
    '    acct.buy("MintAmm1", "AMM1", 0.0000100, meta={"dex": "pumpswap", "liquidity_usd": 4200.0, "liq_source": "pumpportal"})',
    '    acct.check_exits({"MintAmm1": 0.0000084}, liquidities={"MintAmm1": 1800.0}, healthy_rev_quotes={"MintAmm1"})',
    '    acct.check_exits({"MintAmm1": 0.0000084}, liquidities={"MintAmm1": 400.0}, healthy_rev_quotes={"MintAmm1"})',
    '    out["mild_dip_with_quote_kept"] = "MintAmm1" in acct.state["positions"]',
    '    # 3. AMM coin single-poll liquidity drop glitch does not exit immediately, but 2 consecutive confirmed AMM drops without healthy quote DO exit',
    '    acct.check_exits({"MintAmm1": 0.0000060}, liquidities={"MintAmm1": 300.0}, healthy_rev_quotes=set())',
    '    out["single_poll_kept"] = "MintAmm1" in acct.state["positions"]',
    '    acct.check_exits({"MintAmm1": 0.0000060}, liquidities={"MintAmm1": 300.0}, healthy_rev_quotes=set())',
    '    out["two_poll_amm_rug_exited"] = "MintAmm1" not in acct.state["positions"]',
    '    # 4. monitor() must NOT coerce missing DexScreener liquidity.usd (None) into 0.0',
    '    acct.buy("MintMon1", "MON1", 0.0000100, meta={"dex": "pumpswap", "liquidity_usd": 5000.0, "liq_source": "dexscreener"})',
    '    bot._last_liq_poll[0] = 0.0',
    '    bot.get_sol_price_usd = lambda c: (70.0, time.time())',
    '    bot.get_json = lambda url, **k: [{"baseToken": {"address": "MintMon1"}, "dexId": "pumpswap", "priceUsd": "0.0000085"}] if "dexscreener" in url else None',
    '    bot.monitor(acct)',
    '    out["mon_kept_missing_liq"] = "MintMon1" in acct.state["positions"]',
    '    out["mon_liq_preserved"] = acct.state["positions"]["MintMon1"]["current_liquidity_usd"]',
    'finally:',
    '    bot._base_dir = orig_base',
    '    shutil.rmtree(tmp_dir, ignore_errors=True)',
    'print(json.dumps(out))',
  ].join('\n');

  const raw = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const out = JSON.parse(raw.trim().split('\n').pop() || '{}');

  assert.equal(out.pumpfun_kept_open, true);
  assert.equal(out.still_open_at_5757, true);
  assert.equal(out.closed_at_tp, true);
  assert.equal(out.mild_dip_with_quote_kept, true);
  assert.equal(out.single_poll_kept, true);
  assert.equal(out.two_poll_amm_rug_exited, true);
  assert.equal(out.mon_kept_missing_liq, true);
  assert.equal(out.mon_liq_preserved, 5000.0);
});

test('v1.33.2: defaults auto_rug_exit & require_lp_locked to False, unblocks PumpSwap/Meteora/RugCheck unlocked-LP launches, and excludes market pubkeys from Top-10', () => {
  const pyScript = [
    'import sys, types, json',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'out = {}',
    'out["defaults"] = {"auto_rug": bot.CONFIG["auto_rug_exit"], "lp_lock": bot.CONFIG["require_lp_locked"]}',
    'cfg = dict(bot.CONFIG)',
    'bot._rpc_mint_account_info = lambda m, c=None: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
    'bot._check_sell_route = lambda *a, **k: (True, "ok")',
    // Simulate GOAT / PumpSwap / Meteora launch with 0% lpLockedPct, Large Amount of LP Unlocked danger, and 85% held in market pubkey PoolPump1
    'bot.get_json = lambda url, **k: {"score_normalised": 12, "risks": [{"level": "danger", "name": "Large Amount of LP Unlocked", "description": "LP unlocked"}], "markets": [{"pubkey": "PoolPump1", "marketType": "pump_fun_amm", "lp": {"lpLockedPct": 0, "lpBurned": False}}], "topHolders": [{"address": "PoolPump1", "owner": "PoolPump1", "pct": 85.0}, {"address": "Wallet1", "owner": "Wallet1", "pct": 4.0}]} if "rugcheck" in url else None',
    'out["goat_pumpswap_ok"] = list(bot.hard_rug_check("MintGoat1", cfg, age_s=30, pair={"dexId": "pumpswap", "pairAddress": "", "priceUsd": "0.0001", "liquidity": {"usd": 9000}}))',
    // Even if require_lp_locked=True is explicitly enabled later, canonical PumpSwap/Meteora pools still pass without false LP 0% rejection
    'out["pumpswap_ok_even_when_lp_req"] = list(bot.hard_rug_check("MintGoat2", dict(cfg, require_lp_locked=True), age_s=30, pair={"dexId": "pumpswap", "pairAddress": "", "priceUsd": "0.0001", "liquidity": {"usd": 9000}}))',
    'print(json.dumps(out))',
  ].join('\n');

  const raw = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const out = JSON.parse(raw.trim().split('\n').pop() || '{}');

  assert.equal(out.defaults.auto_rug, false);
  assert.equal(out.defaults.lp_lock, false);
  assert.equal(out.goat_pumpswap_ok[0], true);
  assert.equal(out.pumpswap_ok_even_when_lp_req[0], true);
});

test('v1.34.0: website/launchpad checkboxes normalize in SniperManager and strictly filter coins in bot.py', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1340-'));
  try {
    const manager = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const updated = manager.updateSettings({
      enabled_platforms: [' PumpFun ', 'axiom', 'pumpfun', ''],
    });
    assert.equal(updated.ok, true);
    assert.deepEqual(updated.settings?.enabled_platforms, ['pumpfun', 'axiom']);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8'));
    assert.deepEqual(saved.enabled_platforms, ['pumpfun', 'axiom']);
    const cleared = manager.updateSettings({ enabled_platforms: [] });
    assert.equal(cleared.ok, true);
    assert.deepEqual(cleared.settings?.enabled_platforms, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const pyScript = [
    'import sys, types, json, time',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'now_ms = int(time.time() * 1000)',
    'base_metrics = {"pairCreatedAt": now_ms - 30000, "priceUsd": "0.0001", "liquidity": {"usd": 8000}, "volume": {"m5": 4000}, "txns": {"m5": {"buys": 12, "sells": 4}}, "priceChange": {"m5": 15}}',
    'p_pump = {**base_metrics, "dexId": "pumpfun", "baseToken": {"address": "Mint111pump", "symbol": "PMP"}}',
    'p_orca = {**base_metrics, "dexId": "orca", "baseToken": {"address": "Mint222orca", "symbol": "ORC"}}',
    'p_bonk = {**base_metrics, "dexId": "raydium", "baseToken": {"address": "Mint333bonk", "symbol": "BNK"}, "info": {"websites": [{"url": "https://letsbonk.fun/token/Mint333bonk"}]}}',
    'p_synth = {**base_metrics, "_synthetic": True, "url": "https://dexscreener.com/solana/MintSynth", "dexId": "pumpfun", "baseToken": {"address": "Mint444pump", "symbol": "SYN"}}',
    'out = {}',
    // Empty list allows everything
    'cfg_all = dict(bot.CONFIG, enabled_platforms=[])',
    'out["all_allows_orca"] = bot.passes_filters(p_orca, cfg_all, now_ms=now_ms, source="gecko")[0]',
    // Pump.fun only allows pumpfun, rejects orca and letsbonk
    'cfg_pump = dict(bot.CONFIG, enabled_platforms=["pumpfun"])',
    'out["pump_allows_pump"] = bot.passes_filters(p_pump, cfg_pump, now_ms=now_ms, source="pumpportal")[0]',
    'r_orca = bot.passes_filters(p_orca, cfg_pump, now_ms=now_ms, source="gecko")',
    'out["pump_rejects_orca"] = (r_orca[0], r_orca[1])',
    // Axiom allows trenches (pumpfun/letsbonk) and rejects orca-only
    'cfg_axiom = dict(bot.CONFIG, enabled_platforms=["axiom"])',
    'out["axiom_allows_bonk"] = bot.passes_filters(p_bonk, cfg_axiom, now_ms=now_ms, source="profiles")[0]',
    'out["axiom_rejects_orca"] = bot.passes_filters(p_orca, cfg_axiom, now_ms=now_ms, source="gecko")[0]',
    // Synthetic PumpPortal fallback dexscreener URL must NOT falsely match dexscreener checkbox
    'cfg_dex = dict(bot.CONFIG, enabled_platforms=["dexscreener"])',
    'out["dex_ignores_synth"] = bot.passes_filters(p_synth, cfg_dex, now_ms=now_ms, source="pumpportal")[0]',
    'print(json.dumps(out))',
  ].join('\n');

  const raw = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const out = JSON.parse(raw.trim().split('\n').pop() || '{}');

  assert.equal(out.all_allows_orca, true);
  assert.equal(out.pump_allows_pump, true);
  assert.deepEqual(out.pump_rejects_orca, [false, 'wrong website']);
  assert.equal(out.axiom_allows_bonk, true);
  assert.equal(out.axiom_rejects_orca, false);
  assert.equal(out.dex_ignores_synth, false);
});

test('v1.34.1: Jupiter 429 fails over cleanly without circuit-open, PumpPortal trade-local rescues buys/sells, and slippage retry recovers failed buy', async () => {
  const { JupiterProvider } = await import('../providers/jupiter.ts');
  const kp = await Keypair.generate();
  const mockTxBytes = Buffer.from(createBase64MockTx(kp), 'base64');

  const prevFetch = globalThis.fetch;
  const calledUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calledUrls.push(url);
    if (url.startsWith('https://lite-api.jup.ag/swap/v1/quote')) {
      return new Response('Too many requests', { status: 429 });
    }
    if (url.startsWith('https://api.jup.ag/swap/v1/quote')) {
      return new Response(
        JSON.stringify({
          inputMint: 'So11111111111111111111111111111111111111112',
          inAmount: '10000000',
          outputMint: 'MintFallback1111111111111111111111111111111',
          outAmount: '500000000',
          slippageBps: 300,
          priceImpactPct: '0.01',
          routePlan: [{ percent: 100, swapInfo: { label: 'PumpSwap' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://pumpportal.fun/api/trade-local') {
      return new Response(mockTxBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const jup = new JupiterProvider();
    // 1. lite-api.jup.ag 429 fails over cleanly to api.jup.ag without firing a duplicate relaxed request or tripping circuit breaker
    const q = await jup.getQuote({
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'MintFallback1111111111111111111111111111111',
      amountRaw: '10000000',
      slippageBps: 300,
    });
    assert.ok(q && q.outAmount === '500000000');
    const liteCalls = calledUrls.filter((u) => u.startsWith('https://lite-api.jup.ag/swap/v1/quote'));
    assert.equal(liteCalls.length, 1, 'Must break immediately after 429 without sending duplicate relaxed quote');
    const swapHealth = jup.getHealth().find((h) => h.source === 'jupiter_swap');
    assert.equal(swapHealth?.circuitState, 'CLOSED');

    // 2. buildPumpPortalSwapTransaction parses raw binary VersionedTransaction payload
    const ppTx = await jup.buildPumpPortalSwapTransaction({
      userPublicKey: kp.publicKey.toBase58(),
      action: 'buy',
      mint: 'MintFallback1111111111111111111111111111111',
      amount: 0.01,
      denominatedInSol: true,
      slippagePct: 8,
      priorityFeeSol: 0.0002,
    });
    assert.ok(ppTx instanceof Uint8Array && ppTx.length > 32);
  } finally {
    globalThis.fetch = prevFetch;
  }

  // 3. SniperManager.executeLiveBuy falls back to PumpPortal when Jupiter has no route / 429 AND retries once on on-chain slippage revert
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1341-'));
  try {
    const manager = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const mockTxB64 = createBase64MockTx(kp);
    let pollAttempt = 0;
    let ppFallbacks = 0;
    const buySlippages: number[] = [];
    const heldBalance: Record<string, number> = {};
    let activeMint = '';

    const mockOrchestrator = {
      signer: {
        isUnlocked: () => true,
        getPublicKey: () => kp.publicKey.toBase58(),
        signVersionedTransaction: async () => undefined,
      },
      rpcPool: {
        getAgreedBalanceSol: async () => ({ agreed: true, balanceSol: 0.5, readings: [0.5, 0.5] }),
        getAgreedTokenBalanceUi: async (_owner: string, mint: string) => {
          activeMint = mint;
          const bal = heldBalance[mint] ?? 0;
          return {
            agreed: true,
            balanceUi: bal,
            readings: [bal, bal],
            decimals: 6,
            rawAmount: bal > 0 ? String(bal * 1_000_000) : '0',
          };
        },
        inspectTokenOnChain: async () => ({ decimals: 6 }),
      },
      jupiter: {
        getLiveSolPriceUsd: async () => 70,
        getLastQuoteError: () => 'Rate limited backoff active for lite-api.jup.ag',
        getQuote: async (params: any) => {
          buySlippages.push(params.slippageBps);
          if (params.outputMint.includes('PPFallback') || params.inputMint.includes('PPFallback')) return null;
          return {
            inputMint: params.inputMint,
            inAmount: params.amountRaw,
            outputMint: params.outputMint,
            outAmount: '25000000000',
            slippageBps: params.slippageBps,
            priceImpactPct: '0.01',
            routePlan: [],
          };
        },
        buildSwapTransaction: async () => ({ swapTransaction: mockTxB64 }),
        buildPumpPortalSwapTransaction: async () => {
          ppFallbacks += 1;
          return new Uint8Array(mockTxBytes);
        },
      },
    };
    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => 'sigMock111',
      pollConfirmation: async () => {
        pollAttempt += 1;
        // First buy attempt reverts with on-chain slippage 6001; retry succeeds cleanly
        if (pollAttempt === 1) {
          return { status: 'failed', err: 'On-chain slippage exceeded ({"InstructionError":[3,{"Custom":6001}]})' };
        }
        if (activeMint) {
          heldBalance[activeMint] = activeMint.includes('Retry') ? 25000 : 12000;
        }
        return { status: 'confirmed' };
      },
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        solDeltaLamports: -7_142_857,
        feeLamports: 5000,
        tokenDeltaUi: 25000,
      }),
      findRecentSellSignature: async () => null,
    };
    manager.attachOrchestrator(mockOrchestrator as unknown as BotOrchestrator, mockAdapter);

    // Tight 3% slippage fails on attempt 1 (6001) and automatically retries once at bumped slippage -> succeeds!
    const retryRes = await manager.executeLiveBuy({
      mint: 'MintRetryBuy1111111111111111111111111111111',
      symbol: 'RETRY',
      tradeSizeUsd: 0.5,
      slippagePct: 3,
      solPriceUsd: 70,
    });
    assert.equal(retryRes.ok, true);
    assert.deepEqual(buySlippages, [300, 1000]);

    // When Jupiter returns null (429 / no route), PumpPortal trade-local automatically buys instead of failing!
    const ppBuyRes = await manager.executeLiveBuy({
      mint: 'MintPPFallback11111111111111111111111111111',
      symbol: 'PPBUY',
      tradeSizeUsd: 0.5,
      slippagePct: 3,
      solPriceUsd: 70,
    });
    assert.equal(ppBuyRes.ok, true);
    assert.equal(ppFallbacks, 1);

    // When Jupiter returns null on sell, PumpPortal trade-local automatically sells!
    const ppSellRes = await manager.executeLiveSell({
      mint: 'MintPPFallback11111111111111111111111111111',
      symbol: 'PPBUY',
      qty: 12000,
      rawAmount: '12000000000',
      decimals: 6,
      costUsd: 0.5,
      costSol: 0.0071,
      slippagePct: 3,
      solPriceUsd: 70,
      reason: 'take_profit_35',
    });
    assert.equal(ppSellRes.ok, true);
    assert.equal(ppFallbacks, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 4. bot.py skips redundant Jupiter sell-route probes when pair already has sells >= 2
  const pyScript = [
    'import sys, types, json, time',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'probe_calls = [0]',
    'def spy_probe(*a, **k):',
    '    probe_calls[0] += 1',
    '    return (True, "ok")',
    'bot._check_sell_route = spy_probe',
    'bot._rpc_mint_account_info = lambda m, c=None: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
    'bot.get_json = lambda u, **k: {"score_normalised": 10, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    'cfg = dict(bot.CONFIG)',
    'pair_active = {"dexId": "meteora", "priceUsd": "0.0001", "liquidity": {"usd": 8000}, "txns": {"m5": {"buys": 12, "sells": 4}}}',
    'ok1, _ = bot.hard_rug_check("MintActiveSells11111111111111111111111111", cfg, age_s=25, pair=pair_active)',
    'calls_after_active = probe_calls[0]',
    'pair_zero_sells = {"dexId": "meteora", "priceUsd": "0.0001", "liquidity": {"usd": 8000}, "txns": {"m5": {"buys": 12, "sells": 0}}}',
    'ok2, _ = bot.hard_rug_check("MintZeroSells1111111111111111111111111111", cfg, age_s=25, pair=pair_zero_sells)',
    'calls_after_zero = probe_calls[0]',
    'print(json.dumps({"ok1": ok1, "calls_after_active": calls_after_active, "ok2": ok2, "calls_after_zero": calls_after_zero}))',
  ].join('\n');
  const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
  assert.equal(pyOut.ok1, true);
  assert.equal(pyOut.calls_after_active, 0, 'Active pair with >=2 sells should not burn Jupiter /quote quota');
  assert.equal(pyOut.ok2, true);
  assert.equal(pyOut.calls_after_zero, 1, 'Zero-sell honeypot suspect still checks Jupiter sell route');
});

test('v1.35.0: Speed & Anti-Rug checkboxes (checked applies rule, unchecked ignores rule) across SniperManager, JupiterProvider & bot.py', async () => {
  const { JupiterProvider } = await import('../providers/jupiter.ts');
  const kp = await Keypair.generate();
  const mockTxB64 = createBase64MockTx(kp);
  const mockTxBytes = Buffer.from(mockTxB64, 'base64');

  // 1. Raydium Trade API direct fallback test
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://transaction-v1.raydium.io/compute/swap-base-in')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { swapType: 'BaseIn', inputMint: 'So111', outputMint: 'MintRay', outputAmount: '100000' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://transaction-v1.raydium.io/transaction/swap-base-in') {
      return new Response(
        JSON.stringify({ success: true, data: [{ transaction: mockTxB64 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const jup = new JupiterProvider();
    const rayTx = await jup.buildRaydiumSwapTransaction({
      userPublicKey: kp.publicKey.toBase58(),
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'MintRay111111111111111111111111111111111111',
      amountRaw: '7100000',
      slippageBps: 800,
    });
    assert.ok(rayTx instanceof Uint8Array && rayTx.length > 32);
  } finally {
    globalThis.fetch = prevFetch;
  }

  // 2. SniperManager speed/fallback/quota flags (checked vs unchecked)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1350-'));
  try {
    const manager = new SniperManager({ baseDir: tmpDir, startTimers: false });
    let inspectCalls = 0;
    let raydiumCalls = 0;
    let ppCalls = 0;
    let revQuoteCalls = 0;
    const heldByMint = new Map<string, number>();
    let currentMint = '';

    const mockOrchestrator = {
      signer: {
        isUnlocked: () => true,
        getPublicKey: () => kp.publicKey.toBase58(),
        signVersionedTransaction: async () => undefined,
      },
      rpcPool: {
        getAgreedBalanceSol: async () => ({ agreed: true, balanceSol: 0.5, readings: [0.5, 0.5] }),
        getAgreedTokenBalanceUi: async (_owner: string, mint: string) => {
          currentMint = mint;
          const bal = heldByMint.get(mint) ?? 0;
          return {
            agreed: true,
            balanceUi: bal,
            readings: [bal, bal],
            decimals: 6,
            rawAmount: bal > 0 ? String(bal * 1_000_000) : '0',
          };
        },
        inspectTokenOnChain: async () => {
          inspectCalls += 1;
          return { decimals: 6 };
        },
      },
      jupiter: {
        getLiveSolPriceUsd: async () => 70,
        getLastQuoteError: () => 'No routes found',
        getQuote: async (params: any) => {
          currentMint = params.outputMint;
          if (params.outputMint.includes('RayOnly')) return null;
          return {
            inputMint: params.inputMint,
            inAmount: params.amountRaw,
            outputMint: params.outputMint,
            outAmount: '5000000000',
            slippageBps: params.slippageBps,
            priceImpactPct: '0.01',
            routePlan: [],
          };
        },
        buildSwapTransaction: async () => ({ swapTransaction: mockTxB64 }),
        buildPumpPortalSwapTransaction: async () => {
          ppCalls += 1;
          return null;
        },
        buildRaydiumSwapTransaction: async () => {
          raydiumCalls += 1;
          return new Uint8Array(mockTxBytes);
        },
        getReverseExitPricesUsd: async () => {
          revQuoteCalls += 1;
          return { MintRev: 0.001 };
        },
      },
    };
    const mockAdapter: LiveTxAdapter = {
      sendSignedTransaction: async () => 'sigV1350',
      pollConfirmation: async () => {
        if (currentMint) heldByMint.set(currentMint, 5000);
        return { status: 'confirmed' };
      },
      reconcileParsedSwapSolDelta: async () => ({
        found: true,
        solDeltaLamports: -7_142_857,
        feeLamports: 5000,
        tokenDeltaUi: 5000,
      }),
      findRecentSellSignature: async () => null,
    };
    manager.attachOrchestrator(mockOrchestrator as unknown as BotOrchestrator, mockAdapter);

    // Settings persistence of all 10 checkboxes
    const saved = manager.updateSettings({
      fast_live_buy_enabled: true,
      parallel_rug_screen_enabled: true,
      jupiter_quota_guard_enabled: true,
      direct_dex_fallback_enabled: true,
      anti_rug_tight_score_enabled: true,
      anti_rug_pool_depth_check_enabled: true,
      anti_rug_sell_sim_enabled: true,
      anti_rug_copycat_cooldown_enabled: true,
      require_lp_locked: true,
      auto_rug_exit: true,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.settings?.anti_rug_tight_score_enabled, true);

    // fast_live_buy_enabled=true skips inspectTokenOnChain when decimals provided
    const fastBuy = await manager.executeLiveBuy({
      mint: 'MintFast11111111111111111111111111111111111',
      symbol: 'FAST',
      tradeSizeUsd: 0.5,
      slippagePct: 3,
      solPriceUsd: 70,
      decimals: 6,
    });
    assert.equal(fastBuy.ok, true);
    assert.equal(inspectCalls, 0);

    // jupiter_quota_guard_enabled=true pauses reverse quotes right after a live swap
    const pausedRev = await manager.getReverseExitPrices([{ mint: 'MintRev', qty: 100 }], 70);
    assert.equal(pausedRev.pausedForQuota, true);
    assert.equal(revQuoteCalls, 0);

    // direct_dex_fallback_enabled=true invokes Raydium when Jupiter & PumpPortal return null
    const rayFallbackBuy = await manager.executeLiveBuy({
      mint: 'MintRayOnly11111111111111111111111111111111',
      symbol: 'RAYFB',
      tradeSizeUsd: 0.5,
      slippagePct: 3,
      solPriceUsd: 70,
      decimals: 6,
    });
    assert.equal(rayFallbackBuy.ok, true);
    assert.equal(ppCalls, 1);
    assert.equal(raydiumCalls, 1);

    // Now uncheck fast_live_buy_enabled, jupiter_quota_guard_enabled, direct_dex_fallback_enabled
    manager.updateSettings({
      fast_live_buy_enabled: false,
      jupiter_quota_guard_enabled: false,
      direct_dex_fallback_enabled: false,
    });

    const slowBuy = await manager.executeLiveBuy({
      mint: 'MintSlow11111111111111111111111111111111111',
      symbol: 'SLOW',
      tradeSizeUsd: 0.5,
      slippagePct: 3,
      solPriceUsd: 70,
      decimals: 6,
    });
    assert.equal(slowBuy.ok, true);
    assert.equal(inspectCalls, 1, 'Unchecking fast_live_buy_enabled should run full inspectTokenOnChain');

    // Unchecked jupiter_quota_guard_enabled runs reverse quote immediately after swap
    const unguardedRev = await manager.getReverseExitPrices([{ mint: 'MintRev', qty: 100 }], 70);
    assert.equal(unguardedRev.pausedForQuota, undefined);
    assert.equal(revQuoteCalls, 1);

    // Unchecked direct_dex_fallback_enabled fails instead of calling PumpPortal/Raydium
    const noFallbackBuy = await manager.executeLiveBuy({
      mint: 'MintRayOnly11111111111111111111111111111111',
      symbol: 'NOFB',
      tradeSizeUsd: 0.5,
      slippagePct: 3,
      solPriceUsd: 70,
      decimals: 6,
    });
    assert.equal(noFallbackBuy.ok, false);
    assert.equal(ppCalls, 1, 'Should not invoke PumpPortal when direct_dex_fallback_enabled is unchecked');
    assert.equal(raydiumCalls, 1, 'Should not invoke Raydium when direct_dex_fallback_enabled is unchecked');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 3. Python bot.py unit verification for all anti-rug & filter checkboxes (true vs false)
  const pyScript = [
    'import sys, types, json, time',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'bot._rpc_mint_account_info = lambda m, c=None: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
    'def fake_rc(url, **k):',
    '    if "rugcheck" not in url: return None',
    '    if "TightScore" in url:',
    '        return {"score_normalised": 48, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 16.0}, {"address": "W2", "owner": "W2", "pct": 16.0}]}',
    '    if "MeteoraUnlocked" in url:',
    '        return {"score_normalised": 10, "risks": [], "markets": [{"pubkey": "PoolM", "marketType": "meteora", "lp": {"lpLockedPct": 0}}], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]}',
    '    return {"score_normalised": 10, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]}',
    'bot.get_json = fake_rc',
    'probe_impacts = []',
    'def spy_sell_route(mint, decimals, px, cfg, max_impact_pct=15.0):',
    '    probe_impacts.append(max_impact_pct)',
    '    return (True, "ok")',
    'bot._check_sell_route = spy_sell_route',
    'now_ms = int(time.time() * 1000)',
    // A. anti_rug_tight_score_enabled
    'cfg_tight = {**bot.CONFIG, "anti_rug_tight_score_enabled": True}',
    'ok_tight, why_tight = bot.hard_rug_check("TightScore111111111111111111111111111111111", cfg_tight, age_s=25, pair={"dexId": "pumpswap", "priceUsd": "0.001", "liquidity": {"usd": 8000}, "txns": {"m5": {"buys": 10, "sells": 3}}})',
    'cfg_loose = {**bot.CONFIG, "anti_rug_tight_score_enabled": False}',
    'ok_loose, _ = bot.hard_rug_check("TightScore111111111111111111111111111111111", cfg_loose, age_s=25, pair={"dexId": "pumpswap", "priceUsd": "0.001", "liquidity": {"usd": 8000}, "txns": {"m5": {"buys": 10, "sells": 3}}})',
    // B. anti_rug_pool_depth_check_enabled
    'shallow_pair = {"baseToken": {"address": "MintShallow11", "symbol": "SHL"}, "dexId": "pumpswap", "pairCreatedAt": now_ms - 25000, "priceUsd": "0.001", "liquidity": {"usd": 2000}, "fdv": 10000, "volume": {"m5": 5000}, "txns": {"m5": {"buys": 10, "sells": 2}}}',
    'cfg_depth_on = {**bot.CONFIG, "min_liquidity_usd": 1500, "anti_rug_pool_depth_check_enabled": True}',
    'cfg_depth_off = {**bot.CONFIG, "min_liquidity_usd": 1500, "anti_rug_pool_depth_check_enabled": False}',
    'ok_depth_on, code_depth_on, _ = bot.passes_filters(shallow_pair, cfg_depth_on, now_ms)',
    'ok_depth_off, _, _ = bot.passes_filters(shallow_pair, cfg_depth_off, now_ms)',
    // C. anti_rug_sell_sim_enabled
    'pair_active = {"dexId": "pumpswap", "priceUsd": "0.001", "liquidity": {"usd": 8000}, "txns": {"m5": {"buys": 12, "sells": 4}}}',
    'bot.hard_rug_check("SellSimMint1111111111111111111111111111111111", {**bot.CONFIG, "anti_rug_sell_sim_enabled": False}, age_s=25, pair=pair_active)',
    'impacts_when_off = list(probe_impacts)',
    'bot.hard_rug_check("SellSimMint1111111111111111111111111111111111", {**bot.CONFIG, "anti_rug_sell_sim_enabled": True}, age_s=25, pair=pair_active)',
    'impacts_when_on = list(probe_impacts)',
    // D. anti_rug_copycat_cooldown_enabled
    'clone_pair = {"baseToken": {"address": "MintClone11", "symbol": "SCAMCLONE"}, "dexId": "pumpswap", "pairCreatedAt": now_ms - 25000, "priceUsd": "0.001", "liquidity": {"usd": 6000}, "fdv": 20000, "volume": {"m5": 5000}, "txns": {"m5": {"buys": 10, "sells": 2}}}',
    'bot._note_symbol_cooldown("SCAMCLONE", {**bot.CONFIG, "anti_rug_copycat_cooldown_enabled": True})',
    'ok_cd_on, code_cd_on, _ = bot.passes_filters(clone_pair, {**bot.CONFIG, "anti_rug_copycat_cooldown_enabled": True}, now_ms)',
    'ok_cd_off, _, _ = bot.passes_filters(clone_pair, {**bot.CONFIG, "anti_rug_copycat_cooldown_enabled": False}, now_ms)',
    // E. require_lp_locked blocks 0% Meteora unlocked LP when checked, allows when unchecked
    'met_pair = {"dexId": "meteora", "priceUsd": "0.001", "liquidity": {"usd": 8000}, "txns": {"m5": {"buys": 10, "sells": 3}}}',
    'ok_lp_on, why_lp_on = bot.hard_rug_check("MeteoraUnlocked111111111111111111111111111111", {**bot.CONFIG, "require_lp_locked": True}, age_s=25, pair=met_pair)',
    'ok_lp_off, _ = bot.hard_rug_check("MeteoraUnlocked111111111111111111111111111111", {**bot.CONFIG, "require_lp_locked": False}, age_s=25, pair=met_pair)',
    'print(json.dumps({"ok_tight": ok_tight, "why_tight": why_tight, "ok_loose": ok_loose, "ok_depth_on": ok_depth_on, "code_depth_on": code_depth_on, "ok_depth_off": ok_depth_off, "impacts_when_off": impacts_when_off, "impacts_when_on": impacts_when_on, "ok_cd_on": ok_cd_on, "code_cd_on": code_cd_on, "ok_cd_off": ok_cd_off, "ok_lp_on": ok_lp_on, "why_lp_on": why_lp_on, "ok_lp_off": ok_lp_off}))',
  ].join('\n');
  const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
  assert.equal(pyOut.ok_tight, false);
  assert.match(pyOut.why_tight, /rugcheck risk score 48\/100 >= 45/i);
  assert.equal(pyOut.ok_loose, true);
  assert.equal(pyOut.ok_depth_on, false);
  assert.equal(pyOut.code_depth_on, 'low liquidity');
  assert.equal(pyOut.ok_depth_off, true);
  assert.deepEqual(pyOut.impacts_when_off, []);
  assert.deepEqual(pyOut.impacts_when_on, [10]);
  assert.equal(pyOut.ok_cd_on, false);
  assert.equal(pyOut.code_cd_on, 'copycat cooldown');
  assert.equal(pyOut.ok_cd_off, true);
  assert.equal(pyOut.ok_lp_on, false);
  assert.match(pyOut.why_lp_on, /LP burned\/locked/i);
  assert.equal(pyOut.ok_lp_off, true);
});

test('v1.36.0: axiom_pulse_migrated_only_enabled blocks unmigrated pumpfun bonding curve coins and passes migrated pumpswap/raydium coins', async () => {
  const pyScript = [
    'import sys, types, json',
    'req = types.ModuleType("requests")',
    'class DummySess:',
    '    def get(self, *a, **k): raise RuntimeError("no net")',
    '    def post(self, *a, **k): raise RuntimeError("no net")',
    'req.Session = lambda: DummySess()',
    'sys.modules["requests"] = req',
    'sys.path.insert(0, "sniper")',
    'import bot',
    'cfg = {**bot.CONFIG, "axiom_pulse_migrated_only_enabled": True}',
    'unmigrated_pair = {"baseToken": {"address": "UnmigratedPump111111111111111111111pumps"}, "dexId": "pumpfun"}',
    'migrated_pair = {"baseToken": {"address": "MigratedSwap1111111111111111111111111111"}, "dexId": "pumpswap"}',
    'ok_unmigrated, reason_unmigrated = bot.matches_enabled_platforms(unmigrated_pair, cfg=cfg)',
    'ok_migrated, reason_migrated = bot.matches_enabled_platforms(migrated_pair, cfg=cfg)',
    'print(json.dumps({"ok_unmigrated": ok_unmigrated, "reason_unmigrated": reason_unmigrated, "ok_migrated": ok_migrated, "reason_migrated": reason_migrated}))',
  ].join('\n');
  const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
  const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
  assert.equal(pyOut.ok_unmigrated, false);
  assert.equal(pyOut.ok_migrated, true);
});

test('v1.37.0: Python sniper option_enabled checkboxes, creator launch/rug speed history, and min-max coin age gap', () => {
  // 1. isPyOptionEnabled & validatePythonSniperSettings
  assert.equal(isPyOptionEnabled({ option_enabled: { min_age_minutes: false } }, 'min_age_minutes', false), false);
  assert.equal(isPyOptionEnabled({}, 'min_age_minutes', false), false);
  assert.equal(isPyOptionEnabled({}, 'max_age_minutes', true), true);

  // Min age > Max age rejected when min_age_minutes checkbox is ON
  const badAgeGap = validatePythonSniperSettings({
    min_age_minutes: 300,
    max_age_minutes: 120,
    option_enabled: { min_age_minutes: true, max_age_minutes: true },
  });
  assert.equal(badAgeGap.valid, false);
  assert.match(badAgeGap.error || '', /cannot exceed Maximum coin age/i);

  // Valid age gap (5m to 300m) and disabled min_age_minutes skip validation cleanly
  const goodAgeGap = validatePythonSniperSettings({
    min_age_minutes: 5,
    max_age_minutes: 300,
    option_enabled: { min_age_minutes: true, max_age_minutes: true },
  });
  assert.equal(goodAgeGap.valid, true);

  const disabledMinAge = validatePythonSniperSettings({
    min_age_minutes: 999,
    max_age_minutes: 2,
    option_enabled: { min_age_minutes: false, max_age_minutes: true },
  });
  assert.equal(disabledMinAge.valid, true);

  // Creator history invalid negative bounds fail when enabled, pass when unchecked
  const badCreatorBounds = validatePythonSniperSettings({
    check_creator_history: true,
    max_creator_launches: -2,
    option_enabled: { check_creator_history: true, max_creator_launches: true },
  });
  assert.equal(badCreatorBounds.valid, false);
  assert.match(badCreatorBounds.error || '', /Max owner prior coins launched/i);

  const skippedCreatorBounds = validatePythonSniperSettings({
    check_creator_history: true,
    max_creator_launches: -2,
    option_enabled: { check_creator_history: true, max_creator_launches: false },
  });
  assert.equal(skippedCreatorBounds.valid, true);

  // Recover principal blocked if take_profit_pct checkbox is unchecked
  const recWithoutTp = validatePythonSniperSettings({
    recover_principal_enabled: true,
    trade_size_usd: 5,
    recover_principal_sell_pct: 50,
    take_profit_pct: 120,
    option_enabled: { take_profit_pct: false },
  });
  assert.equal(recWithoutTp.valid, false);
  assert.match(recWithoutTp.error || '', /Enable Take profit %/i);

  // 2. SniperManager option_enabled persistence & rugpull_writeoff updates creator_history.json
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1370-mgr-'));
  try {
    const manager = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const defaults = manager.getStatus().settings as Record<string, any>;
    assert.equal(defaults.option_enabled?.min_age_minutes, false);
    assert.equal(defaults.check_creator_history, true);
    assert.equal(defaults.max_creator_launches, 5);
    assert.equal(defaults.max_creator_rugged_coins, 0);
    assert.equal(defaults.creator_fast_rug_window_min, 60);

    const upd = manager.updateSettings({
      min_age_minutes: 5,
      max_age_minutes: 300,
      option_enabled: {
        min_age_minutes: true,
        slippage_pct: false,
        fee_pct: false,
      },
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.settings?.option_enabled?.min_age_minutes, true);
    assert.equal(upd.settings?.option_enabled?.slippage_pct, false);

    // Seed paper state position with creator + launch timestamp 15 minutes ago
    const { stateFile } = getSniperFilePaths('paper', tmpDir);
    const nowSec = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        mode: 'paper',
        cash: 45,
        positions: {
          RugMint111111111111111111111111111111111111: {
            symbol: 'RUGX',
            mint: 'RugMint111111111111111111111111111111111111',
            creator: 'SerialOwner1111111111111111111111111111111',
            created_at_sec: nowSec - 900,
            entry_price: 0.001,
            current_price: 0.001,
            qty: 5000,
            cost: 5,
            opened: nowSec - 600,
          },
        },
        closed: 0,
        total_pnl: 0,
        day_pnl: 0,
      }),
      'utf-8'
    );

    const delRes = manager.forceDeletePosition('RugMint111111111111111111111111111111111111', 'rugpull_writeoff');
    assert.equal(delRes.ok, true);

    const histPath = path.join(tmpDir, 'creator_history.json');
    assert.equal(fs.existsSync(histPath), true);
    const hist = JSON.parse(fs.readFileSync(histPath, 'utf-8'));
    const entry = hist['SerialOwner1111111111111111111111111111111']?.['RugMint111111111111111111111111111111111111'];
    assert.ok(entry);
    assert.equal(entry.rugged, true);
    assert.equal(entry.reason, 'rugpull_writeoff');
    assert.ok(entry.rug_minutes >= 14.5 && entry.rug_minutes <= 16.0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 3. Isolated Python bot.py test for min-max age gap, opt_on bypasses, and creator history speed/launch checks
  const pyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1370-py-'));
  try {
    const pyScript = [
      'import sys, types, json, time, os',
      'req = types.ModuleType("requests")',
      'class DummySess:',
      '    def get(self, *a, **k): raise RuntimeError("no net")',
      '    def post(self, *a, **k): raise RuntimeError("no net")',
      'req.Session = lambda: DummySess()',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      `TMP_DIR = ${JSON.stringify(pyTmpDir)}`,
      'bot._base_dir = lambda: TMP_DIR',
      'now_ms = int(time.time() * 1000)',
      'def make_pair(mint, age_min, liq=8000, buys=12, sells=3):',
      '    return {"baseToken": {"address": mint, "symbol": "GAP"}, "dexId": "pumpswap", "pairCreatedAt": now_ms - int(age_min * 60000), "priceUsd": "0.001", "liquidity": {"usd": liq}, "fdv": 20000, "volume": {"m5": 5000}, "txns": {"m5": {"buys": buys, "sells": sells}}}',
      'cfg_gap = {**bot.CONFIG, "min_age_minutes": 5.0, "max_age_minutes": 300.0, "option_enabled": {"min_age_minutes": True, "max_age_minutes": True}}',
      'ok_young, code_young, _ = bot.passes_filters(make_pair("YoungMint11", 2.0), cfg_gap, now_ms)',
      'ok_in_gap, _, _ = bot.passes_filters(make_pair("InGapMint11", 60.0), cfg_gap, now_ms)',
      'ok_old, code_old, _ = bot.passes_filters(make_pair("OldMint1111", 400.0), cfg_gap, now_ms)',
      'cfg_bypass = {**bot.CONFIG, "min_liquidity_usd": 999999.0, "min_buys_m5": 500, "max_age_minutes": 1.0, "option_enabled": {"min_liquidity_usd": False, "min_buys_m5": False, "max_age_minutes": False, "min_age_minutes": False}}',
      'ok_bypass, code_bypass, _ = bot.passes_filters(make_pair("BypassMint1", 120.0, liq=4000, buys=4, sells=1), cfg_bypass, now_ms)',
      'bot.get_json = lambda *a, **k: None',
      'bot._rpc_earliest_tx_ms = lambda *a, **k: 0',
      'fast_rep = {"creator": "FastRugDev11", "creatorTokens": [{"mint": "PriorRug1", "createdAt": int((now_ms - 3600000)/1000), "rugged": True, "ruggedAt": int((now_ms - 3600000 + 900000)/1000)}]}',
      'res_fast = bot._evaluate_creator_history("NewToken1", "FastRugDev11", fast_rep, {**bot.CONFIG, "check_creator_history": True, "max_creator_launches": 5, "max_creator_rugged_coins": 0, "creator_fast_rug_window_min": 60})',
      'serial_rep = {"creator": "SerialDev11", "creatorTokens": [{"mint": f"P{i}", "createdAt": int((now_ms - (i+2)*3600000)/1000), "rugged": False} for i in range(6)]}',
      'res_serial = bot._evaluate_creator_history("NewToken2", "SerialDev11", serial_rep, {**bot.CONFIG, "check_creator_history": True, "max_creator_launches": 5, "max_creator_rugged_coins": 0, "creator_fast_rug_window_min": 60})',
      'res_off = bot._evaluate_creator_history("NewToken3", "FastRugDev11", fast_rep, {**bot.CONFIG, "check_creator_history": False})',
      'print(json.dumps({"ok_young": ok_young, "code_young": code_young, "ok_in_gap": ok_in_gap, "ok_old": ok_old, "code_old": code_old, "ok_bypass": ok_bypass, "code_bypass": code_bypass, "fast_ok": res_fast["ok"], "fast_reason": res_fast["reason"], "fast_min": res_fast["fast_rug_min"], "serial_ok": res_serial["ok"], "serial_reason": res_serial["reason"], "off_ok": res_off["ok"]}))',
    ].join('\n');
    const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyOut.ok_young, false);
    assert.equal(pyOut.code_young, 'too young');
    assert.equal(pyOut.ok_in_gap, true);
    assert.equal(pyOut.ok_old, false);
    assert.equal(pyOut.code_old, 'too old');
    assert.equal(pyOut.ok_bypass, true, `Unexpected rejection when filters unchecked: ${pyOut.code_bypass}`);
    assert.equal(pyOut.fast_ok, false);
    assert.match(pyOut.fast_reason, /rugged 1 coin|15\.0m/i);
    assert.ok(pyOut.fast_min >= 14.9 && pyOut.fast_min <= 15.1);
    assert.equal(pyOut.serial_ok, false);
    assert.match(pyOut.serial_reason, /launched 6 prior coins > 5 limit/i);
    assert.equal(pyOut.off_ok, true);
  } finally {
    fs.rmSync(pyTmpDir, { recursive: true, force: true });
  }
});

test('v1.39.0: consolidateSniperTrades merges BUY & SELL into one entry per coin trade with buy/sell price & exit diff', () => {
  const rows = [
    // DUVAL: buy then full profit sell
    { time: '2026-11-24T18:59:15Z', action: 'BUY', symbol: 'DUVAL', mint: 'MintDuval', price: '0.00001404', amount: '6.25', pnlUsd: '', pnlPct: '', reason: 'sniper_entry', txSig: 'txDuvalBuy' },
    // SuperELON: still open
    { time: '2026-11-24T18:59:15Z', action: 'BUY', symbol: 'SuperELON', mint: 'MintElON', price: '0.00008701', amount: '6.75', pnlUsd: '', pnlPct: '', reason: 'sniper_entry', txSig: 'txElonBuy' },
    { time: '2026-11-24T19:00:05Z', action: 'SELL', symbol: 'DUVAL', mint: 'MintDuval', price: '0.00001868', amount: '8.15', pnlUsd: '1.9001', pnlPct: '30.40', reason: 'take_profit_35', entryPrice: '0.00001404', txSig: 'txDuvalSell' },
    // MOON: buy + partial principal recovery + final trailing stop
    { time: '2026-11-24T19:01:00Z', action: 'BUY', symbol: 'MOON', mint: 'MintMoon', price: '0.00010000', amount: '5.00', pnlUsd: '', pnlPct: '', reason: 'sniper_entry', txSig: 'txMoonBuy' },
    { time: '2026-11-24T19:02:00Z', action: 'SELL', symbol: 'MOON', mint: 'MintMoon', price: '0.00022000', amount: '5.20', pnlUsd: '2.70', pnlPct: '108.00', reason: 'principal_recovery_50pct', txSig: 'txMoonPart' },
    { time: '2026-11-24T19:03:00Z', action: 'SELL', symbol: 'MOON', mint: 'MintMoon', price: '0.00030500', amount: '5.50', pnlUsd: '3.63', pnlPct: '194.00', reason: 'trailing_stop_15', txSig: 'txMoonFinal' },
    // Re-entry on DUVAL (separate trade record)
    { time: '2026-11-24T19:05:00Z', action: 'BUY', symbol: 'DUVAL', mint: 'MintDuval', price: '0.00002000', amount: '4.00', pnlUsd: '', pnlPct: '', reason: 'sniper_entry', txSig: 'txDuvalRebuy' },
  ];

  const consolidated = consolidateSniperTrades(rows, 200);
  // 7 raw rows -> 4 consolidated coin trades
  assert.equal(consolidated.length, 4);

  // Newest activity first: DUVAL re-entry (OPEN)
  assert.equal(consolidated[0].symbol, 'DUVAL');
  assert.equal(consolidated[0].tradeStatus, 'OPEN');
  assert.equal(consolidated[0].entryPrice, '0.00002000');
  assert.equal(consolidated[0].exitPrice, '');
  assert.equal(consolidated[0].buyAmountUsd, '4.00');
  assert.equal(consolidated[0].exitAmountUsd, '');
  assert.equal(consolidated[0].txBuy, 'txDuvalRebuy');

  // Second newest: MOON (1 row combining buy + partial + final sell)
  assert.equal(consolidated[1].symbol, 'MOON');
  assert.equal(consolidated[1].tradeStatus, 'CLOSED');
  assert.equal(consolidated[1].entryPrice, '0.00010000');
  assert.equal(consolidated[1].exitPrice, '0.00030500');
  assert.equal(consolidated[1].buyAmountUsd, '5.0000');
  assert.equal(consolidated[1].exitAmountUsd, '10.7000');
  assert.equal(consolidated[1].diffUsd, '5.7000');
  assert.equal(consolidated[1].pnlUsd, '6.3300');
  assert.equal(consolidated[1].pnlPct, '126.60');
  assert.equal(consolidated[1].exitCount, 2);
  assert.equal(consolidated[1].txBuy, 'txMoonBuy');
  assert.equal(consolidated[1].txSell, 'txMoonFinal');

  // Third newest: first DUVAL closed trade
  assert.equal(consolidated[2].symbol, 'DUVAL');
  assert.equal(consolidated[2].tradeStatus, 'CLOSED');
  assert.equal(consolidated[2].entryPrice, '0.00001404');
  assert.equal(consolidated[2].exitPrice, '0.00001868');
  assert.equal(consolidated[2].buyAmountUsd, '6.2500');
  assert.equal(consolidated[2].exitAmountUsd, '8.1500');
  assert.equal(consolidated[2].diffUsd, '1.9000');
  assert.equal(consolidated[2].pnlPct, '30.40');
  assert.equal(consolidated[2].reason, 'take_profit_35');

  // Fourth: SuperELON still open
  assert.equal(consolidated[3].symbol, 'SuperELON');
  assert.equal(consolidated[3].tradeStatus, 'OPEN');
});

test('v1.39.0: Open positions expose dev wallet address, launches count, and rug pull count from creator_history & bot.py', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-dev-wallet-'));
  try {
    const devWallet = 'DevWal1111111111111111111111111111111111111';
    const mintA = 'MintOpenAAA11111111111111111111111111111111';
    fs.writeFileSync(
      path.join(tmpDir, 'creator_history.json'),
      JSON.stringify({
        [devWallet]: {
          PriorRugMint1: { symbol: 'PRUG1', pool_created_at_ms: 1700000000000, rugged: true, rugged_at_ms: 1700000600000 },
          PriorCleanMint2: { symbol: 'PCLN2', pool_created_at_ms: 1700005000000, rugged: false },
          [mintA]: { symbol: 'OPENA', pool_created_at_ms: 1700010000000, rugged: false },
        },
      }),
      'utf-8'
    );

    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    await mgr.switchMode('paper');
    const { stateFile } = getSniperFilePaths('paper', tmpDir);
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        mode: 'paper',
        cash: 40,
        positions: {
          [mintA]: {
            symbol: 'OPENA',
            qty: 1000,
            entry_price: 0.01,
            current_price: 0.012,
            cost: 10,
            opened: Date.now() / 1000 - 45,
            url: `https://dexscreener.com/solana/${mintA}`,
            dex: 'pumpfun',
            source: 'pumpportal',
          },
        },
        blacklist: [],
        closed: 0,
        wins: 0,
        total_pnl: 0,
        day_pnl: 0,
      }),
      'utf-8'
    );

    const status = mgr.getStatus();
    const pos = status.state.positions[mintA];
    assert.equal(pos.creator, devWallet);
    assert.equal(pos.creator_launches, 3);
    assert.equal(pos.creator_rugged, 1);
    assert.equal(pos.creator_fast_rug_min, 10);

    // Also verify bot.py hard_rug_check -> scan_and_buy / acct.buy stores creator stats on new positions
    const pyScript = [
      'import sys, types, json, time',
      'req = types.ModuleType("requests")',
      'class DummySess:',
      '    def get(self, *a, **k): raise RuntimeError("no net")',
      '    def post(self, *a, **k): raise RuntimeError("no net")',
      'req.Session = lambda: DummySess()',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      `TMP_DIR = ${JSON.stringify(tmpDir)}`,
      'bot._base_dir = lambda: TMP_DIR',
      'bot.get_json = lambda *a, **k: None',
      'bot._rpc_earliest_tx_ms = lambda *a, **k: 0',
      'bot._rpc_mint_account_info = lambda m, cfg=None: {"decimals": 6, "supply_ui": 1000000000.0, "mint_auth": None, "freeze_auth": None, "disallowed_extensions": []}',
      'bot._fetch_rugcheck_report = lambda m: {"score_normalised": 10, "creator": "DevFromRc1111111111111111111111111111111111", "creatorTokens": [{"mint": "OldM1", "rugged": False}, {"mint": "OldM2", "rugged": False}], "risks": [], "topHolders": [{"address": "H1", "owner": "H1", "pct": 3.0}]}',
      'pair = {"baseToken": {"address": "NewBuyMint1", "symbol": "NBUY"}, "dexId": "pumpfun", "priceUsd": "0.001", "liquidity": {"usd": 9000}, "txns": {"m5": {"buys": 10, "sells": 3}}}',
      'cfg = {**bot.CONFIG, "check_creator_history": True, "max_creator_launches": 5, "max_creator_rugged_coins": 0, "anti_sybil_enabled": False, "reused_socials_enabled": False}',
      'ok, why = bot.hard_rug_check("NewBuyMint1", cfg, 20.0, pair=pair)',
      'acct = bot.TradingAccount(cfg, mode="paper")',
      'c_stats = pair.get("_creator_stats") or {}',
      'acct.buy("NewBuyMint1", "NBUY", 0.001, "https://dexscreener.com/solana/NewBuyMint1", {"dex": "pumpfun", "source": "pumpportal", "age_s": 20, "creator": pair.get("_creator"), "creator_launches": c_stats.get("total_launches"), "creator_prior_launches": c_stats.get("prior_launches"), "creator_rugged": c_stats.get("rugged_count")})',
      'p = acct.state["positions"]["NewBuyMint1"]',
      'print(json.dumps({"ok": ok, "why": why, "creator": p.get("creator"), "launches": p.get("creator_launches"), "rugged": p.get("creator_rugged")}))',
    ].join('\n');
    const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyOut.ok, true, pyOut.why);
    assert.equal(pyOut.creator, 'DevFromRc1111111111111111111111111111111111');
    assert.equal(pyOut.launches, 3);
    assert.equal(pyOut.rugged, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.40.0: Early-Launch Rugpull Shield blocks dev bundles/hidden sell-tax/dev-sybil & executes instant WS creator_dump_exit and AMM collapse exit', async () => {
  const { PumpPortalWsProvider } = await import('../providers/pumpportal');
  const pp = new PumpPortalWsProvider();
  const mintDump = 'MintEarlyRugDump11111111111111111111111pump';
  const devAddr = 'DevWalletEarly1111111111111111111111111111';
  const t0 = Date.now() - 10_000;
  pp.ingestFrame(
    {
      mint: mintDump,
      symbol: 'FBOSS',
      name: 'Fake Boss',
      txType: 'create',
      traderPublicKey: devAddr,
      solAmount: 2.0,
      vSolInBondingCurve: 35,
      vTokensInBondingCurve: 900_000_000,
      marketCapSol: 39,
    },
    t0
  );
  pp.ingestFrame(
    {
      mint: mintDump,
      txType: 'sell',
      traderPublicKey: devAddr,
      solAmount: 1.9,
      vSolInBondingCurve: 30.1,
      vTokensInBondingCurve: 999_000_000,
      marketCapSol: 30,
    },
    t0 + 4000
  );
  const snaps = pp.getLiveMintSnapshots([mintDump], 70, t0 + 5000);
  assert.equal(snaps[mintDump]?.creator, devAddr);
  assert.equal(snaps[mintDump]?.creatorSold, true);
  assert.ok(snaps[mintDump]?.recentSellers.includes(devAddr));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1400-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const status = mgr.getStatus();
    assert.equal((status.settings as any).early_rug_shield_enabled, true);
    mgr.attachOrchestrator({
      pumpPortal: pp,
      signer: { isUnlocked: () => false, getPublicKey: () => null, getMaskedPublicKey: () => 'Locked' },
      rpcPool: { getHealthSnapshot: () => [] },
    } as any);
    mgr.setWsWatchedMints([mintDump]);
    const feed = mgr.getPumpPortalFeed();
    assert.equal(feed.open_prices[mintDump]?.creator, devAddr);
    assert.equal(feed.open_prices[mintDump]?.creatorSold, true);

    const pyScript = [
      'import sys, types, json, time',
      'req = types.ModuleType("requests")',
      'class DummyResp:',
      '    def __init__(self, code, data): self.status_code = code; self._d = data',
      '    def json(self): return self._d',
      'class DummySess:',
      '    def get(self, url, **k):',
      '        if "quote" in url:',
      '            # Return 50% hidden sell-tax value loss on $5 trade (~0.0714 SOL -> 0.030 SOL) despite low reported priceImpactPct',
      '            return DummyResp(200, {"outAmount": str(int(0.030 * 1e9)), "priceImpactPct": "0.01"})',
      '        return DummyResp(404, {})',
      '    def post(self, url, json=None, **k):',
      '        m = (json or {}).get("method")',
      '        p = (json or {}).get("params") or []',
      '        target = p[0] if p else ""',
      '        if m == "getSignaturesForAddress":',
      '            return DummyResp(200, {"result": [{"signature": f"sig_{target}", "blockTime": int(time.time()) - 60}]})',
      '        if m == "getTransaction":',
      '            sig = target',
      '            # Mint creation resolves CreatorA; CreatorA + Holder1 share FunderX',
      '            if sig == "sig_MintRpcCreator1111111111111111111111111111":',
      '                return DummyResp(200, {"result": {"transaction": {"message": {"accountKeys": [{"pubkey": "CreatorA111", "signer": True}]}}}})',
      '            if sig in ("sig_CreatorA111", "sig_HolderSybil1"):',
      '                return DummyResp(200, {"result": {"transaction": {"message": {"accountKeys": [{"pubkey": "FunderSharedX", "signer": True}, {"pubkey": sig[4:], "signer": True}]}}}})',
      '        return DummyResp(200, {"result": None})',
      'req.Session = lambda: DummySess()',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      `TMP_DIR = ${JSON.stringify(tmpDir)}`,
      'bot._base_dir = lambda: TMP_DIR',
      'bot._session = DummySess()',
      'now_ms = int(time.time() * 1000)',
      'cfg = {**bot.CONFIG, "enabled_platforms": [], "use_jupiter_price": False, "use_real_swap_quotes": False}',
      // 1. passes_filters blocks dev sniper bundle (>8 SOL initial buy), thin curve spoof, and 20s 6b/0s honeypot
      'dev_bundle_pair = {"baseToken": {"address": "MDevB", "symbol": "DBND"}, "dexId": "pumpfun", "pairCreatedAt": now_ms - 15000, "priceUsd": "0.0001", "liquidity": {"usd": 8000}, "volume": {"m5": 3000}, "txns": {"m5": {"buys": 12, "sells": 2}}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 8, "sells_60s": 2, "initial_buy_sol": 10.5, "real_sol": 5.0, "v_sol": 35.0}}',
      'thin_curve_pair = {"baseToken": {"address": "MThin", "symbol": "THIN"}, "dexId": "pumpfun", "pairCreatedAt": now_ms - 12000, "priceUsd": "0.0001", "liquidity": {"usd": 6000}, "volume": {"m5": 3000}, "txns": {"m5": {"buys": 10, "sells": 2}}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 8, "sells_60s": 2, "initial_buy_sol": 0.5, "real_sol": 0.4, "v_sol": 30.4}}',
      'early_hp_pair = {"baseToken": {"address": "MHP", "symbol": "HP"}, "dexId": "raydium", "pairCreatedAt": now_ms - 22000, "priceUsd": "0.0001", "liquidity": {"usd": 8000}, "volume": {"m5": 3000}, "txns": {"m5": {"buys": 7, "sells": 0}}}',
      'out = {}',
      'out["dev_bundle"] = list(bot.passes_filters(dev_bundle_pair, cfg, now_ms))',
      'out["thin_curve"] = list(bot.passes_filters(thin_curve_pair, cfg, now_ms))',
      'out["early_hp"] = list(bot.passes_filters(early_hp_pair, cfg, now_ms))',
      // 2. _check_sell_route catches >30% hidden sell tax
      'bot.get_sol_price_usd = lambda c: (70.0, time.time())',
      'out["hidden_tax"] = list(bot._check_sell_route("MintTaxed1", 6, 0.001, cfg, 15.0))',
      // 3. hard_rug_check resolves creator via RPC and catches dev-to-holder shared funder on Pump.fun curve + top-3 whale split
      'bot._check_sell_route = lambda *a, **k: (True, "ok")',
      'bot._rpc_mint_account_info = lambda m, c=None: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
      'bot._evaluate_creator_history = lambda m, ca, r, c, pair=None: {"ok": True, "prior_launches": 0, "total_launches": 1, "rugged_count": 0, "fast_rug_min": None}',
      'bot._rpc_owner_token_pct = lambda *a, **k: 0.0',
      'bot.get_json = lambda u, **k: {"score_normalised": 10, "risks": [], "topHolders": [{"address": "HolderSybil1", "owner": "HolderSybil1", "pct": 4.0}, {"address": "HolderClean2", "owner": "HolderClean2", "pct": 3.0}]} if "rugcheck" in u else None',
      'out["dev_sybil_pumpfun"] = list(bot.hard_rug_check("MintRpcCreator1111111111111111111111111111", cfg, age_s=20, pair={"dexId": "pumpfun", "priceUsd": "0.0001", "liquidity": {"usd": 8000}}))',
      'bot.get_json = lambda u, **k: {"score_normalised": 10, "creator": "CleanDev1", "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 11.6}, {"address": "W2", "owner": "W2", "pct": 11.6}, {"address": "W3", "owner": "W3", "pct": 11.6}]} if "rugcheck" in u else None',
      'out["top3_split"] = list(bot.hard_rug_check("MintTop3Split1", {**cfg, "anti_sybil_enabled": False}, age_s=25, pair={"dexId": "pumpswap", "priceUsd": "0.0001", "liquidity": {"usd": 8000}}))',
      // 4. monitor() emergency-sells open position when WS stream reports creatorSold=True & check_exits() catches catastrophic AMM LP collapse when auto_rug_exit=False
      'acct = bot.TradingAccount(cfg, mode="paper")',
      'acct.buy("MintWsDump1", "WSD", 0.001, meta={"dex": "pumpfun", "source": "pumpportal", "liquidity_usd": 6000.0, "liq_source": "pumpportal", "creator": "DevWs1"})',
      'bot._poll_ws_monitor_feed = lambda c, force=False: ({"MintWsDump1": {"priceUsd": 0.0009, "liquidityUsd": 5000.0, "creator": "DevWs1", "creatorSold": True, "recentSellers": ["DevWs1"]}}, {})',
      'bot.monitor(acct)',
      'out["ws_dev_dump_exited"] = "MintWsDump1" not in acct.state["positions"]',
      'hist = bot._load_creator_history()',
      'out["dev_marked_rugged"] = bool((hist.get("DevWs1") or {}).get("MintWsDump1", {}).get("rugged"))',
      // Catastrophic AMM collapse (>75% LP drop + -30% drop + no healthy quote) exits on 2nd poll even with auto_rug_exit=False & stop_loss_pct=0
      'acct.cfg["stop_loss_pct"] = 0.0',
      'acct.buy("MintAmmCollapse1", "COL", 0.001, meta={"dex": "raydium", "source": "gecko", "liquidity_usd": 8000.0, "liq_source": "dexscreener"})',
      'acct.check_exits({"MintAmmCollapse1": 0.0007}, liquidities={"MintAmmCollapse1": 1000.0}, healthy_rev_quotes=set())',
      'out["amm_collapse_1st_kept"] = "MintAmmCollapse1" in acct.state["positions"]',
      'acct.check_exits({"MintAmmCollapse1": 0.00065}, liquidities={"MintAmmCollapse1": 900.0}, healthy_rev_quotes=set())',
      'out["amm_collapse_2nd_exited"] = "MintAmmCollapse1" not in acct.state["positions"]',
      'print(json.dumps(out))',
    ].join('\n');

    const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyOut.dev_bundle[0], false);
    assert.equal(pyOut.dev_bundle[1], 'dev sniper bundle');
    assert.equal(pyOut.thin_curve[0], false);
    assert.equal(pyOut.thin_curve[1], 'thin bonding curve');
    assert.equal(pyOut.early_hp[0], false);
    assert.equal(pyOut.early_hp[1], 'honeypot pattern');
    assert.equal(pyOut.hidden_tax[0], false);
    assert.match(pyOut.hidden_tax[1], /hidden sell tax/i);
    assert.equal(pyOut.dev_sybil_pumpfun[0], false);
    assert.match(pyOut.dev_sybil_pumpfun[1], /dev-linked sybil bundle/i);
    assert.equal(pyOut.top3_split[0], false);
    assert.match(pyOut.top3_split[1], /top-3 early holders/i);
    assert.equal(pyOut.ws_dev_dump_exited, true);
    assert.equal(pyOut.dev_marked_rugged, true);
    assert.equal(pyOut.amm_collapse_1st_kept, true);
    assert.equal(pyOut.amm_collapse_2nd_exited, true);
  } finally {
    pp.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.41.0: Quick-Profit + Pro Desk defaults & scoped resetSettingsToDefault for Settings and Pro Desk', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1410-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const defaults = mgr.getDefaultSettings();
    assert.equal(defaults.take_profit_pct, 25);
    assert.equal(defaults.trailing_stop_pct, 8);
    assert.equal(defaults.stop_loss_pct, 20);
    assert.equal(defaults.max_hold_minutes, 60);
    assert.equal(defaults.max_price_change_m5_pct, 200);
    assert.equal(defaults.jito_tip_sol, 0.0002);
    assert.equal(defaults.max_short_spike_pct, 60);
    assert.equal(defaults.conviction_min_mult, 0.6);
    assert.equal(defaults.streak_loss_limit, 2);
    assert.equal(defaults.streak_cooldown_minutes, 15);
    assert.equal(defaults.early_rug_shield_enabled, true);

    const upd = mgr.updateSettings({
      trade_size_usd: 15,
      take_profit_pct: 55,
      stop_loss_pct: 35,
      trailing_stop_pct: 18,
      min_liquidity_usd: 12000,
      anti_sybil_enabled: false,
      streak_loss_limit: 5,
      max_short_spike_pct: 120,
      smart_wallets: ['SmartWalletResetKeep1'],
      option_enabled: {
        anti_sybil_enabled: false,
        early_rug_shield_enabled: false,
        jito_dont_front_enabled: false,
      },
    });
    assert.equal(upd.ok, true);

    const resetSettings = mgr.resetSettingsToDefault('settings');
    assert.equal(resetSettings.ok, true);
    const afterSettingsReset = resetSettings.settings as Record<string, any>;
    assert.equal(afterSettingsReset.trade_size_usd, 5);
    assert.equal(afterSettingsReset.take_profit_pct, 25);
    assert.equal(afterSettingsReset.stop_loss_pct, 20);
    assert.equal(afterSettingsReset.trailing_stop_pct, 8);
    assert.equal(afterSettingsReset.min_liquidity_usd, 5000);
    assert.equal(afterSettingsReset.early_rug_shield_enabled, true);
    assert.equal(afterSettingsReset.option_enabled.early_rug_shield_enabled, true);
    assert.equal(afterSettingsReset.anti_sybil_enabled, false);
    assert.equal(afterSettingsReset.streak_loss_limit, 5);
    assert.equal(afterSettingsReset.max_short_spike_pct, 120);
    assert.deepEqual(afterSettingsReset.smart_wallets, ['SmartWalletResetKeep1']);
    assert.equal(afterSettingsReset.option_enabled.anti_sybil_enabled, false);

    mgr.updateSettings({ trade_size_usd: 22, take_profit_pct: 48 });

    const resetPro = mgr.resetSettingsToDefault('pro_desk');
    assert.equal(resetPro.ok, true);
    const afterProReset = resetPro.settings as Record<string, any>;
    assert.equal(afterProReset.anti_sybil_enabled, true);
    assert.equal(afterProReset.jito_dontfront_enabled, true);
    assert.equal(afterProReset.jito_tip_sol, 0.0002);
    assert.equal(afterProReset.max_short_spike_pct, 60);
    assert.equal(afterProReset.conviction_min_mult, 0.6);
    assert.equal(afterProReset.streak_loss_limit, 2);
    assert.equal(afterProReset.streak_cooldown_minutes, 15);
    assert.equal(afterProReset.option_enabled.anti_sybil_enabled, true);
    assert.equal('jito_dont_front_enabled' in afterProReset.option_enabled, false);
    assert.equal(afterProReset.trade_size_usd, 22);
    assert.equal(afterProReset.take_profit_pct, 48);

    const rawPy = execFileSync(
      'python3',
      [
        '-c',
        'import sys, types, json; req = types.ModuleType("requests"); req.Session = lambda: None; sys.modules["requests"] = req; sys.path.insert(0, "sniper"); import bot; print(json.dumps({k: bot.CONFIG[k] for k in ["take_profit_pct","trailing_stop_pct","stop_loss_pct","max_hold_minutes","max_price_change_m5_pct","jito_tip_sol","max_short_spike_pct","conviction_min_mult","streak_loss_limit","streak_cooldown_minutes","early_rug_shield_enabled"]}))',
      ],
      { encoding: 'utf-8' }
    );
    const pyCfg = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyCfg.take_profit_pct, 25);
    assert.equal(pyCfg.trailing_stop_pct, 8);
    assert.equal(pyCfg.stop_loss_pct, 20);
    assert.equal(pyCfg.max_hold_minutes, 60);
    assert.equal(pyCfg.max_price_change_m5_pct, 200);
    assert.equal(pyCfg.jito_tip_sol, 0.0002);
    assert.equal(pyCfg.max_short_spike_pct, 60);
    assert.equal(pyCfg.conviction_min_mult, 0.6);
    assert.equal(pyCfg.streak_loss_limit, 2);
    assert.equal(pyCfg.streak_cooldown_minutes, 15);
    assert.equal(pyCfg.early_rug_shield_enabled, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.43.0: Rugpull crash_streak unfreezes dead positions, Pump.fun real_sol drain exits, and live whale discovery scales without placeholder wallets', async () => {
  const { PumpPortalWsProvider } = await import('../providers/pumpportal');
  const pp = new PumpPortalWsProvider();
  const goodMint = 'MintGoodProfit1111111111111111111111111111pump';
  const goodMint2 = 'MintGoodProfit2222222222222222222222222222pump';
  const rugMint = 'MintRuggedTrap1111111111111111111111111111pump';
  const creatorDev = 'CreatorDev1111111111111111111111111111111111';
  const smartTrader = 'RealWhaleTrader1111111111111111111111111111';
  const baseTs = Date.now() - 120_000;

  // Create coins and simulate creator selling on rugMint + smartTrader profiting on two good mints (non-creator)
  pp.ingestFrame({ mint: goodMint, symbol: 'G1', txType: 'create', traderPublicKey: creatorDev, solAmount: 0.5, vSolInBondingCurve: 30.5, vTokensInBondingCurve: 950_000_000, marketCapSol: 32 }, baseTs);
  pp.ingestFrame({ mint: goodMint2, symbol: 'G2', txType: 'create', traderPublicKey: creatorDev, solAmount: 0.5, vSolInBondingCurve: 30.5, vTokensInBondingCurve: 950_000_000, marketCapSol: 32 }, baseTs + 1000);
  pp.ingestFrame({ mint: rugMint, symbol: 'RUG', txType: 'create', traderPublicKey: creatorDev, solAmount: 1.0, vSolInBondingCurve: 31, vTokensInBondingCurve: 940_000_000, marketCapSol: 33 }, baseTs + 2000);

  // smartTrader buys early & sells in profit on G1 and G2
  pp.ingestFrame({ mint: goodMint, txType: 'buy', traderPublicKey: smartTrader, solAmount: 1.0, vSolInBondingCurve: 32, vTokensInBondingCurve: 900_000_000, marketCapSol: 35 }, baseTs + 5000);
  pp.ingestFrame({ mint: goodMint, txType: 'sell', traderPublicKey: smartTrader, solAmount: 1.6, vSolInBondingCurve: 38, vTokensInBondingCurve: 780_000_000, marketCapSol: 48 }, baseTs + 25_000);
  pp.ingestFrame({ mint: goodMint2, txType: 'buy', traderPublicKey: smartTrader, solAmount: 1.2, vSolInBondingCurve: 33, vTokensInBondingCurve: 890_000_000, marketCapSol: 36 }, baseTs + 30_000);
  pp.ingestFrame({ mint: goodMint2, txType: 'sell', traderPublicKey: smartTrader, solAmount: 1.85, vSolInBondingCurve: 40, vTokensInBondingCurve: 760_000_000, marketCapSol: 52 }, baseTs + 50_000);

  // creatorDev also trades profitably on rugMint then dumps -> must remain disqualified as creator/rugger
  pp.ingestFrame({ mint: rugMint, txType: 'buy', traderPublicKey: creatorDev, solAmount: 0.2, vSolInBondingCurve: 31.2, vTokensInBondingCurve: 930_000_000, marketCapSol: 33.5 }, baseTs + 3000);
  pp.ingestFrame({ mint: rugMint, txType: 'sell', traderPublicKey: creatorDev, solAmount: 4.0, vSolInBondingCurve: 30.01, vTokensInBondingCurve: 999_000_000, marketCapSol: 30 }, baseTs + 40_000);

  const wsWhales = pp.getDiscoveredWhaleWallets(25);
  assert.ok(wsWhales.some((w) => w.address === smartTrader));
  assert.ok(!wsWhales.some((w) => w.address === creatorDev));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1430-'));
  try {
    // Write legacy placeholder addresses into settings.json and ensure SniperManager purges them
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        smart_wallets: [
          'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
          'Avy9z2YfS4cZ1y5R341KkL9p6sXkQx7Yt8K6U3c7j4qR',
          'RealCustomWhale1111111111111111111111111111',
        ],
      }),
      'utf-8'
    );
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const loaded = mgr.getStatus().settings as Record<string, any>;
    assert.deepEqual(loaded.smart_wallets, ['RealCustomWhale1111111111111111111111111111']);
    assert.equal(loaded.smart_money_max_wallets, 50);

    // Attach PumpPortal provider and verify smart trade callback & drainRecentSmartBuys
    mgr.attachOrchestrator({
      pumpPortal: pp,
      signer: { isUnlocked: () => false, getPublicKey: () => null, getMaskedPublicKey: () => 'Locked' },
      rpcPool: { getHealthSnapshot: () => [] },
    } as any);
    pp.setTrackedSmartWallets([smartTrader]);
    const smartMintNew = 'MintWhaleBuyNew1111111111111111111111111pump';
    pp.ingestFrame({ mint: smartMintNew, symbol: 'WHALEBUY', txType: 'buy', traderPublicKey: smartTrader, solAmount: 2.5, vSolInBondingCurve: 35, vTokensInBondingCurve: 880_000_000, marketCapSol: 39 }, Date.now());
    const feed = mgr.getPumpPortalFeed();
    assert.ok(Array.isArray(feed.smart_buys) && feed.smart_buys.some((b) => b.wallet === smartTrader && b.mint === smartMintNew));

    // Verify Python bot.py: crash_streak unfreezes real >70% crash on poll 2 (ignores 1-tick glitch on poll 1), Pumpfun real_sol drain exits, and recent_buyers boost score
    const pyScript = [
      'import sys, types, json, time',
      'req = types.ModuleType("requests")',
      'req.Session = lambda: None',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      `TMP_DIR = ${JSON.stringify(tmpDir)}`,
      'bot._base_dir = lambda: TMP_DIR',
      'cfg = {**bot.CONFIG, "stop_loss_pct": 20.0, "auto_rug_exit": True, "early_rug_shield_enabled": True, "smart_wallets": ["WhaleX111111111111111111111111111111111111"]}',
      'acct = bot.TradingAccount(cfg, mode="paper")',
      // 1) Dead position crash_streak: poll 1 glitch kept (crash_streak=1), poll 2 real crash accepted -> exited via stop_loss_20
      'acct.buy("MintCrash1", "DEAD", 0.001, meta={"dex": "pumpfun", "source": "pumpportal", "liquidity_usd": 5000.0, "liq_source": "pumpportal"})',
      'acct.check_exits({"MintCrash1": 0.0001})',
      'kept_after_1 = "MintCrash1" in acct.state["positions"]',
      'streak_after_1 = acct.state["positions"]["MintCrash1"].get("crash_streak") if kept_after_1 else -1',
      'acct.check_exits({"MintCrash1": 0.0001})',
      'exited_after_2 = "MintCrash1" not in acct.state["positions"]',
      // 2) Pump.fun bonding curve real_sol drain check with stop_loss_pct=0 -> poll 1 keeps, poll 2 exits with rug_liquidity_drop
      'acct.cfg["stop_loss_pct"] = 0.0',
      'acct.buy("MintCurveDrain1", "DRN", 0.001, meta={"dex": "pumpfun", "source": "pumpportal", "liquidity_usd": 6000.0, "real_sol": 12.0, "liq_source": "pumpportal"})',
      'acct.check_exits({"MintCurveDrain1": 0.0007}, real_sol_updates={"MintCurveDrain1": 2.0})',
      'curve_kept_1 = "MintCurveDrain1" in acct.state["positions"]',
      'acct.check_exits({"MintCurveDrain1": 0.00065}, real_sol_updates={"MintCurveDrain1": 1.8})',
      'curve_exited_2 = "MintCurveDrain1" not in acct.state["positions"]',
      // 3) Smart money score priority boost & recent_buyers detection
      'now_ms = int(time.time() * 1000)',
      'pair_plain = {"baseToken": {"address": "MPlain1", "symbol": "PLN"}, "pairCreatedAt": now_ms - 10000, "liquidity": {"usd": 8000}, "volume": {"m5": 4000}, "txns": {"m5": {"buys": 10, "sells": 3}}}',
      'pair_whale = {"baseToken": {"address": "MWhale1", "symbol": "WHL"}, "pairCreatedAt": now_ms - 10000, "liquidity": {"usd": 8000}, "volume": {"m5": 4000}, "txns": {"m5": {"buys": 10, "sells": 3}}, "_pumpportal": {"recent_buyers": ["WhaleX111111111111111111111111111111111111"]}}',
      's_plain = bot.score_candidate(pair_plain, cfg, now_ms)',
      's_whale = bot.score_candidate(pair_whale, cfg, now_ms)',
      'print(json.dumps({"kept_after_1": kept_after_1, "streak_after_1": streak_after_1, "exited_after_2": exited_after_2, "curve_kept_1": curve_kept_1, "curve_exited_2": curve_exited_2, "s_plain": s_plain, "s_whale": s_whale}))',
    ].join('\n');

    const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyOut.kept_after_1, true);
    assert.equal(pyOut.streak_after_1, 1);
    assert.equal(pyOut.exited_after_2, true);
    assert.equal(pyOut.curve_kept_1, true);
    assert.equal(pyOut.curve_exited_2, true);
    assert.ok(pyOut.s_whale >= pyOut.s_plain + 140);
  } finally {
    pp.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.43.1: Open positions record triggering Smart Money wallets in bot.py and enrich wallet details in SniperManager', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1431-'));
  try {
    const whaleAddr = 'WhaleAlpha8888888888888888888888888888888888';
    const metaPath = path.join(tmpDir, 'smart_wallets_meta.json');
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        [whaleAddr]: {
          address: whaleAddr,
          label: 'Top Alpha Whale',
          winRate: 84.5,
          source: 'pumpportal_ws',
        },
      }),
      'utf-8'
    );

    // Run Python bot.py to open one whale-backed position (including duplicate wallet) and one standard Auto Sniper position
    const pyScript = [
      'import sys, types, json',
      'req = types.ModuleType("requests")',
      'req.Session = lambda: None',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      `TMP_DIR = ${JSON.stringify(tmpDir)}`,
      `WHALE = ${JSON.stringify(whaleAddr)}`,
      'bot._base_dir = lambda: TMP_DIR',
      'cfg = {**bot.CONFIG, "smart_wallets": [WHALE], "smart_money_enabled": True}',
      'acct = bot.TradingAccount(cfg, mode="paper")',
      'acct.buy("MintWhaleOpen111", "WOPEN", 0.0005, meta={"dex": "pumpfun", "source": "pumpportal", "smart_wallets_hit": [WHALE, WHALE], "smart_money_entry": True})',
      'acct.buy("MintPlainOpen222", "PLAIN", 0.0004, meta={"dex": "raydium", "source": "dexscreener"})',
      'acct.save()',
      'print(json.dumps({"whale_pos": acct.state["positions"]["MintWhaleOpen111"], "plain_pos": acct.state["positions"]["MintPlainOpen222"]}))',
    ].join('\n');

    const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyOut.whale_pos.smart_money_entry, true);
    assert.deepEqual(pyOut.whale_pos.smart_wallets_hit, [whaleAddr]);
    assert.equal(pyOut.plain_pos.smart_money_entry, false);
    assert.deepEqual(pyOut.plain_pos.smart_wallets_hit, []);

    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    const status = mgr.getStatus();
    const whaleOpen = status.state?.positions?.MintWhaleOpen111;
    const plainOpen = status.state?.positions?.MintPlainOpen222;
    assert.ok(whaleOpen);
    assert.equal(whaleOpen.smart_money_entry, true);
    assert.deepEqual(whaleOpen.smart_wallets_hit, [whaleAddr]);
    assert.deepEqual(whaleOpen.smart_wallet_details, [
      {
        address: whaleAddr,
        label: 'Top Alpha Whale',
        winRate: 84.5,
        source: 'pumpportal_ws',
      },
    ]);
    assert.ok(plainOpen);
    assert.equal(plainOpen.smart_money_entry, false);
    assert.deepEqual(plainOpen.smart_wallets_hit, []);
    assert.deepEqual(plainOpen.smart_wallet_details, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.44.0: Custom unlimited wallet limit, refresh interval clamping, whale_held_mints feed, and scan mode + older whale coin filters', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1440-'));
  try {
    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });

    // 1) Unlimited (0), custom > 200 (500), and refresh interval clamping
    const saveUnlimited = mgr.updateSettings({
      smart_money_max_wallets: 0,
      smart_money_refresh_interval_sec: 45,
      smart_money_scan_mode: 'smart_money_only',
      smart_money_follow_older_coins: true,
      smart_money_max_coin_age_hours: 72,
    });
    assert.equal(saveUnlimited.ok, true);
    assert.equal(saveUnlimited.settings?.smart_money_max_wallets, 0);
    assert.equal(saveUnlimited.settings?.smart_money_refresh_interval_sec, 45);
    assert.equal(saveUnlimited.settings?.smart_money_scan_mode, 'smart_money_only');

    const saveLargeCap = mgr.updateSettings({
      smart_money_max_wallets: 500,
      smart_money_refresh_interval_sec: 3, // clamped up to min 10s
      smart_money_scan_mode: 'both',
    });
    assert.equal(saveLargeCap.ok, true);
    assert.equal(saveLargeCap.settings?.smart_money_max_wallets, 500);
    assert.equal(saveLargeCap.settings?.smart_money_refresh_interval_sec, 10);
    assert.equal(saveLargeCap.settings?.smart_money_scan_mode, 'both');

    // 2) Inject a whale holding entry into recentWhaleHoldings and verify getPumpPortalFeed exposes whale_held_mints
    const whaleAddr = 'WhaleHolder99999999999999999999999999999999';
    const heldMint = 'MintHeld6HoursOld111111111111111111111111111';
    (mgr as any).recentWhaleHoldings.push({
      mint: heldMint,
      wallet: whaleAddr,
      symbol: 'JIMMY',
      uiAmount: 150000,
      ageHours: 6.5,
      discoveredAtMs: Date.now(),
    });
    const feed = mgr.getPumpPortalFeed();
    assert.ok(Array.isArray(feed.whale_held_mints));
    assert.equal(feed.whale_held_mints.length, 1);
    assert.equal(feed.whale_held_mints[0].mint, heldMint);
    assert.equal(feed.whale_held_mints[0].wallet, whaleAddr);

    // 3) Verify Python bot.py: smart_money_only rejects non-whale coins, accepts 6h whale coins, while sniper_only rejects 6h coins
    const pyScript = [
      'import sys, types, json, time',
      'req = types.ModuleType("requests")',
      'req.Session = lambda: None',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      'now_ms = int(time.time() * 1000)',
      'whale = "WhaleHolder99999999999999999999999999999999"',
      'base_cfg = {**bot.CONFIG, "smart_wallets": [whale], "smart_money_enabled": True, "smart_money_follow_older_coins": True, "smart_money_max_coin_age_hours": 72, "max_age_minutes": 2.0, "min_liquidity_usd": 4000.0, "min_volume_m5_usd": 500.0, "min_buys_m5": 2, "min_buy_sell_ratio_m5": 1.1}',
      'pair_fresh_plain = {"baseToken": {"address": "MFreshPlain", "symbol": "FPLN"}, "priceUsd": "0.001", "pairCreatedAt": now_ms - 30000, "liquidity": {"usd": 9000}, "volume": {"m5": 2500}, "txns": {"m5": {"buys": 8, "sells": 2}}, "priceChange": {"m5": 15}}',
      'pair_old_whale = {"baseToken": {"address": "MOldWhale6h", "symbol": "JIMMY"}, "priceUsd": "0.002", "pairCreatedAt": now_ms - (6 * 3600 * 1000), "liquidity": {"usd": 25000}, "volume": {"m5": 4000}, "txns": {"m5": {"buys": 10, "sells": 3}}, "priceChange": {"m5": 10}, "_pumpportal": {"recent_buyers": [whale]}}',
      'cfg_sm_only = {**base_cfg, "smart_money_scan_mode": "smart_money_only"}',
      'cfg_sniper_only = {**base_cfg, "smart_money_scan_mode": "sniper_only"}',
      'ok_sm_plain, reason_sm_plain, _ = bot.passes_filters(pair_fresh_plain, cfg_sm_only)',
      'ok_sm_old, reason_sm_old, _ = bot.passes_filters(pair_old_whale, cfg_sm_only)',
      'ok_sn_old, reason_sn_old, _ = bot.passes_filters(pair_old_whale, cfg_sniper_only)',
      'ok_sn_fresh, reason_sn_fresh, _ = bot.passes_filters(pair_fresh_plain, cfg_sniper_only)',
      'print(json.dumps({"ok_sm_plain": ok_sm_plain, "reason_sm_plain": reason_sm_plain, "ok_sm_old": ok_sm_old, "reason_sm_old": reason_sm_old, "ok_sn_old": ok_sn_old, "reason_sn_old": reason_sn_old, "ok_sn_fresh": ok_sn_fresh}))',
    ].join('\n');

    const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyOut.ok_sm_plain, false);
    assert.equal(pyOut.reason_sm_plain, 'not whale buy');
    assert.equal(pyOut.ok_sm_old, true);
    assert.equal(pyOut.ok_sn_old, false);
    assert.equal(pyOut.ok_sn_fresh, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.44.1: Active whale traders outrank capped clean holders, WS smart trades persist mint meta, and bot.py throttles passive whale_held_mints', async () => {
  const { PumpPortalWsProvider } = await import('../providers/pumpportal');
  const pp = new PumpPortalWsProvider();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1441-'));
  try {
    const activeWhale = 'ActiveLiveTrader1111111111111111111111111111';
    const devCreator = 'DevLauncher111111111111111111111111111111111';
    const tokenMint = 'MintActiveTrade1111111111111111111111111pump';
    const baseTs = Date.now() - 60_000;

    pp.ingestFrame({ mint: tokenMint, symbol: 'ACTV', txType: 'create', traderPublicKey: devCreator, solAmount: 0.5, vSolInBondingCurve: 30.5, vTokensInBondingCurve: 950_000_000, marketCapSol: 32 }, baseTs);
    pp.ingestFrame({ mint: tokenMint, txType: 'buy', traderPublicKey: activeWhale, solAmount: 0.4, vSolInBondingCurve: 31.2, vTokensInBondingCurve: 910_000_000, marketCapSol: 34 }, baseTs + 3000);
    pp.ingestFrame({ mint: tokenMint, txType: 'sell', traderPublicKey: activeWhale, solAmount: 0.65, vSolInBondingCurve: 34.0, vTokensInBondingCurve: 850_000_000, marketCapSol: 40 }, baseTs + 15_000);

    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    mgr.attachOrchestrator({
      pumpPortal: pp,
      signer: { isUnlocked: () => false, getPublicKey: () => null, getMaskedPublicKey: () => 'Locked' },
      rpcPool: { getHealthSnapshot: () => [] },
    } as any);

    // Mock GeckoTerminal + RugCheck fetch responses: 1 pool with 6 top holders -> capped to 3 Clean Holders <= 4.5 SOL and ranked BELOW activeWhale
    const poolAddr = 'PoolMockAddr11111111111111111111111111111111';
    const mintPool = 'MintPoolClaudia11111111111111111111111111111';
    (mgr as any).fetchJsonWithTimeout = async (url: string) => {
      if (url.includes('trending_pools')) {
        return {
          data: [
            {
              attributes: {
                address: poolAddr,
                name: 'CLAUDIA / SOL',
                reserve_in_usd: '120000',
                volume_usd: { h1: '45000' },
                price_change_percentage: { h1: '25', h24: '80' },
                base_token_price_usd: '0.01',
              },
              relationships: { base_token: { data: { id: `solana_${mintPool}` } } },
            },
          ],
        };
      }
      if (url.includes('new_pools')) return { data: [] };
      if (url.includes('/trades')) return { data: [] };
      if (url.includes('rugcheck.xyz')) {
        return {
          score_normalised: 5,
          rugged: false,
          topHolders: [
            { owner: 'HolderA1111111111111111111111111111111111111', pct: 2.5, insider: false },
            { owner: 'HolderB1111111111111111111111111111111111111', pct: 2.0, insider: false },
            { owner: 'HolderC1111111111111111111111111111111111111', pct: 1.5, insider: false },
            { owner: 'HolderD1111111111111111111111111111111111111', pct: 1.2, insider: false },
            { owner: 'HolderE1111111111111111111111111111111111111', pct: 1.0, insider: false },
          ],
        };
      }
      return null;
    };

    const disc = await mgr.discoverSmartWallets({ autoAdd: true });
    assert.equal(disc.ok, true);
    const cleanHolders = disc.discovered.filter((d) => d.source === 'RugCheck Clean Holder');
    assert.equal(cleanHolders.length, 3);
    assert.ok(cleanHolders.every((h) => h.totalProfitSol <= 4.5));
    assert.equal(disc.discovered[0].address, activeWhale);
    assert.equal(disc.discovered[0].recentMint, tokenMint);

    // Live WS smart trade event persists recentMint & recentAction into smart_wallets_meta.json
    pp.setTrackedSmartWallets([activeWhale]);
    const liveMint = 'MintLiveSmartBuy222222222222222222222222pump';
    pp.ingestFrame(
      { mint: liveMint, symbol: 'LIVEW', txType: 'buy', traderPublicKey: activeWhale, solAmount: 1.2, vSolInBondingCurve: 35, vTokensInBondingCurve: 840_000_000, marketCapSol: 42 },
      Date.now()
    );
    const profiles = mgr.getStatus().smart_wallet_profiles as Record<string, any>;
    assert.equal(profiles[activeWhale]?.recentMint, liveMint);
    assert.equal(profiles[activeWhale]?.recentToken, 'LIVEW');
    assert.equal(profiles[activeWhale]?.recentAction, 'HOLDING');

    // Python bot.py: passive whale_held_mints throttled to once per 60s, live smart_buys always queued immediately
    const pyScript = [
      'import sys, types, json',
      'req = types.ModuleType("requests")',
      'req.Session = lambda: None',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      'bot._ws_smart_buys.clear()',
      'bot._smart_buy_pending_mints.clear()',
      'bot._whale_held_eval_ts.clear()',
      'with bot._stats_lock: bot._stats.update({"smart_buys": 0, "whale_held": 0})',
      'payload = {"ok": True, "smart_buys": [{"mint": "MintLiveBuy11111111111111111111111111111111", "wallet": "W1"}], "whale_held_mints": [{"mint": "MintHeldOlder111111111111111111111111111111", "wallet": "W2"}]}',
      'bot._ingest_ws_bridge_payload(payload)',
      'first_pending = sorted(bot._smart_buy_pending_mints.keys())',
      'bot._smart_buy_pending_mints.clear()',
      // Second poll 2s later: passive held mint should be throttled (0 added), live smart_buy still added
      'bot._ingest_ws_bridge_payload(payload)',
      'second_pending = sorted(bot._smart_buy_pending_mints.keys())',
      'with bot._stats_lock: stats_snap = {"sb": bot._stats["smart_buys"], "wh": bot._stats["whale_held"]}',
      'print(json.dumps({"first_pending": first_pending, "second_pending": second_pending, "stats": stats_snap}))',
    ].join('\n');

    const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyOut.first_pending.length, 2);
    assert.deepEqual(pyOut.second_pending, ['MintLiveBuy11111111111111111111111111111111']);
    assert.equal(pyOut.stats.sb, 2);
    assert.equal(pyOut.stats.wh, 1);
  } finally {
    pp.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v1.45.1: Alpha Signals Only mode isolates from Whale/Sniper launches, auto-finds signals across sources, and bridges cleanly to bot.py', async () => {
  const { PumpPortalWsProvider } = await import('../providers/pumpportal');
  const pp = new PumpPortalWsProvider();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-v1451-'));
  try {
    const whaleAddr = 'WhaleIsolated1111111111111111111111111111111';
    const alphaMintWs = 'AlphaWsMint11111111111111111111111111111pump';
    const plainLaunchMint = 'PlainSniperMint1111111111111111111111111pump';
    const boostAlphaMint = 'BoostAlphaMint111111111111111111111111111111';
    const baseTs = Date.now() - 20_000;

    // 1) Ingest strong PumpPortal WS launch (qualifies as Alpha Signal) AND plain 1-buy launch (does NOT qualify)
    pp.ingestFrame({ mint: alphaMintWs, symbol: 'ALPHAWS', txType: 'create', traderPublicKey: 'DevAlpha111111111111111111111111111111111111', solAmount: 1.0, vSolInBondingCurve: 32.5, vTokensInBondingCurve: 900_000_000, marketCapSol: 36 }, baseTs);
    for (let i = 0; i < 5; i += 1) {
      pp.ingestFrame({ mint: alphaMintWs, txType: 'buy', traderPublicKey: `Buyer${i}111111111111111111111111111111111111`, solAmount: 0.6, vSolInBondingCurve: 33.5 + i * 0.5, vTokensInBondingCurve: 860_000_000 - i * 10_000_000, marketCapSol: 40 + i }, baseTs + 1000 + i * 500);
    }
    pp.ingestFrame({ mint: plainLaunchMint, symbol: 'PLAIN', txType: 'create', traderPublicKey: 'DevPlain111111111111111111111111111111111111', solAmount: 0.1, vSolInBondingCurve: 30.1, vTokensInBondingCurve: 990_000_000, marketCapSol: 30 }, baseTs);

    // Tracked whale buys plainLaunchMint so we can prove alpha_signal_only ignores smart_buys
    pp.setTrackedSmartWallets([whaleAddr]);
    pp.ingestFrame({ mint: plainLaunchMint, txType: 'buy', traderPublicKey: whaleAddr, solAmount: 0.2, vSolInBondingCurve: 30.3, vTokensInBondingCurve: 980_000_000, marketCapSol: 31 }, baseTs + 3000);

    const mgr = new SniperManager({ baseDir: tmpDir, startTimers: false });
    (mgr as any).solPriceUsd = 150;
    mgr.attachOrchestrator({
      pumpPortal: pp,
      signer: { isUnlocked: () => false, getPublicKey: () => null, getMaskedPublicKey: () => 'Locked' },
      rpcPool: { getHealthSnapshot: () => [] },
    } as any);

    const oldBoostMint = 'OldBoostedMint11111111111111111111111111111111';
    const bundledBoostMint = 'BundledBoostMint111111111111111111111111111111';
    // 2) Mock external auto-finder feeds (DexScreener Boosts + DexScreener Tokens + RugCheck)
    (mgr as any).fetchJsonWithTimeout = async (url: string) => {
      if (url.includes('token-boosts/latest')) {
        return [
          { chainId: 'solana', tokenAddress: boostAlphaMint },
          { chainId: 'solana', tokenAddress: oldBoostMint },
          { chainId: 'solana', tokenAddress: bundledBoostMint },
        ];
      }
      if (url.includes('tokens/v1/solana/')) {
        return [
          {
            baseToken: { address: boostAlphaMint, symbol: 'BSTALPHA', name: 'Boost Alpha' },
            dexId: 'pumpswap',
            pairCreatedAt: Date.now() - 45_000,
            priceUsd: '0.0025',
            liquidity: { usd: 18500 },
            volume: { m5: 4200 },
            txns: { m5: { buys: 14, sells: 3 } },
            priceChange: { m5: 22 },
          },
          {
            baseToken: { address: oldBoostMint, symbol: 'OLDBST', name: 'Old Boosted Coin' },
            dexId: 'pumpswap',
            pairCreatedAt: Date.now() - 500 * 3600_000,
            priceUsd: '0.015',
            liquidity: { usd: 95000 },
            volume: { m5: 12000 },
            txns: { m5: { buys: 30, sells: 5 } },
            priceChange: { m5: 18 },
          },
          {
            baseToken: { address: bundledBoostMint, symbol: 'BNDL', name: 'Bundled Insider Coin' },
            dexId: 'pumpswap',
            pairCreatedAt: Date.now() - 40_000,
            priceUsd: '0.0031',
            liquidity: { usd: 22000 },
            volume: { m5: 6200 },
            txns: { m5: { buys: 22, sells: 10 } },
            priceChange: { m5: 35 },
          },
        ];
      }
      if (url.includes(`rugcheck.xyz/v1/tokens/${bundledBoostMint}/report`)) {
        return {
          score_normalised: 14,
          insiderNetworks: [{ id: 'cluster-1', size: 7 }],
          insidersDetected: 7,
          risks: [],
        };
      }
      if (url.includes('rugcheck.xyz')) {
        return {
          score_normalised: 12,
          insiderNetworks: [],
          insidersDetected: 0,
          risks: [],
        };
      }
      return { data: [] };
    };

    const saveRes = mgr.updateSettings({
      smart_money_enabled: false,
      smart_wallets: [whaleAddr],
      smart_money_scan_mode: 'alpha_signal_only',
      alpha_signal_auto_find: true,
      alpha_signal_auto_snipe: true,
      alpha_signal_jito_tip_sol: 0.0007,
      alpha_signal_refresh_interval_sec: 10,
      min_age_minutes: 0,
      max_age_minutes: 5,
    });
    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.settings?.smart_money_scan_mode, 'alpha_signal_only');
    // Selecting alpha_signal_only must NOT mutate Smart Money toggle or tracked whale wallets
    assert.equal(saveRes.settings?.smart_money_enabled, false);
    assert.deepEqual(saveRes.settings?.smart_wallets, [whaleAddr]);

    // 3) Auto-finder discovers clean in-window WS & Boost alpha signals, filters 500h-old coins, and marks bundled insiders SKIPPED
    const disc = await mgr.discoverAlphaSignals({ force: true });
    assert.equal(disc.ok, true);
    assert.ok(disc.signals.some((s) => s.mint === alphaMintWs && s.status === 'AUTO_SNIPED'));
    assert.ok(disc.signals.some((s) => s.mint === boostAlphaMint && s.status === 'AUTO_SNIPED'));
    assert.ok(!disc.signals.some((s) => s.mint === oldBoostMint));
    const bundledRow = disc.signals.find((s) => s.mint === bundledBoostMint);
    assert.ok(bundledRow);
    assert.equal(bundledRow?.status, 'SKIPPED');
    assert.match(String(bundledRow?.skipReason || ''), /Bundled insiders/i);

    // 4) getPumpPortalFeed in alpha_signal_only emits ONLY clean alpha signal mints & pairs, with zero smart_buys/whale_held_mints/bundled
    const feed = mgr.getPumpPortalFeed();
    assert.deepEqual(feed.smart_buys, []);
    assert.deepEqual(feed.whale_held_mints, []);
    assert.ok(feed.alpha_signals.some((s) => s.mint === alphaMintWs));
    assert.ok(feed.alpha_signals.some((s) => s.mint === boostAlphaMint));
    assert.ok(!feed.alpha_signals.some((s) => s.mint === bundledBoostMint));
    assert.ok(!feed.mints.includes(plainLaunchMint));
    assert.ok(!feed.mints.includes(oldBoostMint));
    assert.ok(!feed.mints.includes(bundledBoostMint));

    // Tightening max_age_minutes to 10s should immediately prune older signals unless manually queued
    mgr.updateSettings({ max_age_minutes: 0.1 });
    assert.ok(!mgr.getAlphaSignals().signals.some((s) => s.mint === boostAlphaMint));

    // 5) Python bot.py: alpha_signal_only ignores smart_buys & sniper launches, enforces Settings min/max timeframe, and relaxes buy/sell ratio to >= 1.0x
    const pyScript = [
      'import sys, types, json, time',
      'req = types.ModuleType("requests")',
      'req.Session = lambda: None',
      'sys.modules["requests"] = req',
      'sys.path.insert(0, "sniper")',
      'import bot',
      'now_ms = int(time.time() * 1000)',
      'whale = "WhaleIsolated1111111111111111111111111111111"',
      'alpha_m = "AlphaWsMint11111111111111111111111111111pump"',
      'whale_m = "PlainSniperMint1111111111111111111111111pump"',
      'plain_m = "RandomLaunchMint1111111111111111111111111111"',
      'bot._ws_smart_buys.clear()',
      'bot._smart_buy_pending_mints.clear()',
      'bot._ws_alpha_signals.clear()',
      'bot._alpha_pending_mints.clear()',
      'bot._ingest_ws_bridge_payload({"ok": True, "smart_buys": [{"mint": whale_m, "wallet": whale}], "alpha_signals": [{"mint": alpha_m, "symbol": "ALPHAWS", "source": "China Alpha Jito FastLane", "riskScore": 18, "status": "AUTO_SNIPED"}]})',
      'opts_age = {**bot.CONFIG.get("option_enabled", {}), "min_age_minutes": True, "max_age_minutes": True}',
      'cfg_alpha_window = {**bot.CONFIG, "option_enabled": opts_age, "min_age_minutes": 1.0, "max_age_minutes": 120.0, "smart_money_scan_mode": "alpha_signal_only", "smart_wallets": [whale], "smart_money_enabled": True, "min_liquidity_usd": 4000.0, "min_volume_m5_usd": 500.0, "min_buys_m5": 2, "min_buy_sell_ratio_m5": 1.5}',
      'cfg_alpha_tight = {**cfg_alpha_window, "min_age_minutes": 0.0, "max_age_minutes": 2.0}',
      'pair_alpha = {"baseToken": {"address": alpha_m, "symbol": "ALPHAWS"}, "priceUsd": "0.001", "pairCreatedAt": now_ms - 3600000, "liquidity": {"usd": 12000}, "volume": {"m5": 3000}, "txns": {"m5": {"buys": 87, "sells": 65}}, "priceChange": {"m5": 12}}',
      'pair_alpha_sell_heavy = {**pair_alpha, "txns": {"m5": {"buys": 40, "sells": 65}}}',
      'pair_young = {**pair_alpha, "pairCreatedAt": now_ms - 10000}',
      'pair_old = {**pair_alpha, "pairCreatedAt": now_ms - 180 * 60000}',
      'pair_whale = {"baseToken": {"address": whale_m, "symbol": "PLAIN"}, "priceUsd": "0.001", "pairCreatedAt": now_ms - 90000, "liquidity": {"usd": 12000}, "volume": {"m5": 3000}, "txns": {"m5": {"buys": 10, "sells": 2}}, "priceChange": {"m5": 12}, "_pumpportal": {"recent_buyers": [whale]}}',
      'pair_plain = {"baseToken": {"address": plain_m, "symbol": "RAND"}, "priceUsd": "0.001", "pairCreatedAt": now_ms - 90000, "liquidity": {"usd": 12000}, "volume": {"m5": 3000}, "txns": {"m5": {"buys": 10, "sells": 2}}, "priceChange": {"m5": 12}}',
      'ok_a, why_a, _ = bot.passes_filters(pair_alpha, cfg_alpha_window)',
      'ok_sh, why_sh, _ = bot.passes_filters(pair_alpha_sell_heavy, cfg_alpha_window)',
      'ok_y, why_y, _ = bot.passes_filters(pair_young, cfg_alpha_window)',
      'ok_o, why_o, _ = bot.passes_filters(pair_old, cfg_alpha_window)',
      'ok_t, why_t, _ = bot.passes_filters(pair_alpha, cfg_alpha_tight)',
      'ok_w, why_w, _ = bot.passes_filters(pair_whale, cfg_alpha_window)',
      'ok_p, why_p, _ = bot.passes_filters(pair_plain, cfg_alpha_window)',
      'sb_in_alpha = bot._get_pair_smart_buyers(pair_whale, None, cfg_alpha_window)',
      'print(json.dumps({"ok_a": ok_a, "why_a": why_a, "ok_sh": ok_sh, "why_sh": why_sh, "ok_y": ok_y, "why_y": why_y, "ok_o": ok_o, "why_o": why_o, "ok_t": ok_t, "why_t": why_t, "ok_w": ok_w, "why_w": why_w, "ok_p": ok_p, "why_p": why_p, "sb_in_alpha": sb_in_alpha}))',
    ].join('\n');

    const rawPy = execFileSync('python3', ['-c', pyScript], { encoding: 'utf-8' });
    const pyOut = JSON.parse(rawPy.trim().split('\n').pop() || '{}');
    assert.equal(pyOut.ok_a, true);
    assert.equal(pyOut.ok_sh, false);
    assert.equal(pyOut.why_sh, 'selling pressure');
    assert.equal(pyOut.ok_y, false);
    assert.equal(pyOut.why_y, 'too young');
    assert.equal(pyOut.ok_o, false);
    assert.equal(pyOut.why_o, 'too old');
    assert.equal(pyOut.ok_t, false);
    assert.equal(pyOut.why_t, 'too old');
    assert.equal(pyOut.ok_w, false);
    assert.equal(pyOut.why_w, 'not alpha signal');
    assert.equal(pyOut.ok_p, false);
    assert.equal(pyOut.why_p, 'not alpha signal');
    assert.deepEqual(pyOut.sb_in_alpha, []);
  } finally {
    pp.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});



