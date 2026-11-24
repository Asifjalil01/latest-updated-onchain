export type ExecutionMode = 'paper' | 'testnet' | 'live';
export type BotRunState = 'stopped' | 'running' | 'killing';
export type TokenClass = 'bluechip' | 'mid_cap' | 'early_stage' | 'meme' | 'high_risk_micro';
export type ConfirmationLabel = 'confirmed' | 'simulated' | 'est.';
export type PriorityFeePreset = 'auto' | 'standard' | 'high' | 'ultra' | 'custom';
export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export type ExitReason =
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TRAILING_STOP'
  | 'BREAK_EVEN_RECOVERY'
  | 'MAX_HOLD_STAGNATION'
  | 'EMERGENCY_LIQUIDITY_DRAIN'
  | 'EMERGENCY_TAX_SPIKE'
  | 'EMERGENCY_TRADING_DISABLED'
  | 'EMERGENCY_OWNER_TAKEOVER'
  | 'EMERGENCY_LIQUIDITY_FLOOR'
  | 'SMART_MONEY_SELL'
  | 'MANUAL_SELL'
  | 'KILL_SWITCH'
  | 'SLOT_ROTATION'
  | 'WRITE_OFF_UNSELLABLE'
  | 'SOLD_EXTERNALLY';

export interface TrailingTier {
  peakGainPct: number;
  allowedDropPct: number;
}

export interface StopLossTier {
  triggerDropPct: number;
  sellPct: number;
}

export type SolRegimeAction = 'pause' | 'half_size';
export type StreakThrottleAction = 'half_size' | 'pause';

export interface BotSettings {
  // Sizing & Risk
  tradeSizeSol: number;
  maxPositionSizeSol: number;
  maxWalletExposureSol: number;
  gasReserveSol: number;
  dailyLossLimitSol: number;
  maxOpenPositions: number;
  cooldownMinutes: number;
  allowSlotRotation: boolean;
  slotRotationMinScoreDelta: number;
  autoReclaimRent: boolean;
  priorityFeePreset: PriorityFeePreset;
  customPriorityFeeSol: number;
  maxPriorityFeeSol: number;
  slippageBps: number;

  // Hard Filters
  minPoolAgeMinutes: number;
  maxPoolAgeDays: number;
  customAgeWindowEnabled: boolean;
  customMinPoolAgeMinutes: number;
  customMaxPoolAgeMinutes: number;
  newLaunchOnlyEnabled: boolean;
  newLaunchMinAgeSeconds: number;
  newLaunchMaxAgeSeconds: number;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  minTx24h: number;
  minUniqueTraders24h: number;
  maxVolumeLiquidityRatio: number;
  maxFdvLiquidityRatio: number;
  minPriceChange1hPct: number;
  minPriceChange24hPct: number;
  maxPriceChange1hPct: number;
  minBuyRatio: number;
  maxPlannedPriceImpactPct: number;

  // Security
  maxRugCheckRiskScore: number;
  minLpLockedOrBurnedPct: number;
  enforceMaxTop10Holders: boolean;
  maxTop10HoldersPct: number;
  maxSingleHolderPct: number;
  maxSellRouteImpactPct: number;
  creatorHistoryEnabled: boolean;
  maxCreatorLaunches: number;
  maxCreatorRuggedCoins: number;
  creatorFastRugWindowMinutes: number;

  // Scoring
  enforceMinScores: boolean;
  minQualityScore: number;
  minTradeScore: number;

  // Discovery
  enableDexScreenerBoosts: boolean;
  enablePumpPortalWs: boolean;
  scanIntervalSeconds: number;

