import {
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createCloseAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type {
  BotSettings,
  CandidateToken,
  ExitReason,
  ExplanationRecord,
  PositionRecord,
  TradeRecord,
} from '../types';
import type { BotDatabase } from '../store/db';
import type { ServerSignerManager } from '../security/signer';
import type { SolanaRpcPool } from '../providers/rpcPool';
import type { JupiterProvider, JupiterQuoteResponse } from '../providers/jupiter';
import { WSOL_MINT } from '../providers/jupiter';
import {
  ATA_RENT_SOL,
  computeBreakEvenPrices,
  computeEntryFees,
  computeExitFees,
  resolvePriorityFeeSol,
  snapshotExitParams,
} from './fees';

export interface ExecutionProgressEvent {
  mint: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  step: 'quote' | 'build' | 'sign' | 'send' | 'confirm' | 'reconcile' | 'done' | 'error';
  message: string;
  txSig?: string;
  timestampMs: number;
}

export interface LiveTxAdapter {
  sendSignedTransaction: (
    rawTx: Uint8Array,
    maxRetries: number
  ) => Promise<string>;
  pollConfirmation: (
    signature: string,
    timeoutMs: number
  ) => Promise<{ status: 'confirmed' | 'failed' | 'timeout'; err?: string }>;
  reconcileParsedSwapSolDelta: (
    signature: string,
    ownerAddress: string
  ) => Promise<{ found: boolean; solDeltaLamports: number; feeLamports: number }>;
  findRecentSellSignature: (
    ownerAddress: string,
    mintAddress: string
  ) => Promise<string | null>;
}

export class DefaultLiveTxAdapter implements LiveTxAdapter {
  constructor(private readonly rpcPool: SolanaRpcPool) {}

  async sendSignedTransaction(rawTx: Uint8Array, maxRetries: number): Promise<string> {
    return this.rpcPool.withFailover(async (conn) => {
      const sig = await conn.sendRawTransaction(rawTx, {
        skipPreflight: false,
        maxRetries: BigInt(maxRetries),
        preflightCommitment: 'confirmed',
      });
      return sig;
    });
  }

  async pollConfirmation(
    signature: string,
    timeoutMs: number
  ): Promise<{ status: 'confirmed' | 'failed' | 'timeout'; err?: string }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await this.rpcPool.getAgreedSignatureConfirmation(signature);
      if (res.confirmed) return { status: 'confirmed' };
      if (res.err) return { status: 'failed', err: res.err };
      await new Promise((r) => setTimeout(r, 2500));
    }
    return { status: 'timeout' };
  }

  async reconcileParsedSwapSolDelta(
    signature: string,
    ownerAddress: string
  ): Promise<{ found: boolean; solDeltaLamports: number; feeLamports: number }> {
    try {
      return await this.rpcPool.withFailover(async (conn) => {
        const tx = await conn.getParsedTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || !tx.meta) {
          return { found: false, solDeltaLamports: 0, feeLamports: 5000 };
        }
        const keys = tx.transaction.message.accountKeys.map((k) => String(k.pubkey.toBase58()));
        const idx = keys.indexOf(ownerAddress);
        const feeLamports = Number(tx.meta.fee);
        if (idx < 0) {
          return { found: false, solDeltaLamports: 0, feeLamports };
        }
        const pre = Number(tx.meta.preBalances[idx] ?? 0);
        const post = Number(tx.meta.postBalances[idx] ?? 0);
        return {
          found: true,
          solDeltaLamports: post - pre,
          feeLamports,
        };
      });
    } catch {
      return { found: false, solDeltaLamports: 0, feeLamports: 5000 };
    }
  }

  async findRecentSellSignature(ownerAddress: string, mintAddress: string): Promise<string | null> {
    try {
      return await this.rpcPool.withFailover(async (conn) => {
        const sigs = await conn.getSignaturesForAddress(
          new PublicKey(ownerAddress),
          { limit: 15 }
        );
        for (const info of sigs) {
          if (info.err) continue;
          const tx = await conn.getParsedTransaction(info.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });
          if (!tx?.meta) continue;
          const preToken = tx.meta.preTokenBalances?.find(
            (b) => b.mint === mintAddress && b.owner === ownerAddress
          );
          const postToken = tx.meta.postTokenBalances?.find(
            (b) => b.mint === mintAddress && b.owner === ownerAddress
          );
          const preUi = Number(preToken?.uiTokenAmount?.uiAmount ?? 0);
          const postUi = Number(postToken?.uiTokenAmount?.uiAmount ?? 0);
          if (preUi > postUi) {
            return info.signature;
          }
        }
        return null;
      });
    } catch {
      return null;
    }
  }
}

