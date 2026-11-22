import { HttpProvider } from './base';
import type { SolanaRpcPool } from './rpcPool';
import type { CandidateToken } from '../types';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export interface JupiterQuoteRoutePlanStep {
  swapInfo?: {
    ammKey?: string;
    label?: string;
    inputMint?: string;
    outputMint?: string;
    inAmount?: string;
    outAmount?: string;
    feeAmount?: string;
    feeMint?: string;
  };
  percent?: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold?: string;
  swapMode?: string;
  slippageBps: number;
  platformFee?: {
    amount?: string;
    feeBps?: number;
  } | null;
  priceImpactPct: string;
  routePlan: JupiterQuoteRoutePlanStep[];
  contextSlot?: number;
}

export interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
}

export class JupiterProvider {
  private readonly priceHttp: HttpProvider;
  private readonly swapHttp: HttpProvider;
  private readonly fallbackSwapHttp: HttpProvider;
  private readonly tokensHttp: HttpProvider;
  private apiKey?: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey?.trim() || undefined;
    const domain = this.apiKey ? 'api.jup.ag' : 'lite-api.jup.ag';
    this.baseUrl = `https://${domain}`;
    this.priceHttp = new HttpProvider({
      sourceName: 'jupiter_price',
      domain,
      minIntervalMs: 350,
      timeoutMs: 6000,
      maxRetries: 0,
      cacheTtlMs: 1200,
      base429BackoffMs: 2500,
      max429BackoffMs: 12_000,
    });
    this.swapHttp = new HttpProvider({
      sourceName: 'jupiter_swap',
      domain,
      minIntervalMs: this.apiKey ? 200 : 750,
      timeoutMs: 9000,
      maxRetries: 0,
      cacheTtlMs: 1500,
      base429BackoffMs: 2500,
      max429BackoffMs: 10_000,
    });
    this.fallbackSwapHttp = new HttpProvider({
      sourceName: 'jupiter_swap_fallback',
      domain: 'api.jup.ag',
      minIntervalMs: 900,
      timeoutMs: 9000,
      maxRetries: 0,
      cacheTtlMs: 1500,
      base429BackoffMs: 3000,
      max429BackoffMs: 12_000,
    });
    this.tokensHttp = new HttpProvider({
      sourceName: 'jupiter_tokens',
      domain,
      minIntervalMs: 500,
      timeoutMs: 8000,
      cacheTtlMs: 30_000,
      base429BackoffMs: 5000,
      max429BackoffMs: 30_000,
    });
  }

  setApiKey(apiKey?: string): void {
    const clean = apiKey?.trim() || undefined;
    if (clean === this.apiKey) return;
    this.apiKey = clean;
    const domain = this.apiKey ? 'api.jup.ag' : 'lite-api.jup.ag';
    this.baseUrl = `https://${domain}`;
    this.swapHttp.setMinIntervalMs(this.apiKey ? 200 : 750);
  }

  private getHeaders(): Record<string, string> {
    return this.apiKey ? { 'x-api-key': this.apiKey } : {};
  }

  getHealth() {
    return [
      this.tokensHttp.getHealth(),
      this.priceHttp.getHealth(),
      this.swapHttp.getHealth(),
    ];
  }

  async getLivePricesUsd(mints: string[], cacheTtlMs = 850): Promise<Record<string, number>> {
    if (mints.length === 0) return {};
    const unique = Array.from(new Set(mints)).slice(0, 50);
    const ids = unique.join(',');
    const out: Record<string, number> = {};

    try {
      const data = await this.priceHttp.fetchJson<
        Record<string, { usdPrice?: number; price?: string | number }> | { data?: Record<string, { price?: string | number }> }
      >(
        `${this.baseUrl}/price/v3?ids=${encodeURIComponent(ids)}`,
        { headers: this.getHeaders() },
        `jup_v3_${ids}`,
        cacheTtlMs
      );

      const maybeNested = (data as { data?: Record<string, { price?: string | number; usdPrice?: number }> }).data;
      const sourceObj = maybeNested ?? (data as Record<string, { usdPrice?: number; price?: string | number }>);

      for (const mint of unique) {
        const entry = sourceObj[mint];
        const rawVal = entry?.usdPrice ?? entry?.price;
        const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
        if (Number.isFinite(num) && num > 0) {
          out[mint] = num;
        }
      }
      this.priceHttp.recordItems(Object.keys(out).length);
      return out;
    } catch {
      return out;
    }
  }

  async getLiveSolPriceUsd(): Promise<number | null> {
    const prices = await this.getLivePricesUsd([WSOL_MINT], 5000);
    return prices[WSOL_MINT] ?? null;
  }

  async fetchRecentTokens(): Promise<CandidateToken[]> {
    const candidatesByMint = new Map<string, CandidateToken>();
    const now = Date.now();
    const endpoints: Array<{ url: string; key: string; ttlMs: number; tag: string; limit: number }> = [
      {
        url: `${this.baseUrl}/tokens/v2/toptrending/5m`,
        key: 'jup_tokens_toptrending_5m',
        ttlMs: 45_000,
        tag: 'jupiter_toptrending_5m',
        limit: 40,
      },
      {
        url: `${this.baseUrl}/tokens/v2/recent`,
        key: 'jup_tokens_recent',
        ttlMs: 25_000,
        tag: 'jupiter_tokens_v2',
        limit: 45,
      },
    ];

    for (const ep of endpoints) {
      try {
        const data = await this.tokensHttp.fetchJson<
          Array<{
            id?: string;
            address?: string;
            symbol?: string;
            name?: string;
            decimals?: number;
            liquidity?: number;
            usdPrice?: number;
            createdAt?: string;
          }>
        >(ep.url, { headers: this.getHeaders() }, ep.key, ep.ttlMs);

        if (!Array.isArray(data)) continue;
        for (const item of data.slice(0, ep.limit)) {
          const mint = item.id || item.address;
          if (!mint || mint === WSOL_MINT || candidatesByMint.has(mint)) continue;
          candidatesByMint.set(mint, {
            mint,
            symbol: item.symbol || 'UNKNOWN',
            name: item.name || item.symbol || 'Unknown Token',
            source: ep.tag,
            dex: 'jupiter',
            pairAddress: '',
            poolCreatedAtMs: item.createdAt ? Date.parse(item.createdAt) || 0 : 0,
            priceUsd: Number(item.usdPrice || 0),
            priceSol: 0,
            liquidityUsd: Number(item.liquidity || 0),
            volume24hUsd: 0,
            fdvUsd: 0,
            txCount24h: 0,
            buys24h: 0,
            sells24h: 0,
            uniqueTraders24h: 0,
            priceChange1hPct: 0,
            priceChange24hPct: 0,
            tokenDecimals: typeof item.decimals === 'number' ? item.decimals : undefined,
            rawUpdatedAtMs: now,
          });
        }
      } catch {
        // resilient per endpoint
      }
    }

    const list = Array.from(candidatesByMint.values());
    this.tokensHttp.recordItems(list.length);
    return list;
  }

  async searchTokens(query: string): Promise<CandidateToken[]> {
    try {
      const data = await this.tokensHttp.fetchJson<
        Array<{
          id?: string;
          address?: string;
          symbol?: string;
          name?: string;
          decimals?: number;
          liquidity?: number;
          usdPrice?: number;
        }>
      >(
        `${this.baseUrl}/tokens/v2/search?query=${encodeURIComponent(query)}`,
        { headers: this.getHeaders() },
        `jup_search_${query}`,
        45_000
      );
      if (!Array.isArray(data)) return [];
      const now = Date.now();
      return data
        .filter((i) => Boolean(i.id || i.address))
        .slice(0, 20)
        .map((item) => ({
          mint: (item.id || item.address)!,
          symbol: item.symbol || 'UNKNOWN',
          name: item.name || item.symbol || 'Unknown',
          source: 'jupiter_tokens_v2',
          dex: 'jupiter',
          pairAddress: '',
          poolCreatedAtMs: 0,
          priceUsd: Number(item.usdPrice || 0),
          priceSol: 0,
          liquidityUsd: Number(item.liquidity || 0),
          volume24hUsd: 0,
          fdvUsd: 0,
          txCount24h: 0,
          buys24h: 0,
          sells24h: 0,
          uniqueTraders24h: 0,
          priceChange1hPct: 0,
          priceChange24hPct: 0,
          tokenDecimals: typeof item.decimals === 'number' ? item.decimals : undefined,
          rawUpdatedAtMs: now,
        }));
    } catch {
      return [];
    }
  }

  private lastQuoteError: string | null = null;

  getLastQuoteError(): string | null {
    return this.lastQuoteError;
  }

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amountRaw: string;
    slippageBps: number;
    restrictIntermediateTokens?: boolean;
    onlyDirectRoutes?: boolean;
    allowRelaxFallback?: boolean;
    bypassCache?: boolean;
  }): Promise<JupiterQuoteResponse | null> {
    const attempts: Array<{ restrictIntermediate: boolean; onlyDirect: boolean }> = [
      {
        restrictIntermediate: params.restrictIntermediateTokens ?? true,
        onlyDirect: params.onlyDirectRoutes ?? false,
      },
    ];
    if (params.allowRelaxFallback !== false && (params.restrictIntermediateTokens ?? true) === true) {
      attempts.push({ restrictIntermediate: false, onlyDirect: false });
    }

    const hosts: Array<{ url: string; client: HttpProvider }> = [
      { url: this.baseUrl, client: this.swapHttp },
    ];
    if (!this.apiKey && this.baseUrl === 'https://lite-api.jup.ag') {
      hosts.push({ url: 'https://api.jup.ag', client: this.fallbackSwapHttp });
    }

    let lastErr: string | null = null;
    for (const host of hosts) {
      if (host.client.isRateLimited()) {
        lastErr = `Rate limited backoff active for ${host.url.replace('https://', '')}`;
        continue;
      }
      for (const attempt of attempts) {
        const qs = new URLSearchParams({
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amountRaw,
          slippageBps: String(params.slippageBps),
          swapMode: 'ExactIn',
        });
        if (!attempt.restrictIntermediate) {
          qs.set('restrictIntermediateTokens', 'false');
        }
        if (attempt.onlyDirect) {
          qs.set('onlyDirectRoutes', 'true');
        }

        try {
          const cacheTtlMs = params.bypassCache ? 0 : 1200;
          const quote = await host.client.fetchJson<JupiterQuoteResponse>(
            `${host.url}/swap/v1/quote?${qs.toString()}`,
            { headers: this.getHeaders() },
            params.bypassCache
              ? ''
              : `quote_${params.inputMint}_${params.outputMint}_${params.amountRaw}_${params.slippageBps}_${attempt.restrictIntermediate ? 'strict' : 'relaxed'}`,
            cacheTtlMs
          );
          if (quote && quote.outAmount && Number(quote.outAmount) > 0 && Array.isArray(quote.routePlan)) {
            this.lastQuoteError = null;
            host.client.recordItems(1);
            return quote;
          }
          lastErr = 'Empty routePlan or zero outAmount';
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          // Never fire a second relaxed request into an active 429 or circuit limit on the same host
          if (/429|Rate limited|Circuit breaker/i.test(lastErr)) {
            break;
          }
        }
      }
      // Only move to secondary host when the primary failed due to 429/rate-limit/network, not when token truly has no route (HTTP 400)
      if (lastErr && !/429|Rate limited|Circuit breaker|timeout|fetch failed/i.test(lastErr)) {
        break;
      }
    }

    this.lastQuoteError = lastErr;
    return null;
  }

  private cachedAutoPriorityFee: { sol: number; source: 'rpc_recent' | 'preset'; atMs: number } | null = null;

  async buildSwapTransaction(params: {
    quoteResponse: JupiterQuoteResponse;
    userPublicKey: string;
    priorityFeeLamports: number | 'auto';
    priorityLevel?: 'medium' | 'high' | 'veryHigh';
    maxPriorityFeeLamports?: number;
    jitoTipLamports?: number;
    dynamicSlippage?: boolean;
  }): Promise<JupiterSwapResponse> {
    let prioritizationFeeLamports: unknown;
    if (params.jitoTipLamports && params.jitoTipLamports > 0) {
      prioritizationFeeLamports = {
        jitoTipLamports: Math.max(1000, Math.round(params.jitoTipLamports)),
      };
    } else if (typeof params.priorityFeeLamports === 'number') {
      prioritizationFeeLamports = Math.max(1000, Math.round(params.priorityFeeLamports));
    } else if (params.priorityLevel) {
      prioritizationFeeLamports = {
        priorityLevelWithMaxLamports: {
          maxLamports: Math.max(50_000, Math.round(params.maxPriorityFeeLamports ?? 500_000)),
          priorityLevel: params.priorityLevel,
        },
      };
    } else {
      prioritizationFeeLamports = { autoMultiplier: 2 };
    }

    const bodyPayload = JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      ...(params.dynamicSlippage ? { dynamicSlippage: true } : {}),
      prioritizationFeeLamports,
    });

    const hosts: Array<{ url: string; client: HttpProvider }> = [
      { url: this.baseUrl, client: this.swapHttp },
    ];
    if (!this.apiKey && this.baseUrl === 'https://lite-api.jup.ag') {
      hosts.push({ url: 'https://api.jup.ag', client: this.fallbackSwapHttp });
    }

    let lastErr: unknown;
    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i];
      if (host.client.isRateLimited() && i < hosts.length - 1) {
        continue;
      }
      try {
        return await host.client.fetchJson<JupiterSwapResponse>(
          `${host.url}/swap/v1/swap`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...this.getHeaders(),
            },
            body: bodyPayload,
          },
          '',
          0
        );
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (i < hosts.length - 1 && /429|Rate limited|timeout|fetch failed/i.test(msg)) {
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Jupiter swap build failed');
  }

  /**
   * Direct PumpPortal unsigned local swap transaction fallback (pool='auto' covers Pump.fun,
   * PumpSwap, LaunchLab, Raydium, Raydium-CPMM, and Bonk when Jupiter is rate-limited or unindexed).
   */
  async buildPumpPortalSwapTransaction(params: {
    userPublicKey: string;
    action: 'buy' | 'sell';
    mint: string;
    amount: number | string;
    denominatedInSol: boolean;
    slippagePct: number;
    priorityFeeSol: number;
    pool?: string;
  }): Promise<Uint8Array> {
    const res = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/octet-stream, application/json',
      },
      body: JSON.stringify({
        publicKey: params.userPublicKey,
        action: params.action,
        mint: params.mint,
        amount: params.amount,
        denominatedInSol: params.denominatedInSol ? 'true' : 'false',
        slippage: Math.max(1, Math.min(50, Math.round(params.slippagePct))),
        priorityFee: Math.max(0.00001, Number(params.priorityFeeSol.toFixed(6))),
        pool: params.pool || 'auto',
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`PumpPortal trade-local HTTP ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as { transaction?: string; error?: string };
      if (json?.transaction) {
        return new Uint8Array(Buffer.from(json.transaction, 'base64'));
      }
      throw new Error(json?.error || 'PumpPortal trade-local returned empty transaction');
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 32) {
      throw new Error('PumpPortal trade-local returned invalid transaction payload');
    }
    return buf;
  }

  /**
   * Computes real exitable token prices (USD) via reverse Jupiter quotes (mint -> WSOL)
   * so exit decisions react to actual pool depth & slippage rather than stale cached prices.
   */
  async getReverseExitPricesUsd(
    positions: Array<{ mint: string; qty: number; decimals?: number; rawAmount?: string | null }>,
    solPriceUsd: number
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (!solPriceUsd || solPriceUsd <= 0 || positions.length === 0) return out;
    if (this.swapHttp.isRateLimited()) return out;

    await Promise.all(
      positions.slice(0, 4).map(async (p) => {
        const mint = (p.mint || '').trim();
        const qty = Number(p.qty || 0);
        if (!mint || qty <= 0) return;
        const decimals = typeof p.decimals === 'number' && p.decimals >= 0 ? p.decimals : 6;
        const rawAmount =
          p.rawAmount && /^\d+$/.test(p.rawAmount) && BigInt(p.rawAmount) > 0n
            ? p.rawAmount
            : String(Math.max(1, Math.floor(qty * 10 ** decimals)));
        const quote = await this.getQuote({
          inputMint: mint,
          outputMint: WSOL_MINT,
          amountRaw: rawAmount,
          slippageBps: 500,
          allowRelaxFallback: false,
          bypassCache: true,
        }).catch(() => null);
        if (quote && Number(quote.outAmount) > 0) {
          const outSol = Number(quote.outAmount) / 1e9;
          const exitUsd = outSol * solPriceUsd;
          const unitPriceUsd = exitUsd / qty;
          if (Number.isFinite(unitPriceUsd) && unitPriceUsd > 0) {
            out[mint] = unitPriceUsd;
          }
        }
      })
    );

    return out;
  }

  /**
   * Estimates live priority fee in SOL using Solana RPC recent prioritization fees
   * (typical Jupiter route swap = ~200,000 CUs), cached briefly for 15s.
   */
  async estimateLivePriorityFeeSol(
    rpcPool?: SolanaRpcPool,
    maxCapSol = 0.002,
    fallbackSol = 0.0001
  ): Promise<{ sol: number; source: 'rpc_recent' | 'preset' }> {
    const now = Date.now();
    if (this.cachedAutoPriorityFee && now - this.cachedAutoPriorityFee.atMs < 15_000) {
      return {
        sol: Math.min(this.cachedAutoPriorityFee.sol, maxCapSol),
        source: this.cachedAutoPriorityFee.source,
      };
    }

    if (!rpcPool) {
      return { sol: Math.min(fallbackSol, maxCapSol), source: 'preset' };
    }

    try {
      const fees = await rpcPool.withFailover((conn) => conn.getRecentPrioritizationFees());
      const nonZero = (fees || [])
        .map((f) => Number(f.prioritizationFee))
        .filter((v) => Number.isFinite(v) && v >= 0)
        .sort((a, b) => a - b);

      if (nonZero.length > 0) {
        // 75th percentile microLamports per Compute Unit * 200,000 CU typical Jupiter swap
        const p75Index = Math.min(nonZero.length - 1, Math.floor(nonZero.length * 0.75));
        const microLamportsPerCu = nonZero[p75Index];
        const estimatedLamports = Math.max(5_000, Math.round((microLamportsPerCu * 200_000) / 1_000_000));
        const sol = Math.min(maxCapSol, Math.max(0.000005, estimatedLamports / 1e9));
        this.cachedAutoPriorityFee = { sol, source: 'rpc_recent', atMs: now };
        return { sol, source: 'rpc_recent' };
      }
    } catch {
      // fall through to safe fallback
    }

    const cappedFallback = Math.min(fallbackSol, maxCapSol);
    this.cachedAutoPriorityFee = { sol: cappedFallback, source: 'preset', atMs: now };
    return { sol: cappedFallback, source: 'preset' };
  }
}