  // Exits (snapshotted on each position at entry)
  stopLossEnabled: boolean;
  stopLossPct: number;
  stopLossTiers: StopLossTier[];
  takeProfitPct: number;
  trailingEnabled: boolean;
  trailingLadder: TrailingTier[];
  breakEvenRecoveryEnabled: boolean;
  maxHoldMinutes: number;
  maxHoldStagnationEnabled: boolean;
  stagnationMinGainPct: number;
  emergencyLiquidityFloorUsd: number;
  emergencyLiquidityDrainPct: number;
  emergencyMaxSellTaxPct: number;

  // Paper Realism
  paperDelayMinSec: number;
  paperDelayMaxSec: number;
  paperDefaultDelaySec: number;
  paperBuyFailChancePct: number;
  paperSellFailChancePct: number;
  paperCompetitionPenaltyPct: number;
  applyMeasuredGapToPaper: boolean;
  paperInitialBalanceSol: number;

  // Shadow Compare
  shadowCompareEnabled: boolean;
  shadowLiveSizeSol: number;

  // Pro Desk — Group 1: Deeper Wallet & Scam Intelligence
  antiSybilEnabled: boolean;
  freshWalletMinutes: number;
  maxSharedFunderCount: number;
  smartMoneyEnabled: boolean;
  smartWallets: string[];
  smartMoneyMinConfluence: number;
  smartMoneySizeBoostPct: number;
  smartMoneyAutoExitOnSell: boolean;
  reusedSocialsEnabled: boolean;
  maxSocialReuseCount: number;

  // Pro Desk — Group 2: Zero-Lag Exits & MEV / Wallet Sweep
  wsExitStreamEnabled: boolean;
  jitoDontFrontEnabled: boolean;
  jitoTipSol: number;
  orphanSweepEnabled: boolean;

  // Pro Desk — Group 3: Market Structure & Entry Timing
  postMigrationPullbackEnabled: boolean;
  migrationMinDipPct: number;
  migrationWaitSec: number;
  preMigrationCurveEnabled: boolean;
  preMigrationCurveMinPct: number;
  preMigrationCurveMaxPct: number;
  washTradeFilterEnabled: boolean;
  minUniqueMakersRatio: number;
  minUniqueTraders5m: number;
  solRegimeFilterEnabled: boolean;
  solRegimeMaxDropPct: number;
  solRegimeAction: SolRegimeAction;
  antiTopWickEnabled: boolean;
  maxShortSpikePct: number;

  // Pro Desk — Group 4: Dynamic Sizing & Capital Efficiency
  convictionSizingEnabled: boolean;
  convictionMinMult: number;
  convictionMaxMult: number;
  streakThrottleEnabled: boolean;
  streakLossLimit: number;
  streakCooldownMinutes: number;
  streakAction: StreakThrottleAction;
  narrativeCapEnabled: boolean;
  maxSameNarrativePositions: number;

  // Per-option enable/disable toggles (omitted or true = active)
  optionToggles?: Record<string, boolean>;
}

export interface PositionExitSnapshot {
  stopLossEnabled: boolean;
  stopLossPct: number;
  stopLossTiers: StopLossTier[];
  takeProfitEnabled?: boolean;
  takeProfitPct: number;
  trailingEnabled: boolean;
  trailingLadder: TrailingTier[];
  breakEvenRecoveryEnabled: boolean;
  maxHoldMinutes: number;
  maxHoldStagnationEnabled: boolean;
  stagnationMinGainPct: number;
  emergencyLiquidityFloorEnabled?: boolean;
  emergencyLiquidityFloorUsd: number;
  emergencyLiquidityDrainPct: number;
  emergencyMaxSellTaxPct: number;
  roundTripCostPct: number;
}

export interface CandidateToken {
  mint: string;
  symbol: string;
  name: string;
  source: string;
  dex: string;
  pairAddress: string;
  poolCreatedAtMs: number;
  priceUsd: number;
  priceSol: number;
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd: number;
  txCount24h: number;
  buys24h: number;
  sells24h: number;
  uniqueTraders24h: number;
  priceChange5mPct?: number;
  priceChange1hPct: number;
  priceChange24hPct: number;
  buys5m?: number;
  sells5m?: number;
  buys1h?: number;
  sells1h?: number;
  socialUrls?: string[];
  uniqueTraders5m?: number;
  realSolInCurve?: number;
  smartWalletBuyers?: string[];
  tokenDecimals?: number;
  isToken2022?: boolean;
  rawUpdatedAtMs: number;
}

