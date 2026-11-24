import { HttpProvider } from './base';
import type { HolderAccountInfo } from '../types';

export interface RugCheckApiReport {
  mint: string;
  score: number;
  score_normalised?: number;
  rugged?: boolean;
  risks?: Array<{
    name?: string;
    value?: string;
    description?: string;
    score?: number;
    level?: string;
  }>;
  markets?: Array<{
    pubkey?: string;
    lp?: {
      lpLockedPct?: number;
      lpBurned?: boolean;
      lpLockedUSD?: number;
    };
  }>;
  topHolders?: Array<{
    address?: string;
    owner?: string;
    uiAmount?: number;
    pct?: number;
    insider?: boolean;
  }>;
  knownAccounts?: Record<string, { name?: string; type?: string }>;
  creator?: string;
  creatorTokens?: Array<{
    mint?: string;
    createdAt?: string | number;
    marketCap?: number;
    rugged?: boolean;
  }>;
  detectedAt?: string | number;
  tokenMeta?: {
    mutable?: boolean;
  };
  freezeAuthority?: string | null;
  mintAuthority?: string | null;
}

export interface RugCheckCreatorTokenInfo {
  mint: string;
  createdAtMs: number | null;
  marketCap: number | null;
  rugged: boolean;
}

export interface NormalizedRugCheckResult {
  available: boolean;
  normalizedRiskScore: number;
  rugged: boolean;
  lpLockedOrBurnedPct: number;
  riskNames: string[];
  criticalRisks: string[];
  creator: string | null;
  creatorTokens?: RugCheckCreatorTokenInfo[];
  detectedAtMs?: number | null;
  holders?: HolderAccountInfo[];
  top10HoldersPct?: number | null;
  singleMaxHolderPct?: number | null;
  knownPoolAddresses?: string[];
  mintAuthorityRevoked?: boolean | null;
  freezeAuthorityRevoked?: boolean | null;
}

export class RugCheckProvider {
  private readonly http: HttpProvider;

  constructor() {
    this.http = new HttpProvider({
      sourceName: 'rugcheck',
      domain: 'api.rugcheck.xyz',
      minIntervalMs: 400,
      timeoutMs: 7000,
      cacheTtlMs: 60_000,
    });
  }

  getHealth() {
    return this.http.getHealth();
  }

  async getReport(mint: string): Promise<NormalizedRugCheckResult | null> {
    try {
      const data = await this.http.fetchJson<RugCheckApiReport>(
        `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`,
        undefined,
        `rugcheck_${mint}`,
        60_000
      );

      if (!data || typeof data.score !== 'number') {
        return null;
      }

      // RugCheck returns either score_normalised (0-100) or raw score (0-10000+)
      const normalizedRiskScore =
        typeof data.score_normalised === 'number'
          ? data.score_normalised
          : Math.min(100, Math.round(data.score / 100));

      let maxLpPct = 0;
      const knownPoolAddresses = new Set<string>();
      for (const m of data.markets ?? []) {
        if (m.pubkey) knownPoolAddresses.add(m.pubkey);
        const locked = Number(m.lp?.lpLockedPct ?? 0);
        const burned = m.lp?.lpBurned ? 100 : 0;
        maxLpPct = Math.max(maxLpPct, locked, burned);
      }

      for (const [addr, info] of Object.entries(data.knownAccounts ?? {})) {
        const t = (info?.type || '').toUpperCase();
        if (t === 'AMM' || t === 'LOCKER' || t === 'CLOB' || t === 'POOL') {
          knownPoolAddresses.add(addr);
        }
      }

      const holders: HolderAccountInfo[] = [];
      for (const h of (data.topHolders ?? []).slice(0, 20)) {
        if (!h.address || typeof h.pct !== 'number') continue;
        const isExcluded =
          knownPoolAddresses.has(h.address) ||
          (h.owner ? knownPoolAddresses.has(h.owner) : false);
        holders.push({
          address: h.address,
          amount: Number(h.uiAmount ?? 0),
          pct: h.pct,
          isExcludedPoolOrBurn: isExcluded,
          label: h.owner && data.knownAccounts?.[h.owner]?.name
            ? data.knownAccounts[h.owner].name
            : isExcluded
              ? 'Pool / Locker'
              : undefined,
        });
      }

      const nonPoolHolders = holders.filter((h) => !h.isExcludedPoolOrBurn);
      const top10HoldersPct =
        holders.length > 0
          ? nonPoolHolders.slice(0, 10).reduce((sum, h) => sum + h.pct, 0)
          : null;
      const singleMaxHolderPct =
        holders.length > 0 ? (nonPoolHolders.length > 0 ? nonPoolHolders[0].pct : 0) : null;

      const risks = data.risks ?? [];
      const riskNames = risks.map((r) => r.name || r.description || 'Unknown risk');
      const criticalRisks = risks
        .filter((r) => (r.level || '').toLowerCase() === 'danger' || (r.level || '').toLowerCase() === 'critical')
        .map((r) => r.name || r.description || 'Critical risk');

      const creatorTokens: RugCheckCreatorTokenInfo[] = [];
      for (const ct of data.creatorTokens ?? []) {
        if (!ct?.mint) continue;
        let createdAtMs: number | null = null;
        if (typeof ct.createdAt === 'number' && Number.isFinite(ct.createdAt)) {
          createdAtMs = ct.createdAt > 1e12 ? ct.createdAt : ct.createdAt * 1000;
        } else if (typeof ct.createdAt === 'string' && ct.createdAt.trim()) {
          const parsedTs = Date.parse(ct.createdAt);
          if (Number.isFinite(parsedTs)) createdAtMs = parsedTs;
        }
        creatorTokens.push({
          mint: String(ct.mint),
          createdAtMs,
          marketCap: typeof ct.marketCap === 'number' ? ct.marketCap : null,
          rugged: Boolean(ct.rugged),
        });
      }

      let detectedAtMs: number | null = null;
      if (typeof data.detectedAt === 'number' && Number.isFinite(data.detectedAt)) {
        detectedAtMs = data.detectedAt > 1e12 ? data.detectedAt : data.detectedAt * 1000;
      } else if (typeof data.detectedAt === 'string' && data.detectedAt.trim()) {
        const parsedTs = Date.parse(data.detectedAt);
        if (Number.isFinite(parsedTs)) detectedAtMs = parsedTs;
      }

      this.http.recordItems(1);
      return {
        available: true,
        normalizedRiskScore,
        rugged: Boolean(data.rugged),
        lpLockedOrBurnedPct: maxLpPct,
        riskNames,
        criticalRisks,
        creator: data.creator ?? null,
        creatorTokens,
        detectedAtMs,
        holders,
        top10HoldersPct,
        singleMaxHolderPct,
        knownPoolAddresses: Array.from(knownPoolAddresses),
        mintAuthorityRevoked: data.mintAuthority === undefined ? null : data.mintAuthority === null,
        freezeAuthorityRevoked: data.freezeAuthority === undefined ? null : data.freezeAuthority === null,
      };
    } catch {
      return null;
    }
  }
}
