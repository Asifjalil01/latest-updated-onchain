import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { loadAppEnv } from './server/config/env';
import { BotDatabase } from './server/store/db';
import { ServerSignerManager } from './server/security/signer';
import { SolanaRpcPool } from './server/providers/rpcPool';
import { JupiterProvider } from './server/providers/jupiter';
import { DexScreenerProvider } from './server/providers/dexscreener';
import { GeckoTerminalProvider } from './server/providers/geckoterminal';
import { RugCheckProvider } from './server/providers/rugcheck';
import { PumpPortalWsProvider } from './server/providers/pumpportal';
import { BotOrchestrator } from './server/engine/pipeline';
import { createApiRouter } from './server/routes/api';

async function bootstrapServer() {
  const env = loadAppEnv();
  const db = new BotDatabase(env.dbPath);
  const signer = new ServerSignerManager(env.keystorePath);
  await signer.initFromEnv(env.solanaPrivateKey);
  const rpcPool = new SolanaRpcPool([
    env.solanaRpcUrl,
    env.solanaRpcBackup1,
    env.solanaRpcBackup2,
  ]);
  const jupiter = new JupiterProvider(env.jupiterApiKey);
  const dexScreener = new DexScreenerProvider();
  const geckoTerminal = new GeckoTerminalProvider();
  const rugCheck = new RugCheckProvider();
  const pumpPortal = new PumpPortalWsProvider();

  const orchestrator = new BotOrchestrator(
    db,
    signer,
    rpcPool,
    jupiter,
    dexScreener,
    geckoTerminal,
    rugCheck,
    pumpPortal
  );

  // Non-blocking initial health + price check
  void orchestrator.refreshSolPrice();
  void rpcPool.checkAllEndpoints().then((rpcs) => {
    for (const r of rpcs) db.upsertRpcHealth(r);
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createApiRouter(orchestrator, env.apiToken));

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const server = app.listen(env.port, env.host, () => {
    console.log(`\n[Solana Spot Bot] Listening on http://${env.host}:${env.port}`);
    console.log(`[Solana Spot Bot] Initial mode: PAPER (stopped). Trading can lose all of your money.`);
    if (env.isFirstRunTokenGenerated) {
      console.log(`[Solana Spot Bot] Generated BOT_API_TOKEN in .env (masked): ${env.apiToken.slice(0, 6)}...`);
    }
  });

  const shutdown = () => {
    orchestrator.shutdown();
    db.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => {
  console.error('[Solana Spot Bot] Unhandled promise rejection (caught safely):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Solana Spot Bot] Uncaught exception (caught safely):', err);
});

bootstrapServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
