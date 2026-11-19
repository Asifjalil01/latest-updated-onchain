import { spawn, spawnSync, ChildProcess } from 'child_process';
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

export function detectPythonCommand(customPath?: string): { command: string; args: string[]; info: string } {
  const isWin = process.platform === 'win32';

  // 1. If user configured a custom path / binary in Settings
  if (customPath && typeof customPath === 'string' && customPath.trim() && customPath.trim().toLowerCase() !== 'auto') {
    const trimmed = customPath.trim();
    try {
      const res = spawnSync(trimmed, ['-c', 'import sys; print(sys.version)'], {
        encoding: 'utf-8',
        timeout: 4000,
        shell: isWin,
      });
      if (res.status === 0 && !res.stderr?.includes('Microsoft Store') && !res.stdout?.includes('Microsoft Store')) {
        const ver = (res.stdout || '').split('\n')[0].trim();
        return { command: trimmed, args: [], info: `Configured path: "${trimmed}" (${ver})` };
      }
    } catch {}
  }

  // 2. If PYTHON_PATH environment variable is set
  if (process.env.PYTHON_PATH) {
    try {
      const res = spawnSync(process.env.PYTHON_PATH, ['-c', 'import sys; print(sys.version)'], {
        encoding: 'utf-8',
        timeout: 4000,
        shell: isWin,
      });
      if (res.status === 0 && !res.stderr?.includes('Microsoft Store') && !res.stdout?.includes('Microsoft Store')) {
        const ver = (res.stdout || '').split('\n')[0].trim();
        return { command: process.env.PYTHON_PATH, args: [], info: `Env PYTHON_PATH (${ver})` };
      }
    } catch {}
  }

  // 3. Platform-specific candidate probing
  // On Windows: 'py' (Windows Python Launcher) is the official python.org launcher installed in C:\Windows.
  // It handles Python 3.14 / 3.12 / 3.11 seamlessly and bypasses the Microsoft Store stub alias!
  const candidates: Array<{ cmd: string; args: string[]; label: string }> = isWin
    ? [
        { cmd: 'py', args: ['-3'], label: 'Windows Python Launcher (py -3)' },
        { cmd: 'py', args: [], label: 'Windows Python Launcher (py)' },
        { cmd: 'python', args: [], label: 'System Python (python)' },
        { cmd: 'python3', args: [], label: 'python3' },
      ]
    : [
        { cmd: 'python3', args: [], label: 'python3' },
        { cmd: 'python', args: [], label: 'python' },
      ];

  // On Windows, also inspect standard user and system installation directories
  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || '';

    const searchDirs = [
      path.join(localAppData, 'Programs', 'Python'),
      programFiles,
      programFilesX86,
    ];

    for (const baseDir of searchDirs) {
      if (baseDir && fs.existsSync(baseDir)) {
        try {
          const entries = fs.readdirSync(baseDir);
          for (const entry of entries) {
            if (entry.toLowerCase().startsWith('python')) {
              const fullExe = path.join(baseDir, entry, 'python.exe');
              if (fs.existsSync(fullExe)) {
                candidates.push({ cmd: fullExe, args: [], label: `Direct Path: ${fullExe}` });
              }
            }
          }
        } catch {}
      }
    }
  }

  // Test candidates sequentially
  for (const cand of candidates) {
    try {
      const testArgs = [...cand.args, '-c', 'import sys; print(sys.version.split()[0])'];
      const res = spawnSync(cand.cmd, testArgs, {
        encoding: 'utf-8',
        timeout: 4000,
        shell: isWin,
      });
      const out = (res.stdout || '').trim();
      const err = (res.stderr || '').trim();
      // Code 0 and not Microsoft Store stub warning
      if (res.status === 0 && out.length > 0 && !err.includes('Microsoft Store') && !out.includes('Microsoft Store')) {
        return {
          command: cand.cmd,
          args: cand.args,
          info: `${cand.label} [Python ${out}]`,
        };
      }
    } catch {}
  }

  // Safe fallback
  return isWin
    ? { command: 'py', args: [], info: 'Default Windows Python (py)' }
    : { command: 'python3', args: [], info: 'Default Python (python3)' };
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
      python_binary_path: 'auto',
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
  }

  public getStatus() {
    let settings: any = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      } catch {}
    }

    const defaultCash = typeof settings.start_balance_usd === 'number' ? settings.start_balance_usd : 50.0;
    let state: any = { cash: defaultCash, positions: {}, closed: 0, wins: 0, total_pnl: 0.0, day_pnl: 0.0 };
    if (fs.existsSync(STATE_FILE)) {
      try {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      } catch {}
    }

    if (state.positions) {
      for (const [mint, pos] of Object.entries<any>(state.positions)) {
        if (!pos.current_price || pos.current_price <= 0) {
          pos.current_price = pos.entry_price;
        }
        if (pos.current_price && pos.entry_price) {
          if (pos.pnl_pct === undefined || pos.pnl_pct === null) {
            pos.pnl_pct = Number(((pos.current_price / pos.entry_price - 1) * 100).toFixed(2));
          }
          if (pos.pnl_usd === undefined || pos.pnl_usd === null) {
            const slippage = (settings.slippage_pct ?? 2.0) / 100;
            const fee = (settings.fee_pct ?? 1.0) / 100;
            const fill = pos.current_price * (1 - slippage);
            const proceeds = (pos.qty || 0) * fill * (1 - fee);
            pos.pnl_usd = Number((proceeds - (pos.cost || 0)).toFixed(4));
          }
          if (pos.peak_pct === undefined) {
            const peak = pos.peak_price || pos.entry_price;
            pos.peak_pct = Number(((peak / pos.entry_price - 1) * 100).toFixed(2));
          }
          if (pos.low_pct === undefined) {
            const low = pos.low_price || pos.entry_price;
            pos.low_pct = Number(((low / pos.entry_price - 1) * 100).toFixed(2));
          }
        }
      }
    }

    const trades: any[] = [];
    if (fs.existsSync(TRADES_CSV)) {
      try {
        const content = fs.readFileSync(TRADES_CSV, 'utf-8');
        const lines = content.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
        for (let i = lines.length - 1; i >= 1 && trades.length < 200; i--) {
          const parts = lines[i].split(',').map((p) => p.trim());
          if (parts.length >= 6) {
            trades.push({
              time: parts[0] || '',
              action: parts[1] || '',
              symbol: parts[2] || '',
              mint: parts[3] || '',
              price: parts[4] || '',
              amount: parts[5] || '',
              pnlUsd: parts[6] || '',
              pnlPct: parts[7] || '',
              reason: parts[8] || '',
              dexscreener: parts[9] || (parts[3] ? `https://dexscreener.com/solana/${parts[3]}` : ''),
              age_s: parts[10] || '',
              dex: parts[11] || '',
              source: parts[12] || '',
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

    let settings: any = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      } catch {}
    }

    const detected = detectPythonCommand(settings.python_binary_path);
    this.appendLog('INFO', `Starting Python New-Launch Sniper Bot using: ${detected.info}...`);

    const spawnArgs = [...detected.args, botPath];
    this.process = spawn(detected.command, spawnArgs, {
      cwd: SNIPER_DIR,
      shell: process.platform === 'win32',
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
      if (code === 9009) {
        this.appendLog(
          'WARN',
          'Exit code 9009: Windows could not find Python. Set your Python executable in Settings > "Python executable / path" (e.g. py, python, or full path to python.exe).'
        );
      }
      this.appendLog('INFO', `Python bot exited with code ${code}`);
      this.process = null;
    });

    return { ok: true, message: `Python sniper bot started (${detected.info})` };
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
      let settings: any = {};
      if (fs.existsSync(SETTINGS_FILE)) {
        try {
          settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        } catch {}
      }
      const startCash = typeof settings.start_balance_usd === 'number' ? settings.start_balance_usd : 50.0;
      const freshState = {
        cash: startCash,
        positions: {},
        day: new Date().toISOString().slice(0, 10),
        day_pnl: 0.0,
        total_pnl: 0.0,
        closed: 0,
        wins: 0,
        blacklist: [],
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(freshState, null, 2), 'utf-8');
      if (fs.existsSync(TRADES_CSV)) fs.unlinkSync(TRADES_CSV);
      this.appendLog('INFO', `Python bot account reset (cash set to $${startCash.toFixed(2)}, trades cleared).`);
      return { ok: true, message: `Account reset with $${startCash.toFixed(2)} start balance` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Error resetting account' };
    }
  }

  public sellPosition(mint: string) {
    try {
      if (!fs.existsSync(STATE_FILE)) return { ok: false, message: 'No active state' };
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (!state.positions || !state.positions[mint]) {
        return { ok: false, message: 'Position not found' };
      }
      let settings: any = {};
      if (fs.existsSync(SETTINGS_FILE)) {
        try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch {}
      }
      const pos = state.positions[mint];
      delete state.positions[mint];
      state.closed = (state.closed || 0) + 1;
      const currentPrice = pos.current_price || pos.entry_price;
      const slippage = (settings.slippage_pct ?? 2.0) / 100;
      const fee = (settings.fee_pct ?? 1.0) / 100;
      const fill = currentPrice * (1 - slippage);
      const proceeds = pos.qty * fill * (1 - fee);
      const pnlUsd = proceeds - pos.cost;
      const pnlPct = (pnlUsd / pos.cost) * 100;

      state.cash = (state.cash || 50) + proceeds;
      state.total_pnl = (state.total_pnl || 0) + pnlUsd;
      state.day_pnl = (state.day_pnl || 0) + pnlUsd;
      if (pnlUsd > 0) state.wins = (state.wins || 0) + 1;
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');

      // Append to CSV
      const nowIso = new Date().toISOString();
      const csvLine = `${nowIso},SELL,${pos.symbol},${mint},${fill.toFixed(8)},${proceeds.toFixed(4)},${pnlUsd.toFixed(4)},${pnlPct.toFixed(2)},manual_exit,${pos.url || `https://dexscreener.com/solana/${mint}`},${pos.age_at_entry || 0},${pos.dex || '?'},${pos.source || '?'}\n`;
      fs.appendFileSync(TRADES_CSV, csvLine, 'utf-8');

      this.appendLog('INFO', `Manual sell executed for ${pos.symbol} at $${fill.toFixed(8)} (PnL $${pnlUsd.toFixed(2)})`);
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
