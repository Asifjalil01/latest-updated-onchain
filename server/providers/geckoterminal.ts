import { HttpProvider } from './base';
import type { CandidateToken } from '../types';

interface GeckoPoolItem {
  id: string;
  attributes?: {
    address?: string;
    name?: string;
    pool_created_at?: string;
    base_token_price_usd?: string;
    fdv_usd?: string;
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
    price_change_percentage?: { h1?: string; h24?: string };
    transactions?: {
      h24?: { buys?: number; sells?: number; buyers?: number; sellers?: number };
    };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
}

export class GeckoTerminalProvider {
  private readonly http: HttpProvider;

  constructor() {
    this.http = new HttpProvider({
      sourceName: 'geckoterminal',
      domain: 'api.geckoterminal.com',
      minIntervalMs: 1200,
      timeoutMs: 8000,
      cacheTtlMs: 25_000,
    });
  }

  getHealth() {
    return this.http.getHealth();
  }

  private mapPool(item: GeckoPoolItem, source: string): CandidateToken | null {
    const attrs = item.attributes;
    const baseTokenId = item.relationships?.base_token?.data?.id || '';
    const mint = baseTokenId.replace(/^solana_/, '');
    if (!mint || mint === baseTokenId) return null;

    const buys24h = Number(attrs?.transactions?.h24?.buys ?? 0);
    const sells24h = Number(attrs?.transactions?.h24?.sells ?? 0);
    const buyers = Number(attrs?.transactions?.h24?.buyers ?? 0);
    const sellers = Number(attrs?.transactions?.h24?.sellers ?? 0);
    const symbolPart = (attrs?.name || 'UNKNOWN').split('/')[0]?.trim() || 'UNKNOWN';

    return {
      mint,
      symbol: symbolPart,
      name: attrs?.name || symbolPart,
      source,
      dex: item.relationships?.dex?.data?.id || 'geckoterminal',
      pairAddress: attrs?.address || '',
      poolCreatedAtMs: attrs?.pool_created_at ? Date.parse(attrs.pool_created_at) || 0 : 0,
      priceUsd: Number(attrs?.base_token_price_usd || 0),
      priceSol: 0,
      liquidityUsd: Number(attrs?.reserve_in_usd || 0),
      volume24hUsd: Number(attrs?.volume_usd?.h24 || 0),
      fdvUsd: Number(attrs?.fdv_usd || 0),
      txCount24h: buys24h + sells24h,
      buys24h,
      sells24h,
      uniqueTraders24h: buyers + sellers > 0 ? Math.max(buyers, sellers) + Math.round(Math.min(buyers, sellers) * 0.6) : Math.round((buys24h + sells24h) * 0.5),
      priceChange1hPct: Number(attrs?.price_change_percentage?.h1 ?? NaN),
      priceChange24hPct: Number(attrs?.price_change_percentage?.h24 ?? NaN),
      rawUpdatedAtMs: Date.now(),
    };
  }

  async discoverPools(): Promise<CandidateToken[]> {
    const results: CandidateToken[] = [];
    const endpoints = [
      { url: 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools', tag: 'gecko_trending' },
      { url: 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=2', tag: 'gecko_trending_p2' },
      { url: 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools', tag: 'gecko_new' },
    ];

    for (const ep of endpoints) {
      try {
        const resp = await this.http.fetchJson<{ data?: GeckoPoolItem[] }>(
          ep.url,
          undefined,
          ep.tag,
          25_000
        );
        for (const item of resp?.data ?? []) {
          const mapped = this.mapPool(item, ep.tag);
          if (mapped) results.push(mapped);
        }
      } catch {
        // resilient
      }
    }

    this.http.recordItems(results.length);
    return results;
  }
}
