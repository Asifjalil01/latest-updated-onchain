import { PublicKey } from '@solana/web3.js';
import type { BotDatabase } from '../store/db';
import type { DexScreenerProvider } from './dexscreener';
import type { NormalizedRugCheckResult } from './rugcheck';
import type { SolanaRpcPool } from './rpcPool';

export interface CreatorHistorySummary {
  creatorAddress: string | null;
  launchCount: number;
  ruggedCount: number;
  fastestRugMinutes: number | null;
  flaggedByRugCheckRisk: boolean;
  ruggedMints: string[];
}

interface PriorCoinRecord {
  mint: string;
  createdAtMs: number | null;
  rugged: boolean;
  ruggedAtMs: number | null;
  rugReason: string | null;
}

const CREATOR_CACHE_TTL_MS = 180_000;
const creatorCache = new Map<string, { atMs: number; summary: CreatorHistorySummary }>();

export async function inspectCreatorHistory(params: {
  creatorAddress: string | null;
  currentMint: string;
  currentPoolCreatedAtMs?: number | null;
  currentSymbol?: string;
  rugCheck: NormalizedRugCheckResult | null;
  dexScreener?: DexScreenerProvider;
  rpcPool?: SolanaRpcPool;
  db?: BotDatabase;
  nowMs?: number;
  bypassCache?: boolean;
}): Promise<CreatorHistorySummary> {
  const creator = (params.creatorAddress || '').trim() || null;
  const nowMs = params.nowMs ?? Date.now();
  const riskText = [
    ...(params.rugCheck?.riskNames ?? []),
    ...(params.rugCheck?.criticalRisks ?? []),
  ].join(' | ');
  const flaggedByRugCheckRisk = /creator.*rug|rugged.*token|serial.*rug/i.test(riskText);

  if (!creator) {
    return {
      creatorAddress: null,
      launchCount: 0,
      ruggedCount: flaggedByRugCheckRisk ? 1 : 0,
      fastestRugMinutes: null,
      flaggedByRugCheckRisk,
      ruggedMints: [],
    };
  }

  // Always record the current coin launch under this creator when known
  if (params.db && params.currentMint) {
    params.db.recordCreatorObservation({
      creator,
      mint: params.currentMint,
      symbol: params.currentSymbol || '',
      createdAtMs:
        params.currentPoolCreatedAtMs && params.currentPoolCreatedAtMs > 0
          ? params.currentPoolCreatedAtMs
          : params.rugCheck?.detectedAtMs ?? null,
      rugged: Boolean(params.rugCheck?.rugged),
      ruggedAtMs: params.rugCheck?.rugged ? nowMs : null,
      rugReason: params.rugCheck?.rugged ? 'RugCheck rugged flag' : null,
      nowMs,
    });
  }

  const cached = creatorCache.get(creator);
  if (!params.bypassCache && cached && nowMs - cached.atMs < CREATOR_CACHE_TTL_MS) {
    return {
      ...cached.summary,
      flaggedByRugCheckRisk: cached.summary.flaggedByRugCheckRisk || flaggedByRugCheckRisk,
      ruggedCount: Math.max(
        cached.summary.ruggedCount,
        flaggedByRugCheckRisk ? 1 : 0
      ),
    };
  }

  const priorMap = new Map<string, PriorCoinRecord>();
  for (const ct of params.rugCheck?.creatorTokens ?? []) {
    if (!ct.mint || ct.mint === params.currentMint) continue;
    priorMap.set(ct.mint, {
      mint: ct.mint,
      createdAtMs: ct.createdAtMs ?? null,
      rugged: Boolean(ct.rugged),
      ruggedAtMs: ct.rugged ? nowMs : null,
      rugReason: ct.rugged ? 'RugCheck creatorTokens flagged rugged' : null,
    });
  }

  if (params.db) {
    for (const row of params.db.getCreatorCoins(creator)) {
      if (!row.mint || row.mint === params.currentMint) continue;
      const existing = priorMap.get(row.mint);
      priorMap.set(row.mint, {
        mint: row.mint,
        createdAtMs: existing?.createdAtMs ?? row.createdAtMs,
        rugged: Boolean(existing?.rugged || row.rugged),
        ruggedAtMs: row.ruggedAtMs ?? existing?.ruggedAtMs ?? null,
        rugReason: row.rugReason ?? existing?.rugReason ?? null,
      });
    }
  }

  const priorMints = Array.from(priorMap.keys());
  if (priorMints.length > 0 && params.dexScreener) {
    try {
      const dsMap = await params.dexScreener.enrichMintsBatch(priorMints.slice(0, 30), 60_000);
      for (const mint of priorMints) {
        const rec = priorMap.get(mint)!;
        const ds = dsMap.get(mint);
        if (!ds) continue;
        if (!rec.createdAtMs && ds.poolCreatedAtMs > 0) {
          rec.createdAtMs = ds.poolCreatedAtMs;
        }
        const drainedLiq = ds.liquidityUsd < 500;
        const crashDrain = ds.liquidityUsd < 2000 && Number.isFinite(ds.priceChange24hPct) && ds.priceChange24hPct <= -90;
        if (!rec.rugged && (drainedLiq || crashDrain)) {
          rec.rugged = true;
          rec.rugReason = drainedLiq
            ? `Prior coin LP drained ($${ds.liquidityUsd.toFixed(0)})`
            : `Prior coin collapsed ${ds.priceChange24hPct.toFixed(0)}% (liq $${ds.liquidityUsd.toFixed(0)})`;
        }
      }
    } catch {
      // Resilient fallback: keep local + RugCheck data
    }
  }

  // Sort prior launches chronologically to infer serial-launch gap when rugged timestamp isn't observed directly
  const sortedCreated = Array.from(priorMap.values())
    .map((r) => ({ mint: r.mint, createdAtMs: r.createdAtMs }))
    .filter((r): r is { mint: string; createdAtMs: number } => typeof r.createdAtMs === 'number' && r.createdAtMs > 0)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  if (params.currentPoolCreatedAtMs && params.currentPoolCreatedAtMs > 0 && params.currentMint) {
    sortedCreated.push({ mint: params.currentMint, createdAtMs: params.currentPoolCreatedAtMs });
    sortedCreated.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  let fastestRugMinutes: number | null = null;
  const ruggedMints: string[] = [];

  for (const rec of priorMap.values()) {
    if (!rec.rugged) {
      if (params.db && rec.createdAtMs) {
        params.db.recordCreatorObservation({
          creator,
          mint: rec.mint,
          createdAtMs: rec.createdAtMs,
          rugged: false,
          nowMs,
        });
      }
      continue;
    }

    ruggedMints.push(rec.mint);
    let speedMin: number | null = null;

    // 1. Exact locally observed rug duration
    if (rec.ruggedAtMs && rec.createdAtMs && rec.ruggedAtMs > rec.createdAtMs) {
      speedMin = Math.max(0.1, (rec.ruggedAtMs - rec.createdAtMs) / 60_000);
    }

    // 2. Active on-chain lifetime via RPC latest signature timestamp when prior LP is dead
    if (speedMin === null && rec.createdAtMs && params.rpcPool && typeof params.rpcPool.withFailover === 'function') {
      try {
        const lastBlockMs = await params.rpcPool.withFailover(async (conn) => {
          const sigs = await conn.getSignaturesForAddress(new PublicKey(rec.mint), { limit: 1 });
          const bt = sigs?.[0]?.blockTime;
          return typeof bt === 'number' && bt > 0 ? bt * 1000 : null;
        });
        if (lastBlockMs && lastBlockMs > rec.createdAtMs) {
          const spanMin = (lastBlockMs - rec.createdAtMs) / 60_000;
          if (spanMin <= 7 * 24 * 60) {
            speedMin = Math.max(0.1, spanMin);
            rec.ruggedAtMs = lastBlockMs;
          }
        }
      } catch {
        // Ignore single-RPC failures
      }
    }

    // 3. Serial-launch gap (owner launched next token shortly after previous rugged coin)
    if (speedMin === null && rec.createdAtMs) {
      const idx = sortedCreated.findIndex((x) => x.mint === rec.mint);
      if (idx >= 0 && idx + 1 < sortedCreated.length) {
        const nextCreated = sortedCreated[idx + 1].createdAtMs;
        if (nextCreated > rec.createdAtMs) {
          const gapMin = (nextCreated - rec.createdAtMs) / 60_000;
          if (gapMin <= 24 * 60) {
            speedMin = Math.max(0.1, gapMin);
          }
        }
      }
    }

    // 4. Fallback if coin is <24h old and already rugged
    if (speedMin === null && rec.createdAtMs && nowMs > rec.createdAtMs) {
      const ageMin = (nowMs - rec.createdAtMs) / 60_000;
      if (ageMin <= 24 * 60) {
        speedMin = Math.max(0.1, ageMin);
      }
    }

    if (speedMin !== null) {
      fastestRugMinutes =
        fastestRugMinutes === null ? speedMin : Math.min(fastestRugMinutes, speedMin);
    }

    if (params.db) {
      params.db.recordCreatorObservation({
        creator,
        mint: rec.mint,
        createdAtMs: rec.createdAtMs,
        rugged: true,
        ruggedAtMs: rec.ruggedAtMs ?? nowMs,
        rugReason: rec.rugReason ?? 'Prior rugged coin',
        nowMs,
      });
    }
  }

  const ruggedCount = Math.max(ruggedMints.length, flaggedByRugCheckRisk ? 1 : 0);
  const summary: CreatorHistorySummary = {
    creatorAddress: creator,
    launchCount: priorMints.length,
    ruggedCount,
    fastestRugMinutes: fastestRugMinutes !== null ? Number(fastestRugMinutes.toFixed(1)) : null,
    flaggedByRugCheckRisk,
    ruggedMints,
  };

  creatorCache.set(creator, { atMs: nowMs, summary });
  if (creatorCache.size > 500) {
    const firstKey = creatorCache.keys().next().value;
    if (firstKey) creatorCache.delete(firstKey);
  }

  return summary;
}
