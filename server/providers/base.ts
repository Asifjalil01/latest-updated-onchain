import type { SourceHealthRecord } from '../types';

export interface ProviderOptions {
  sourceName: string;
  domain: string;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  cacheTtlMs?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
}

interface DomainRateState {
  lastRequestAtMs: number;
  rateLimitedUntilMs: number;
  consecutive429s: number;
}

const domainRateStates = new Map<string, DomainRateState>();

export class HttpProvider {
  public readonly sourceName: string;
  private readonly domain: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly cacheTtlMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitCooldownMs: number;

  private cache = new Map<string, CacheEntry<unknown>>();
  private consecutiveFailures = 0;
  private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private circuitOpenedAtMs = 0;

  private itemsCount = 0;
  private lastOkMs: number | null = null;
  private errorCount = 0;
  private lastError: string | null = null;
  private recentErrors: Array<{ message: string; atMs: number }> = [];

  constructor(options: ProviderOptions) {
    this.sourceName = options.sourceName;
    this.domain = options.domain;
    this.minIntervalMs = options.minIntervalMs ?? 300;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxRetries = options.maxRetries ?? 2;
    this.cacheTtlMs = options.cacheTtlMs ?? 15_000;
    this.circuitFailureThreshold = options.circuitFailureThreshold ?? 5;
    this.circuitCooldownMs = options.circuitCooldownMs ?? 60_000;
  }

  private getDomainState(): DomainRateState {
    let state = domainRateStates.get(this.domain);
    if (!state) {
      state = { lastRequestAtMs: 0, rateLimitedUntilMs: 0, consecutive429s: 0 };
      domainRateStates.set(this.domain, state);
    }
    return state;
  }

  recordItems(count: number): void {
    this.itemsCount = count;
  }

  getHealth(): SourceHealthRecord {
    const domainState = this.getDomainState();
    return {
      source: this.sourceName,
      itemsCount: this.itemsCount,
      lastOkMs: this.lastOkMs,
      errorCount: this.errorCount,
      lastError: this.lastError,
      recentErrors: [...this.recentErrors],
      rateLimitedUntilMs:
        domainState.rateLimitedUntilMs > Date.now() ? domainState.rateLimitedUntilMs : null,
      circuitState: this.circuitState,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  isRateLimited(): boolean {
    return this.getDomainState().rateLimitedUntilMs > Date.now();
  }

  async fetchJson<T>(
    url: string,
    init?: RequestInit,
    cacheKey?: string,
    customTtlMs?: number
  ): Promise<T> {
    const now = Date.now();
    const key = cacheKey || (init?.method === 'POST' ? '' : url);
    if (key) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAtMs > now) {
        return cached.value as T;
      }
    }

    if (this.circuitState === 'OPEN') {
      if (now - this.circuitOpenedAtMs >= this.circuitCooldownMs) {
        this.circuitState = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.sourceName}`);
      }
    }

    const domainState = this.getDomainState();
    if (domainState.rateLimitedUntilMs > now) {
      throw new Error(`Rate limited backoff active for ${this.domain}`);
    }

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const elapsedSinceLast = Date.now() - domainState.lastRequestAtMs;
      if (elapsedSinceLast < this.minIntervalMs) {
        await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsedSinceLast));
      }

      domainState.lastRequestAtMs = Date.now();
      try {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            Accept: 'application/json',
            ...(init?.headers ?? {}),
          },
        });

        if (response.status === 429) {
          // Silent backoff on HTTP 429 — never immediately retry into an active 429 window
          domainState.consecutive429s += 1;
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
          const backoffMs = Number.isFinite(retryAfterSec)
            ? Math.max(5_000, retryAfterSec * 1000)
            : Math.min(180_000, 15_000 * 2 ** Math.min(domainState.consecutive429s - 1, 3));
          domainState.rateLimitedUntilMs = Date.now() + backoffMs;
          lastErr = new Error(`HTTP 429 from ${this.domain}`);
          throw lastErr;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${this.sourceName}`);
        }

        domainState.consecutive429s = 0;
        const data = (await response.json()) as T;
        this.consecutiveFailures = 0;
        this.circuitState = 'CLOSED';
        this.lastOkMs = Date.now();
        this.lastError = null;

        if (key) {
          const ttl = customTtlMs ?? this.cacheTtlMs;
          if (ttl > 0) {
            this.cache.set(key, { value: data, expiresAtMs: Date.now() + ttl });
          }
        }
        return data;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (lastErr.message.includes('HTTP 429')) {
          break;
        }
        if (attempt < this.maxRetries) {
          const delay = 250 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    this.errorCount += 1;
    this.consecutiveFailures += 1;
    const errMsg = lastErr ? lastErr.message : 'Unknown provider failure';
    this.lastError = errMsg;
    this.recentErrors = [{ message: errMsg, atMs: Date.now() }, ...this.recentErrors].slice(0, 10);
    if (this.consecutiveFailures >= this.circuitFailureThreshold) {
      this.circuitState = 'OPEN';
      this.circuitOpenedAtMs = Date.now();
    }
    throw lastErr ?? new Error(`Provider failure: ${this.sourceName}`);
  }
}
