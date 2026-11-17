import Database from 'better-sqlite3';
import { DEFAULT_SETTINGS, validateSettingsUpdate } from '../config/defaults';
import type {
  BotSettings,
  ExecutionMode,
  LogEntry,
  LogSeverity,
  PaperVsLiveGapRecord,
  PositionExitSnapshot,
  PositionRecord,
  PositionStatus,
  RejectionRecord,
  RpcEndpointHealth,
  SeenTokenRecord,
  TradeRecord,
} from '../types';

export interface SettingsHistoryEntry {
  id: number;
  field: string;
  oldValue: string;
  newValue: string;
  changedAtMs: number;
}

export class BotDatabase {
  public readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field TEXT NOT NULL,
        old_value TEXT NOT NULL,
        new_value TEXT NOT NULL,
        changed_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        dex TEXT NOT NULL,
        token_class TEXT NOT NULL,
        status TEXT NOT NULL,
        opened_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        token_age_at_entry_min REAL NOT NULL,
        decimals INTEGER NOT NULL,
        quantity REAL NOT NULL,
        entry_price_usd REAL NOT NULL,
        entry_price_sol REAL NOT NULL,
        current_price_usd REAL NOT NULL,
        current_price_sol REAL NOT NULL,
        break_even_price_usd REAL NOT NULL,
        break_even_price_sol REAL NOT NULL,
        entry_liquidity_usd REAL NOT NULL,
        current_liquidity_usd REAL NOT NULL,
        sol_in REAL NOT NULL,
        entry_fees_sol REAL NOT NULL,
        entry_rent_sol REAL NOT NULL,
        sol_price_usd_at_entry REAL NOT NULL,
        peak_price_usd REAL NOT NULL,
        peak_pnl_pct REAL NOT NULL,
        trailing_floor_pct REAL,
        trailing_armed INTEGER NOT NULL DEFAULT 0,
        gap_down_triggered INTEGER NOT NULL DEFAULT 0,
        exit_params_json TEXT NOT NULL,
        tx_buy TEXT,
        confirmation_label TEXT NOT NULL,
        quality_score REAL NOT NULL,
        trade_score REAL NOT NULL,
        explanation_json TEXT NOT NULL,
        sell_attempts INTEGER NOT NULL DEFAULT 0,
        first_sell_failure_at_ms INTEGER,
        last_sell_error TEXT,
        consecutive_zero_balance_reads INTEGER NOT NULL DEFAULT 0,
        review_reason TEXT,
        is_stale_data INTEGER NOT NULL DEFAULT 0,
        price_history_json TEXT NOT NULL DEFAULT '[]',
        triggered_sl_tiers_json TEXT NOT NULL DEFAULT '[]',
        archived_session_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_positions_mode_status ON positions(mode, status);
      CREATE INDEX IF NOT EXISTS idx_positions_mint ON positions(mint);