export interface HardFilterResult {
  passed: boolean;
  reasons: string[];
  warnings: string[];
  computed: {
    poolAgeMinutes: number;
    volumeLiquidityRatio: number;
    fdvLiquidityRatio: number;
    buyRatio: number;
  };
}

export interface HolderAccountInfo {
  address: string;
  amount: number;
  pct: number;
  isExcludedPoolOrBurn: boolean;
  label?: string;
}

export interface SecurityReport {
  passed: boolean;
  reasons: string[];
  warnings: string[];
  criticalFlags: string[];
  sourcesAgreed: number;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  token2022DisallowedExtensions: string[];
  rugCheckScore: number | null;
  rugCheckRisks: string[];
  lpLockedOrBurnedPct: number | null;
  top10HoldersPct: number | null;
  singleMaxHolderPct: number | null;
  holders: HolderAccountInfo[];
  deployerFlagged: boolean;
  deployerReason?: string;
  creatorAddress?: string | null;
  creatorLaunchCount?: number;
  creatorRuggedCount?: number;
  creatorFastestRugMinutes?: number | null;
  sybilClusterCount?: number;
  sybilSharedFunder?: string | null;
  reusedSocialMatch?: { url: string; priorMints: number; ruggedMints: number } | null;
  smartMoneyBuyers?: string[];
  sellRouteExists: boolean;
  sellRouteImpactPct: number | null;
  sellTaxPct: number | null;
  tradingEnabled: boolean;
  tokenDecimals?: number;
}

export interface ExplanationRecord {
  mint: string;
  symbol: string;
  tokenClass: TokenClass;
  qualityScore: number;
  tradeScore: number;
  combinedScore: number;
  sizeMultiplier: number;
  decision: 'BUY' | 'REJECT';
  stageFailed?: string;
  reasons: string[];
  warnings: string[];
  qualityBreakdown: Record<string, number>;
  tradeBreakdown: Record<string, number>;
  evaluatedAtMs: number;
}

export interface SizingResult {
  approved: boolean;
  reason?: string;
  solAmount: number;
  usdAmount: number;
  tokenClassMultiplier: number;
  cappedBy: string;
}

export interface FeeBreakdown {
  baseFeeSol: number;
  priorityFeeSol: number;
  dexFeeSol: number;
  jupiterPlatformFeeSol: number;
  ataRentSol: number;
  tokenTaxSol: number;
  walletOutFeeSol: number;
  routeLabels?: string[];
  priorityFeeSource?: 'jupiter_auto' | 'rpc_recent' | 'preset' | 'custom';
  rentReclaimedSol?: number;
  totalSol: number;
}

export type PositionStatus =
  | 'OPEN'
  | 'PENDING'
  | 'CLOSING'
  | 'NEEDS_REVIEW'
  | 'CLOSED';

