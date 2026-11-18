import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { BotDatabase } from '../store/db';
import { ServerSignerManager } from '../security/signer';
import { SolanaRpcPool } from '../providers/rpcPool';
import { JupiterProvider } from '../providers/jupiter';
import { DexScreenerProvider } from '../providers/dexscreener';
import { GeckoTerminalProvider } from '../providers/geckoterminal';
import { RugCheckProvider } from '../providers/rugcheck';
import { PumpPortalWsProvider } from '../providers/pumpportal';
import { BotOrchestrator } from '../engine/pipeline';
import { createApiRouter } from '../routes/api';
import type { TradeRecord } from '../types';

test('API: requests without x-api-token return 401 and paper reset keeps live rows', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-api-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  const signer = new ServerSignerManager(path.join(tmpDir, 'ks.json'));
  const orch = new BotOrchestrator(
    db,
    signer,
    new SolanaRpcPool(),
    new JupiterProvider(),
    new DexScreenerProvider(),
    new GeckoTerminalProvider(),
    new RugCheckProvider(),
    new PumpPortalWsProvider()
  );

  const token = 'test-secret-api-token-1234567890';
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(orch, token));

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/api`;

    // 1. Unauthenticated requests must return 401
    for (const [method, endpoint] of [
      ['GET', '/settings'],
      ['POST', '/settings'],
      ['POST', '/start'],
      ['POST', '/kill'],
      ['GET', '/signer/status'],
      ['POST', '/account/reset'],
    ] as const) {
      const r = await fetch(`${base}${endpoint}`, { method });
      assert.equal(r.status, 401, `${method} ${endpoint} should return 401 without token`);
    }

    // 2. Seed one paper trade and one live trade
    const baseTrade: Omit<TradeRecord, 'tradeId' | 'mode' | 'confirmed'> = {
      openedAt: '2026-11-15T01:00:00.000Z',
      closedAt: '2026-11-15T01:10:00.000Z',
      symbol: 'SOLT',
      mint: 'MintKeep11111111111111111111111111111111111',
      source: 'dexscreener',
      dex: 'raydium',
      tokenAgeAtEntry: 120,
      entryPrice: 0.1,
      exitPrice: 0.12,
      quantity: 100,
      solIn: 0.05,
      solOut: 0.058,
      feesSol: 0.0004,
      rentSol: 0.00203928,
      grossPnlSol: 0.008,
      pnlSol: 0.00556,
      pnlUsd: 1.11,
      pnlPct: 11.1,
      peakPct: 12,
      holdSeconds: 600,
      exitReason: 'TAKE_PROFIT',
      txBuy: 'txb',
      txSell: 'txs',
      solPriceUsd: 200,
      feeBreakdownJson: '{}',
      archivedSessionId: null,
    };

    db.insertTrade({ ...baseTrade, tradeId: 'paper_1', mode: 'paper', confirmed: 'simulated' });
    db.insertTrade({ ...baseTrade, tradeId: 'live_1', mode: 'live', confirmed: 'confirmed' });

    // 3. Reset paper account with valid token
    const resetRes = await fetch(`${base}/account/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': token,
      },
      body: JSON.stringify({ mode: 'paper' }),
    });
    assert.equal(resetRes.status, 200);

    // Paper active ledger cleared (archived), live row untouched!
    assert.equal(db.getTrades('paper', false).length, 0);
    assert.equal(db.getTrades('paper', true).length, 1);
    assert.equal(db.getTrades('live', false).length, 1);
    // 4. POST /settings accepts applyToOpenPositions without Unrecognized key error
    const settingsRes = await fetch(`${base}/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': token,
      },
      body: JSON.stringify({
        takeProfitPct: 22,
        applyToOpenPositions: true,
      }),
    });
    assert.equal(settingsRes.status, 200);
    const settingsJson = (await settingsRes.json()) as { settings: { takeProfitPct: number } };
    assert.equal(settingsJson.settings.takeProfitPct, 22);

    // 5. POST /wallet/connect safely extracts public key from a 64-byte JSON secret key array
    const { Keypair } = await import('@solana/web3.js');
    const kp = await Keypair.generate();
    const secretArr = JSON.stringify(Array.from(kp.secretKey));
    const connectRes = await fetch(`${base}/wallet/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': token,
      },
      body: JSON.stringify({
        provider: 'watch_only',
        address: secretArr,
      }),
    });
    assert.equal(connectRes.status, 200);
    const connectJson = (await connectRes.json()) as { diagnostics: { address: string } };
    assert.equal(connectJson.diagnostics.address, kp.publicKey.toBase58());

    // 6. POST /mode rejects while running without autoStop, and stops + switches cleanly with autoStop=true
    (orch as unknown as { runState: string }).runState = 'running';
    assert.equal(orch.getStatusSnapshot().runState, 'running');
    const blockedModeRes = await fetch(`${base}/mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': token,
      },
      body: JSON.stringify({ mode: 'testnet' }),
    });
    assert.equal(blockedModeRes.status, 400);

    const modeRes = await fetch(`${base}/mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': token,
      },
      body: JSON.stringify({ mode: 'testnet', autoStop: true }),
    });
    assert.equal(modeRes.status, 200);
    const modeJson = (await modeRes.json()) as { status: { mode: string; runState: string } };
    assert.equal(modeJson.status.mode, 'testnet');
    assert.equal(modeJson.status.runState, 'stopped');
  } finally {
    orch.stop();
    db.close();
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