      CREATE TABLE IF NOT EXISTS trades (
        trade_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        mint TEXT NOT NULL,
        source TEXT NOT NULL,
        dex TEXT NOT NULL,
        token_age_at_entry REAL NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        quantity REAL NOT NULL,
        sol_in REAL NOT NULL,
        sol_out REAL NOT NULL,
        fees_sol REAL NOT NULL,
        rent_sol REAL NOT NULL,
        gross_pnl_sol REAL NOT NULL,
        pnl_sol REAL NOT NULL,
        pnl_usd REAL NOT NULL,
        pnl_pct REAL NOT NULL,
        peak_pct REAL NOT NULL,
        hold_seconds INTEGER NOT NULL,
        exit_reason TEXT NOT NULL,
        confirmed TEXT NOT NULL,
        tx_buy TEXT,
        tx_sell TEXT,
        sol_price_usd REAL NOT NULL,
        fee_breakdown_json TEXT NOT NULL,
        archived_session_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_trades_mode_closed ON trades(mode, closed_at);

      CREATE TABLE IF NOT EXISTS trade_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_or_position_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        mint TEXT NOT NULL,
        event_type TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS seen_tokens (
        mint TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        dex TEXT NOT NULL,
        first_seen_ms INTEGER NOT NULL,
        last_scanned_ms INTEGER NOT NULL,
        last_quality_score REAL NOT NULL,
        last_trade_score REAL NOT NULL,
        times_evaluated INTEGER NOT NULL DEFAULT 1,
        last_decision TEXT NOT NULL,
        last_reason TEXT NOT NULL,
        liquidity_usd REAL NOT NULL,
        price_usd REAL NOT NULL,
        explanation_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rejections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        source TEXT NOT NULL,
        stage TEXT NOT NULL,
        reason TEXT NOT NULL,
        quality_score REAL NOT NULL,
        trade_score REAL NOT NULL,
        created_at_ms INTEGER NOT NULL,
        details_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rejections_created ON rejections(created_at_ms DESC);

      CREATE TABLE IF NOT EXISTS attempted_mints (
        mint TEXT NOT NULL,
        mode TEXT NOT NULL,
        tx_sig TEXT,
        status TEXT NOT NULL,
        attempted_at_ms INTEGER NOT NULL,
        PRIMARY KEY (mint, mode)
      );

      CREATE TABLE IF NOT EXISTS cooldowns (
        mint TEXT NOT NULL,
        mode TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        PRIMARY KEY (mint, mode)
      );

      CREATE TABLE IF NOT EXISTS rpc_health (
        url TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        healthy INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        error_count INTEGER NOT NULL,
        last_checked_ms INTEGER NOT NULL,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        meta_json TEXT,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at_ms DESC);

      CREATE TABLE IF NOT EXISTS paper_vs_live_gaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT NOT NULL,
        mint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        quoted_price_usd REAL NOT NULL,
        actual_fill_price_usd REAL NOT NULL,
        gap_pct REAL NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migrate existing databases to include triggered_sl_tiers_json
    try {
      this.db.exec(
        "ALTER TABLE positions ADD COLUMN triggered_sl_tiers_json TEXT NOT NULL DEFAULT '[]'"
      );
    } catch {
      // Column already exists
    }

    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get('bot_settings') as { value_json: string } | undefined;

    if (!row) {
      this.db
        .prepare('INSERT INTO settings (key, value_json, updated_at_ms) VALUES (?, ?, ?)')
        .run('bot_settings', JSON.stringify(DEFAULT_SETTINGS), Date.now());
    }

    const paperBal = this.db
      .prepare('SELECT value FROM app_meta WHERE key = ?')
      .get('paper_balance_sol') as { value: string } | undefined;
    if (!paperBal) {
      this.setMeta('paper_balance_sol', String(DEFAULT_SETTINGS.paperInitialBalanceSol));
    }

    const testnetBal = this.db
      .prepare('SELECT value FROM app_meta WHERE key = ?')
      .get('testnet_balance_sol') as { value: string } | undefined;
    if (!testnetBal) {
      this.setMeta('testnet_balance_sol', String(DEFAULT_SETTINGS.paperInitialBalanceSol));
    }
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value);
  }

  getSettings(): BotSettings {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get('bot_settings') as { value_json: string } | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(row.value_json) as Partial<BotSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  updateSettings(patch: Partial<BotSettings>): { valid: boolean; errors: string[]; fieldErrors: Record<string, string>; settings: BotSettings } {
    const current = this.getSettings();
    const validation = validateSettingsUpdate(current, patch);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors, fieldErrors: validation.fieldErrors, settings: current };
    }

    const now = Date.now();
    const insertHistory = this.db.prepare(
      'INSERT INTO settings_history (field, old_value, new_value, changed_at_ms) VALUES (?, ?, ?, ?)'
    );

    const tx = this.db.transaction(() => {
      for (const key of Object.keys(patch) as Array<keyof BotSettings>) {
        const oldVal = JSON.stringify(current[key]);
        const newVal = JSON.stringify(validation.merged[key]);
        if (oldVal !== newVal) {
          insertHistory.run(String(key), oldVal, newVal, now);
        }
      }
      this.db
        .prepare('UPDATE settings SET value_json = ?, updated_at_ms = ? WHERE key = ?')
        .run(JSON.stringify(validation.merged), now, 'bot_settings');
    });

