import { HttpProvider } from './base';
import type { CandidateToken } from '../types';
import { WSOL_MINT } from './jupiter';

interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceNative?: string;
  priceUsd?: string;
  txns?: {
    h24?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    m5?: { buys?: number; sells?: number };
  };
  volume?: { h24?: number; h1?: number; m5?: number };
  priceChange?: { m5?: number; h1?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  pairCreatedAt?: number;
  info?: {
    websites?: Array<{ label?: string; url?: string }>;
    socials?: Array<{ type?: string; url?: string }>;
  };
}

const ROTATING_SWEEP_TERMS = [
  'raydium',
  'pump',
  'meteora',
  'orca',
  'solana',
  'bonk',
  'jup',
  'ai',
  'defi',
  'meme',
  'cat',
  'dog',
];

export class DexScreenerProvider {
  private readonly http: HttpProvider;
  private sweepIndex = 0;

  constructor() {
    this.http = new HttpProvider({
      sourceName: 'dexscreener',
      domain: 'api.dexscreener.com',
      minIntervalMs: 350,
      timeoutMs: 8000,
      cacheTtlMs: 15_000,
    });
  }

  getHealth() {
    return this.http.getHealth();
  }

  async getLiveSolPriceUsd(): Promise<number | null> {
    try {
      const pairs = await this.http.fetchJson<DexScreenerPair[]>(
        `https://api.dexscreener.com/tokens/v1/solana/${WSOL_MINT}`,
        undefined,
        'ds_sol_price',
        10_000
      );
      if (!Array.isArray(pairs) || pairs.length === 0) return null;
      const valid = pairs
        .filter((p) => Number(p.liquidity?.usd || 0) > 100_000 && Number(p.priceUsd || 0) > 0)
        .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
      const best = valid[0] ?? pairs[0];
      const price = Number(best?.priceUsd || 0);
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
      return null;
    }
  }

  private mapPairToCandidate(pair: DexScreenerPair, source: string): CandidateToken | null {
    if (pair.chainId !== 'solana' || !pair.baseToken?.address) return null;
    if (pair.baseToken.address === WSOL_MINT) return null;
    const buys24h = Number(pair.txns?.h24?.buys ?? 0);
    const sells24h = Number(pair.txns?.h24?.sells ?? 0);
    const txCount24h = buys24h + sells24h;
    // Estimate unique traders conservatively when DexScreener omits distinct maker count
    const estimatedUniqueTraders = Math.round(txCount24h * 0.55);

    const buys5m = pair.txns?.m5?.buys !== undefined ? Number(pair.txns.m5.buys) : undefined;
    const sells5m = pair.txns?.m5?.sells !== undefined ? Number(pair.txns.m5.sells) : undefined;
    const buys1h = pair.txns?.h1?.buys !== undefined ? Number(pair.txns.h1.buys) : undefined;
    const sells1h = pair.txns?.h1?.sells !== undefined ? Number(pair.txns.h1.sells) : undefined;
    const rawM5Change = pair.priceChange?.m5;
    const priceChange5mPct =
      rawM5Change !== undefined && rawM5Change !== null && Number.isFinite(Number(rawM5Change))
        ? Number(rawM5Change)
        : undefined;
    const socialUrls: string[] = [];
    for (const w of pair.info?.websites ?? []) {
      if (w?.url && typeof w.url === 'string') socialUrls.push(w.url.trim());
    }
    for (const s of pair.info?.socials ?? []) {
      if (s?.url && typeof s.url === 'string') socialUrls.push(s.url.trim());
    }

    return {
      mint: pair.baseToken.address,
      symbol: pair.baseToken.symbol || 'UNKNOWN',
      name: pair.baseToken.name || pair.baseToken.symbol || 'Unknown Token',
      source,
      dex: pair.dexId || 'unknown',
      pairAddress: pair.pairAddress || '',
      poolCreatedAtMs: Number(pair.pairCreatedAt || 0),
      priceUsd: Number(pair.priceUsd || 0),
      priceSol: Number(pair.priceNative || 0),
      liquidityUsd: Number(pair.liquidity?.usd || 0),
      volume24hUsd: Number(pair.volume?.h24 || 0),
      fdvUsd: Number(pair.fdv || 0),
      txCount24h,
      buys24h,
      sells24h,
      uniqueTraders24h: estimatedUniqueTraders,
      priceChange5mPct,
      priceChange1hPct: Number(pair.priceChange?.h1 ?? NaN),
      priceChange24hPct: Number(pair.priceChange?.h24 ?? NaN),
      buys5m,
      sells5m,
      buys1h,
      sells1h,
      socialUrls: socialUrls.length > 0 ? socialUrls : undefined,
      rawUpdatedAtMs: Date.now(),
    };
  }

