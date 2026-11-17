import { HttpProvider } from './base';
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

  constructor(apiKey?: string) {
    this.apiKey = apiKey || undefined;
    this.priceHttp = new HttpProvider({
      sourceName: 'jupiter_price',
      domain: 'lite-api.jup.ag',
      minIntervalMs: 350,
      timeoutMs: 7000,
      cacheTtlMs: 8000,
    });
    this.swapHttp = new HttpProvider({
      sourceName: 'jupiter_swap',
      domain: 'lite-api.jup.ag',
      minIntervalMs: 350,
      timeoutMs: 9000,
      cacheTtlMs: 2500,
    });
    this.tokensHttp = new HttpProvider({
      sourceName: 'jupiter_tokens',
      domain: 'lite-api.jup.ag',
      minIntervalMs: 500,
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

  async getLivePricesUsd(mints: string[]): Promise<Record<string, number>> {
    if (mints.length === 0) return {};
    const unique = Array.from(new Set(mints)).slice(0, 50);
    const ids = unique.join(',');
    const out: Record<string, number> = {};

    try {
      const data = await this.priceHttp.fetchJson<
        Record<string, { usdPrice?: number; price?: string | number }> | { data?: Record<string, { price?: string | number }> }
      >(
        `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(ids)}`,
        { headers: this.getHeaders() },
        `jup_v3_${ids}`,
        8000
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
    const prices = await this.getLivePricesUsd([WSOL_MINT]);
    return prices[WSOL_MINT] ?? null;
  }

  async fetchRecentTokens(): Promise<CandidateToken[]> {
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
      >(
        'https://lite-api.jup.ag/tokens/v2/recent',
        { headers: this.getHeaders() },
        'jup_tokens_recent',
        25_000
      );

      if (!Array.isArray(data)) return [];
      const now = Date.now();
      const candidates: CandidateToken[] = [];
      for (const item of data.slice(0, 60)) {
        const mint = item.id || item.address;
        if (!mint || mint === WSOL_MINT) continue;
        candidates.push({
          mint,
          symbol: item.symbol || 'UNKNOWN',
          name: item.name || item.symbol || 'Unknown Token',
          source: 'jupiter_tokens_v2',
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
      this.tokensHttp.recordItems(candidates.length);
      return candidates;
    } catch {
      return [];
    }
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
        `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(query)}`,
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

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amountRaw: string;
    slippageBps: number;
  }): Promise<JupiterQuoteResponse | null> {
    const qs = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amountRaw,
      slippageBps: String(params.slippageBps),
    });

    try {
      const quote = await this.swapHttp.fetchJson<JupiterQuoteResponse>(
        `https://lite-api.jup.ag/swap/v1/quote?${qs.toString()}`,
        { headers: this.getHeaders() },
        `quote_${params.inputMint}_${params.outputMint}_${params.amountRaw}_${params.slippageBps}`,
        2000
      );
      if (!quote || !quote.outAmount || !Array.isArray(quote.routePlan)) {
        return null;
      }
      this.swapHttp.recordItems(1);
      return quote;
    } catch {
      return null;
    }
  }

  async buildSwapTransaction(params: {
    quoteResponse: JupiterQuoteResponse;
    userPublicKey: string;
    priorityFeeLamports: number;
  }): Promise<JupiterSwapResponse> {
    return this.swapHttp.fetchJson<JupiterSwapResponse>(
      'https://lite-api.jup.ag/swap/v1/swap',
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
          prioritizationFeeLamports: params.priorityFeeLamports,
        }),
      },
      '',
      0
    );
  }
}
