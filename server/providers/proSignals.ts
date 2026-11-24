import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import type {
  BacktestRequest,
  BacktestResult,
  BotSettings,
  CandidateToken,
  HolderAccountInfo,
  TradeRecord,
} from '../types';
import { isOptionEnabled } from '../config/defaults';
import type { SolanaRpcPool } from './rpcPool';

export const JITO_DONT_FRONT_PUBKEY_STR = 'jitodontfront111111111111111111111111111111';
export const JITO_DONT_FRONT_PUBKEY = new PublicKey(JITO_DONT_FRONT_PUBKEY_STR);

/**
 * Safely appends the read-only non-signer `jitodontfront...` account key to an unsigned
 * v0 or legacy VersionedTransaction and shifts any ALT-indexed instruction references by +1
 * so Jito block engines enforce strict sandwich protection without breaking account lookup tables.
 */
export function injectDontFrontMarker(tx: VersionedTransaction): boolean {
  try {
    const msg = tx.message as any;
    const keys: PublicKey[] | undefined = msg?.staticAccountKeys;
    const header = msg?.header;
    if (!Array.isArray(keys) || !header) return false;

    if (keys.some((k) => k.toBase58() === JITO_DONT_FRONT_PUBKEY_STR)) {
      return true;
    }

    const oldStaticLen = keys.length;
    keys.push(JITO_DONT_FRONT_PUBKEY);
    header.numReadonlyUnsignedAccounts = Number(header.numReadonlyUnsignedAccounts || 0) + 1;

    const ixs: Array<{ accountKeyIndexes?: number[] }> | undefined = msg.compiledInstructions;
    if (Array.isArray(ixs)) {
      for (const ix of ixs) {
        if (!Array.isArray(ix.accountKeyIndexes)) continue;
        ix.accountKeyIndexes = ix.accountKeyIndexes.map((idx) =>
          idx >= oldStaticLen ? idx + 1 : idx
        );
      }
    }
    return true;
  } catch {
    return false;
  }
}

const IGNORED_SOCIAL_HOSTS = new Set([
  'dexscreener.com',
  'www.dexscreener.com',
  'pump.fun',
  'www.pump.fun',
  'solscan.io',
  'www.solscan.io',
  'birdeye.so',
  'www.birdeye.so',
  'gmgn.ai',
  'jup.ag',
  'raydium.io',
  'axiom.trade',
  'photon-sol.tinyastro.io',
  'rugcheck.xyz',
]);

export function normalizeSocialUrls(urls: string[] | undefined): string[] {
  if (!Array.isArray(urls) || urls.length === 0) return [];
  const out = new Set<string>();
  for (const raw of urls) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    try {
      const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      if (!host || IGNORED_SOCIAL_HOSTS.has(host)) continue;
      let normalizedHost = host === 'twitter.com' ? 'x.com' : host;
      const cleanPath = u.pathname.replace(/\/+$/, '').toLowerCase();
      if (!cleanPath && (normalizedHost === 'x.com' || normalizedHost === 't.me')) continue;
      out.add(`${normalizedHost}${cleanPath}`);
    } catch {
      const clean = trimmed.toLowerCase().replace(/\/+$/, '');
      if (clean.length >= 4) out.add(clean);
    }
  }
  return Array.from(out);
}

const TICKER_STRIP_REGEX = /(MINI|BABY|SUPER|MEGA|MICRO|TURBO|COIN|TOKEN|INU|WIF|SOL|AI|2\.0)$/i;
const PREFIX_STRIP_REGEX = /^(MINI|BABY|SUPER|MEGA|MICRO|TURBO)/i;

export function extractTickerStem(symbol: string): string {
  let s = String(symbol || '')
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, '');
  if (!s) return 'UNKNOWN';
  s = s.replace(/\d+$/g, '');
  for (let i = 0; i < 2; i += 1) {
    const afterSuffix = s.replace(TICKER_STRIP_REGEX, '');
    if (afterSuffix.length >= 2) s = afterSuffix;
    const afterPrefix = s.replace(PREFIX_STRIP_REGEX, '');
    if (afterPrefix.length >= 2) s = afterPrefix;
  }
  return s || String(symbol).toUpperCase();
}

