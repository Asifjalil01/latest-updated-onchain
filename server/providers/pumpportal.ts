import WebSocket from 'ws';
import type { SourceHealthRecord } from '../types';

export interface PumpPortalEvent {
  mint: string;
  symbol?: string;
  name?: string;
  eventType: 'new_token' | 'migration';
  receivedAtMs: number;
}

export interface PumpPortalTradeSample {
  tsMs: number;
  side: 'buy' | 'sell';
  solAmount: number;
  trader?: string;
}

export interface PumpPortalTokenState {
  mint: string;
  symbol: string;
  name: string;
  createdAtMs: number;
  lastTradeAtMs: number;
  bondingCurveKey: string;
  creator: string;
  creatorInitialBuySol: number;
  creatorSold: boolean;
  migrated: boolean;
  vSolInBondingCurve: number;
  vTokensInBondingCurve: number;
  marketCapSol: number;
  trades: PumpPortalTradeSample[];
}

export interface SyntheticPumpPortalPair {
  baseToken: { address: string; symbol: string; name: string };
  dexId: string;
  pairAddress: string;
  pairCreatedAt: number;
  priceUsd: string;
  liquidity: { usd: number };
  fdv: number;
  marketCap: number;
  txns: {
    m5: { buys: number; sells: number };
  };
  volume: {
    m5: number;
  };
  url: string;
  _synthetic: true;
  _pumpportal: {
    has_trade_stream: boolean;
    buys_60s: number;
    sells_60s: number;
    sol_vol_60s: number;
    unique_traders_5m: number;
    v_sol: number;
    real_sol: number;
    creator: string;
    creator_sold: boolean;
    initial_buy_sol: number;
    recent_buyers: string[];
  };
}

export interface PumpPortalTradeTick {
  mint: string;
  side: 'buy' | 'sell';
  solAmount: number;
  trader: string;
  priceSol: number;
  vSol: number;
  vTokens: number;
  tsMs: number;
  migrated: boolean;
}

export interface PumpPortalLiveSnapshot {
  mint: string;
  priceUsd: number;
  priceSol: number;
  liquidityUsd: number;
  lastTradeAtMs: number;
  uniqueTraders5m: number;
  recentSellers: string[];
  recentBuyers: string[];
  realSol: number;
  creator: string;
  creatorSold: boolean;
}

export interface PumpPortalRawMessage {
  mint?: string;
  symbol?: string;
  name?: string;
  txType?: string;
  traderPublicKey?: string;
  initialBuy?: number | string;
  solAmount?: number | string;
  tokenAmount?: number | string;
  bondingCurveKey?: string;
  vTokensInBondingCurve?: number | string;
  vSolInBondingCurve?: number | string;
  marketCapSol?: number | string;
}

const MAX_TRACKED_TOKENS = 180;
const MAX_SUBSCRIBED_MINTS = 60;
const TOKEN_RETENTION_MS = 10 * 60_000;
const TRADE_WINDOW_MS = 5 * 60_000;