export interface PositionRecord {
  id: string;
  mode: ExecutionMode;
  mint: string;
  symbol: string;
  name: string;
  source: string;
  dex: string;
  tokenClass: TokenClass;
  status: PositionStatus;
  openedAtMs: number;
  updatedAtMs: number;
  tokenAgeAtEntryMin: number;
  decimals: number;
  quantity: number;
  entryPriceUsd: number;
  entryPriceSol: number;
  currentPriceUsd: number;
  currentPriceSol: number;
  breakEvenPriceUsd: number;
  breakEvenPriceSol: number;
  entryLiquidityUsd: number;
  currentLiquidityUsd: number;
  solIn: number;
  entryFeesSol: number;
  entryRentSol: number;
  solPriceUsdAtEntry: number;
  peakPriceUsd: number;
  peakPnlPct: number;
  trailingFloorPct: number | null;
  trailingArmed: boolean;
  gapDownTriggered: boolean;
  exitParams: PositionExitSnapshot;
  txBuy: string | null;
  confirmationLabel: ConfirmationLabel;
  qualityScore: number;
  tradeScore: number;
  explanationJson: string;
  sellAttempts: number;
  firstSellFailureAtMs: number | null;
  lastSellError: string | null;
  consecutiveZeroBalanceReads: number;
  reviewReason: string | null;
  isStaleData: boolean;
  priceHistory: number[];
  triggeredStopLossTiers?: number[];
}

export interface TradeRecord {
  tradeId: string;
  mode: ExecutionMode;
  openedAt: string;
  closedAt: string;
  symbol: string;
  mint: string;
  source: string;
  dex: string;
  tokenAgeAtEntry: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  solIn: number;
  solOut: number;
  feesSol: number;
  rentSol: number;
  grossPnlSol: number;
  pnlSol: number;
  pnlUsd: number;
  pnlPct: number;
  peakPct: number;
  holdSeconds: number;
  exitReason: ExitReason;
  confirmed: ConfirmationLabel;
  txBuy: string | null;
  txSell: string | null;
  solPriceUsd: number;
  feeBreakdownJson: string;
  archivedSessionId: string | null;
}

export interface SeenTokenRecord {
  mint: string;
  symbol: string;
  name: string;
  source: string;
  dex: string;
  firstSeenMs: number;
  lastScannedMs: number;
  lastQualityScore: number;
  lastTradeScore: number;
  timesEvaluated: number;
  lastDecision: 'BUY' | 'REJECT';
  lastReason: string;
  liquidityUsd: number;
  priceUsd: number;
  explanationJson: string;
}

export interface RejectionRecord {
  id: number;
  mint: string;
  symbol: string;
  source: string;
  stage: string;
  reason: string;
  qualityScore: number;
  tradeScore: number;
  createdAtMs: number;
  detailsJson: string;
}

export interface SourceErrorEntry {
  message: string;
  atMs: number;
}

export interface SourceHealthRecord {
  source: string;
  itemsCount: number;
  lastOkMs: number | null;
  errorCount: number;
  lastError: string | null;
  recentErrors?: SourceErrorEntry[];
  rateLimitedUntilMs: number | null;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

export interface RpcEndpointHealth {
  url: string;
  label: string;
  healthy: boolean;
  latencyMs: number;
  slot: number;
  errorCount: number;
  lastCheckedMs: number;
  lastError: string | null;
}

export interface PaperVsLiveGapRecord {
  id: number;
  tradeId: string;
  mint: string;
  symbol: string;
  quotedPriceUsd: number;
  actualFillPriceUsd: number;
  gapPct: number;
  createdAtMs: number;
}

export interface LogEntry {
  id: number;
  severity: LogSeverity;
  category: string;
  message: string;
  metaJson: string | null;
  createdAtMs: number;
}

export interface WalletFeeProfile {
  id: string;
  name: string;
  network: 'Solana' | 'EVM (View Only)';
  tradingSupported: boolean;
  displaySwapFeePct: string;
  typicalPrioritySol: string;
  notes: string;
}

export interface WalletDiagnostics {
  provider: 'server_signer' | 'phantom' | 'solflare' | 'watch_only' | 'none';
  network: 'mainnet-beta' | 'testnet' | 'devnet';
  address: string | null;
  maskedAddress: string | null;
  balanceSol: number | null;
  balanceUsd: number | null;
  signingCapability: 'automated_server' | 'manual_browser_only' | 'read_only' | 'none';
  syncState: 'synced' | 'degraded' | 'unavailable';
  liveReady: boolean;
  liveNotReadyReasons: string[];
  signerUnlocked: boolean;
  keystoreExists: boolean;
  lastRefreshedMs: number;
}

export interface BotStatusSnapshot {
  mode: ExecutionMode;
  runState: BotRunState;
  solPriceUsd: number | null;
  solPriceSource: string;
  paperBalanceSol: number;
  liveBalanceSol: number | null;
  openPositionsCount: number;
  currentExposureSol: number;
  dailyRealizedPnlSol: number;
  dailyLossLimitHit: boolean;
  liveConfirmed: boolean;
  liveConfirmedSettingsHash: string | null;
  lastScanAtMs: number | null;
  funnel: {
    discovered: number;
    validated: number;
    filtered: number;
    securityPassed: number;
    scored: number;
    bought: number;
  };
  averagePaperLiveGapPct: number;
}

export interface AnalyticsSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  grossPnlSol: number;
  netPnlSol: number;
  netPnlUsd: number;
  totalFeesSol: number;
  totalRentSol: number;
  profitFactor: number;
  avgWinSol: number;
  avgLossSol: number;
  maxDrawdownSol: number;
  expectancySol: number;
  byExitReason: Array<{ reason: string; count: number; netPnlSol: number }>;
  bySource: Array<{ source: string; count: number; winRatePct: number; netPnlSol: number }>;
  byHour: Array<{ hour: number; count: number; netPnlSol: number }>;
  equityCurve: Array<{ timestamp: string; cumulativeNetSol: number; drawdownSol: number }>;
}