  async discoverMints(includeBoosts: boolean): Promise<{ mints: string[]; candidates: CandidateToken[] }> {
    const mints = new Set<string>();
    const candidates: CandidateToken[] = [];

    const endpoints: Array<{ url: string; tag: string }> = [
      { url: 'https://api.dexscreener.com/token-profiles/latest/v1', tag: 'dexscreener_profiles' },
      { url: 'https://api.dexscreener.com/community-takeovers/latest/v1', tag: 'dexscreener_cto' },
    ];

    if (includeBoosts) {
      endpoints.push(
        { url: 'https://api.dexscreener.com/token-boosts/latest/v1', tag: 'dexscreener_boosts' },
        { url: 'https://api.dexscreener.com/token-boosts/top/v1', tag: 'dexscreener_top_boosts' }
      );
    }

    for (const ep of endpoints) {
      try {
        const items = await this.http.fetchJson<Array<{ chainId?: string; tokenAddress?: string }>>(
          ep.url,
          undefined,
          `ds_${ep.tag}`,
          20_000
        );
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item.chainId === 'solana' && item.tokenAddress) {
              mints.add(item.tokenAddress);
            }
          }
        }
      } catch {
        // Resilient per-sub-endpoint
      }
    }

    // Rotating search sweep across keywords and DEX names
    const term1 = ROTATING_SWEEP_TERMS[this.sweepIndex % ROTATING_SWEEP_TERMS.length];
    const term2 = ROTATING_SWEEP_TERMS[(this.sweepIndex + 1) % ROTATING_SWEEP_TERMS.length];
    this.sweepIndex = (this.sweepIndex + 2) % ROTATING_SWEEP_TERMS.length;

    for (const term of [term1, term2]) {
      try {
        const resp = await this.http.fetchJson<{ pairs?: DexScreenerPair[] }>(
          `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`,
          undefined,
          `ds_search_${term}`,
          25_000
        );
        for (const pair of resp?.pairs ?? []) {
          const mapped = this.mapPairToCandidate(pair, `dexscreener_sweep:${term}`);
          if (mapped) {
            mints.add(mapped.mint);
            candidates.push(mapped);
          }
        }
      } catch {
        // continue
      }
    }

    this.http.recordItems(mints.size);
    return { mints: Array.from(mints), candidates };
  }

  /**
   * Batch enriches up to 30 mints per request, consolidating multiple pools into the highest-liquidity pool.
   */
  async enrichMintsBatch(mints: string[], cacheTtlMs = 4_000): Promise<Map<string, CandidateToken>> {
    const consolidated = new Map<string, CandidateToken>();
    const unique = Array.from(new Set(mints.filter((m) => m && m !== WSOL_MINT)));

    for (let i = 0; i < unique.length; i += 30) {
      const chunk = unique.slice(i, i + 30);
      try {
        const pairs = await this.http.fetchJson<DexScreenerPair[]>(
          `https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`,
          undefined,
          `ds_batch_${chunk.join('_').slice(0, 64)}`,
          cacheTtlMs
        );
        if (!Array.isArray(pairs)) continue;
        for (const pair of pairs) {
          const mapped = this.mapPairToCandidate(pair, 'dexscreener_batch');
          if (!mapped) continue;
          const existing = consolidated.get(mapped.mint);
          if (!existing || mapped.liquidityUsd > existing.liquidityUsd) {
            consolidated.set(mapped.mint, mapped);
          }
        }
      } catch {
        // resilient chunking
      }
    }

    return consolidated;
  }
}
