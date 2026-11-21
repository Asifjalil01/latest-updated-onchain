import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { HolderAccountInfo, RpcEndpointHealth } from '../types';

export interface RpcEndpointConfig {
  url: string;
  label: string;
}

const DEFAULT_PUBLIC_MAINNET_RPCS: RpcEndpointConfig[] = [
  { url: 'https://solana-rpc.publicnode.com', label: 'PublicNode' },
  { url: 'https://api.zan.top/solana-mainnet', label: 'ZAN Mainnet' },
  { url: 'https://api.mainnet-beta.solana.com', label: 'Solana Mainnet' },
  { url: 'https://solana.publicnode.com', label: 'PublicNode Alt' },
];

const KNOWN_POOL_OR_BURN_OWNERS = new Set([
  '11111111111111111111111111111111',
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium Authority V4
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', // Raydium CPMM Authority
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora Pools
  'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC', // Meteora Pool Authority
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // PumpSwap AMM
  '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg', // Pump.fun migration
]);

export interface OnChainTokenInspection {
  mint: string;
  decimals: number;
  programId: string;
  isToken2022: boolean;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  disallowedExtensions: string[];
  supplyUi: number;
  holderInspectionAvailable?: boolean;
  top10HoldersPct: number;
  singleMaxHolderPct: number;
  holders: HolderAccountInfo[];
}

export class SolanaRpcPool {
  private readonly endpoints: RpcEndpointConfig[];
  private readonly connections: Map<string, Connection>;
  private readonly healthMap: Map<string, RpcEndpointHealth>;
  private readonly largestAccountsCooldownUntil = new Map<string, number>();
  private readonly endpointCooldownUntil = new Map<string, number>();

  constructor(customUrls: string[] = []) {
    const merged: RpcEndpointConfig[] = [];
    const seen = new Set<string>();

    customUrls.forEach((url, idx) => {
      const clean = url.trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        merged.push({ url: clean, label: idx === 0 ? 'Custom Primary RPC' : `Custom RPC ${idx}` });
      }
    });

    for (const def of DEFAULT_PUBLIC_MAINNET_RPCS) {
      if (!seen.has(def.url)) {
        seen.add(def.url);
        merged.push(def);
      }
    }

    this.endpoints = merged;
    this.connections = new Map();
    this.healthMap = new Map();