export interface ExecutionTelemetryRecord {
  id?: number;
  tradeId: string;
  mode: ExecutionMode;
  side: 'BUY' | 'SELL';
  mint: string;
  symbol: string;
  dex: string;
  platform: string;
  quotedPriceUsd: number;
  actualFillPriceUsd: number;
  slippagePct: number;
  latencyMs: number;
  jitoProtected: boolean;
  createdAtMs: number;
}

export interface DexScorecardRow {
  dex: string;
  platform: string;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  avgSlippagePct: number;
  maxSlippagePct: number;
  avgLatencyMs: number;
  winRatePct: number;
  netPnlSol: number;
}

export interface RentAuditAccount {
  pubkey: string;
  mint: string;
  symbol?: string;
  programId: 'spl-token' | 'token-2022';
  amountRaw: string;
  uiAmount: number;
  estValueUsd: number | null;
  estRentSol: number;
  isEmpty: boolean;
  isDust: boolean;
  isOpenPosition: boolean;
}

export interface RentAuditReport {
  walletAddress: string | null;
  emptyCount: number;
  dustCount: number;
  emptyReclaimableSol: number;
  dustReclaimableSol: number;
  accounts: RentAuditAccount[];
  solPriceUsd: number | null;
}

export interface OrphanSweepResult {
  scanned: number;
  adopted: number;
  adoptedSymbols: string[];
  skipped: number;
  errors: string[];
}

export interface BacktestRequest {
  mode?: ExecutionMode;
  lookbackHours?: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingEnabled: boolean;
  trailingDropPct: number;
  minAgeMinutes?: number;
  maxAgeMinutes?: number;
  minLiquidityUsd?: number;
  solRegimeMaxDropPct?: number;
}

export interface BacktestResult {
  sampleSize: number;
  evaluatedTrades: number;
  baselineWinRatePct: number;
  baselineNetPnl: number;
  baselineMaxDrawdown: number;
  simulatedWinRatePct: number;
  simulatedNetPnl: number;
  simulatedMaxDrawdown: number;
  filteredOutCount: number;
  pnlUnit: 'SOL' | 'USD';
  notes: string[];
}

export interface SseEventPayload {
  type:
    | 'status'
    | 'log'
    | 'positions_batch_update'
    | 'trade_event'
    | 'execution_progress'
    | 'rejection'
    | 'wallet_insufficient';
  data: unknown;
}