export class LiveExecutionEngine {
  private readonly txAdapter: LiveTxAdapter;

  constructor(
    private readonly db: BotDatabase,
    private readonly signer: ServerSignerManager,
    private readonly rpcPool: SolanaRpcPool,
    private readonly jupiter: JupiterProvider,
    private readonly emitProgress: (ev: ExecutionProgressEvent) => void,
    txAdapter?: LiveTxAdapter
  ) {
    this.txAdapter = txAdapter ?? new DefaultLiveTxAdapter(rpcPool);
  }

  async executeLiveBuy(params: {
    token: CandidateToken;
    solAmount: number;
    solPriceUsd: number;
    settings: BotSettings;
    explanation: ExplanationRecord;
    decimals: number;
    quote: JupiterQuoteResponse;
    confirmationWaitMs?: number;
  }): Promise<{ ok: boolean; position?: PositionRecord; error?: string }> {
    const { token, solAmount, solPriceUsd, settings, explanation, decimals, quote } = params;
    const owner = this.signer.getPublicKey();
    if (!this.signer.isUnlocked() || !owner) {
      return { ok: false, error: 'Server signer is not unlocked for live execution.' };
    }

    // Never rebuy if already attempted
    if (this.db.isMintAttempted(token.mint, 'live')) {
      return { ok: false, error: `Mint ${token.symbol} already in persisted attempted set.` };
    }

    // Check existing on-chain balance BEFORE any buy; never rebuy
    const preBalance = await this.rpcPool.getAgreedTokenBalanceUi(owner, token.mint);
    if (preBalance.agreed && (preBalance.balanceUi ?? 0) > 0) {
      this.db.insertLog(
        'WARN',
        'LIVE_ENGINE',
        `Detected existing on-chain balance (${preBalance.balanceUi}) for ${token.symbol}; adopting or skipping rebuy.`
      );
      return { ok: false, error: `On-chain balance already held for ${token.symbol}; rebuy blocked.` };
    }

    const quotedTokensOut = Number(quote.outAmount) / 10 ** decimals;
    const quotedPriceUsd = quotedTokensOut > 0 ? (solAmount / quotedTokensOut) * solPriceUsd : token.priceUsd;

    this.emitProgress({
      mint: token.mint,
      symbol: token.symbol,
      side: 'BUY',
      step: 'build',
      message: `Building Jupiter swap for ${solAmount.toFixed(4)} SOL`,
      timestampMs: Date.now(),
    });

    const priorityFeeSol = resolvePriorityFeeSol(settings);
    const priorityFeeLamports = Math.round(priorityFeeSol * LAMPORTS_PER_SOL);

    let swapTxResp;
    try {
      swapTxResp = await this.jupiter.buildSwapTransaction({
        quoteResponse: quote,
        userPublicKey: owner,
        priorityFeeLamports,
      });
    } catch (err) {
      return {
        ok: false,
        error: `Jupiter swap build failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    this.emitProgress({
      mint: token.mint,
      symbol: token.symbol,
      side: 'BUY',
      step: 'sign',
      message: 'Signing transaction with server keypair',
      timestampMs: Date.now(),
    });

    const txBytes = Buffer.from(swapTxResp.swapTransaction, 'base64');
    const versionedTx = VersionedTransaction.deserialize(txBytes);
    await this.signer.signVersionedTransaction(versionedTx);
    const rawSigned = versionedTx.serialize();

    // Persist to attempted_mints BEFORE sending
    this.db.markMintAttempted(token.mint, 'live', 'SENDING');

    this.emitProgress({
      mint: token.mint,
      symbol: token.symbol,
      side: 'BUY',
      step: 'send',
      message: 'Submitting transaction (skipPreflight=false)',
      timestampMs: Date.now(),
    });

    let sig: string;
    try {
      sig = await this.txAdapter.sendSignedTransaction(rawSigned, 3);
      this.db.markMintAttempted(token.mint, 'live', 'SENT', sig);
    } catch (err) {
      this.db.markMintAttempted(token.mint, 'live', 'SEND_FAILED');
      return {
        ok: false,
        error: `Transaction submission failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    this.emitProgress({
      mint: token.mint,
      symbol: token.symbol,
      side: 'BUY',
      step: 'confirm',
      message: 'Confirming transaction across RPC pool',
      txSig: sig,
      timestampMs: Date.now(),
    });

    const nowMs = Date.now();
    const posId = `live_pos_${nowMs}_${token.mint.slice(0, 6)}`;
    const estEntryFees = computeEntryFees({
      solAmount,
      settings,
      quote,
      needsAtaRent: true,
    });
    const estBreakEven = computeBreakEvenPrices({
      entryPriceUsd: quotedPriceUsd,
      entryPriceSol: quotedPriceUsd / solPriceUsd,
      solIn: solAmount,
      entryFeesSol: estEntryFees.totalSol - estEntryFees.ataRentSol,
      entryRentSol: estEntryFees.ataRentSol,
      estimatedExitFeesSol: estEntryFees.totalSol - estEntryFees.ataRentSol,
    });

    // Create initial PENDING position immediately so timeout never leaves an untracked buy
    const pendingPos: PositionRecord = {
      id: posId,
      mode: 'live',
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      source: token.source,
      dex: token.dex,
      tokenClass: explanation.tokenClass,
      status: 'PENDING',
      openedAtMs: nowMs,
      updatedAtMs: nowMs,
      tokenAgeAtEntryMin: Math.max(0, (nowMs - token.poolCreatedAtMs) / 60_000),
      decimals,
      quantity: quotedTokensOut,
      entryPriceUsd: quotedPriceUsd,
      entryPriceSol: quotedPriceUsd / solPriceUsd,
      currentPriceUsd: quotedPriceUsd,
      currentPriceSol: quotedPriceUsd / solPriceUsd,
      breakEvenPriceUsd: estBreakEven.breakEvenPriceUsd,
      breakEvenPriceSol: estBreakEven.breakEvenPriceSol,
      entryLiquidityUsd: token.liquidityUsd,
      currentLiquidityUsd: token.liquidityUsd,
      solIn: solAmount,
      entryFeesSol: estEntryFees.totalSol - estEntryFees.ataRentSol,
      entryRentSol: estEntryFees.ataRentSol,
      solPriceUsdAtEntry: solPriceUsd,
      peakPriceUsd: quotedPriceUsd,
      peakPnlPct: 0,
      trailingFloorPct: null,
      trailingArmed: false,
      gapDownTriggered: false,
      exitParams: snapshotExitParams(settings, estBreakEven.roundTripCostPct),
      txBuy: sig,
      confirmationLabel: 'est.',
      qualityScore: explanation.qualityScore,
      tradeScore: explanation.tradeScore,
      explanationJson: JSON.stringify(explanation),
      sellAttempts: 0,
      firstSellFailureAtMs: null,
      lastSellError: null,
      consecutiveZeroBalanceReads: 0,
      reviewReason: null,
      isStaleData: false,
      priceHistory: [quotedPriceUsd],
    };
    this.db.upsertPosition(pendingPos);

    // Wait for confirmation (initial fast window; if timeout, keep polling up to 120s in reconcile)
    const waitMs = params.confirmationWaitMs ?? 20_000;
    const conf = await this.txAdapter.pollConfirmation(sig, waitMs);
    if (conf.status === 'failed') {
      this.db.upsertPosition({ ...pendingPos, status: 'CLOSED', reviewReason: conf.err ?? 'Tx failed' });
      this.db.markMintAttempted(token.mint, 'live', 'CONFIRMED_FAILED', sig);
      return { ok: false, error: conf.err ?? 'Transaction failed on-chain' };
    }

    if (conf.status === 'timeout') {
      // Confirmation timeout is NEVER a failure: keep polling for 120s and reconcile
      this.emitProgress({
        mint: token.mint,
        symbol: token.symbol,
        side: 'BUY',
        step: 'reconcile',
        message: 'Confirmation timeout — polling for 120s and reconciling on-chain balance',
        txSig: sig,
        timestampMs: Date.now(),
      });
      const lateConf = await this.txAdapter.pollConfirmation(sig, 120_000);
      if (lateConf.status === 'failed') {
        this.db.upsertPosition({ ...pendingPos, status: 'CLOSED', reviewReason: lateConf.err ?? 'Tx failed' });
        return { ok: false, error: lateConf.err ?? 'Transaction failed during 120s reconciliation' };
      }
      if (lateConf.status === 'timeout') {
        // Still verify if balance landed on-chain
        const balCheck = await this.rpcPool.getAgreedTokenBalanceUi(owner, token.mint);
        if (!balCheck.agreed || (balCheck.balanceUi ?? 0) <= 0) {
          this.db.upsertPosition({
            ...pendingPos,
            status: 'NEEDS_REVIEW',
            reviewReason: 'Confirmation timed out after 120s; manual signature check required',
          });
          return { ok: false, error: 'Confirmation timed out after 120s; marked NEEDS REVIEW' };
        }
      }
    }

    // Reconcile actual on-chain balance & real SOL spent
    const reconciled = await this.reconcileConfirmedBuy({
      pendingPos,
      owner,
      sig,
      quotedPriceUsd,
      solPriceUsd,
      settings,
    });

    this.emitProgress({
      mint: token.mint,
      symbol: token.symbol,
      side: 'BUY',
      step: 'done',
      message: `Buy confirmed: ${reconciled.quantity.toFixed(4)} ${token.symbol}`,
      txSig: sig,
      timestampMs: Date.now(),
    });

    return { ok: true, position: reconciled };
  }

  private async reconcileConfirmedBuy(params: {
    pendingPos: PositionRecord;
    owner: string;
    sig: string;
    quotedPriceUsd: number;
    solPriceUsd: number;
    settings: BotSettings;
  }): Promise<PositionRecord> {
    const { pendingPos, owner, sig, quotedPriceUsd, solPriceUsd, settings } = params;

    const [balCheck, txDelta] = await Promise.all([
      this.rpcPool.getAgreedTokenBalanceUi(owner, pendingPos.mint),
      this.txAdapter.reconcileParsedSwapSolDelta(sig, owner),
    ]);

    const realQuantity =
      balCheck.agreed && (balCheck.balanceUi ?? 0) > 0
        ? balCheck.balanceUi!
        : pendingPos.quantity;

    let realSolSpent = pendingPos.solIn;
    let realFeesSol = pendingPos.entryFeesSol;
    if (txDelta.found && txDelta.solDeltaLamports < 0) {
      const totalOutSol = Math.abs(txDelta.solDeltaLamports) / LAMPORTS_PER_SOL;
      const networkFeeSol = txDelta.feeLamports / LAMPORTS_PER_SOL;
      const rentSol = ATA_RENT_SOL;
      realSolSpent = Math.max(0.0001, totalOutSol - networkFeeSol - rentSol);
      realFeesSol = networkFeeSol;
    }

    const realEntryPriceSol = realQuantity > 0 ? realSolSpent / realQuantity : pendingPos.entryPriceSol;
    const realEntryPriceUsd = realEntryPriceSol * solPriceUsd;
    const exitFeeEst = computeExitFees({
      estimatedSolOut: realSolSpent,
      settings,
      quote: null,
    });
    const breakEven = computeBreakEvenPrices({
      entryPriceUsd: realEntryPriceUsd,
      entryPriceSol: realEntryPriceSol,
      solIn: realSolSpent,
      entryFeesSol: realFeesSol,
      entryRentSol: pendingPos.entryRentSol,
      estimatedExitFeesSol: exitFeeEst.totalSol,
    });

    const confirmedPos: PositionRecord = {
      ...pendingPos,
      status: 'OPEN',
      updatedAtMs: Date.now(),
      quantity: realQuantity,
      solIn: realSolSpent,
      entryFeesSol: realFeesSol,
      entryPriceSol: realEntryPriceSol,
      entryPriceUsd: realEntryPriceUsd,
      currentPriceSol: realEntryPriceSol,
      currentPriceUsd: realEntryPriceUsd,
      peakPriceUsd: realEntryPriceUsd,
      breakEvenPriceSol: breakEven.breakEvenPriceSol,
      breakEvenPriceUsd: breakEven.breakEvenPriceUsd,
      confirmationLabel: 'confirmed',
    };

    this.db.upsertPosition(confirmedPos);
    this.db.markMintAttempted(pendingPos.mint, 'live', 'CONFIRMED', sig);

    // Record Paper vs Live reality gap
    if (quotedPriceUsd > 0 && realEntryPriceUsd > 0) {
      const gapPct = ((realEntryPriceUsd - quotedPriceUsd) / quotedPriceUsd) * 100;
      this.db.recordPaperVsLiveGap({
        tradeId: confirmedPos.id,
        mint: confirmedPos.mint,
        symbol: confirmedPos.symbol,
        quotedPriceUsd,
        actualFillPriceUsd: realEntryPriceUsd,
        gapPct,
        createdAtMs: Date.now(),
      });
    }

    return confirmedPos;
  }

  /**
   * Verifies external sale ONLY if 3 consecutive zero balance reads from 2 RPC endpoints
   * AND a matching on-chain sell tx is found. Otherwise marks NEEDS_REVIEW.
   */
  async verifyBalanceAndExternalSell(position: PositionRecord): Promise<PositionRecord> {
    const owner = this.signer.getPublicKey();
    if (!owner || position.mode !== 'live' || position.status !== 'OPEN') {
      return position;
    }

    const bal = await this.rpcPool.getAgreedTokenBalanceUi(owner, position.mint);
    if (!bal.agreed) {
      // RPC disagreement or outage: never clear a position on uncertain/single read
      return position;
    }

    if ((bal.balanceUi ?? 0) > 0) {
      if (position.consecutiveZeroBalanceReads !== 0) {
        const resetPos = { ...position, consecutiveZeroBalanceReads: 0, updatedAtMs: Date.now() };
        this.db.upsertPosition(resetPos);
        return resetPos;
      }
      return position;
    }

    // Balance is 0 on two RPC endpoints
    const nextReads = position.consecutiveZeroBalanceReads + 1;
    if (nextReads < 3) {
      const updated = {
        ...position,
        consecutiveZeroBalanceReads: nextReads,
        updatedAtMs: Date.now(),
      };
      this.db.upsertPosition(updated);
      return updated;
    }

    // 3 consecutive zero reads reached: require matching on-chain sell tx
    const sellSig = await this.txAdapter.findRecentSellSignature(owner, position.mint);
    if (!sellSig) {
      const reviewPos: PositionRecord = {
        ...position,
        status: 'NEEDS_REVIEW',
        consecutiveZeroBalanceReads: nextReads,
        reviewReason:
          '3 consecutive zero token balance reads across 2 RPCs, but no matching on-chain sell transaction found.',
        updatedAtMs: Date.now(),
      };
      this.db.upsertPosition(reviewPos);
      this.db.insertLog('WARN', 'RECONCILE', `${position.symbol} marked NEEDS_REVIEW: ${reviewPos.reviewReason}`);
      return reviewPos;
    }

    // Confirmed external sale
    const closedAtMs = Date.now();
    const solOutEst = (position.quantity * position.currentPriceSol);
    const trade: TradeRecord = {
      tradeId: `live_ext_${closedAtMs}_${position.mint.slice(0, 6)}`,
      mode: 'live',
      openedAt: new Date(position.openedAtMs).toISOString(),
      closedAt: new Date(closedAtMs).toISOString(),
      symbol: position.symbol,
      mint: position.mint,
      source: position.source,
      dex: position.dex,
      tokenAgeAtEntry: position.tokenAgeAtEntryMin,
      entryPrice: position.entryPriceUsd,
      exitPrice: position.currentPriceUsd,
      quantity: position.quantity,
      solIn: position.solIn,
      solOut: solOutEst,
      feesSol: position.entryFeesSol,
      rentSol: position.entryRentSol,
      grossPnlSol: solOutEst - position.solIn,
      pnlSol: solOutEst - (position.solIn + position.entryFeesSol + position.entryRentSol),
      pnlUsd: (solOutEst - (position.solIn + position.entryFeesSol + position.entryRentSol)) * position.solPriceUsdAtEntry,
      pnlPct: position.solIn > 0 ? ((solOutEst - position.solIn) / position.solIn) * 100 : 0,
      peakPct: position.peakPnlPct,
      holdSeconds: Math.max(1, Math.round((closedAtMs - position.openedAtMs) / 1000)),
      exitReason: 'SOLD_EXTERNALLY',
      confirmed: 'confirmed',
      txBuy: position.txBuy,
      txSell: sellSig,
      solPriceUsd: position.solPriceUsdAtEntry,
      feeBreakdownJson: JSON.stringify({ note: 'Sold externally on-chain' }),
      archivedSessionId: null,
    };

    const closedPos: PositionRecord = {
      ...position,
      status: 'CLOSED',
      consecutiveZeroBalanceReads: nextReads,
      updatedAtMs: closedAtMs,
    };
    this.db.upsertPosition(closedPos);
    this.db.insertTrade(trade);
    return closedPos;
  }

  /**
   * Evaluates whether a failed live sell may be written off as WRITE_OFF_UNSELLABLE.
   * Strictly requires >= 10 minutes since first sell failure, >= 5 attempts,
   * AND liquidity < $50 from two independent sources.
   */
  canWriteOffUnsellable(params: {
    position: PositionRecord;
    liquiditySource1Usd: number | null;
    liquiditySource2Usd: number | null;
    nowMs?: number;
  }): boolean {
    const nowMs = params.nowMs ?? Date.now();
    const { position, liquiditySource1Usd, liquiditySource2Usd } = params;
    if (position.sellAttempts < 5 || !position.firstSellFailureAtMs) return false;
    const elapsedMs = nowMs - position.firstSellFailureAtMs;
    if (elapsedMs < 10 * 60_000) return false;
    if (liquiditySource1Usd === null || liquiditySource2Usd === null) return false;
    return liquiditySource1Usd < 50 && liquiditySource2Usd < 50;
  }

  async executeLiveSell(params: {
    position: PositionRecord;
    exitReason: ExitReason;
    solPriceUsd: number;
    settings: BotSettings;
    isEmergency: boolean;
    sellFraction?: number;
    triggeredStopLossTier?: number;
    liquiditySource1Usd?: number | null;
    liquiditySource2Usd?: number | null;
  }): Promise<{ ok: boolean; trade?: TradeRecord; position: PositionRecord; error?: string }> {
    const { position, exitReason, solPriceUsd, settings, isEmergency } = params;
    const owner = this.signer.getPublicKey();
    if (!this.signer.isUnlocked() || !owner) {
      return { ok: false, position, error: 'Server signer locked' };
    }

    const clampedFraction = Math.min(1, Math.max(0.01, params.sellFraction ?? 1));
    const isPartial = clampedFraction < 0.999;
    const soldQty = isPartial ? position.quantity * clampedFraction : position.quantity;
    const soldSolIn = isPartial ? position.solIn * clampedFraction : position.solIn;
    const soldEntryFees = isPartial ? position.entryFeesSol * clampedFraction : position.entryFeesSol;
    const soldEntryRent = isPartial ? 0 : position.entryRentSol;

    const attempts = position.sellAttempts + 1;
    const firstFailureAt = position.firstSellFailureAtMs ?? Date.now();
    // Escalate slippage on emergency or retry attempts (capped safely)
    const slippageBps = Math.min(
      2500,
      settings.slippageBps + (isEmergency ? 300 : 0) + (attempts - 1) * 150
    );

    const rawUnits = Math.max(1, Math.floor(soldQty * 10 ** position.decimals));
    const quote = await this.jupiter.getQuote({
      inputMint: position.mint,
      outputMint: WSOL_MINT,
      amountRaw: String(rawUnits),
      slippageBps,
    });

    if (!quote || Number(quote.outAmount) <= 0) {
      const updatedPos: PositionRecord = {
        ...position,
        sellAttempts: attempts,
        firstSellFailureAtMs: firstFailureAt,
        lastSellError: 'No sell route available from Jupiter',
        updatedAtMs: Date.now(),
      };

      if (
        this.canWriteOffUnsellable({
          position: updatedPos,
          liquiditySource1Usd: params.liquiditySource1Usd ?? null,
          liquiditySource2Usd: params.liquiditySource2Usd ?? null,
        })
      ) {
        const closedAtMs = Date.now();
        const trade: TradeRecord = {
          tradeId: `live_wo_${closedAtMs}_${position.mint.slice(0, 6)}`,
          mode: 'live',
          openedAt: new Date(position.openedAtMs).toISOString(),
          closedAt: new Date(closedAtMs).toISOString(),
          symbol: position.symbol,
          mint: position.mint,
          source: position.source,
          dex: position.dex,
          tokenAgeAtEntry: position.tokenAgeAtEntryMin,
          entryPrice: position.entryPriceUsd,
          exitPrice: 0,
          quantity: position.quantity,
          solIn: position.solIn,
          solOut: 0,
          feesSol: position.entryFeesSol,
          rentSol: position.entryRentSol,
          grossPnlSol: -position.solIn,
          pnlSol: -(position.solIn + position.entryFeesSol + position.entryRentSol),
          pnlUsd: -(position.solIn + position.entryFeesSol + position.entryRentSol) * solPriceUsd,
          pnlPct: -100,
          peakPct: position.peakPnlPct,
          holdSeconds: Math.max(1, Math.round((closedAtMs - position.openedAtMs) / 1000)),
          exitReason: 'WRITE_OFF_UNSELLABLE',
          confirmed: 'confirmed',
          txBuy: position.txBuy,
          txSell: null,
          solPriceUsd,
          feeBreakdownJson: JSON.stringify({ note: 'Written off after >=10m, >=5 attempts, <$50 liq on 2 sources' }),
          archivedSessionId: null,
        };
        const closedPos = { ...updatedPos, status: 'CLOSED' as const };
        this.db.upsertPosition(closedPos);
        this.db.insertTrade(trade);
        return { ok: true, trade, position: closedPos };
      }

      this.db.upsertPosition(updatedPos);
      return { ok: false, position: updatedPos, error: 'No sell route available; keeping position open for retry' };
    }

    try {
      const priorityFeeLamports = Math.round(
        resolvePriorityFeeSol(settings) * (isEmergency ? 2 : 1) * LAMPORTS_PER_SOL
      );
      const swapResp = await this.jupiter.buildSwapTransaction({
        quoteResponse: quote,
        userPublicKey: owner,
        priorityFeeLamports,
      });
      const versionedTx = VersionedTransaction.deserialize(
        Buffer.from(swapResp.swapTransaction, 'base64')
      );
      await this.signer.signVersionedTransaction(versionedTx);
      const sig = await this.txAdapter.sendSignedTransaction(versionedTx.serialize(), 3);
      const conf = await this.txAdapter.pollConfirmation(sig, 45_000);
      if (conf.status !== 'confirmed') {
        const retryPos: PositionRecord = {
          ...position,
          sellAttempts: attempts,
          firstSellFailureAtMs: firstFailureAt,
          lastSellError: conf.err ?? `Sell confirmation ${conf.status}`,
          updatedAtMs: Date.now(),
        };
        this.db.upsertPosition(retryPos);
        return { ok: false, position: retryPos, error: retryPos.lastSellError ?? 'Sell pending' };
      }

      const delta = await this.txAdapter.reconcileParsedSwapSolDelta(sig, owner);
      const estSolOut = Number(quote.outAmount) / LAMPORTS_PER_SOL;
      const realSolOut =
        delta.found && delta.solDeltaLamports > 0
          ? delta.solDeltaLamports / LAMPORTS_PER_SOL
          : estSolOut;
      const exitFeeSol = delta.found
        ? delta.feeLamports / LAMPORTS_PER_SOL
        : computeExitFees({ estimatedSolOut: realSolOut, settings, quote }).totalSol;

      const closedAtMs = Date.now();
      const totalFeesSol = soldEntryFees + exitFeeSol;
      const grossPnlSol = realSolOut - soldSolIn;
      const netPnlSol = realSolOut - (soldSolIn + totalFeesSol + soldEntryRent);
      const exitPriceSol = soldQty > 0 ? realSolOut / soldQty : position.currentPriceSol;
      const exitPriceUsd = exitPriceSol * solPriceUsd;

      const trade: TradeRecord = {
        tradeId: `live_tr_${closedAtMs}_${position.mint.slice(0, 6)}`,
        mode: 'live',
        openedAt: new Date(position.openedAtMs).toISOString(),
        closedAt: new Date(closedAtMs).toISOString(),
        symbol: position.symbol,
        mint: position.mint,
        source: position.source,
        dex: position.dex,
        tokenAgeAtEntry: position.tokenAgeAtEntryMin,
        entryPrice: position.entryPriceUsd,
        exitPrice: exitPriceUsd,
        quantity: soldQty,
        solIn: soldSolIn,
        solOut: realSolOut,
        feesSol: totalFeesSol,
        rentSol: soldEntryRent,
        grossPnlSol,
        pnlSol: netPnlSol,
        pnlUsd: netPnlSol * solPriceUsd,
        pnlPct: soldSolIn > 0 ? (netPnlSol / soldSolIn) * 100 : 0,
        peakPct: position.peakPnlPct,
        holdSeconds: Math.max(1, Math.round((closedAtMs - position.openedAtMs) / 1000)),
        exitReason,
        confirmed: 'confirmed',
        txBuy: position.txBuy,
        txSell: sig,
        solPriceUsd,
        feeBreakdownJson: JSON.stringify({
          entryFeesSol: soldEntryFees,
          exitFeeSol,
          partialFraction: isPartial ? clampedFraction : 1,
        }),
        archivedSessionId: null,
      };

      const nextTriggeredTiers =
        params.triggeredStopLossTier !== undefined
          ? Array.from(new Set([...(position.triggeredStopLossTiers ?? []), params.triggeredStopLossTier]))
          : position.triggeredStopLossTiers;

      const remainingQty = Math.max(0, position.quantity - soldQty);
      if (isPartial && remainingQty > 0) {
        const partialPos: PositionRecord = {
          ...position,
          status: 'OPEN',
          quantity: remainingQty,
          solIn: Math.max(0, position.solIn - soldSolIn),
          entryFeesSol: Math.max(0, position.entryFeesSol - soldEntryFees),
          triggeredStopLossTiers: nextTriggeredTiers,
          currentPriceUsd: exitPriceUsd,
          currentPriceSol: exitPriceSol,
          updatedAtMs: closedAtMs,
        };
        this.db.upsertPosition(partialPos);
        this.db.insertTrade(trade);
        return { ok: true, trade, position: partialPos };
      }

      const closedPos: PositionRecord = {
        ...position,
        status: 'CLOSED',
        triggeredStopLossTiers: nextTriggeredTiers,
        currentPriceUsd: exitPriceUsd,
        currentPriceSol: exitPriceSol,
        updatedAtMs: closedAtMs,
      };
      this.db.upsertPosition(closedPos);
      this.db.insertTrade(trade);
      this.db.setCooldown(position.mint, 'live', settings.cooldownMinutes);

      if (settings.autoReclaimRent) {
        await this.reclaimEmptyTokenAccounts().catch(() => undefined);
      }

      return { ok: true, trade, position: closedPos };
    } catch (err) {
      const retryPos: PositionRecord = {
        ...position,
        sellAttempts: attempts,
        firstSellFailureAtMs: firstFailureAt,
        lastSellError: err instanceof Error ? err.message : String(err),
        updatedAtMs: Date.now(),
      };
      this.db.upsertPosition(retryPos);
      return { ok: false, position: retryPos, error: retryPos.lastSellError ?? 'Live sell failed' };
    }
  }

  async reclaimEmptyTokenAccounts(): Promise<{ closedCount: number; reclaimedSol: number; txSig: string | null }> {
    const owner = this.signer.getPublicKey();
    if (!this.signer.isUnlocked() || !owner) {
      throw new Error('Server signer must be unlocked to reclaim ATA rent.');
    }

    const ownerPk = new PublicKey(owner);
    const kp = this.signer.getKeypairForInternalSigning();

    return this.rpcPool.withFailover(async (conn) => {
      const [splAccs, t22Accs] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_PROGRAM_ID }),
        conn.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_2022_PROGRAM_ID }),
      ]);

      const emptyClosures: Array<{ pubkey: PublicKey; programId: PublicKey }> = [];
      for (const acc of splAccs.value) {
        const amt = Number(
          (acc.account.data.parsed as { info?: { tokenAmount?: { amount?: string } } })?.info
            ?.tokenAmount?.amount ?? '1'
        );
        if (amt === 0) emptyClosures.push({ pubkey: acc.pubkey, programId: TOKEN_PROGRAM_ID });
      }
      for (const acc of t22Accs.value) {
        const amt = Number(
          (acc.account.data.parsed as { info?: { tokenAmount?: { amount?: string } } })?.info
            ?.tokenAmount?.amount ?? '1'
        );
        if (amt === 0) emptyClosures.push({ pubkey: acc.pubkey, programId: TOKEN_2022_PROGRAM_ID });
      }

      if (emptyClosures.length === 0) {
        return { closedCount: 0, reclaimedSol: 0, txSig: null };
      }

      const batch = emptyClosures.slice(0, 10);
      const tx = new Transaction();
      for (const item of batch) {
        tx.add(createCloseAccountInstruction(item.pubkey, ownerPk, ownerPk, [], item.programId));
      }
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = ownerPk;
      await tx.sign(kp);
      const serialized = await tx.serialize();
      const sig = await conn.sendRawTransaction(serialized, { skipPreflight: false });
      return {
        closedCount: batch.length,
        reclaimedSol: Number((batch.length * ATA_RENT_SOL).toFixed(6)),
        txSig: sig,
      };
    });
  }
}