    for (const ep of this.endpoints) {
      this.connections.set(
        ep.url,
        new Connection(ep.url, { commitment: 'confirmed', disableRetryOnRateLimit: true })
      );
      this.healthMap.set(ep.url, {
        url: ep.url,
        label: ep.label,
        healthy: true,
        latencyMs: 0,
        slot: 0,
        errorCount: 0,
        lastCheckedMs: 0,
        lastError: null,
      });
    }
  }

  getEndpoints(): RpcEndpointConfig[] {
    return [...this.endpoints];
  }

  getHealthSnapshot(): RpcEndpointHealth[] {
    return Array.from(this.healthMap.values());
  }

  getOrderedConnections(): Array<{ ep: RpcEndpointConfig; conn: Connection }> {
    const now = Date.now();
    return [...this.endpoints]
      .sort((a, b) => {
        const aCooldown = (this.endpointCooldownUntil.get(a.url) ?? 0) > now ? 1 : 0;
        const bCooldown = (this.endpointCooldownUntil.get(b.url) ?? 0) > now ? 1 : 0;
        if (aCooldown !== bCooldown) return aCooldown - bCooldown;
        const ha = this.healthMap.get(a.url);
        const hb = this.healthMap.get(b.url);
        const healthyDiff = Number(Boolean(hb?.healthy)) - Number(Boolean(ha?.healthy));
        if (healthyDiff !== 0) return healthyDiff;
        return (ha?.latencyMs ?? 9999) - (hb?.latencyMs ?? 9999);
      })
      .map((ep) => ({ ep, conn: this.connections.get(ep.url)! }));
  }

  private recordEndpointError(epUrl: string, errMsg: string): void {
    const now = Date.now();
    const health = this.healthMap.get(epUrl);
    const is429 = errMsg.includes('429') || errMsg.toLowerCase().includes('too many requests');
    if (is429) {
      this.endpointCooldownUntil.set(epUrl, now + 20_000);
    }
    if (health) {
      this.healthMap.set(epUrl, {
        ...health,
        healthy: is429 ? health.healthy : false,
        errorCount: health.errorCount + 1,
        lastCheckedMs: now,
        lastError: errMsg,
      });
    }
  }

  async checkAllEndpoints(): Promise<RpcEndpointHealth[]> {
    await Promise.all(
      this.endpoints.map(async (ep) => {
        const conn = this.connections.get(ep.url)!;
        const current = this.healthMap.get(ep.url)!;
        const start = Date.now();
        try {
          const slot = await Promise.race([
            conn.getSlot('confirmed'),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('RPC timeout')), 5000)),
          ]);
          this.endpointCooldownUntil.delete(ep.url);
          this.healthMap.set(ep.url, {
            ...current,
            healthy: true,
            latencyMs: Date.now() - start,
            slot: Number(slot),
            lastCheckedMs: Date.now(),
            lastError: null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const is429 = msg.includes('429') || msg.toLowerCase().includes('too many requests');
          if (is429) {
            this.endpointCooldownUntil.set(ep.url, Date.now() + 20_000);
          }
          this.healthMap.set(ep.url, {
            ...current,
            healthy: is429 ? true : false,
            latencyMs: Date.now() - start,
            errorCount: current.errorCount + 1,
            lastCheckedMs: Date.now(),
            lastError: msg,
          });
        }
      })
    );
    return this.getHealthSnapshot();
  }

  async withFailover<T>(fn: (conn: Connection, url: string) => Promise<T>): Promise<T> {
    const ordered = this.getOrderedConnections();
    let lastError: Error | null = null;
    for (const { ep, conn } of ordered) {
      const start = Date.now();
      const health = this.healthMap.get(ep.url)!;
      try {
        const res = await Promise.race([
          fn(conn, ep.url),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('RPC call timeout')), 8000)),
        ]);
        this.endpointCooldownUntil.delete(ep.url);
        this.healthMap.set(ep.url, {
          ...health,
          healthy: true,
          latencyMs: Date.now() - start,
          lastCheckedMs: Date.now(),
          lastError: null,
        });
        return res;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.recordEndpointError(ep.url, lastError.message);
      }
    }
    throw lastError ?? new Error('All Solana RPC endpoints failed.');
  }

  /**
   * Requires agreement from at least two distinct RPC endpoints for balance decisions.
   */
  async getAgreedBalanceSol(
    address: string,
    toleranceSol = 0.0005
  ): Promise<{ agreed: boolean; balanceSol: number | null; readings: number[] }> {
    const pubkey = new PublicKey(address);
    const ordered = this.getOrderedConnections().slice(0, 3);
    const readings: number[] = [];

    await Promise.all(
      ordered.map(async ({ ep, conn }) => {
        const start = Date.now();
        try {
          const lamports = await Promise.race([
            conn.getBalance(pubkey, 'confirmed'),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('RPC timeout')), 5000)),
          ]);
          const h = this.healthMap.get(ep.url);
          if (h) {
            this.endpointCooldownUntil.delete(ep.url);
            this.healthMap.set(ep.url, {
              ...h,
              healthy: true,
              latencyMs: Date.now() - start,
              lastCheckedMs: Date.now(),
              lastError: null,
            });
          }
          readings.push(Number(lamports) / LAMPORTS_PER_SOL);
        } catch (err) {
          this.recordEndpointError(ep.url, err instanceof Error ? err.message : String(err));
        }
      })
    );

    if (readings.length < 2) {
      return { agreed: false, balanceSol: null, readings };
    }

    for (let i = 0; i < readings.length; i++) {
      for (let j = i + 1; j < readings.length; j++) {
        if (Math.abs(readings[i] - readings[j]) <= toleranceSol) {
          return { agreed: true, balanceSol: Math.min(readings[i], readings[j]), readings };
        }
      }
    }

    return { agreed: false, balanceSol: null, readings };
  }

  async getAgreedTokenBalanceUi(
    ownerAddress: string,
    mintAddress: string
  ): Promise<{
    agreed: boolean;
    balanceUi: number | null;
    readings: number[];
    decimals?: number;
    rawAmount?: string;
  }> {
    const owner = new PublicKey(ownerAddress);
    const mint = new PublicKey(mintAddress);
    const ordered = this.getOrderedConnections().slice(0, 3);
    const readings: number[] = [];
    const rawDetails: Array<{ ui: number; rawBigInt: bigint; decimals?: number }> = [];

    await Promise.all(
      ordered.map(async ({ ep, conn }) => {
        const start = Date.now();
        try {
          const resp = await Promise.race([
            conn.getParsedTokenAccountsByOwner(owner, { mint }, 'confirmed'),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('RPC timeout')), 5000)),
          ]);
          let total = 0;
          let totalRaw = 0n;
          let parsedDecimals: number | undefined;
          for (const acc of resp.value) {
            const parsed = acc.account.data.parsed as {
              info?: {
                tokenAmount?: {
                  uiAmount?: number | null;
                  amount?: string;
                  decimals?: number;
                };
              };
            };
            total += parsed?.info?.tokenAmount?.uiAmount ?? 0;
            if (parsed?.info?.tokenAmount?.amount) {
              try {
                totalRaw += BigInt(parsed.info.tokenAmount.amount);
              } catch {
                // ignore malformed amount
              }
            }
            if (typeof parsed?.info?.tokenAmount?.decimals === 'number') {
              parsedDecimals = parsed.info.tokenAmount.decimals;
            }
          }
          const h = this.healthMap.get(ep.url);
          if (h) {
            this.endpointCooldownUntil.delete(ep.url);
            this.healthMap.set(ep.url, {
              ...h,
              healthy: true,
              latencyMs: Date.now() - start,
              lastCheckedMs: Date.now(),
              lastError: null,
            });
          }
          readings.push(total);
          rawDetails.push({ ui: total, rawBigInt: totalRaw, decimals: parsedDecimals });
        } catch (err) {
          this.recordEndpointError(ep.url, err instanceof Error ? err.message : String(err));
        }
      })
    );

    if (readings.length < 2) {
      const single = rawDetails[0];
      return {
        agreed: false,
        balanceUi: single ? single.ui : null,
        readings,
        decimals: single?.decimals,
        rawAmount: single && single.rawBigInt > 0n ? single.rawBigInt.toString() : undefined,
      };
    }

    for (let i = 0; i < rawDetails.length; i++) {
      for (let j = i + 1; j < rawDetails.length; j++) {
        const diff = Math.abs(rawDetails[i].ui - rawDetails[j].ui);
        const tol = Math.max(1e-9, Math.max(rawDetails[i].ui, rawDetails[j].ui) * 0.001);
        if (diff <= tol) {
          const minIdx = rawDetails[i].ui <= rawDetails[j].ui ? i : j;
          const chosen = rawDetails[minIdx];
          return {
            agreed: true,
            balanceUi: chosen.ui,
            readings,
            decimals: chosen.decimals,
            rawAmount: chosen.rawBigInt > 0n ? chosen.rawBigInt.toString() : undefined,
          };
        }
      }
    }

    const fallback = rawDetails[0];
    return {
      agreed: false,
      balanceUi: fallback ? fallback.ui : null,
      readings,
      decimals: fallback?.decimals,
      rawAmount: fallback && fallback.rawBigInt > 0n ? fallback.rawBigInt.toString() : undefined,
    };
  }

  async getAgreedSignatureConfirmation(
    signature: string
  ): Promise<{ confirmed: boolean; err: string | null; agreements: number }> {
    const ordered = this.getOrderedConnections().slice(0, 3);
    if (ordered.length === 0) {
      return { confirmed: false, err: null, agreements: 0 };
    }

    let confirmedCount = 0;
    let errorCount = 0;
    let respondedCount = 0;
    let completed = 0;
    let lastErr: string | null = null;
    const quorum = Math.min(2, ordered.length);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: { confirmed: boolean; err: string | null; agreements: number }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const checkFinal = () => {
        if (confirmedCount >= quorum) {
          finish({ confirmed: true, err: null, agreements: confirmedCount });
          return;
        }
        if (errorCount >= quorum) {
          finish({
            confirmed: false,
            err: lastErr ?? 'On-chain transaction error',
            agreements: errorCount,
          });
          return;
        }
        if (completed >= ordered.length) {
          // If only 1 healthy RPC responded and confirmed with zero errors, accept it instead of stalling
          if (confirmedCount >= 1 && errorCount === 0 && respondedCount === 1) {
            finish({ confirmed: true, err: null, agreements: confirmedCount });
            return;
          }
          if (errorCount >= 1 && confirmedCount === 0 && respondedCount === errorCount) {
            finish({
              confirmed: false,
              err: lastErr ?? 'On-chain transaction error',
              agreements: errorCount,
            });
            return;
          }
          finish({ confirmed: false, err: null, agreements: confirmedCount });
        }
      };

      for (const { ep, conn } of ordered) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const statusPromise = conn
          .getSignatureStatuses([signature], { searchTransactionHistory: true })
          .finally(() => {
            if (timer !== undefined) clearTimeout(timer);
          });
        const timeoutPromise = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('RPC timeout')), 1800);
        });

        Promise.race([statusPromise, timeoutPromise])
          .then((statusResp) => {
            respondedCount += 1;
            const st = statusResp?.value?.[0];
            if (st) {
              if (st.err) {
                errorCount += 1;
                lastErr = JSON.stringify(st.err);
              } else if (
                st.confirmationStatus === 'confirmed' ||
                st.confirmationStatus === 'finalized'
              ) {
                confirmedCount += 1;
              }
            }
          })
          .catch((err) => {
            this.recordEndpointError(ep.url, err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            completed += 1;
            checkFinal();
          });
      }
    });
  }

  private async rpcJsonPost<T>(
    url: string,
    method: string,
    params: unknown[],
    timeoutMs = 5500
  ): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (json.error) {
      throw new Error(`RPC ${json.error.code ?? ''}: ${json.error.message ?? 'Error'}`);
    }
    return json.result as T;
  }

  async inspectTokenOnChain(mintAddress: string): Promise<OnChainTokenInspection> {
    // Validate base58 mint format early
    new PublicKey(mintAddress);

    interface ParsedAccountRpcResult {
      value: {
        owner: string;
        data?: {
          parsed?: {
            info?: {
              decimals?: number;
              supply?: string;
              mintAuthority?: string | null;
              freezeAuthority?: string | null;
              extensions?: Array<{ extension?: string; state?: Record<string, unknown> }>;
            };
          };
        };
      } | null;
    }

    // Step 1: Authoritative single-call on-chain mint & Token-2022 extension check
    const ordered = this.getOrderedConnections();
    let mintMeta: {
      ownerProgram: string;
      decimals: number;
      supplyUi: number;
      mintAuthorityRevoked: boolean;
      freezeAuthorityRevoked: boolean;
      disallowedExtensions: string[];
    } | null = null;
    let lastError: Error | null = null;

    for (const { ep } of ordered) {
      const start = Date.now();
      const health = this.healthMap.get(ep.url)!;
      try {
        const result = await this.rpcJsonPost<ParsedAccountRpcResult>(ep.url, 'getAccountInfo', [
          mintAddress,
          { encoding: 'jsonParsed', commitment: 'confirmed' },
        ]);
        if (!result?.value) {
          throw new Error(`Mint account not found on-chain: ${mintAddress}`);
        }

        const ownerProgram = result.value.owner;
        const isToken2022 = ownerProgram === TOKEN_2022_PROGRAM_ID.toBase58();
        const info = result.value.data?.parsed?.info;
        if (!info || typeof info.decimals !== 'number') {
          throw new Error(`Account is not a valid SPL/Token-2022 mint: ${mintAddress}`);
        }

        const disallowedExtensions: string[] = [];
        if (isToken2022 && Array.isArray(info.extensions)) {
          for (const ext of info.extensions) {
            const name = ext.extension ?? '';
            if (
              name === 'transferFeeConfig' ||
              name === 'nonTransferable' ||
              name === 'permanentDelegate' ||
              name === 'transferHook'
            ) {
              disallowedExtensions.push(name);
            }
          }
        }

        const supplyRaw = Number(info.supply ?? 0);
        const supplyUi = info.decimals >= 0 ? supplyRaw / 10 ** info.decimals : 0;

        this.healthMap.set(ep.url, {
          ...health,
          healthy: true,
          latencyMs: Date.now() - start,
          lastCheckedMs: Date.now(),
          lastError: null,
        });

        mintMeta = {
          ownerProgram,
          decimals: info.decimals,
          supplyUi,
          mintAuthorityRevoked: info.mintAuthority === null || info.mintAuthority === undefined,
          freezeAuthorityRevoked: info.freezeAuthority === null || info.freezeAuthority === undefined,
          disallowedExtensions,
        };
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;
        // Mark unhealthy on network/5xx errors, keep silent on per-method 429/403
        if (!msg.includes('HTTP 403') && !msg.includes('HTTP 429')) {
          this.healthMap.set(ep.url, {
            ...health,
            healthy: false,
            errorCount: health.errorCount + 1,
            lastCheckedMs: Date.now(),
            lastError: msg,
          });
        }
      }
    }

    if (!mintMeta) {
      throw lastError ?? new Error(`All Solana RPC endpoints failed for mint ${mintAddress}`);
    }

    // Step 2: Best-effort on-chain holder concentration (public RPCs often 403/429 getTokenLargestAccounts;
    // when unavailable, security gate relies on RugCheck topHolders + knownAccounts).
    const holders: HolderAccountInfo[] = [];
    let holderInspectionAvailable = false;
    const now = Date.now();

    if (mintMeta.supplyUi > 0) {
      for (const { ep } of ordered) {
        const cooldownUntil = this.largestAccountsCooldownUntil.get(ep.url) ?? 0;
        if (now < cooldownUntil) continue;
        try {
          const largestResp = await this.rpcJsonPost<{
            value: Array<{ address: string; uiAmount: number | null }>;
          }>(ep.url, 'getTokenLargestAccounts', [mintAddress, { commitment: 'confirmed' }], 4500);

          const topAccounts = (largestResp?.value ?? []).slice(0, 15);
          if (topAccounts.length > 0) {
            const multiResp = await this.rpcJsonPost<{
              value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null>;
            }>(
              ep.url,
              'getMultipleAccounts',
              [topAccounts.map((a) => a.address), { encoding: 'jsonParsed', commitment: 'confirmed' }],
              4500
            );

            topAccounts.forEach((acc, idx) => {
              const amount = Number(acc.uiAmount ?? 0);
              const pct = (amount / mintMeta!.supplyUi) * 100;
              const ownerAddr = multiResp?.value?.[idx]?.data?.parsed?.info?.owner ?? '';
              const isExcluded =
                KNOWN_POOL_OR_BURN_OWNERS.has(ownerAddr) ||
                KNOWN_POOL_OR_BURN_OWNERS.has(acc.address) ||
                ownerAddr.includes('11111111111111111');

              holders.push({
                address: acc.address,
                amount,
                pct,
                isExcludedPoolOrBurn: isExcluded,
                label: isExcluded ? 'Pool / Burn / Program' : undefined,
              });
            });
            holderInspectionAvailable = true;
            break;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Silently back off endpoints that restrict or rate-limit getTokenLargestAccounts
          const backoffMs = msg.includes('403') || msg.includes('-32012') ? 10 * 60_000 : 45_000;
          this.largestAccountsCooldownUntil.set(ep.url, now + backoffMs);
        }
      }
    }

    const nonPoolHolders = holders.filter((h) => !h.isExcludedPoolOrBurn);
    const top10HoldersPct = nonPoolHolders.slice(0, 10).reduce((acc, h) => acc + h.pct, 0);
    const singleMaxHolderPct = nonPoolHolders.length > 0 ? nonPoolHolders[0].pct : 0;

    return {
      mint: mintAddress,
      decimals: mintMeta.decimals,
      programId: mintMeta.ownerProgram,
      isToken2022: mintMeta.ownerProgram === TOKEN_2022_PROGRAM_ID.toBase58(),
      mintAuthorityRevoked: mintMeta.mintAuthorityRevoked,
      freezeAuthorityRevoked: mintMeta.freezeAuthorityRevoked,
      disallowedExtensions: mintMeta.disallowedExtensions,
      supplyUi: mintMeta.supplyUi,
      holderInspectionAvailable,
      top10HoldersPct,
      singleMaxHolderPct,
      holders,
    };
  }
}
