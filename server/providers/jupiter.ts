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
  private readonly tokensHttp: HttpProvider;
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey?.trim() || undefined;
    const domain = this.apiKey ? 'api.jup.ag' : 'lite-api.jup.ag';
    this.baseUrl = `https://${domain}`;
    this.priceHttp = new HttpProvider({
      sourceName: 'jupiter_price',
      domain,
      minIntervalMs: 250,
      timeoutMs: 6000,
      maxRetries: 0,
      cacheTtlMs: 850,
    });
    this.swapHttp = new HttpProvider({
      sourceName: 'jupiter_swap',
      domain,
      minIntervalMs: 250,
      timeoutMs: 9000,
      cacheTtlMs: 1500,
    });
    this.tokensHttp = new HttpProvider({
      sourceName: 'jupiter_tokens',
      domain,
      minIntervalMs: 400,
      timeoutMs: 8000,
      cacheTtlMs: 30_000,
    });
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

    let lastErr: string | null = null;
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
        const quote = await this.swapHttp.fetchJson<JupiterQuoteResponse>(
          `${this.baseUrl}/swap/v1/quote?${qs.toString()}`,
          { headers: this.getHeaders() },
          `quote_${params.inputMint}_${params.outputMint}_${params.amountRaw}_${params.slippageBps}_${attempt.restrictIntermediate ? 'strict' : 'relaxed'}`,
          1200
        );
        if (quote && quote.outAmount && Number(quote.outAmount) > 0 && Array.isArray(quote.routePlan)) {
          this.lastQuoteError = null;
          this.swapHttp.recordItems(1);
          return quote;
        }
        lastErr = 'Empty routePlan or zero outAmount';
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
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
  }): Promise<JupiterSwapResponse> {
    return this.swapHttp.fetchJson<JupiterSwapResponse>(
      `${this.baseUrl}/swap/v1/swap`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getHeaders(),
        },
        body: JSON.stringify({
          quoteResponse: params.quoteResponse,
          userPublicKey: params.userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports:
            params.priorityFeeLamports === 'auto'
              ? { autoMultiplier: 2 }
              : params.priorityFeeLamports,
        }),
      },
      '',
      0
    );
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