function toFiniteNum(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export class PumpPortalWsProvider {
  private ws: WebSocket | null = null;
  private enabled = false;
  private newTokenBuffer: PumpPortalEvent[] = [];
  private migrationBuffer: PumpPortalEvent[] = [];
  private tokenStates = new Map<string, PumpPortalTokenState>();
  private subscribedMints = new Set<string>();
  private pinnedOpenMints = new Set<string>();
  private tradeListeners = new Set<(tick: PumpPortalTradeTick) => void>();
  private itemsCount = 0;
  private lastOkMs: number | null = null;
  private errorCount = 0;
  private consecutiveErrors = 0;
  private lastError: string | null = null;
  private recentErrors: Array<{ message: string; atMs: number }> = [];
  private reconnectTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.consecutiveErrors = 0;
    this.connect();
  }

  stop(): void {
    this.enabled = false;
    this.consecutiveErrors = 0;
    this.subscribedMints.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore close errors
      }
      this.ws = null;
    }
  }

  onTrade(listener: (tick: PumpPortalTradeTick) => void): () => void {
    this.tradeListeners.add(listener);
    return () => {
      this.tradeListeners.delete(listener);
    };
  }

  setPinnedOpenMints(mints: string[]): void {
    const clean = new Set(mints.map((m) => String(m || '').trim()).filter((m) => m.length >= 32));
    const newlyAdded: string[] = [];
    for (const m of clean) {
      if (!this.pinnedOpenMints.has(m)) newlyAdded.push(m);
    }
    this.pinnedOpenMints = clean;
    for (const m of newlyAdded) {
      this.subscribeMintTrades(m);
    }
  }

  private subscribeMintTrades(mint: string): void {
    if (!mint || this.subscribedMints.has(mint)) return;
    if (this.subscribedMints.size >= MAX_SUBSCRIBED_MINTS) {
      // Never evict a pinned open position mint when rolling discovery slots
      let evictCandidate: string | null = null;
      for (const existing of this.subscribedMints) {
        if (!this.pinnedOpenMints.has(existing)) {
          evictCandidate = existing;
          break;
        }
      }
      if (evictCandidate) {
        this.subscribedMints.delete(evictCandidate);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [evictCandidate] }));
          } catch {
            // ignore
          }
        }
      }
    }
    this.subscribedMints.add(mint);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
      } catch {
        // ignore
      }
    }
  }

  private pruneTokenStates(nowMs: number): void {
    if (this.tokenStates.size <= MAX_TRACKED_TOKENS) {
      for (const [mint, st] of this.tokenStates.entries()) {
        if (this.pinnedOpenMints.has(mint)) continue;
        if (nowMs - st.createdAtMs > TOKEN_RETENTION_MS && nowMs - st.lastTradeAtMs > TOKEN_RETENTION_MS) {
          this.tokenStates.delete(mint);
          if (this.subscribedMints.has(mint)) {
            this.subscribedMints.delete(mint);
          }
        }
      }
      return;
    }
    const entries = Array.from(this.tokenStates.entries())
      .filter(([mint]) => !this.pinnedOpenMints.has(mint))
      .sort((a, b) => a[1].lastTradeAtMs - b[1].lastTradeAtMs);
    const toRemove = Math.max(0, this.tokenStates.size - MAX_TRACKED_TOKENS);
    for (let i = 0; i < Math.min(toRemove, entries.length); i += 1) {
      const mint = entries[i][0];
      this.tokenStates.delete(mint);
      this.subscribedMints.delete(mint);
    }
  }

  /**
   * Ingests a PumpPortal WebSocket frame (create, buy, sell, or migrate).
   * Exposed publicly so unit tests can verify live bonding-curve metrics and 60s velocity deterministically.
   */
  ingestFrame(msg: PumpPortalRawMessage, nowMs = Date.now()): void {
    const mint = typeof msg?.mint === 'string' ? msg.mint.trim() : '';
    if (!mint) return;

    this.lastOkMs = nowMs;
    this.consecutiveErrors = 0;
    this.itemsCount += 1;

    const txType = String(msg.txType || '').toLowerCase();
    const isTrade = txType === 'buy' || txType === 'sell';
    const isMigration = txType === 'migrate';

    const vSol = toFiniteNum(msg.vSolInBondingCurve, 0);
    const vTokens = toFiniteNum(msg.vTokensInBondingCurve, 0);
    const marketCapSol = toFiniteNum(msg.marketCapSol, 0);
    const solAmt = toFiniteNum(msg.solAmount, toFiniteNum(msg.initialBuy, 0));
    const trader = typeof msg.traderPublicKey === 'string' ? msg.traderPublicKey.trim() : '';

    let state = this.tokenStates.get(mint);
    if (!state) {
      state = {
        mint,
        symbol: (typeof msg.symbol === 'string' && msg.symbol.trim()) || '?',
        name: (typeof msg.name === 'string' && msg.name.trim()) || (typeof msg.symbol === 'string' ? msg.symbol : 'Unknown'),
        createdAtMs: nowMs,
        lastTradeAtMs: nowMs,
        bondingCurveKey: typeof msg.bondingCurveKey === 'string' ? msg.bondingCurveKey : '',
        creator: !isTrade && !isMigration ? trader : '',
        creatorInitialBuySol: !isTrade && !isMigration ? Math.max(0, solAmt) : 0,
        creatorSold: false,
        migrated: isMigration,
        vSolInBondingCurve: vSol,
        vTokensInBondingCurve: vTokens,
        marketCapSol,
        trades: [],
      };
      this.tokenStates.set(mint, state);
    } else {
      if (msg.symbol && state.symbol === '?') state.symbol = msg.symbol.trim();
      if (msg.name && state.name === 'Unknown') state.name = msg.name.trim();
      if (msg.bondingCurveKey && !state.bondingCurveKey) state.bondingCurveKey = msg.bondingCurveKey;
      if (vSol > 0) state.vSolInBondingCurve = vSol;
      if (vTokens > 0) state.vTokensInBondingCurve = vTokens;
      if (marketCapSol > 0) state.marketCapSol = marketCapSol;
      if (isMigration) state.migrated = true;
      state.lastTradeAtMs = nowMs;
    }

    if (isTrade) {
      const side: 'buy' | 'sell' = txType === 'sell' ? 'sell' : 'buy';
      if (side === 'sell' && state.creator && trader && trader === state.creator) {
        state.creatorSold = true;
      }
      state.trades.push({
        tsMs: nowMs,
        side,
        solAmount: Math.max(0, solAmt),
        trader: trader || undefined,
      });
      const cutoff = nowMs - TRADE_WINDOW_MS;
      if (state.trades.length > 250 || (state.trades[0] && state.trades[0].tsMs < cutoff)) {
        state.trades = state.trades.filter((t) => t.tsMs >= cutoff).slice(-250);
      }
      if (this.tradeListeners.size > 0 && state.vSolInBondingCurve > 0 && state.vTokensInBondingCurve > 0) {
        const tick: PumpPortalTradeTick = {
          mint,
          side,
          solAmount: Math.max(0, solAmt),
          trader,
          priceSol: state.vSolInBondingCurve / state.vTokensInBondingCurve,
          vSol: state.vSolInBondingCurve,
          vTokens: state.vTokensInBondingCurve,
          tsMs: nowMs,
          migrated: state.migrated,
        };
        for (const cb of this.tradeListeners) {
          try {
            cb(tick);
          } catch {
            // keep stream healthy
          }
        }
      }
    } else {
      // Seed initial creator buy when creation frame reports solAmount/initialBuy > 0
      if (!isMigration && solAmt > 0 && state.trades.length === 0) {
        state.trades.push({
          tsMs: nowMs,
          side: 'buy',
          solAmount: solAmt,
          trader: trader || undefined,
        });
      }

      const event: PumpPortalEvent = {
        mint,
        symbol: msg.symbol || state.symbol,
        name: msg.name || state.name,
        eventType: isMigration ? 'migration' : 'new_token',
        receivedAtMs: nowMs,
      };
      if (isMigration) {
        this.migrationBuffer.push(event);
        if (this.migrationBuffer.length > 150) {
          this.migrationBuffer.shift();
        }
      } else {
        this.newTokenBuffer.push(event);
        if (this.newTokenBuffer.length > 200) {
          this.newTokenBuffer.shift();
        }
        this.subscribeMintTrades(mint);
      }
    }

    if (this.tokenStates.size > MAX_TRACKED_TOKENS) {
      this.pruneTokenStates(nowMs);
    }
  }

  private connect(): void {
    if (!this.enabled) return;
    let openedThisAttempt = false;
    let erroredThisAttempt = false;
    try {
      this.ws = new WebSocket('wss://pumpportal.fun/api/data');
      this.ws.on('open', () => {
        openedThisAttempt = true;
        this.lastOkMs = Date.now();
        this.lastError = null;
        this.consecutiveErrors = 0;
        this.ws?.send(JSON.stringify({ method: 'subscribeNewToken' }));
        this.ws?.send(JSON.stringify({ method: 'subscribeMigration' }));
        if (this.subscribedMints.size > 0) {
          this.ws?.send(
            JSON.stringify({ method: 'subscribeTokenTrade', keys: Array.from(this.subscribedMints) })
          );
        }
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString()) as PumpPortalRawMessage;
          if (msg && msg.mint) {
            this.ingestFrame(msg, Date.now());
          }
        } catch {
          // ignore malformed WS frame
        }
      });

      this.ws.on('error', (err: Error) => {
        erroredThisAttempt = true;
        this.errorCount += 1;
        this.consecutiveErrors += 1;
        this.lastError = err.message;
        this.recentErrors = [{ message: err.message, atMs: Date.now() }, ...this.recentErrors].slice(0, 10);
      });

      this.ws.on('close', () => {
        this.ws = null;
        if (this.enabled) {
          if (!openedThisAttempt && !erroredThisAttempt) {
            this.errorCount += 1;
            this.consecutiveErrors += 1;
            this.lastError = 'WebSocket closed before opening';
            this.recentErrors = [
              { message: 'WebSocket closed before opening', atMs: Date.now() },
              ...this.recentErrors,
            ].slice(0, 10);
          }
          this.reconnectTimer = setTimeout(() => this.connect(), 15_000);
        }
      });
    } catch (err) {
      this.errorCount += 1;
      this.consecutiveErrors += 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errMsg;
      this.recentErrors = [{ message: errMsg, atMs: Date.now() }, ...this.recentErrors].slice(0, 10);
    }
  }

  drainRecentMints(maxAgeMs = 45 * 60_000): string[] {
    const now = Date.now();
    // Reverse so brand-new 5s–5m launches are prioritized at the front of enrichment
    const validMigrations = this.migrationBuffer
      .filter((e) => now - e.receivedAtMs <= maxAgeMs)
      .slice()
      .reverse();
    const validNew = this.newTokenBuffer
      .filter((e) => now - e.receivedAtMs <= maxAgeMs)
      .slice()
      .reverse();
    return Array.from(new Set([...validNew, ...validMigrations].map((e) => e.mint)));
  }

  /**
   * Builds live DexScreener-compatible synthetic pairs directly from PumpPortal curve reserves
   * and WebSocket trade velocity so fresh launches can be evaluated in 5-20s without waiting for DexScreener indexing.
   */
  getSyntheticPairs(solPriceUsd: number | null, maxAgeMs = 180_000, nowMs = Date.now()): SyntheticPumpPortalPair[] {
    const solPx = solPriceUsd && Number.isFinite(solPriceUsd) && solPriceUsd > 0 ? solPriceUsd : 0;
    const cutoffCreated = nowMs - maxAgeMs;
    const cutoff60s = nowMs - 60_000;
    const cutoff5m = nowMs - TRADE_WINDOW_MS;
    const pairs: SyntheticPumpPortalPair[] = [];

    for (const st of this.tokenStates.values()) {
      if (st.createdAtMs < cutoffCreated) continue;

      let buys5m = 0;
      let sells5m = 0;
      let vol5mSol = 0;
      let buys60s = 0;
      let sells60s = 0;
      let vol60sSol = 0;

      const traders5m = new Set<string>();
      const buyers5m = new Set<string>();

      for (const tr of st.trades) {
        if (tr.tsMs < cutoff5m) continue;
        if (tr.trader) {
          traders5m.add(tr.trader);
          if (tr.side === 'buy') buyers5m.add(tr.trader);
        }
        if (tr.side === 'buy') buys5m += 1;
        else sells5m += 1;
        vol5mSol += tr.solAmount;
        if (tr.tsMs >= cutoff60s) {
          if (tr.side === 'buy') buys60s += 1;
          else sells60s += 1;
          vol60sSol += tr.solAmount;
        }
      }

      const hasCurve = st.vSolInBondingCurve > 0 && st.vTokensInBondingCurve > 0;
      const priceSol = hasCurve ? st.vSolInBondingCurve / st.vTokensInBondingCurve : 0;
      const priceUsdNum = solPx > 0 && priceSol > 0 ? priceSol * solPx : 0;
      const liquidityUsd =
        solPx > 0 && st.vSolInBondingCurve > 0 ? Number((st.vSolInBondingCurve * 2 * solPx).toFixed(2)) : 0;
      const realSol = st.vSolInBondingCurve > 30 ? Number((st.vSolInBondingCurve - 30).toFixed(4)) : 0;
      const fdvUsd =
        solPx > 0 && st.marketCapSol > 0
          ? Number((st.marketCapSol * solPx).toFixed(2))
          : priceUsdNum > 0
            ? Number((priceUsdNum * 1_000_000_000).toFixed(2))
            : 0;

      pairs.push({
        baseToken: {
          address: st.mint,
          symbol: st.symbol || '?',
          name: st.name || st.symbol || 'Unknown',
        },
        dexId: st.migrated ? 'pumpswap' : 'pumpfun',
        pairAddress: st.bondingCurveKey || '',
        pairCreatedAt: st.createdAtMs,
        priceUsd: priceUsdNum > 0 ? priceUsdNum.toFixed(12).replace(/0+$/, '').replace(/\.$/, '') : '0',
        liquidity: { usd: liquidityUsd },
        fdv: fdvUsd,
        marketCap: fdvUsd,
        txns: {
          m5: { buys: buys5m, sells: sells5m },
        },
        volume: {
          m5: solPx > 0 ? Number((vol5mSol * solPx).toFixed(2)) : 0,
        },
        url: `https://dexscreener.com/solana/${st.mint}`,
        _synthetic: true,
        _pumpportal: {
          has_trade_stream: st.trades.length > 0,
          buys_60s: buys60s,
          sells_60s: sells60s,
          sol_vol_60s: Number(vol60sSol.toFixed(4)),
          unique_traders_5m: traders5m.size,
          v_sol: Number(st.vSolInBondingCurve.toFixed(4)),
          real_sol: realSol,
          creator: st.creator,
          creator_sold: st.creatorSold,
          initial_buy_sol: Number(st.creatorInitialBuySol.toFixed(4)),
          recent_buyers: Array.from(buyers5m).slice(0, 60),
        },
      });
    }

    // Most recently active/created tokens first
    pairs.sort((a, b) => b.pairCreatedAt - a.pairCreatedAt);
    return pairs;
  }

  getLiveMintSnapshots(
    mints: string[],
    solPriceUsd: number | null,
    nowMs = Date.now()
  ): Record<string, PumpPortalLiveSnapshot> {
    const solPx = solPriceUsd && Number.isFinite(solPriceUsd) && solPriceUsd > 0 ? solPriceUsd : 0;
    const cutoff5m = nowMs - TRADE_WINDOW_MS;
    const out: Record<string, PumpPortalLiveSnapshot> = {};

    for (const rawMint of mints) {
      const mint = String(rawMint || '').trim();
      if (!mint) continue;
      const st = this.tokenStates.get(mint);
      if (!st) continue;
      const hasCurve = st.vSolInBondingCurve > 0 && st.vTokensInBondingCurve > 0;
      const priceSol = hasCurve ? st.vSolInBondingCurve / st.vTokensInBondingCurve : 0;
      const priceUsd = solPx > 0 && priceSol > 0 ? priceSol * solPx : 0;
      const liquidityUsd =
        solPx > 0 && st.vSolInBondingCurve > 0 ? Number((st.vSolInBondingCurve * 2 * solPx).toFixed(2)) : 0;
      const realSol = st.vSolInBondingCurve > 30 ? Number((st.vSolInBondingCurve - 30).toFixed(4)) : 0;

      const traders5m = new Set<string>();
      const recentSellers = new Set<string>();
      const recentBuyers = new Set<string>();
      for (const tr of st.trades) {
        if (tr.tsMs < cutoff5m) continue;
        if (tr.trader) {
          traders5m.add(tr.trader);
          if (tr.side === 'sell' && nowMs - tr.tsMs <= 90_000) recentSellers.add(tr.trader);
          if (tr.side === 'buy') recentBuyers.add(tr.trader);
        }
      }
      out[mint] = {
        mint,
        priceUsd,
        priceSol,
        liquidityUsd,
        lastTradeAtMs: st.lastTradeAtMs,
        uniqueTraders5m: traders5m.size,
        recentSellers: Array.from(recentSellers),
        recentBuyers: Array.from(recentBuyers),
        realSol,
        creator: st.creator,
        creatorSold: st.creatorSold,
      };
    }

    return out;
  }

  getHealth(): SourceHealthRecord {
    const isConnected = Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
    let circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    if (this.enabled && !isConnected && this.consecutiveErrors > 0) {
      circuitState = this.consecutiveErrors >= 5 ? 'OPEN' : 'HALF_OPEN';
    }
    return {
      source: 'pumpportal_ws',
      itemsCount: this.itemsCount,
      lastOkMs: this.lastOkMs,
      errorCount: this.errorCount,
      lastError: this.lastError,
      recentErrors: [...this.recentErrors],
      rateLimitedUntilMs: null,
      circuitState,
    };
  }
}
