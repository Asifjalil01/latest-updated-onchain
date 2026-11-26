import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export interface AppEnvConfig {
  host: string;
  port: number;
  apiToken: string;
  isFirstRunTokenGenerated: boolean;
  solanaRpcUrl: string;
  solanaRpcBackup1: string;
  solanaRpcBackup2: string;
  solanaPrivateKey: string;
  jupiterApiKey: string;
  dbPath: string;
  keystorePath: string;
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  return dotenv.parse(raw);
}

function upsertEnvVar(envPath: string, key: string, value: string): void {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }
  const line = `${key}="${value}"`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = content.trimEnd() + (content.length > 0 ? '\n' : '') + line + '\n';
  }
  fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
}

let cachedEnv: AppEnvConfig | null = null;

export function loadAppEnv(): AppEnvConfig {
  if (cachedEnv) return cachedEnv;

  const cwd = process.cwd();
  const envPath = path.resolve(cwd, '.env');
  dotenv.config({ path: envPath, quiet: true });

  const fileVars = parseEnvFile(envPath);
  let apiToken = process.env.BOT_API_TOKEN || fileVars.BOT_API_TOKEN || '';
  let isFirstRunTokenGenerated = false;

  if (!apiToken || apiToken.trim().length < 16) {
    apiToken = crypto.randomBytes(32).toString('hex');
    upsertEnvVar(envPath, 'BOT_API_TOKEN', apiToken);
    process.env.BOT_API_TOKEN = apiToken;
    isFirstRunTokenGenerated = true;
  }

  const argvHostIdx = process.argv.indexOf('--host');
  const cliHost =
    argvHostIdx >= 0 && process.argv[argvHostIdx + 1] && !process.argv[argvHostIdx + 1].startsWith('--')
      ? process.argv[argvHostIdx + 1]
      : undefined;
  const argvPortIdx = process.argv.indexOf('--port');
  const cliPortRaw =
    argvPortIdx >= 0 && process.argv[argvPortIdx + 1] && !process.argv[argvPortIdx + 1].startsWith('--')
      ? Number(process.argv[argvPortIdx + 1])
      : NaN;

  const host = cliHost || process.env.HOST || '0.0.0.0';
  const cliPort = Number.isFinite(cliPortRaw) && cliPortRaw > 0 ? cliPortRaw : undefined;
  const envAppPort = process.env.APP_PORT ? Number(process.env.APP_PORT) : undefined;
  // Always default to port 3000 as required by AI Studio runtime environment constraints.
  // Note: process.env.PORT is 8080 in Cloud Run because Nginx listens on 8080 and proxies to localhost:3000.
  const envPort =
    process.env.PORT && process.env.PORT !== '8080' && Number(process.env.PORT) > 0
      ? Number(process.env.PORT)
      : undefined;
  const port = cliPort || envAppPort || envPort || 3000;

  const dbPath = path.resolve(cwd, process.env.DB_PATH || './data/solana_spot_bot.db');
  const keystorePath = path.resolve(cwd, process.env.KEYSTORE_PATH || './data/signer.enc.json');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.dirname(keystorePath), { recursive: true });

  cachedEnv = {
    host,
    port,
    apiToken,
    isFirstRunTokenGenerated,
    solanaRpcUrl: process.env.SOLANA_RPC_URL || '',
    solanaRpcBackup1: process.env.SOLANA_RPC_URL_BACKUP_1 || '',
    solanaRpcBackup2: process.env.SOLANA_RPC_URL_BACKUP_2 || '',
    solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY || '',
    jupiterApiKey: process.env.JUPITER_API_KEY || '',
    dbPath,
    keystorePath,
  };

  return cachedEnv;
}

export function resetEnvCacheForTest(): void {
  cachedEnv = null;
}