    tx();
    return { valid: true, errors: [], fieldErrors: {}, settings: validation.merged };
  }

  getSettingsHistory(limit = 100): SettingsHistoryEntry[] {
    return this.db
      .prepare(
        'SELECT id, field, old_value as oldValue, new_value as newValue, changed_at_ms as changedAtMs FROM settings_history ORDER BY id DESC LIMIT ?'
      )
      .all(limit) as SettingsHistoryEntry[];
  }

  getModeBalanceSol(mode: ExecutionMode): number {
    if (mode === 'paper') {
      return Number(this.getMeta('paper_balance_sol') ?? DEFAULT_SETTINGS.paperInitialBalanceSol);
    }
    if (mode === 'testnet') {
      return Number(this.getMeta('testnet_balance_sol') ?? DEFAULT_SETTINGS.paperInitialBalanceSol);
    }
    return Number(this.getMeta('live_balance_sol') ?? 0);
  }

  setModeBalanceSol(mode: ExecutionMode, balance: number): void {
    const key =
      mode === 'paper'
        ? 'paper_balance_sol'
        : mode === 'testnet'
          ? 'testnet_balance_sol'
          : 'live_balance_sol';
    this.setMeta(key, String(Math.max(0, balance)));
  }

  upsertPosition(pos: PositionRecord): void {
    this.db
      .prepare(
        `INSERT INTO positions (
          id, mode, mint, symbol, name, source, dex, token_class, status,
          opened_at_ms, updated_at_ms, token_age_at_entry_min, decimals, quantity,
          entry_price_usd, entry_price_sol, current_price_usd, current_price_sol,
          break_even_price_usd, break_even_price_sol, entry_liquidity_usd, current_liquidity_usd,
          sol_in, entry_fees_sol, entry_rent_sol, sol_price_usd_at_entry,
          peak_price_usd, peak_pnl_pct, trailing_floor_pct, trailing_armed, gap_down_triggered,
          exit_params_json, tx_buy, confirmation_label, quality_score, trade_score,
          explanation_json, sell_attempts, first_sell_failure_at_ms, last_sell_error,
          consecutive_zero_balance_reads, review_reason, is_stale_data, price_history_json,
          triggered_sl_tiers_json
        ) VALUES (
          @id, @mode, @mint, @symbol, @name, @source, @dex, @tokenClass, @status,
          @openedAtMs, @updatedAtMs, @tokenAgeAtEntryMin, @decimals, @quantity,
          @entryPriceUsd, @entryPriceSol, @currentPriceUsd, @currentPriceSol,
          @breakEvenPriceUsd, @breakEvenPriceSol, @entryLiquidityUsd, @currentLiquidityUsd,
          @solIn, @entryFeesSol, @entryRentSol, @solPriceUsdAtEntry,
          @peakPriceUsd, @peakPnlPct, @trailingFloorPct, @trailingArmed, @gapDownTriggered,
          @exitParamsJson, @txBuy, @confirmationLabel, @qualityScore, @tradeScore,
          @explanationJson, @sellAttempts, @firstSellFailureAtMs, @lastSellError,
          @consecutiveZeroBalanceReads, @reviewReason, @isStaleData, @priceHistoryJson,
          @triggeredSlTiersJson
        ) ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          updated_at_ms = excluded.updated_at_ms,
          quantity = excluded.quantity,
          sol_in = excluded.sol_in,
          entry_fees_sol = excluded.entry_fees_sol,
          current_price_usd = excluded.current_price_usd,
          current_price_sol = excluded.current_price_sol,
          current_liquidity_usd = excluded.current_liquidity_usd,
          peak_price_usd = excluded.peak_price_usd,
          peak_pnl_pct = excluded.peak_pnl_pct,
          trailing_floor_pct = excluded.trailing_floor_pct,
          trailing_armed = excluded.trailing_armed,
          gap_down_triggered = excluded.gap_down_triggered,
          sell_attempts = excluded.sell_attempts,
          first_sell_failure_at_ms = excluded.first_sell_failure_at_ms,
          last_sell_error = excluded.last_sell_error,
          consecutive_zero_balance_reads = excluded.consecutive_zero_balance_reads,
          review_reason = excluded.review_reason,
          is_stale_data = excluded.is_stale_data,
          price_history_json = excluded.price_history_json,
          triggered_sl_tiers_json = excluded.triggered_sl_tiers_json`
      )
      .run({
        ...pos,
        trailingArmed: pos.trailingArmed ? 1 : 0,
        gapDownTriggered: pos.gapDownTriggered ? 1 : 0,
        isStaleData: pos.isStaleData ? 1 : 0,
        exitParamsJson: JSON.stringify(pos.exitParams),
        priceHistoryJson: JSON.stringify(pos.priceHistory),
        triggeredSlTiersJson: JSON.stringify(pos.triggeredStopLossTiers ?? []),
      });
  }

  private mapPositionRow(row: Record<string, unknown>): PositionRecord {
    return {
      id: String(row.id),
      mode: row.mode as ExecutionMode,
      mint: String(row.mint),
      symbol: String(row.symbol),
      name: String(row.name),
      source: String(row.source),
      dex: String(row.dex),
      tokenClass: row.token_class as PositionRecord['tokenClass'],
      status: row.status as PositionStatus,
      openedAtMs: Number(row.opened_at_ms),
      updatedAtMs: Number(row.updated_at_ms),
      tokenAgeAtEntryMin: Number(row.token_age_at_entry_min),
      decimals: Number(row.decimals),
      quantity: Number(row.quantity),
      entryPriceUsd: Number(row.entry_price_usd),
      entryPriceSol: Number(row.entry_price_sol),
      currentPriceUsd: Number(row.current_price_usd),
      currentPriceSol: Number(row.current_price_sol),
      breakEvenPriceUsd: Number(row.break_even_price_usd),
      breakEvenPriceSol: Number(row.break_even_price_sol),
      entryLiquidityUsd: Number(row.entry_liquidity_usd),
      currentLiquidityUsd: Number(row.current_liquidity_usd),
      solIn: Number(row.sol_in),
      entryFeesSol: Number(row.entry_fees_sol),
      entryRentSol: Number(row.entry_rent_sol),
      solPriceUsdAtEntry: Number(row.sol_price_usd_at_entry),
      peakPriceUsd: Number(row.peak_price_usd),
      peakPnlPct: Number(row.peak_pnl_pct),
      trailingFloorPct: row.trailing_floor_pct === null ? null : Number(row.trailing_floor_pct),
      trailingArmed: Number(row.trailing_armed) === 1,
      gapDownTriggered: Number(row.gap_down_triggered) === 1,
      exitParams: JSON.parse(String(row.exit_params_json)) as PositionExitSnapshot,
      txBuy: row.tx_buy ? String(row.tx_buy) : null,
      confirmationLabel: row.confirmation_label as PositionRecord['confirmationLabel'],
      qualityScore: Number(row.quality_score),
      tradeScore: Number(row.trade_score),
      explanationJson: String(row.explanation_json),
      sellAttempts: Number(row.sell_attempts),
      first_sell_failure_at_ms: null,
      firstSellFailureAtMs:
        row.first_sell_failure_at_ms === null ? null : Number(row.first_sell_failure_at_ms),
      lastSellError: row.last_sell_error ? String(row.last_sell_error) : null,
      consecutiveZeroBalanceReads: Number(row.consecutive_zero_balance_reads),
      reviewReason: row.review_reason ? String(row.review_reason) : null,
      isStaleData: Number(row.is_stale_data) === 1,
      priceHistory: JSON.parse(String(row.price_history_json || '[]')) as number[],
      triggeredStopLossTiers: JSON.parse(String(row.triggered_sl_tiers_json || '[]')) as number[],
    } as PositionRecord;
  }

  getPositions(mode: ExecutionMode, includeClosed = false): PositionRecord[] {
    const query = includeClosed
      ? 'SELECT * FROM positions WHERE mode = ? AND archived_session_id IS NULL ORDER BY opened_at_ms DESC'
      : "SELECT * FROM positions WHERE mode = ? AND status != 'CLOSED' AND archived_session_id IS NULL ORDER BY opened_at_ms DESC";
    const rows = this.db.prepare(query).all(mode) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapPositionRow(r));
  }

  getPositionById(id: string): PositionRecord | null {
    const row = this.db.prepare('SELECT * FROM positions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapPositionRow(row) : null;
  }

  getOpenPositionByMint(mode: ExecutionMode, mint: string): PositionRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM positions WHERE mode = ? AND mint = ? AND status != 'CLOSED' AND archived_session_id IS NULL LIMIT 1"
      )
      .get(mode, mint) as Record<string, unknown> | undefined;
    return row ? this.mapPositionRow(row) : null;
  }

  insertTrade(trade: TradeRecord): void {
    this.db
      .prepare(
        `INSERT INTO trades (
          trade_id, mode, opened_at, closed_at, symbol, mint, source, dex,
          token_age_at_entry, entry_price, exit_price, quantity, sol_in, sol_out,
          fees_sol, rent_sol, gross_pnl_sol, pnl_sol, pnl_usd, pnl_pct, peak_pct,
          hold_seconds, exit_reason, confirmed, tx_buy, tx_sell, sol_price_usd,
          fee_breakdown_json, archived_session_id
        ) VALUES (
          @tradeId, @mode, @openedAt, @closedAt, @symbol, @mint, @source, @dex,
          @tokenAgeAtEntry, @entryPrice, @exitPrice, @quantity, @solIn, @solOut,
          @feesSol, @rentSol, @grossPnlSol, @pnlSol, @pnlUsd, @pnlPct, @peakPct,
          @holdSeconds, @exitReason, @confirmed, @txBuy, @txSell, @solPriceUsd,
          @feeBreakdownJson, @archivedSessionId
        )`
      )
      .run(trade);
  }

  getTrades(mode?: ExecutionMode, includeArchived = false): TradeRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (mode) {
      clauses.push('mode = ?');
      params.push(mode);
    }
    if (!includeArchived) {
      clauses.push('archived_session_id IS NULL');
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM trades ${where} ORDER BY closed_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      tradeId: String(r.trade_id),
      mode: r.mode as ExecutionMode,
      openedAt: String(r.opened_at),
      closedAt: String(r.closed_at),
      symbol: String(r.symbol),
      mint: String(r.mint),
      source: String(r.source),
      dex: String(r.dex),
      tokenAgeAtEntry: Number(r.token_age_at_entry),
      entryPrice: Number(r.entry_price),
      exitPrice: Number(r.exit_price),
      quantity: Number(r.quantity),
      solIn: Number(r.sol_in),
      solOut: Number(r.sol_out),
      feesSol: Number(r.fees_sol),
      rentSol: Number(r.rent_sol),
      grossPnlSol: Number(r.gross_pnl_sol),
      pnlSol: Number(r.pnl_sol),
      pnlUsd: Number(r.pnl_usd),
      pnlPct: Number(r.pnl_pct),
      peakPct: Number(r.peak_pct),
      holdSeconds: Number(r.hold_seconds),
      exitReason: r.exit_reason as TradeRecord['exitReason'],
      confirmed: r.confirmed as TradeRecord['confirmed'],
      txBuy: r.tx_buy ? String(r.tx_buy) : null,
      txSell: r.tx_sell ? String(r.tx_sell) : null,
      solPriceUsd: Number(r.sol_price_usd),
      feeBreakdownJson: String(r.fee_breakdown_json),
      archivedSessionId: r.archived_session_id ? String(r.archived_session_id) : null,
    }));
  }

  getDailyRealizedPnlSol(mode: ExecutionMode): number {
    const dayStartIso = new Date();
    dayStartIso.setUTCHours(0, 0, 0, 0);
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(pnl_sol), 0) as total FROM trades WHERE mode = ? AND archived_session_id IS NULL AND closed_at >= ?'
      )
      .get(mode, dayStartIso.toISOString()) as { total: number };
    return Number(row.total || 0);
  }

  addTradeEvent(
    tradeOrPositionId: string,
    mode: ExecutionMode,
    mint: string,
    eventType: string,
    details: unknown
  ): void {
    this.db
      .prepare(
        'INSERT INTO trade_events (trade_or_position_id, mode, mint, event_type, details_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(tradeOrPositionId, mode, mint, eventType, JSON.stringify(details), Date.now());
  }

  markMintAttempted(mint: string, mode: ExecutionMode, status: string, txSig?: string): void {
    this.db
      .prepare(
        `INSERT INTO attempted_mints (mint, mode, tx_sig, status, attempted_at_ms)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(mint, mode) DO UPDATE SET tx_sig = COALESCE(excluded.tx_sig, attempted_mints.tx_sig), status = excluded.status`
      )
      .run(mint, mode, txSig ?? null, status, Date.now());
  }

  isMintAttempted(mint: string, mode: ExecutionMode): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM attempted_mints WHERE mint = ? AND mode = ?')
      .get(mint, mode);
    return row !== undefined;
  }

  setCooldown(mint: string, mode: ExecutionMode, cooldownMinutes: number): void {
    const expiresAtMs = Date.now() + cooldownMinutes * 60_000;
    this.db
      .prepare(
        `INSERT INTO cooldowns (mint, mode, expires_at_ms) VALUES (?, ?, ?)
         ON CONFLICT(mint, mode) DO UPDATE SET expires_at_ms = excluded.expires_at_ms`
      )
      .run(mint, mode, expiresAtMs);
  }

  isInCooldown(mint: string, mode: ExecutionMode, nowMs = Date.now()): boolean {
    const row = this.db
      .prepare('SELECT expires_at_ms FROM cooldowns WHERE mint = ? AND mode = ?')
      .get(mint, mode) as { expires_at_ms: number } | undefined;
    return row !== undefined && row.expires_at_ms > nowMs;
  }

  upsertSeenToken(token: Omit<SeenTokenRecord, 'firstSeenMs' | 'timesEvaluated'> & { nowMs: number }): void {
    this.db
      .prepare(
        `INSERT INTO seen_tokens (
          mint, symbol, name, source, dex, first_seen_ms, last_scanned_ms,
          last_quality_score, last_trade_score, times_evaluated, last_decision,
          last_reason, liquidity_usd, price_usd, explanation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(mint) DO UPDATE SET
          symbol = excluded.symbol,
          name = excluded.name,
          source = excluded.source,
          dex = excluded.dex,
          last_scanned_ms = excluded.last_scanned_ms,
          last_quality_score = excluded.last_quality_score,
          last_trade_score = excluded.last_trade_score,
          times_evaluated = seen_tokens.times_evaluated + 1,
          last_decision = excluded.last_decision,
          last_reason = excluded.last_reason,
          liquidity_usd = excluded.liquidity_usd,
          price_usd = excluded.price_usd,
          explanation_json = excluded.explanation_json`
      )
      .run(
        token.mint,
        token.symbol,
        token.name,
        token.source,
        token.dex,
        token.nowMs,
        token.lastScannedMs,
        token.lastQualityScore,
        token.lastTradeScore,
        token.lastDecision,
        token.lastReason,
        token.liquidityUsd,
        token.priceUsd,
        token.explanationJson
      );
  }

  getSeenTokens(limit = 300): SeenTokenRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM seen_tokens ORDER BY last_scanned_ms DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      mint: String(r.mint),
      symbol: String(r.symbol),
      name: String(r.name),
      source: String(r.source),
      dex: String(r.dex),
      firstSeenMs: Number(r.first_seen_ms),
      lastScannedMs: Number(r.last_scanned_ms),
      lastQualityScore: Number(r.last_quality_score),
      lastTradeScore: Number(r.last_trade_score),
      timesEvaluated: Number(r.times_evaluated),
      lastDecision: r.last_decision as 'BUY' | 'REJECT',
      lastReason: String(r.last_reason),
      liquidityUsd: Number(r.liquidity_usd),
      priceUsd: Number(r.price_usd),
      explanationJson: String(r.explanation_json),
    }));
  }

  clearSeenTokensCache(): void {
    this.db.prepare('DELETE FROM seen_tokens').run();
  }

  insertRejection(rej: Omit<RejectionRecord, 'id'>): RejectionRecord {
    const info = this.db
      .prepare(
        `INSERT INTO rejections (mint, symbol, source, stage, reason, quality_score, trade_score, created_at_ms, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rej.mint,
        rej.symbol,
        rej.source,
        rej.stage,
        rej.reason,
        rej.qualityScore,
        rej.tradeScore,
        rej.createdAtMs,
        rej.detailsJson
      );
    return { ...rej, id: Number(info.lastInsertRowid) };
  }

  getRejections(limit = 200): RejectionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM rejections ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      mint: String(r.mint),
      symbol: String(r.symbol),
      source: String(r.source),
      stage: String(r.stage),
      reason: String(r.reason),
      qualityScore: Number(r.quality_score),
      tradeScore: Number(r.trade_score),
      createdAtMs: Number(r.created_at_ms),
      detailsJson: String(r.details_json),
    }));
  }

  upsertRpcHealth(health: RpcEndpointHealth): void {
    this.db
      .prepare(
        `INSERT INTO rpc_health (url, label, healthy, latency_ms, slot, error_count, last_checked_ms, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           label = excluded.label,
           healthy = excluded.healthy,
           latency_ms = excluded.latency_ms,
           slot = excluded.slot,
           error_count = excluded.error_count,
           last_checked_ms = excluded.last_checked_ms,
           last_error = excluded.last_error`
      )
      .run(
        health.url,
        health.label,
        health.healthy ? 1 : 0,
        health.latencyMs,
        health.slot,
        health.errorCount,
        health.lastCheckedMs,
        health.lastError
      );
  }

  insertLog(severity: LogSeverity, category: string, message: string, meta?: unknown): LogEntry {
    const now = Date.now();
    const metaJson = meta !== undefined ? JSON.stringify(meta) : null;
    const info = this.db
      .prepare('INSERT INTO events (severity, category, message, meta_json, created_at_ms) VALUES (?, ?, ?, ?, ?)')
      .run(severity, category, message, metaJson, now);
    return {
      id: Number(info.lastInsertRowid),
      severity,
      category,
      message,
      metaJson,
      createdAtMs: now,
    };
  }

  getLogs(limit = 300, severity?: LogSeverity): LogEntry[] {
    const rows = severity
      ? (this.db
          .prepare('SELECT * FROM events WHERE severity = ? ORDER BY id DESC LIMIT ?')
          .all(severity, limit) as Array<Record<string, unknown>>)
      : (this.db
          .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
          .all(limit) as Array<Record<string, unknown>>);
    return rows.map((r) => ({
      id: Number(r.id),
      severity: r.severity as LogSeverity,
      category: String(r.category),
      message: String(r.message),
      metaJson: r.meta_json ? String(r.meta_json) : null,
      createdAtMs: Number(r.created_at_ms),
    }));
  }

  recordPaperVsLiveGap(entry: Omit<PaperVsLiveGapRecord, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO paper_vs_live_gaps (trade_id, mint, symbol, quoted_price_usd, actual_fill_price_usd, gap_pct, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.tradeId,
        entry.mint,
        entry.symbol,
        entry.quotedPriceUsd,
        entry.actualFillPriceUsd,
        entry.gapPct,
        entry.createdAtMs
      );
  }

  getPaperVsLiveGaps(limit = 100): PaperVsLiveGapRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM paper_vs_live_gaps ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      tradeId: String(r.trade_id),
      mint: String(r.mint),
      symbol: String(r.symbol),
      quotedPriceUsd: Number(r.quoted_price_usd),
      actualFillPriceUsd: Number(r.actual_fill_price_usd),
      gapPct: Number(r.gap_pct),
      createdAtMs: Number(r.created_at_ms),
    }));
  }

  getAveragePaperLiveGapPct(): number {
    const row = this.db
      .prepare('SELECT COALESCE(AVG(gap_pct), 0) as avgGap FROM paper_vs_live_gaps')
      .get() as { avgGap: number };
    return Number(row.avgGap || 0);
  }

  /**
   * Archives paper (or testnet) positions and trades without deleting anything,
   * and NEVER touches live rows.
   */
  archiveAndResetPaperAccount(initialBalanceSol: number, targetMode: 'paper' | 'testnet' = 'paper'): string {
    const sessionId = `archive_${targetMode}_${Date.now()}`;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE positions SET archived_session_id = ? WHERE mode = ? AND archived_session_id IS NULL'
        )
        .run(sessionId, targetMode);
      this.db
        .prepare(
          'UPDATE trades SET archived_session_id = ? WHERE mode = ? AND archived_session_id IS NULL'
        )
        .run(sessionId, targetMode);
      this.db.prepare('DELETE FROM attempted_mints WHERE mode = ?').run(targetMode);
      this.db.prepare('DELETE FROM cooldowns WHERE mode = ?').run(targetMode);
      this.setModeBalanceSol(targetMode, initialBalanceSol);
    });
    tx();
    return sessionId;
  }

  close(): void {
    this.db.close();
  }
}
