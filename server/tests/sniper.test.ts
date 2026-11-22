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
  orderLogsNewestFirst,
  formatBotUptime,
  formatTrailingModeHint,
  calcMinRecoveryTakeProfitPct,
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
    'out["honeypot_filter"] = bot.passes_filters(honeypot_pair, dict(bot.CONFIG), now_ms)',
    'low_liq_young = {"pairCreatedAt": now_ms - 5000, "priceUsd": "0.001", "liquidity": {"usd": 400}, "volume": {"m5": 2000}, "txns": {"m5": {"buys": 10, "sells": 2}}}',
    'out["no_grace_bypass"] = bot.passes_filters(low_liq_young, dict(bot.CONFIG), now_ms)',
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
    'cfg = dict(bot.CONFIG)',
    'now_ms = int(time.time() * 1000)',
    'slow_pair = {"baseToken": {"address": "M1", "symbol": "SLOW"}, "pairCreatedAt": now_ms - 25000, "priceUsd": "0.0001", "liquidity": {"usd": 6500}, "txns": {"m5": {"buys": 12, "sells": 5}}, "volume": {"m5": 3000}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 1, "sells_60s": 0}}',
    'out["low_vel"] = list(bot.passes_filters(slow_pair, cfg, now_ms))',
    'good_pair = {"baseToken": {"address": "M2", "symbol": "GOOD"}, "pairCreatedAt": now_ms - 25000, "priceUsd": "0.0001", "liquidity": {"usd": 6500}, "txns": {"m5": {"buys": 20, "sells": 4}}, "volume": {"m5": 5000}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 8, "sells_60s": 2, "sol_vol_60s": 6.0}}',
    'out["good_vel"] = list(bot.passes_filters(good_pair, cfg, now_ms))',
    'bot._rpc_mint_account_info = lambda m, c=None: {"mint_auth": None, "freeze_auth": None, "decimals": 6, "supply_ui": 1000000.0, "disallowed_extensions": []}',
    'bot._check_sell_route = lambda *a, **k: (True, "ok")',
    'bot.get_json = lambda u, **k: {"score_normalised": 15, "insiderNetworks": [{"id": "net1", "size": 12}], "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    'out["insider_net"] = list(bot.hard_rug_check("MintIns1", cfg, age_s=20, pair=good_pair))',
    'bot.get_json = lambda u, **k: {"score_normalised": 15, "creator": "Dev1", "creatorBalance": 90000, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    'out["dev_hold"] = list(bot.hard_rug_check("MintDev1", cfg, age_s=20, pair=good_pair))',
    'bot.get_json = lambda u, **k: {"score_normalised": 15, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    'dump_pair = dict(good_pair); dump_pair["_pumpportal"] = {"has_trade_stream": True, "buys_60s": 6, "sells_60s": 2, "creator_sold": True}',
    'out["creator_sold"] = list(bot.hard_rug_check("MintDump1", cfg, age_s=20, pair=dump_pair))',
    'mint_weak = "MintWeakAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
    'mint_strong = "MintStrongBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"',
    'weak_pair = {"baseToken": {"address": mint_weak, "symbol": "WEAK"}, "dexId": "pumpfun", "pairCreatedAt": now_ms - 50000, "priceUsd": "0.0001", "liquidity": {"usd": 6000}, "txns": {"m5": {"buys": 10, "sells": 6}}, "volume": {"m5": 2200}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 3, "sells_60s": 2, "sol_vol_60s": 0.8}}',
    'strong_pair = {"baseToken": {"address": mint_strong, "symbol": "STRG"}, "dexId": "pumpfun", "pairCreatedAt": now_ms - 12000, "priceUsd": "0.0002", "liquidity": {"usd": 8000}, "txns": {"m5": {"buys": 35, "sells": 5}}, "volume": {"m5": 14000}, "_pumpportal": {"has_trade_stream": True, "buys_60s": 14, "sells_60s": 1, "sol_vol_60s": 8.0}}',
    'bot._pumpportal_pairs.clear()',
    'bot._pumpportal_pairs[mint_weak] = weak_pair',
    'bot._pumpportal_pairs[mint_strong] = strong_pair',
    'bot.fetch_candidate_mints = lambda c, force=False: [mint_weak, mint_strong]',
    'bot.get_json = lambda u, **k: {"score_normalised": 10, "risks": [], "topHolders": [{"address": "W1", "owner": "W1", "pct": 3.0}]} if "rugcheck" in u else None',
    'tmp_dir = tempfile.mkdtemp()',
    'orig_base = bot._base_dir',
    'bot._base_dir = lambda: tmp_dir',
    'try:',
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

