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
  private buffer: PumpPortalEvent[] = [];
  private itemsCount = 0;
  private lastOkMs: number | null = null;
  private errorCount = 0;
  private lastError: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.connect();
  }

  stop(): void {
    this.enabled = false;
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
    try {
      this.ws = new WebSocket('wss://pumpportal.fun/api/data');
      this.ws.on('open', () => {
        this.lastOkMs = Date.now();
        this.lastError = null;
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
            this.itemsCount += 1;
            this.buffer.push({
              mint: msg.mint,
              symbol: msg.symbol,
              name: msg.name,
              eventType: msg.txType === 'migrate' ? 'migration' : 'new_token',
              receivedAtMs: Date.now(),
            });
            if (this.buffer.length > 200) {
              this.buffer.shift();
            }
          }
        } catch {
          // ignore malformed WS frame
        }
      });

      this.ws.on('error', (err: Error) => {
        this.errorCount += 1;
        this.lastError = err.message;
      });

      this.ws.on('close', () => {
        this.ws = null;
        if (this.enabled) {
          this.reconnectTimer = setTimeout(() => this.connect(), 15_000);
        }
      });
    } catch (err) {
      this.errorCount += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  drainRecentMints(): string[] {
    const now = Date.now();
    // Only surface events from the last 45 minutes so enrichment can still evaluate 30m+ pools
    const valid = this.buffer.filter((e) => now - e.receivedAtMs <= 45 * 60_000);
    return Array.from(new Set(valid.map((e) => e.mint)));
  }

  getHealth(): SourceHealthRecord {
    return {
      source: 'pumpportal_ws',
      itemsCount: this.itemsCount,
      lastOkMs: this.lastOkMs,
      errorCount: this.errorCount,
      lastError: this.lastError,
      rateLimitedUntilMs: null,
      circuitState: this.ws && this.ws.readyState === WebSocket.OPEN ? 'CLOSED' : 'HALF_OPEN',
    };
  }
}