export interface SybilClusterResult {
  inspectedCount: number;
  freshWalletCount: number;
  maxSharedCount: number;
  sharedFunder: string | null;
}

export async function analyzeSybilFunders(params: {
  holders: HolderAccountInfo[];
  rpcPool: SolanaRpcPool;
  freshWalletMinutes: number;
  nowMs?: number;
}): Promise<SybilClusterResult> {
  const nowMs = params.nowMs ?? Date.now();
  const cutoffMs = nowMs - Math.max(1, params.freshWalletMinutes) * 60_000;
  const nonPool = (params.holders || [])
    .filter((h) => !h.isExcludedPoolOrBurn && h.address && h.pct >= 0.3)
    .slice(0, 8);

  if (nonPool.length < 2) {
    return { inspectedCount: 0, freshWalletCount: 0, maxSharedCount: 0, sharedFunder: null };
  }

  const funderCounts = new Map<string, number>();
  let inspectedCount = 0;
  let freshWalletCount = 0;

  await Promise.race([
    Promise.all(
      nonPool.map(async (h) => {
        try {
          const info = await params.rpcPool.withFailover(async (conn) => {
            const pk = new PublicKey(h.address);
            const sigs = await conn.getSignaturesForAddress(pk, { limit: 15 });
            if (!sigs || sigs.length === 0) return null;
            // Oldest signature in window approximates wallet creation / first funding
            const oldest = sigs[sigs.length - 1];
            const firstSeenMs = oldest?.blockTime ? Number(oldest.blockTime) * 1000 : nowMs;
            const isFresh = sigs.length < 15 && firstSeenMs >= cutoffMs;
            const parsedTx = await conn.getParsedTransaction(oldest.signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            });
            let funder: string | null = null;
            const keys = parsedTx?.transaction?.message?.accountKeys ?? [];
            for (const k of keys) {
              const addr = typeof k?.pubkey?.toBase58 === 'function' ? k.pubkey.toBase58() : String(k?.pubkey || '');
              if (addr && addr !== h.address && k?.signer) {
                funder = addr;
                break;
              }
            }
            return { isFresh, funder };
          });
          if (!info) return;
          inspectedCount += 1;
          if (info.isFresh) {
            freshWalletCount += 1;
            if (info.funder) {
              funderCounts.set(info.funder, (funderCounts.get(info.funder) ?? 0) + 1);
            }
          }
        } catch {
          // Non-fatal RPC skip per holder
        }
      })
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);

  let sharedFunder: string | null = null;
  let maxSharedCount = 0;
  for (const [funder, count] of funderCounts.entries()) {
    if (count > maxSharedCount) {
      maxSharedCount = count;
      sharedFunder = funder;
    }
  }

  return { inspectedCount, freshWalletCount, maxSharedCount, sharedFunder };
}

export class SolRegimeTracker {
  private readonly samples: Array<{ tsMs: number; priceUsd: number }> = [];

  record(priceUsd: number, nowMs = Date.now()): void {
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
    this.samples.push({ tsMs: nowMs, priceUsd });
    const cutoff = nowMs - 20 * 60_000;
    while (this.samples.length > 0 && this.samples[0].tsMs < cutoff) {
      this.samples.shift();
    }
    if (this.samples.length > 400) {
      this.samples.splice(0, this.samples.length - 400);
    }
  }

  getDropPct15m(nowMs = Date.now()): number {
    const cutoff = nowMs - 15 * 60_000;
    const recent = this.samples.filter((s) => s.tsMs >= cutoff);
    if (recent.length < 2) return 0;
    const peak = Math.max(...recent.map((s) => s.priceUsd));
    const latest = recent[recent.length - 1].priceUsd;
    if (peak <= 0) return 0;
    const dropPct = ((peak - latest) / peak) * 100;
    return Number(Math.max(0, dropPct).toFixed(3));
  }

  evaluate(settings: BotSettings, nowMs = Date.now()): {
    redMarket: boolean;
    dropPct15m: number;
    pauseEntries: boolean;
    sizeMultiplier: number;
  } {
    const enabled =
      settings.solRegimeFilterEnabled && isOptionEnabled(settings, 'solRegimeFilterEnabled');
    const dropPct15m = this.getDropPct15m(nowMs);
    if (!enabled) {
      return { redMarket: false, dropPct15m, pauseEntries: false, sizeMultiplier: 1.0 };
    }
    const maxDrop = Math.max(0.1, settings.solRegimeMaxDropPct || 2.0);
    const redMarket = dropPct15m >= maxDrop;
    if (!redMarket) {
      return { redMarket: false, dropPct15m, pauseEntries: false, sizeMultiplier: 1.0 };
    }
    const action = settings.solRegimeAction === 'half_size' ? 'half_size' : 'pause';
    return {
      redMarket: true,
      dropPct15m,
      pauseEntries: action === 'pause',
      sizeMultiplier: action === 'half_size' ? 0.5 : 0,
    };
  }
}

export class MarketStructureTracker {
  private readonly migrationPeaks = new Map<string, { peakUsd: number; firstSeenMs: number }>();
  private readonly shortPriceWindow = new Map<string, Array<{ tsMs: number; priceUsd: number }>>();

  evaluateEntryTiming(
    token: CandidateToken,
    settings: BotSettings,
    nowMs = Date.now()
  ): { passed: boolean; reasons: string[]; warnings: string[] } {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const dexLow = (token.dex || '').toLowerCase();
    const isPreMigrationCurveDex = dexLow === 'pumpfun' || dexLow === 'pump';
    const isMigratedPool = !isPreMigrationCurveDex && (
      dexLow.includes('pumpswap') ||
      dexLow.includes('raydium') ||
      dexLow.includes('meteora') ||
      dexLow.includes('orca') ||
      token.mint.endsWith('pump')
    );

    // Track short price history (20s window) for Anti-Top-Wick
    if (token.priceUsd > 0) {
      const list = this.shortPriceWindow.get(token.mint) ?? [];
      list.push({ tsMs: nowMs, priceUsd: token.priceUsd });
      const cutoff = nowMs - 20_000;
      const pruned = list.filter((x) => x.tsMs >= cutoff).slice(-20);
      this.shortPriceWindow.set(token.mint, pruned);
      if (this.shortPriceWindow.size > 600) {
        const firstKey = this.shortPriceWindow.keys().next().value;
        if (firstKey) this.shortPriceWindow.delete(firstKey);
      }
    }

    // 1. Wash-Trading / Fake Volume Detection
    if (settings.washTradeFilterEnabled && isOptionEnabled(settings, 'washTradeFilterEnabled')) {
      const minRatio = Math.max(0.05, Math.min(1, settings.minUniqueMakersRatio ?? 0.25));
      const min5mTraders = Math.max(1, settings.minUniqueTraders5m ?? 6);
      const tx5m = (token.buys5m ?? 0) + (token.sells5m ?? 0);

      if (token.uniqueTraders5m !== undefined && tx5m >= 6) {
        const ratio5m = token.uniqueTraders5m / Math.max(1, tx5m);
        if (token.uniqueTraders5m < min5mTraders) {
          reasons.push(
            `Wash-trade guard: ${token.uniqueTraders5m} unique 5m traders < ${min5mTraders} min`
          );
        } else if (ratio5m < minRatio) {
          reasons.push(
            `Wash-trade guard: unique maker ratio ${(ratio5m * 100).toFixed(0)}% < ${(minRatio * 100).toFixed(0)}% (${token.uniqueTraders5m}/${tx5m})`
          );
        }
      } else if (token.txCount24h >= 12) {
        const ratio24 = token.uniqueTraders24h / Math.max(1, token.txCount24h);
        if (ratio24 < minRatio) {
          reasons.push(
            `Wash-trade guard: unique maker ratio ${(ratio24 * 100).toFixed(0)}% < ${(minRatio * 100).toFixed(0)}%`
          );
        }
      }
    }

    // 2. Anti-Top-Wick Guard
    if (settings.antiTopWickEnabled && isOptionEnabled(settings, 'antiTopWickEnabled')) {
      const maxSpike = Math.max(5, settings.maxShortSpikePct ?? 70);
      const history = this.shortPriceWindow.get(token.mint) ?? [];
      if (history.length >= 2) {
        const base = history[0].priceUsd;
        const latest = history[history.length - 1].priceUsd;
        const surgePct = base > 0 ? ((latest - base) / base) * 100 : 0;
        if (surgePct > maxSpike) {
          reasons.push(
            `Anti-Top-Wick guard: +${surgePct.toFixed(1)}% vertical spike in <20s > +${maxSpike}% cap`
          );
        }
      }
      if (token.priceChange5mPct !== undefined && Number.isFinite(token.priceChange5mPct)) {
        if (token.priceChange5mPct > maxSpike) {
          reasons.push(
            `Anti-Top-Wick guard: 5m spike +${token.priceChange5mPct.toFixed(1)}% > +${maxSpike}% cap`
          );
        }
      }
    }

    // 3. Post-Migration Pullback / Reclaim Entry
    if (
      settings.postMigrationPullbackEnabled &&
      isOptionEnabled(settings, 'postMigrationPullbackEnabled') &&
      isMigratedPool
    ) {
      const waitMs = Math.max(5, settings.migrationWaitSec ?? 45) * 1000;
      const minDipPct = Math.max(1, settings.migrationMinDipPct ?? 15);
      const ageMs = token.poolCreatedAtMs > 0 ? Math.max(0, nowMs - token.poolCreatedAtMs) : waitMs;
      let peakRec = this.migrationPeaks.get(token.mint);
      if (!peakRec) {
        peakRec = { peakUsd: token.priceUsd, firstSeenMs: nowMs };
        this.migrationPeaks.set(token.mint, peakRec);
        if (this.migrationPeaks.size > 500) {
          const oldest = this.migrationPeaks.keys().next().value;
          if (oldest) this.migrationPeaks.delete(oldest);
        }
      } else if (token.priceUsd > peakRec.peakUsd) {
        peakRec.peakUsd = token.priceUsd;
      }

      if (ageMs < waitMs) {
        reasons.push(
          `Post-migration wait: pool age ${Math.round(ageMs / 1000)}s < ${Math.round(waitMs / 1000)}s dump settle window`
        );
      } else {
        const dipFromPeakPct =
          peakRec.peakUsd > 0 ? ((peakRec.peakUsd - token.priceUsd) / peakRec.peakUsd) * 100 : 0;
        const m5Negative =
          token.priceChange5mPct !== undefined &&
          Number.isFinite(token.priceChange5mPct) &&
          token.priceChange5mPct <= -minDipPct;
        if (dipFromPeakPct < minDipPct && !m5Negative) {
          reasons.push(
            `Post-migration pullback pending: dip ${dipFromPeakPct.toFixed(1)}% < ${minDipPct}% required pullback`
          );
        } else {
          warnings.push(`Post-migration pullback satisfied (-${Math.max(dipFromPeakPct, 0).toFixed(1)}%)`);
        }
      }
    }

    // 4. Pre-Migration Bonding Curve Surge Filter
    if (
      settings.preMigrationCurveEnabled &&
      isOptionEnabled(settings, 'preMigrationCurveEnabled') &&
      isPreMigrationCurveDex
    ) {
      const minCurve = settings.preMigrationCurveMinPct ?? 75;
      const maxCurve = settings.preMigrationCurveMaxPct ?? 92;
      if (token.realSolInCurve !== undefined && Number.isFinite(token.realSolInCurve)) {
        const curvePct = Math.min(100, Math.max(0, (token.realSolInCurve / 85) * 100));
        if (curvePct < minCurve || curvePct > maxCurve) {
          reasons.push(
            `Pre-migration bonding curve ${curvePct.toFixed(1)}% outside ${minCurve}%–${maxCurve}% sweet spot`
          );
        }
      }
    }

    return { passed: reasons.length === 0, reasons, warnings };
  }
}

export function evaluateLosingStreakThrottle(
  trades: TradeRecord[],
  settings: BotSettings,
  nowMs = Date.now()
): {
  active: boolean;
  consecutiveLosses: number;
  pauseEntries: boolean;
  sizeMultiplier: number;
  cooldownRemainingSec: number;
} {
  if (!settings.streakThrottleEnabled || !isOptionEnabled(settings, 'streakThrottleEnabled')) {
    return {
      active: false,
      consecutiveLosses: 0,
      pauseEntries: false,
      sizeMultiplier: 1.0,
      cooldownRemainingSec: 0,
    };
  }
  const limit = Math.max(1, settings.streakLossLimit || 3);
  const cooldownMs = Math.max(1, settings.streakCooldownMinutes || 20) * 60_000;
  // Assume trades sorted descending or sort safely
  const sorted = [...trades].sort(
    (a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt)
  );
  let consecutiveLosses = 0;
  for (const t of sorted) {
    if (t.pnlSol < 0) consecutiveLosses += 1;
    else break;
  }
  if (consecutiveLosses < limit || sorted.length === 0) {
    return {
      active: false,
      consecutiveLosses,
      pauseEntries: false,
      sizeMultiplier: 1.0,
      cooldownRemainingSec: 0,
    };
  }
  const latestLossMs = Date.parse(sorted[0].closedAt) || 0;
  const elapsedMs = Math.max(0, nowMs - latestLossMs);
  if (elapsedMs >= cooldownMs) {
    return {
      active: false,
      consecutiveLosses,
      pauseEntries: false,
      sizeMultiplier: 1.0,
      cooldownRemainingSec: 0,
    };
  }
  const cooldownRemainingSec = Math.ceil((cooldownMs - elapsedMs) / 1000);
  const pauseEntries = settings.streakAction === 'pause';
  return {
    active: true,
    consecutiveLosses,
    pauseEntries,
    sizeMultiplier: pauseEntries ? 0 : 0.5,
    cooldownRemainingSec,
  };
}

export function calculateConvictionMultiplier(params: {
  token: CandidateToken;
  settings: BotSettings;
  smartWalletMatches: number;
}): number {
  const { token, settings, smartWalletMatches } = params;
  let mult = 1.0;

  if (settings.convictionSizingEnabled && isOptionEnabled(settings, 'convictionSizingEnabled')) {
    const minM = Math.max(0.1, settings.convictionMinMult ?? 0.5);
    const maxM = Math.max(minM, settings.convictionMaxMult ?? 1.5);
    let score = 0.5;
    if (token.liquidityUsd >= 50_000) score += 0.2;
    else if (token.liquidityUsd >= 15_000) score += 0.1;
    else if (token.liquidityUsd < 5_000) score -= 0.15;

    const total = token.buys24h + token.sells24h;
    const buyRatio = total > 0 ? token.buys24h / total : 0.5;
    if (buyRatio >= 0.65) score += 0.15;
    else if (buyRatio < 0.45) score -= 0.15;

    if ((token.uniqueTraders5m ?? 0) >= 15 || token.uniqueTraders24h >= 120) score += 0.15;
    const clamped = Math.max(0, Math.min(1, score));
    mult = minM + clamped * (maxM - minM);
  }

  if (
    settings.smartMoneyEnabled &&
    isOptionEnabled(settings, 'smartMoneyEnabled') &&
    smartWalletMatches >= Math.max(1, settings.smartMoneyMinConfluence || 1)
  ) {
    const boostPct = Math.max(0, Math.min(200, settings.smartMoneySizeBoostPct || 0));
    mult *= 1 + boostPct / 100;
  }

  return Number(Math.max(0.1, Math.min(3.0, mult)).toFixed(3));
}

export function runSpotBacktest(trades: TradeRecord[], req: BacktestRequest): BacktestResult {
  const nowMs = Date.now();
  const lookbackMs = req.lookbackHours && req.lookbackHours > 0 ? req.lookbackHours * 3600_000 : 0;

  const inWindow = trades
    .filter((t) => {
      if (lookbackMs > 0) {
        const ts = Date.parse(t.closedAt);
        if (Number.isFinite(ts) && nowMs - ts > lookbackMs) return false;
      }
      return true;
    })
    .sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));

  let filteredOutCount = 0;
  let baseWins = 0;
  let baseNet = 0;
  let basePeak = 0;
  let baseMaxDd = 0;

  let simWins = 0;
  let simNet = 0;
  let simPeak = 0;
  let simMaxDd = 0;
  let evaluatedTrades = 0;

  for (const t of inWindow) {
    baseNet += t.pnlSol;
    if (t.pnlSol > 0) baseWins += 1;
    if (baseNet > basePeak) basePeak = baseNet;
    const baseDd = basePeak - baseNet;
    if (baseDd > baseMaxDd) baseMaxDd = baseDd;

    const ageOk =
      (req.minAgeMinutes === undefined || t.tokenAgeAtEntry >= req.minAgeMinutes) &&
      (req.maxAgeMinutes === undefined || req.maxAgeMinutes <= 0 || t.tokenAgeAtEntry <= req.maxAgeMinutes);
    if (!ageOk) {
      filteredOutCount += 1;
      continue;
    }

    evaluatedTrades += 1;
    const peakPct = Math.max(0, t.peakPct || 0);
    const actualPct = t.pnlPct || 0;
    const costSol = t.solIn > 0 ? t.solIn : 0.05;
    const feeOverheadSol = t.feesSol || 0;

    let simPct = actualPct;
    if (peakPct >= req.takeProfitPct) {
      simPct = req.takeProfitPct;
    } else if (req.trailingEnabled && peakPct > req.trailingDropPct && req.trailingDropPct > 0) {
      const trailExit = peakPct - req.trailingDropPct;
      if (actualPct <= trailExit) {
        simPct = Math.max(trailExit, actualPct);
      }
    } else if (actualPct <= -Math.abs(req.stopLossPct)) {
      simPct = -Math.abs(req.stopLossPct);
    }

    const simPnlSol = costSol * (simPct / 100) - feeOverheadSol;
    simNet += simPnlSol;
    if (simPnlSol > 0) simWins += 1;
    if (simNet > simPeak) simPeak = simNet;
    const simDd = simPeak - simNet;
    if (simDd > simMaxDd) simMaxDd = simDd;
  }

  return {
    sampleSize: inWindow.length,
    evaluatedTrades,
    baselineWinRatePct: inWindow.length > 0 ? Number(((baseWins / inWindow.length) * 100).toFixed(1)) : 0,
    baselineNetPnl: Number(baseNet.toFixed(6)),
    baselineMaxDrawdown: Number(baseMaxDd.toFixed(6)),
    simulatedWinRatePct: evaluatedTrades > 0 ? Number(((simWins / evaluatedTrades) * 100).toFixed(1)) : 0,
    simulatedNetPnl: Number(simNet.toFixed(6)),
    simulatedMaxDrawdown: Number(simMaxDd.toFixed(6)),
    filteredOutCount,
    pnlUnit: 'SOL',
    notes: [
      `Replayed ${inWindow.length} closed trades (${evaluatedTrades} passed age filters, ${filteredOutCount} filtered out).`,
      'Uses recorded peak gain %, stop-loss %, fees, and entry age per historical position.',
    ],
  };
}
