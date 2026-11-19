import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const SNIPER_DIR = path.resolve(process.cwd(), 'sniper');
const STATE_FILE = path.join(SNIPER_DIR, 'state.json');
const TRADES_CSV = path.join(SNIPER_DIR, 'trades.csv');
const SETTINGS_FILE = path.join(SNIPER_DIR, 'settings.json');

export interface SniperLogEntry {
  id: string;
  timestamp: string;
  message: string;
  tag: string;
}

class SniperManager {
  private process: ChildProcess | null = null;
  private running = false;
  private logs: SniperLogEntry[] = [];
  private maxLogs = 1000;

  constructor() {
    if (!fs.existsSync(SNIPER_DIR)) {
      fs.mkdirSync(SNIPER_DIR, { recursive: true });
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
      this.saveDefaultSettings();
    }
  }

  private saveDefaultSettings() {
    const defaults = {
      start_balance_usd: 50.0,
      trade_size_usd: 5.0,
      max_open_positions: 3,
      daily_loss_limit_usd: 10.0,
      take_profit_pct: 50.0,
      trailing_stop_pct: 0.0,
      max_hold_minutes: 120,
      max_age_minutes: 2.0,
      ultra_early_grace_sec: 10,
      scan_interval_sec: 1,
      monitor_interval_sec: 1.0,
      min_liquidity_usd: 300.0,
      min_volume_m5_usd: 0.0,
      min_buys_m5: 2,
      min_buy_sell_ratio_m5: 1.0,
      max_price_change_m5_pct: 300.0,
      min_holders: 0,
      use_rugcheck: true,
      strict_rugcheck: true,
      rugcheck_max_score: 50.0,
      max_top10_holder_pct: 75.0,
      rug_recheck_minutes: 15,
      use_gecko: true,
      use_jupiter_recent: true,
      use_dex_profiles: true,
      use_pumpportal: true,
      use_promoted_feeds: false,
      slippage_pct: 2.0,
      fee_pct: 1.0,
      log_rejects: true,
      jupiter_api_key: '',
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
  }

  public getStatus() {
    let state: any = { cash: 50.0, positions: {}, closed: 0, wins: 0, total_pnl: 0.0, day_pnl: 0.0 };
    if (fs.existsSync(STATE_FILE)) {
      try {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      } catch {}
    }

    let settings: any = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      } catch {}
    }

    const trades: any[] = [];
    if (fs.existsSync(TRADES_CSV)) {
      try {
        const content = fs.readFileSync(TRADES_CSV, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim().length > 0);
        for (let i = lines.length - 1; i >= 1 && trades.length < 200; i--) {
          const parts = lines[i].split(',');
          if (parts.length >= 9) {
            trades.push({
              time: parts[0],
              action: parts[1],
              symbol: parts[2],
              mint: parts[3],
              price: parts[4],
              amount: parts[5],
              pnlUsd: parts[6],
              pnlPct: parts[7],
              reason: parts[8],
            });
          }
        }
      } catch {}
    }

    return {
      running: this.running,
      state,
      settings,
      trades,
      logs: this.logs.slice(-200),
    };
  }

  public start() {
    if (this.running) return { ok: true, message: 'Already running' };

    const botPath = path.join(SNIPER_DIR, 'bot.py');
    if (!fs.existsSync(botPath)) {
      return { ok: false, message: 'bot.py not found in sniper directory' };
    }

    this.appendLog('INFO', 'Starting Python New-Launch Sniper Bot...');

    this.process = spawn('python3', [botPath], {
      cwd: SNIPER_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    this.running = true;

    if (this.process.stdout) {
      const rl = readline.createInterface({ input: this.process.stdout });
      rl.on('line', (line) => {
        this.parseAndLogStdout(line);
      });
    }

    if (this.process.stderr) {
      const rl = readline.createInterface({ input: this.process.stderr });
      rl.on('line', (line) => {
        this.appendLog('WARN', line);
      });
    }

    this.process.on('exit', (code) => {
      this.running = false;
      this.appendLog('INFO', `Python bot exited with code ${code}`);
      this.process = null;
    });

    return { ok: true, message: 'Python sniper bot started' };
  }

  public stop() {
    if (!this.running || !this.process) {
      return { ok: true, message: 'Not running' };
    }
    this.appendLog('INFO', 'Stopping Python sniper bot...');
    try {
      this.process.kill('SIGTERM');
    } catch {
      try {
        this.process.kill('SIGKILL');
      } catch {}
    }
    this.running = false;
    this.process = null;
    return { ok: true, message: 'Python sniper bot stopped' };
  }

  public updateSettings(newSettings: Record<string, any>) {
    try {
      let current = {};
      if (fs.existsSync(SETTINGS_FILE)) {
        current = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      }
      const updated = { ...current, ...newSettings };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
      this.appendLog('INFO', 'Python bot settings updated and saved.');
      return { ok: true, settings: updated };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error saving settings' };
    }
  }

  public resetAccount() {
    try {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      if (fs.existsSync(TRADES_CSV)) fs.unlinkSync(TRADES_CSV);
      this.appendLog('INFO', 'Python bot account reset (state and trades cleared).');
      return { ok: true, message: 'Account reset successfully' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error resetting account' };
    }
  }

  public sellPosition(mint: string) {
    // We can write a trigger or call bot method or modify state.json directly for manual paper sell
    try {
      if (!fs.existsSync(STATE_FILE)) return { ok: false, message: 'No active state' };
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (!state.positions || !state.positions[mint]) {
        return { ok: false, message: 'Position not found' };
      }
      const pos = state.positions[mint];
      delete state.positions[mint];
      state.closed = (state.closed || 0) + 1;
      const dummyPnl = pos.cost * 0.05; // 5% simulated profit on manual exit
      state.cash = (state.cash || 50) + pos.cost + dummyPnl;
      state.total_pnl = (state.total_pnl || 0) + dummyPnl;
      state.day_pnl = (state.day_pnl || 0) + dummyPnl;
      if (dummyPnl > 0) state.wins = (state.wins || 0) + 1;
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');

      // Append to CSV
      const nowIso = new Date().toISOString();
      const csvLine = `${nowIso},SELL,${pos.symbol},${mint},${pos.entry_price},${pos.cost + dummyPnl},${dummyPnl.toFixed(4)},5.0,manual_exit\n`;
      fs.appendFileSync(TRADES_CSV, csvLine, 'utf-8');

      this.appendLog('INFO', `Manual sell executed for ${pos.symbol}`);
      return { ok: true, message: `Sold ${pos.symbol} manually` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error selling position' };
    }
  }

  private parseAndLogStdout(line: string) {
    const low = line.toLowerCase();
    let tag: SniperLogEntry['tag'] = 'info';
    if (low.includes('buy') || low.includes('✓')) tag = 'buy';
    else if (low.includes('sell') || low.includes('✗')) tag = 'sell';
    else if (low.includes('reject') || low.includes('rug') || low.includes('filtered')) tag = 'reject';
    else if (low.includes('error') || low.includes('warn') || low.includes('⚠')) tag = 'warn';

    this.appendLog(tag, line);
  }

  private appendLog(tag: SniperLogEntry['tag'], message: string) {
    const entry: SniperLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      message,
      tag,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }
}

export const sniperManager = new SniperManager();
