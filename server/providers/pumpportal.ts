import WebSocket from 'ws';
import type { SourceHealthRecord } from '../types';

export interface PumpPortalEvent {
  mint: string;
  symbol?: string;
  name?: string;
  eventType: 'new_token' | 'migration';
  receivedAtMs: number;
}

export class PumpPortalWsProvider {
  private ws: WebSocket | null = null;
  private enabled = false;
  private newTokenBuffer: PumpPortalEvent[] = [];
  private migrationBuffer: PumpPortalEvent[] = [];
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
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            mint?: string;
            symbol?: string;
            name?: string;
            txType?: string;
          };
          if (msg.mint) {
            this.lastOkMs = Date.now();
            this.consecutiveErrors = 0;
            this.itemsCount += 1;
            const isMigration = msg.txType === 'migrate';
            const event: PumpPortalEvent = {
              mint: msg.mint,
              symbol: msg.symbol,
              name: msg.name,
              eventType: isMigration ? 'migration' : 'new_token',
              receivedAtMs: Date.now(),
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
            }
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

  drainRecentMints(): string[] {
    const now = Date.now();
    // Keep events from the last 45 minutes so enrichment can evaluate 5-30m+ migrated pools
    const validMigrations = this.migrationBuffer.filter((e) => now - e.receivedAtMs <= 45 * 60_000);
    const validNew = this.newTokenBuffer.filter((e) => now - e.receivedAtMs <= 45 * 60_000);
    return Array.from(new Set([...validMigrations, ...validNew].map((e) => e.mint)));
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
