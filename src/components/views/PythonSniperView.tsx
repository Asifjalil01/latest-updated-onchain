import React, { useEffect, useState, useRef } from 'react';
import {
  Play,
  Square,
  RotateCcw,
  Copy,
  Check,
  ExternalLink,
  Terminal,
  Sliders,
  Activity,
  History,
  ArrowUpRight,
  ArrowDownRight,
  PauseCircle,
  Wallet,
  ShieldAlert,
  RefreshCw,
  Download,
  Trash2,
  Clock,
  Globe,
  Zap,
  ShieldCheck,
  Save,
  Users,
  TrendingDown,
  Coins,
  BarChart3,
  Search,
  Sparkles,
  Radio,
} from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import {
  fmtUsdPrice,
  fmtSolPrice,
  fmtSignedUsdAndSol,
  fmtUnsignedUsdAndSol,
  fmtSolAmount,
  usdToSol,
  orderLogsNewestFirst,
  formatBotUptime,
  formatTrailingModeHint,
  isPyOptionEnabled,
  validatePythonSniperSettings,
  type EnrichedSniperTrade,
} from '../../utils/sniperFormat';
import type {
  RentAuditReport,
  OrphanSweepResult,
  DexScorecardRow,
  BacktestResult,
} from '../../types';

interface SniperPosition {
  symbol: string;
  qty: number;
  entry_price: number;
  current_price?: number;
  cost: number;
  cost_sol?: number;
  original_cost?: number;
  principal_recovered?: boolean;
  recovered_usd?: number;
  next_scale_out_pct?: number;
  scale_out_count?: number;
  tx_buy?: string;
  opened: number;
  url: string;
  pnl_pct?: number;
  pnl_usd?: number;
  peak_price?: number;
  low_price?: number;
  peak_pct?: number;
  low_pct?: number;
  trailing_active?: boolean;
  trailing_floor_pct?: number | null;
  dex?: string;
  source?: string;
  creator?: string;
  creator_launches?: number;
  creator_prior_launches?: number;
  creator_rugged?: number;
  creator_fast_rug_min?: number | null;
  age_at_entry?: number;
  last_updated?: number;
  last_sell_error?: string;
  last_sell_error_at?: number;
  smart_money_entry?: boolean;
  smart_wallets_hit?: string[];
  smart_wallet_details?: Array<{
    address: string;
    label?: string;
    winRate?: number;
    source?: string;
  }>;
}

interface SniperLiveWallet {
  unlocked: boolean;
  publicKey: string | null;
  maskedPublicKey: string;
  balanceSol: number | null;
  balanceUsd: number | null;
  healthyRpcs: number;
}

interface SniperLog {
  id: string;
  timestamp: string;
  message: string;
  tag: string;
}

interface SmartWalletProfile {
  address: string;
  label?: string;
  category?: string;
  winRate?: string;
  wins?: number;
  totalTrades?: number;
  recentToken?: string;
  recentMint?: string;
  recentAction?: 'HOLDING' | 'CLOSED_PROFIT';
  heldMints?: Array<{
    mint: string;
    symbol: string;
    uiAmount: number;
    ageHours: number;
  }>;
  totalProfitSol?: number;
  source?: string;
  updatedAt?: number;
}

const USD_SETTING_KEYS = new Set([
  'start_balance_usd',
  'trade_size_usd',
  'daily_loss_limit_usd',
  'min_liquidity_usd',
  'min_volume_m5_usd',
]);

const PYTHON_PRO_DESK_KEYS: Array<[string, 'bool' | 'int' | 'float' | 'string' | 'list']> = [
  ['anti_sybil_enabled', 'bool'],
  ['fresh_wallet_minutes', 'int'],
  ['max_shared_funder_count', 'int'],
  ['smart_money_enabled', 'bool'],
  ['smart_money_scan_mode', 'string'],
  ['smart_wallets', 'list'],
  ['smart_money_min_confluence', 'int'],
  ['smart_money_size_boost_pct', 'float'],
  ['smart_money_auto_exit_on_sell', 'bool'],
  ['smart_money_auto_discover', 'bool'],
  ['smart_money_max_wallets', 'int'],
  ['smart_money_refresh_interval_sec', 'int'],
  ['smart_money_prioritize_entries', 'bool'],
  ['smart_money_follow_older_coins', 'bool'],
  ['smart_money_max_coin_age_hours', 'int'],
  ['reused_socials_enabled', 'bool'],
  ['max_social_reuse_count', 'int'],
  ['ws_exit_stream_enabled', 'bool'],
  ['jito_dontfront_enabled', 'bool'],
  ['jito_tip_sol', 'float'],
  ['orphan_sweep_enabled', 'bool'],
  ['post_migration_pullback_enabled', 'bool'],
  ['migration_min_dip_pct', 'float'],
  ['migration_wait_sec', 'int'],
  ['pre_migration_curve_enabled', 'bool'],
  ['pre_migration_curve_min_pct', 'float'],
  ['pre_migration_curve_max_pct', 'float'],
  ['wash_trade_filter_enabled', 'bool'],
  ['min_unique_makers_ratio', 'float'],
  ['min_unique_traders_5m', 'int'],
  ['sol_regime_filter_enabled', 'bool'],
  ['sol_regime_max_drop_pct', 'float'],
  ['sol_regime_action', 'string'],
  ['anti_top_wick_enabled', 'bool'],
  ['max_short_spike_pct', 'float'],
  ['conviction_sizing_enabled', 'bool'],
  ['conviction_min_mult', 'float'],
  ['conviction_max_mult', 'float'],
  ['streak_throttle_enabled', 'bool'],
  ['streak_loss_limit', 'int'],
  ['streak_cooldown_minutes', 'int'],
  ['streak_action', 'string'],
  ['narrative_cap_enabled', 'bool'],
  ['max_same_narrative_positions', 'int'],
  ['auto_reclaim_rent_enabled', 'bool'],
];

const PYTHON_SETTINGS_METADATA: Array<[string, string, 'float' | 'int' | 'bool' | 'string' | 'tier']> = [
  // Core Position & Risk Management (Important)
  ['trade_size_usd', 'Trade size $', 'float'],
  ['max_open_positions', 'Max open positions', 'int'],
  ['daily_loss_limit_usd', 'Daily loss limit $', 'float'],

  // Quick Profit & Loss Exits (Important)
  ['take_profit_pct', 'Take profit % (arms trailing stop, 0 = off)', 'float'],
  ['trailing_stop_pct', 'Trailing stop % from peak (0 = off)', 'float'],
  ['stop_loss_pct', 'Stop loss % (0 = off)', 'float'],
  ['slippage_pct', 'Slippage % (used in paper & live sells)', 'float'],
  ['use_real_swap_quotes', 'Exit monitor: real Jupiter reverse swap quotes', 'bool'],

  // Entry Momentum & Liquidity Filters (Important)
  ['min_age_minutes', 'Sniper window: min coin age (minutes)', 'float'],
  ['max_age_minutes', 'Sniper window: max coin age (minutes)', 'float'],
  ['min_liquidity_usd', 'Min liquidity $', 'float'],
  ['min_volume_m5_usd', 'Min 5-min volume $ (0 = off)', 'float'],
  ['min_buys_m5', 'Min buys last 5 min', 'int'],
  ['min_buy_sell_ratio_m5', 'Min buy/sell ratio (5 min)', 'float'],
  ['max_price_change_m5_pct', 'Skip if pumped +X% in 5 min', 'float'],

  // Hard Anti-Rug & Anti-Bundle Protections (Important)
  ['use_rugcheck', 'Hard RugCheck (score + risks)', 'bool'],
  ['strict_rugcheck', 'Strict: reject ANY danger & missing reports', 'bool'],
  ['block_insider_bundles', 'Block bundled / insider RugCheck wallets', 'bool'],
  ['check_creator_history', 'Owner / Creator History & Fast-Rug Check', 'bool'],
  ['max_creator_launches', 'Max owner prior coins launched', 'int'],
  ['max_creator_rugged_coins', 'Max owner prior rugged coins', 'int'],
  ['creator_fast_rug_window_min', 'Fast rugpull block window (minutes)', 'int'],
  ['max_dev_hold_pct', 'Max creator/dev wallet holdings %', 'float'],
  ['rugcheck_max_score', 'Max RugCheck risk score (0-100)', 'float'],
  ['max_top10_holder_pct', 'Max top-10 non-pool holders %', 'float'],

  // Fast Execution (Private RPC, Priority & Jito)
  ['priority_fee_tier', 'Priority fee speed tier (live swaps)', 'tier'],
  ['jito_tip_sol', 'Optional Jito tip (SOL, 0 = off, e.g. 0.0001)', 'float'],
  ['custom_rpc_url', 'Private RPC URL (optional, Helius / QuickNode)', 'string'],
];

const PYTHON_SETTING_NOTES: Record<string, string> = {
  trade_size_usd: 'USD invested per coin buy (converted automatically to SOL in Live mode).',
  max_open_positions: 'Max coins held at the same time; scanning pauses when all slots are full.',
  daily_loss_limit_usd: 'Stops opening new buys for the day if realized daily loss reaches this $ cap.',
  take_profit_pct: 'Profit target %: sells directly if Trailing Stop is 0, or arms Trailing Stop when > 0.',
  trailing_stop_pct: 'Trailing drawdown % below peak PnL after Take Profit arms trailing.',
  stop_loss_pct: 'Max allowed loss % from entry before force-selling.',
  slippage_pct: 'Max swap price tolerance % for fills and sells; higher speeds up fills on volatile launches.',
  use_real_swap_quotes: 'Prices exits from live Jupiter token→SOL swap quotes instead of cached chart prices.',
  min_age_minutes: 'Minimum coin age in minutes (e.g. 5m, 300m = 5h). Pair with Max coin age to trade a specific age gap.',
  max_age_minutes: 'Maximum coin age in minutes (e.g. 2m for launches, 300m = 5h, 600m = 10h); skips older coins.',
  min_liquidity_usd: 'Minimum pool liquidity $ required before entry to avoid shallow illiquid traps.',
  min_volume_m5_usd: 'Minimum 5-minute trading volume $ to verify real active trader demand (0 = off).',
  min_buys_m5: 'Minimum number of buy swaps in the last 5 minutes required to enter.',
  min_buy_sell_ratio_m5: 'Buys must outnumber sells by this multiplier (e.g. 1.5 = 1.5× more buys than sells).',
  max_price_change_m5_pct: 'Skips coins already up more than +X% in 5 minutes to avoid buying at the top.',
  use_rugcheck: 'Runs on-chain RPC + RugCheck audit to block mintable, freezable, and Token-2022 scams.',
  strict_rugcheck: 'Fail-closed guard: rejects tokens with missing RugCheck/RPC reports or critical risk flags.',
  block_insider_bundles: 'Blocks bundled insider wallet clusters and tokens where the dev dumped during launch.',
  check_creator_history: 'Inspects the owner/creator wallet before buying: total prior launches, rugged coins, and minutes-to-rug speed.',
  max_creator_launches: 'Rejects coins whose creator wallet has launched more than this many prior tokens.',
  max_creator_rugged_coins: 'Rejects coins whose creator wallet has more than this many prior rugged tokens.',
  creator_fast_rug_window_min: 'Blocks creators who previously rugged a coin within this many minutes of its launch (0 = block any prior rug).',
  max_dev_hold_pct: 'Rejects launches where the creator wallet still holds more than this % of total supply.',
  rugcheck_max_score: 'Maximum allowed RugCheck risk score 0–100 (brand-new Solana launches baseline ~52).',
  max_top10_holder_pct: 'Caps combined % held by top-10 private wallets (excludes DEX pool and burn addresses).',
  priority_fee_tier: 'Solana compute priority fee speed (Fast/Turbo automatically boosts urgent stop/rug sells).',
  jito_tip_sol: 'Optional Jito validator tip in SOL on live swaps for faster block landing (0 = disabled).',
  custom_rpc_url: 'Optional private Helius/QuickNode RPC placed first ahead of free public RPCs.',
};

const SNIPER_WEBSITE_OPTIONS: Array<{ id: string; name: string; domain: string; note: string }> = [
  { id: 'pumpfun', name: 'Pump.fun', domain: 'pump.fun', note: 'Bonding-curve & *pump launches' },
  { id: 'pumpswap', name: 'PumpSwap', domain: 'swap.pump.fun', note: 'Graduated Pump.fun AMM pools' },
  { id: 'axiom', name: 'Axiom Trade', domain: 'axiom.trade', note: 'Axiom Pulse / Trenches launchpads' },
  { id: 'letsbonk', name: 'LetsBonk.fun', domain: 'letsbonk.fun', note: 'Bonk launchpad & *bonk mints' },
  { id: 'raydium', name: 'Raydium / LaunchLab', domain: 'raydium.io', note: 'Raydium CPMM, CLMM & LaunchLab' },
  { id: 'meteora', name: 'Meteora', domain: 'meteora.ag', note: 'Meteora DLMM & DAMM v2 pools' },
  { id: 'moonshot', name: 'Moonshot', domain: 'moonshot.cc', note: 'Moonshot launchpad & *moon mints' },
  { id: 'bags', name: 'Bags', domain: 'bags.fm', note: 'Bags.fm creator fee launches' },
  { id: 'believe', name: 'Believe', domain: 'believe.app', note: 'Believe / LaunchCoin launches' },
  { id: 'boop', name: 'Boop', domain: 'boop.fun', note: 'Boop.fun meme launches' },
  { id: 'orca', name: 'Orca', domain: 'orca.so', note: 'Orca Whirlpool DEX pools' },
  { id: 'jupiter', name: 'Jupiter', domain: 'jup.ag', note: 'Jupiter Studio / recent feed' },
  { id: 'gmgn', name: 'GMGN', domain: 'gmgn.ai', note: 'GMGN sniper & trench pools' },
  { id: 'photon', name: 'Photon', domain: 'photon-sol.tinyastro.io', note: 'Photon Solana meme pools' },
  { id: 'bullx', name: 'BullX', domain: 'bullx.io', note: 'BullX Pump Vision pools' },
  { id: 'dexscreener', name: 'DexScreener', domain: 'dexscreener.com', note: 'DexScreener indexed / profile feeds' },
  { id: 'geckoterminal', name: 'GeckoTerminal', domain: 'geckoterminal.com', note: 'GeckoTerminal new pools feed' },
];

interface SniperProtectionModuleOption {
  key: string;
  group: 'speed' | 'safety';
  label: string;
  defaultValue: boolean;
  description: string;
  linkedTo: string;
}

const SNIPER_PROTECTION_MODULES: SniperProtectionModuleOption[] = [
  {
    key: 'fast_live_buy_enabled',
    group: 'speed',
    label: 'Fast Live Buy Pipeline (Skip Redundant Checks & Lock Hold)',
    defaultValue: true,
    description:
      'Checked: Releases the internal bot lock during HTTP swap requests, reuses token decimals already verified in Hard RugCheck, and caps post-buy balance RPC polling at 750ms (~1–3s buys). Unchecked: Runs slower locked sequential swaps and waits for full RPC polling.',
    linkedTo: 'Priority fee speed tier · Optional Jito tip · Private RPC URL',
  },
  {
    key: 'parallel_rug_screen_enabled',
    group: 'speed',
    label: 'Parallel Top-3 Rug Pre-Screening',
    defaultValue: true,
    description:
      'Checked: Screens the top 3 ranked launch candidates concurrently across worker threads so passing coins reach buy execution faster. Unchecked: Checks each candidate one by one in sequence.',
    linkedTo: 'Hard RugCheck (score + risks) · Max RugCheck risk score · Max top-10 non-pool holders %',
  },
  {
    key: 'jupiter_quota_guard_enabled',
    group: 'speed',
    label: 'Jupiter 429 Quota Guard (Pause Background Exit Quotes)',
    defaultValue: true,
    description:
      'Checked: Automatically pauses background exit reverse-quote polling during active live swaps, for 10s afterward, and while running keyless with open scan slots so buys avoid Jupiter HTTP 429 throttling. Unchecked: Polls reverse quotes continuously.',
    linkedTo: 'Exit monitor: real Jupiter reverse swap quotes · Always Simulate Exit Swap',
  },
  {
    key: 'direct_dex_fallback_enabled',
    group: 'speed',
    label: 'Direct PumpPortal & Raydium Instant Swap Fallback',
    defaultValue: true,
    description:
      'Checked: When Jupiter returns HTTP 429 or has no route on a brand-new coin or urgent exit, immediately builds and signs the swap via PumpPortal trade-local (pool=auto) or Raydium Trade API. Unchecked: Uses Jupiter swap routes only.',
    linkedTo: 'Slippage % · Priority fee speed tier',
  },
  {
    key: 'early_rug_shield_enabled',
    group: 'safety',
    label: 'Early-Launch Rugpull Shield (0m–3m Pre-Buy + Live Dev-Dump Auto-Exit)',
    defaultValue: true,
    description:
      'Checked: Blocks dev sniper bundles (>8 SOL block-0 buy), thin curve spoofs, >18% single whales, >34% top-3 splits, shared-funder dev/Pump.fun sybil clusters, and hidden >30% sell taxes; triggers instant creator_dump_exit & catastrophic LP collapse auto-exits.',
    linkedTo: 'Hard RugCheck · Anti-Sybil · Block creator/dev sell dumps · Auto Emergency Sell on LP Drain',
  },
  {
    key: 'anti_rug_tight_score_enabled',
    group: 'safety',
    label: 'Tight Anti-Rug Score & Whale Cap (<= 45 Score / <= 30% Top-10)',
    defaultValue: false,
    description:
      'Checked: Enforces stricter limits than defaults — rejects RugCheck risk score >= 45 (vs 55), Top-10 non-pool holders > 30% (vs 35%), and single private wallet > 12%. Unchecked: Follows the numeric RugCheck & Top-10 thresholds set above.',
    linkedTo: 'Max RugCheck risk score (0-100) · Max top-10 non-pool holders % · Hard RugCheck',
  },
  {
    key: 'anti_rug_pool_depth_check_enabled',
    group: 'safety',
    label: 'Real Pool Depth & MCap/LP Ratio Guard ($2,500 Floor & 80x Cap)',
    defaultValue: true,
    description:
      'Checked: Requires at least $2,500 effective liquidity (when Min liquidity > 0) and blocks artificially inflated MCap > 80x Liquidity wash-trade traps. Unchecked: Uses your Min liquidity $ directly with a looser 150x MCap/LP cap.',
    linkedTo: 'Min liquidity $ · Min 5-min volume $',
  },
  {
    key: 'anti_rug_sell_sim_enabled',
    group: 'safety',
    label: 'Always Simulate Exit Swap & Tight 10% Impact Cap',
    defaultValue: false,
    description:
      'Checked: Runs a live Jupiter token->SOL sell simulation before every buy (even when active sells already appear on chart) and rejects if exit price impact exceeds 10% (vs 15%). Unchecked: Only simulates when sells < 2 (saves Jupiter quota).',
    linkedTo: 'Jupiter 429 Quota Guard · Hard RugCheck · Slippage %',
  },
  {
    key: 'anti_rug_copycat_cooldown_enabled',
    group: 'safety',
    label: 'Copycat Ticker Cooldown (10 Min After Rug Reject)',
    defaultValue: true,
    description:
      'Checked: Puts a rejected token ticker on a 10-minute cooldown to avoid clone-spam rug launches (tokens with >= $15k liquidity bypass). Unchecked: Evaluates every new launch fresh regardless of ticker.',
    linkedTo: 'Hard RugCheck · Target Websites / Launchpads Filter',
  },
  {
    key: 'require_lp_locked',
    group: 'safety',
    label: 'Require Burned/Locked LP >= 80% (AMM & Meteora Pools)',
    defaultValue: false,
    description:
      'Checked: Rejects standard AMM and unlocked Meteora DLMM/DAMM pools unless >= 80% of LP is burned/locked (canonical Pump.fun curves & PumpSwap stay allowed). Unchecked: Allows unlocked AMM/Meteora LPs.',
    linkedTo: 'Hard RugCheck · Target Websites / Launchpads Filter',
  },
  {
    key: 'auto_rug_exit',
    group: 'safety',
    label: 'Auto Emergency Sell on LP Drain (AMM Pools Only)',
    defaultValue: false,
    description:
      'Checked: Forces an urgent market sell after 2 consecutive confirmed >= 50% liquidity drops on AMM pools without a healthy Jupiter exit quote (Pump.fun curves are skipped). Unchecked: Exits strictly via Take Profit, Trailing Stop, or Stop Loss.',
    linkedTo: 'Stop loss % · Trailing stop % · Slippage % · Exit monitor: real Jupiter reverse swap quotes',
  },
  {
    key: 'axiom_pulse_migrated_only_enabled',
    group: 'speed',
    label: 'Axiom.trade Pulse: Migrated Coins Only (Exclusive Mode)',
    defaultValue: false,
    description:
      'Checked: Forgets and bypasses all other website filters, scanning and trading ONLY migrated coins from Axiom.trade Pulse (graduated AMM pools like Pumpswap, Raydium, and Meteora). Unchecked: Uses your standard website filter settings.',
    linkedTo: 'Target Websites / Launchpads Filter',
  },
];

function fmtHeld(minutes: number): string {
  if (minutes < 1) {
    return `${Math.max(1, Math.floor(minutes * 60))}s`;
  }
  if (minutes < 60) {
    return `${Math.floor(minutes)}m`;
  }
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h}h ${m}m`;
}

function fmtDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoStr;
  }
}

export function PythonSniperView() {
  const { apiFetch, apiToken, pushToast, setActiveTab: setAppViewTab } = useBotStore();
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [switchingMode, setSwitchingMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [liveWallet, setLiveWallet] = useState<SniperLiveWallet>({
    unlocked: false,
    publicKey: null,
    maskedPublicKey: 'Not connected',
    balanceSol: null,
    balanceUsd: null,
    healthyRpcs: 0,
  });
  const [state, setState] = useState<{
    cash: number;
    wallet_sol?: number | null;
    positions: Record<string, SniperPosition>;
    closed: number;
    wins: number;
    total_pnl: number;
    day_pnl: number;
    last_price_time?: number;
    scan_paused?: boolean;
    last_sell_time?: number;
    cooldown_remaining_sec?: number;
  }>({
    cash: 50.0,
    wallet_sol: null,
    positions: {},
    closed: 0,
    wins: 0,
    total_pnl: 0.0,
    day_pnl: 0.0,
    last_price_time: 0,
    scan_paused: false,
    last_sell_time: 0,
    cooldown_remaining_sec: 0,
  });

  // Separate committed server settings from draft user inputs to prevent snap-back while editing
  const [serverSettings, setServerSettings] = useState<Record<string, any>>({});
  const [draftSettings, setDraftSettings] = useState<Record<string, any>>({});
  const [isSettingsDirty, setIsSettingsDirty] = useState(false);
  const isSettingsDirtyRef = useRef(false);
  const settingsLoadedRef = useRef(false);
  const markSettingsDirty = (dirty: boolean) => {
    isSettingsDirtyRef.current = dirty;
    setIsSettingsDirty(dirty);
  };

  const [trades, setTrades] = useState<EnrichedSniperTrade[]>([]);
  const [logs, setLogs] = useState<SniperLog[]>([]);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [priceAgeSec, setPriceAgeSec] = useState<number | null>(null);
  const [scanPaused, setScanPaused] = useState(false);
  const [cooldownSec, setCooldownSec] = useState<number>(0);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [exportingCsv, setExportingCsv] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'history' | 'smart_money' | 'logs' | 'settings' | 'pro_desk'>('positions');
  const [historySearch, setHistorySearch] = useState('');
  const [newSmartWalletInput, setNewSmartWalletInput] = useState('');
  const [smartWalletSearch, setSmartWalletSearch] = useState('');
  const [smartWalletProfiles, setSmartWalletProfiles] = useState<Record<string, SmartWalletProfile>>({});
  const [showStartModal, setShowStartModal] = useState(false);
  const [startSmartMoneyFollow, setStartSmartMoneyFollow] = useState(true);
  const [startScanMode, setStartScanMode] = useState<'both' | 'smart_money_only' | 'sniper_only'>('both');
  const [savingSmartConfig, setSavingSmartConfig] = useState(false);
  const [discoveringWhales, setDiscoveringWhales] = useState(false);
  const [discoveredWhales, setDiscoveredWhales] = useState<Array<{
    address: string;
    label: string;
    category?: string;
    winRate: string;
    recentToken: string;
    recentMint?: string;
    recentAction?: 'HOLDING' | 'CLOSED_PROFIT';
    totalProfitSol: number;
    source?: string;
  }>>([]);

  // Python Pro Desk Tool States
  const [pyRentReport, setPyRentReport] = useState<RentAuditReport | null>(null);
  const [pyRentLoading, setPyRentLoading] = useState(false);
  const [pyBurnDust, setPyBurnDust] = useState(false);
  const [pySweepResult, setPySweepResult] = useState<OrphanSweepResult | null>(null);
  const [pySweepLoading, setPySweepLoading] = useState(false);
  const [pyScorecardRows, setPyScorecardRows] = useState<DexScorecardRow[]>([]);
  const [pyScorecardLoading, setPyScorecardLoading] = useState(false);
  const [pyBacktestReq, setPyBacktestReq] = useState({
    lookbackHours: 24,
    takeProfitPct: 35,
    stopLossPct: 15,
    trailingEnabled: true,
    trailingDropPct: 12,
  });
  const [pyBacktestResult, setPyBacktestResult] = useState<BacktestResult | null>(null);
  const [pyBacktestLoading, setPyBacktestLoading] = useState(false);
  const [pyNewWalletInput, setPyNewWalletInput] = useState('');
  const [openPositionsSmartOnly, setOpenPositionsSmartOnly] = useState(false);

  useEffect(() => {
    if (activeTab === 'pro_desk') {
      void loadPyRentAudit();
      void loadPyScorecard();
    }
  }, [activeTab]);

  const loadPyRentAudit = async () => {
    setPyRentLoading(true);
    try {
      const res = await apiFetch('/api/sniper/rent/audit');
      setPyRentReport(res as RentAuditReport);
    } catch (err) {
      pushToast({ kind: 'error', title: 'Rent audit failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setPyRentLoading(false);
    }
  };

  const handlePyReclaimRent = async (burnDust: boolean) => {
    setPyRentLoading(true);
    try {
      const res = (await apiFetch('/api/sniper/rent/reclaim', {
        method: 'POST',
        body: JSON.stringify({ burnDust }),
      })) as { closedCount: number; burnedCount: number; reclaimedSol: number; txSig?: string };
      pushToast({
        kind: 'success',
        title: 'ATA Rent Reclaimed',
        body: `Closed ${res.closedCount} empty ATAs, burned ${res.burnedCount} dust accounts. Reclaimed +${res.reclaimedSol.toFixed(4)} SOL!`,
      });
      await loadPyRentAudit();
    } catch (err) {
      pushToast({ kind: 'error', title: 'Reclaim failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setPyRentLoading(false);
    }
  };

  const handlePyRunOrphanSweep = async () => {
    setPySweepLoading(true);
    try {
      const res = (await apiFetch('/api/sniper/sweep-orphans', {
        method: 'POST',
      })) as OrphanSweepResult;
      setPySweepResult(res);
      pushToast({
        kind: 'success',
        title: 'Orphan Sweep Complete',
        body: `Scanned ${res.scanned} accounts, adopted ${res.adopted} unmonitored positions (${res.adoptedSymbols.join(', ') || 'none'}).`,
      });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Orphan sweep failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setPySweepLoading(false);
    }
  };

  const loadPyScorecard = async () => {
    setPyScorecardLoading(true);
    try {
      const res = (await apiFetch('/api/sniper/telemetry')) as { scorecard: DexScorecardRow[] };
      setPyScorecardRows(res.scorecard || []);
    } catch (err) {
      // ignore
    } finally {
      setPyScorecardLoading(false);
    }
  };

  const handlePyRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setPyBacktestLoading(true);
    try {
      const res = (await apiFetch('/api/sniper/backtest', {
        method: 'POST',
        body: JSON.stringify({
          mode: mode,
          lookbackHours: Number(pyBacktestReq.lookbackHours),
          takeProfitPct: Number(pyBacktestReq.takeProfitPct),
          stopLossPct: Number(pyBacktestReq.stopLossPct),
          trailingEnabled: Boolean(pyBacktestReq.trailingEnabled),
          trailingDropPct: Number(pyBacktestReq.trailingDropPct),
          minAgeMinutes: Number(draftSettings.min_age_minutes ?? 0),
          maxAgeMinutes: Number(draftSettings.max_age_minutes ?? 1440),
        }),
      })) as BacktestResult;
      setPyBacktestResult(res);
      pushToast({ kind: 'success', title: 'Backtest Completed', body: `Evaluated ${res.evaluatedTrades} historical trades.` });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Backtest failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setPyBacktestLoading(false);
    }
  };

  const saveQuickSniperSettings = async (patch: Record<string, any>, toastTitle?: string) => {
    setSavingSmartConfig(true);
    try {
      const nextDraft = {
        ...draftSettings,
        ...patch,
      };
      if (typeof patch.smart_money_enabled === 'boolean') {
        nextDraft.option_enabled = {
          ...(nextDraft.option_enabled || {}),
          smart_money_enabled: patch.smart_money_enabled,
        };
      }
      if (typeof patch.smart_money_follow_older_coins === 'boolean') {
        nextDraft.option_enabled = {
          ...(nextDraft.option_enabled || {}),
          smart_money_follow_older_coins: patch.smart_money_follow_older_coins,
        };
      }
      const data = await apiFetch<any>('/api/sniper/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: nextDraft }),
      });
      if (data?.ok) {
        const saved = data.settings ? { ...nextDraft, ...data.settings } : nextDraft;
        setServerSettings(saved);
        setDraftSettings(saved);
        markSettingsDirty(false);
        if (toastTitle) {
          pushToast({ kind: 'success', title: toastTitle });
        }
        void fetchStatus();
      } else {
        pushToast({
          kind: 'error',
          title: 'Could not save Smart Money config',
          body: data?.message || 'Validation error',
        });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Save failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setSavingSmartConfig(false);
    }
  };

  const handleDiscoverWhales = async () => {
    setDiscoveringWhales(true);
    try {
      const res = await apiFetch<any>('/api/sniper/smart-money/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAdd: true, scanHoldings: true }),
      });
      if (res?.ok && Array.isArray(res.discovered)) {
        setDiscoveredWhales(res.discovered);
        const added = Number(res.addedCount || 0);
        const total = Number(res.totalTracked || 0);
        const holdingsFound = Number(res.holdingsScan?.foundCoins || 0);
        if (!isSettingsDirtyRef.current && res.settings && Array.isArray(res.settings.smart_wallets)) {
          setDraftSettings((prev) => ({ ...prev, smart_wallets: res.settings.smart_wallets }));
        } else if (added > 0) {
          setDraftSettings((prev) => {
            const cur = Array.isArray(prev.smart_wallets) ? prev.smart_wallets : [];
            const next = Array.from(new Set([...cur, ...res.discovered.map((w: any) => w.address)]));
            return { ...prev, smart_wallets: next };
          });
        }
        pushToast({
          kind: res.discovered.length > 0 || holdingsFound > 0 ? 'success' : 'info',
          title: 'Whale Discovery & Holdings Scan Complete',
          body:
            (res.message || `Found ${res.discovered.length} profitable traders (${added} added · ${total} total tracked).`) +
            (holdingsFound > 0 ? ` Scanned ${res.holdingsScan.scannedWallets} whale portfolios → ${holdingsFound} live held coin(s).` : ''),
        });
        void fetchStatus();
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Discovery failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setDiscoveringWhales(false);
    }
  };
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmSellMint, setConfirmSellMint] = useState<string | null>(null);
  const [confirmDeleteMint, setConfirmDeleteMint] = useState<string | null>(null);
  const [deletingMint, setDeletingMint] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resettingDefaults, setResettingDefaults] = useState<'settings' | 'pro_desk' | null>(null);

  const fetchStatus = async () => {
    try {
      const data = await apiFetch<any>('/api/sniper/status');
      if (data) {
        setMode(data.mode === 'live' ? 'live' : 'paper');
        setRunning(Boolean(data.running));
        setStartedAtMs(
          Boolean(data.running) && typeof data.started_at_ms === 'number'
            ? data.started_at_ms
            : Boolean(data.running) && typeof data.uptime_sec === 'number'
              ? Date.now() - data.uptime_sec * 1000
              : null
        );
        setState(data.state || {});
        if (data.live_wallet) {
          setLiveWallet(data.live_wallet);
        }
        const fetchedSettings = data.settings || {};
        setServerSettings(fetchedSettings);

        if (!settingsLoadedRef.current) {
          setDraftSettings(fetchedSettings);
          settingsLoadedRef.current = true;
        } else if (!isSettingsDirtyRef.current) {
          setDraftSettings(fetchedSettings);
        }

        setTrades(data.trades || []);
        setLogs(data.logs || []);
        if (data.smart_wallet_profiles && typeof data.smart_wallet_profiles === 'object') {
          setSmartWalletProfiles(data.smart_wallet_profiles);
        }
        if (typeof data.sol_price_usd === 'number' && data.sol_price_usd > 0) {
          setSolPriceUsd(data.sol_price_usd);
        }
        setPriceAgeSec(typeof data.price_age_sec === 'number' ? data.price_age_sec : null);
        setScanPaused(Boolean(data.scan_paused ?? data.state?.scan_paused));
        if (typeof data.cooldown_remaining_sec === 'number') {
          setCooldownSec(data.cooldown_remaining_sec);
        } else if (typeof data.state?.cooldown_remaining_sec === 'number') {
          setCooldownSec(data.state.cooldown_remaining_sec);
        } else {
          setCooldownSec(0);
        }
      }
    } catch {}
  };

  // Poll status every 1 second (1000ms) for real-time price updates
  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 1000);
    return () => clearInterval(interval);
  }, [isSettingsDirty]);

  // Smooth 1s local tick for live bot runtime timer
  useEffect(() => {
    if (!running || !startedAtMs) return;
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [running, startedAtMs]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
    pushToast({ kind: 'info', title: 'Coin key copied to clipboard' });
  };

  const handleSwitchMode = async (targetMode: 'paper' | 'live') => {
    if (targetMode === mode || switchingMode) return;
    setSwitchingMode(true);
    try {
      const data = await apiFetch<any>('/api/sniper/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: targetMode }),
      });
      if (data?.ok) {
        setMode(data.mode === 'live' ? 'live' : 'paper');
        setRunning(false);
        if (data.live_wallet) {
          setLiveWallet(data.live_wallet);
        }
        pushToast({
          kind: targetMode === 'live' ? 'info' : 'success',
          title: data.message || `Switched to ${targetMode.toUpperCase()} mode`,
        });
        void fetchStatus();
      } else {
        pushToast({ kind: 'error', title: 'Mode switch failed', body: data?.message || 'Error switching mode' });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Mode switch failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setSwitchingMode(false);
    }
  };

  const handleRefreshWallet = async () => {
    try {
      const res = await apiFetch<any>('/api/sniper/live-wallet?force=true');
      if (res) {
        setLiveWallet({
          unlocked: Boolean(res.unlocked),
          publicKey: res.publicKey || null,
          maskedPublicKey: res.maskedPublicKey || 'Not connected',
          balanceSol: res.balanceSol ?? null,
          balanceUsd: res.balanceUsd ?? null,
          healthyRpcs: res.healthyRpcs ?? 0,
        });
        void fetchStatus();
      }
    } catch {}
  };

  const handleToggle = async () => {
    try {
      const action = running ? 'stop' : 'start';
      const data = await apiFetch<any>('/api/sniper/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (data.ok) {
        setRunning(action === 'start');
        pushToast({ kind: 'success', title: data.message });
        void fetchStatus();
      } else {
        pushToast({ kind: 'error', title: 'Control error', body: data.message });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Request failed', body: err instanceof Error ? err.message : 'Error' });
    }
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    try {
      const data = await apiFetch<any>('/api/sniper/reset', { method: 'POST' });
      if (data.ok) {
        markSettingsDirty(false);
        pushToast({ kind: 'info', title: data.message || 'Account reset successfully' });
        void fetchStatus();
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Reset failed', body: err instanceof Error ? err.message : 'Error' });
    }
  };

  const handleResetDefaults = async (scope: 'settings' | 'pro_desk') => {
    setResettingDefaults(scope);
    try {
      const data = await apiFetch<any>('/api/sniper/settings/reset', {
        method: 'POST',
        body: JSON.stringify({ scope }),
      });
      if (data.ok && data.settings) {
        setServerSettings(data.settings);
        setDraftSettings(data.settings);
        markSettingsDirty(false);
        pushToast({
          kind: 'success',
          title: scope === 'pro_desk' ? 'Pro Desk Reset to Default' : 'Settings Reset to Default',
          body:
            scope === 'pro_desk'
              ? 'All Pro Desk modules and thresholds have been restored to best Quick-Profit defaults and saved.'
              : 'All Settings filters, exits, and Rug Shield options have been restored to best Quick-Profit defaults and saved.',
        });
        void fetchStatus();
      } else {
        pushToast({ kind: 'error', title: 'Reset failed', body: data.message || 'Unable to reset defaults' });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Reset failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setResettingDefaults(null);
    }
  };

  const isPyOptEnabled = (key: string) => draftSettings.option_enabled?.[key] !== false;
  const togglePyOpt = (key: string, enabled: boolean) => {
    setDraftSettings((prev) => ({
      ...prev,
      option_enabled: {
        ...(prev.option_enabled || {}),
        [key]: enabled,
      },
    }));
    markSettingsDirty(true);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: Record<string, any> = {};
      const nextOptionEnabled: Record<string, boolean> = {
        min_age_minutes: false,
        ...(draftSettings.option_enabled && typeof draftSettings.option_enabled === 'object'
          ? draftSettings.option_enabled
          : {}),
      };
      for (const [key, _, kind] of PYTHON_SETTINGS_METADATA) {
        const raw = draftSettings[key];
        if (kind === 'bool') {
          payload[key] = raw === true || raw === 'true';
        } else if (kind === 'int') {
          const parsed = parseInt(String(raw ?? 0), 10);
          payload[key] = isNaN(parsed) ? 0 : parsed;
        } else if (kind === 'float') {
          const parsed = parseFloat(String(raw ?? 0));
          payload[key] = isNaN(parsed) ? 0.0 : parsed;
        } else {
          payload[key] = String(raw ?? '');
        }
      }
      for (const mod of SNIPER_PROTECTION_MODULES) {
        const raw = draftSettings[mod.key];
        payload[mod.key] = raw === undefined ? mod.defaultValue : raw === true || raw === 'true';
      }
      for (const [key, kind] of PYTHON_PRO_DESK_KEYS) {
        const raw = draftSettings[key];
        if (kind === 'bool') {
          payload[key] = raw === true || raw === 'true';
        } else if (kind === 'int') {
          const parsed = parseInt(String(raw ?? 0), 10);
          payload[key] = isNaN(parsed) ? 0 : parsed;
        } else if (kind === 'float') {
          const parsed = parseFloat(String(raw ?? 0));
          payload[key] = isNaN(parsed) ? 0.0 : parsed;
        } else if (kind === 'list') {
          payload[key] = Array.isArray(raw) ? raw : [];
        } else {
          payload[key] = String(raw ?? '');
        }
        if (kind === 'bool') {
          if (typeof nextOptionEnabled[key] !== 'boolean') {
            nextOptionEnabled[key] = true;
          }
          nextOptionEnabled[key] = payload[key] === true && nextOptionEnabled[key] !== false;
        }
      }
      for (const [key, _, kind] of PYTHON_SETTINGS_METADATA) {
        const defOn = key === 'min_age_minutes' ? false : true;
        if (typeof nextOptionEnabled[key] !== 'boolean') {
          nextOptionEnabled[key] = defOn;
        }
        if (kind === 'bool') {
          nextOptionEnabled[key] = payload[key] === true && nextOptionEnabled[key] !== false;
        }
      }
      payload.option_enabled = nextOptionEnabled;
      payload.enabled_platforms = Array.isArray(draftSettings.enabled_platforms)
        ? Array.from(
            new Set(
              draftSettings.enabled_platforms
                .map((v: unknown) => String(v).trim().toLowerCase())
                .filter(Boolean)
            )
          )
        : [];

      const clientCheck = validatePythonSniperSettings({ ...payload, mode }, solPriceUsd);
      if (!clientCheck.valid) {
        pushToast({
          kind: 'error',
          title: 'Invalid Python Sniper settings',
          body: clientCheck.error || 'Adjust highlighted setting before saving.',
        });
        return;
      }

      const data = await apiFetch<any>('/api/sniper/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload }),
      });
      if (data?.ok) {
        const saved = data.settings ? { ...payload, ...data.settings } : payload;
        setServerSettings(saved);
        setDraftSettings(saved);
        markSettingsDirty(false);
        pushToast({ kind: 'success', title: 'Python sniper settings saved' });
        void fetchStatus();
      } else {
        pushToast({
          kind: 'error',
          title: 'Settings rejected',
          body: data?.message || 'Unable to save settings.',
        });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Save failed', body: err instanceof Error ? err.message : 'Error' });
    }
  };

  const handleSellNow = async (mint: string) => {
    if (confirmSellMint !== mint) {
      setConfirmSellMint(mint);
      setTimeout(() => {
        setConfirmSellMint((cur) => (cur === mint ? null : cur));
      }, 4000);
      return;
    }
    setConfirmSellMint(null);
    try {
      const data = await apiFetch<any>('/api/sniper/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint }),
      });
      if (data.ok) {
        pushToast({ kind: 'success', title: data.message });
        void fetchStatus();
      } else {
        pushToast({ kind: 'error', title: data.message });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Sell failed', body: err instanceof Error ? err.message : 'Error' });
    }
  };

  const handleForceDelete = async (mint: string) => {
    if (deletingMint === mint) return;
    if (confirmDeleteMint !== mint) {
      setConfirmDeleteMint(mint);
      setTimeout(() => {
        setConfirmDeleteMint((cur) => (cur === mint ? null : cur));
      }, 4000);
      return;
    }
    setConfirmDeleteMint(null);
    setDeletingMint(mint);
    try {
      const data = await apiFetch<any>('/api/sniper/delete-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint, reason: 'rugpull_writeoff' }),
      });
      if (data.ok) {
        // Immediately remove from optimistic React state so it clears even before next 1s poll
        setState((prev) => {
          const nextPositions = { ...(prev.positions || {}) };
          delete nextPositions[mint];
          return { ...prev, positions: nextPositions };
        });
        pushToast({ kind: 'success', title: data.message });
        void fetchStatus();
      } else {
        pushToast({ kind: 'error', title: data.message || 'Failed to clear position' });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Delete failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setDeletingMint((cur) => (cur === mint ? null : cur));
    }
  };

  const handleExportCsv = async () => {
    try {
      setExportingCsv(true);
      const tokenParam = apiToken ? `&token=${encodeURIComponent(apiToken)}` : '';
      const url = `/api/sniper/export/trades.csv?mode=${mode}${tokenParam}`;
      const res = await fetch(url, {
        headers: apiToken ? { 'x-api-token': apiToken } : {},
      });
      if (!res.ok) {
        throw new Error(`Export failed with HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `sniper_${mode}_pnl_${today}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      pushToast({
        kind: 'success',
        title: 'PnL CSV exported successfully',
        body: `Downloaded sniper_${mode}_pnl_${today}.csv`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Export failed',
        body: err instanceof Error ? err.message : 'Error exporting CSV',
      });
    } finally {
      setExportingCsv(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      setClearingLogs(true);
      const data = await apiFetch<any>('/api/sniper/logs/clear', { method: 'POST' });
      if (data?.ok) {
        setLogs([]);
        pushToast({ kind: 'info', title: 'Scan logs cleared' });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Clear logs failed', body: err instanceof Error ? err.message : 'Error' });
    } finally {
      setClearingLogs(false);
    }
  };

  const botRuntimeSec =
    running && startedAtMs ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)) : 0;
  const botRuntimeText = formatBotUptime(botRuntimeSec);

  const positionsList = Object.entries(state.positions || {}).map(([mint, p]) => ({
    mint,
    ...p,
  }));

  const openPnl = positionsList.reduce((acc, p) => {
    if (p.pnl_usd !== undefined && p.pnl_usd !== null) return acc + p.pnl_usd;
    const currentPrice = p.current_price || p.entry_price;
    const chg = currentPrice / p.entry_price - 1;
    return acc + p.cost * chg;
  }, 0);

  const openCost = positionsList.reduce((acc, p) => acc + (p.cost || 0), 0);
  const closedFromTrades = trades.filter((t) => t.tradeStatus === 'CLOSED' || t.tradeStatus === 'PARTIAL');
  const winsFromTrades = closedFromTrades.filter((t) => parseFloat(t.pnlUsd || t.diffUsd || '0') > 0);
  const closedCount = closedFromTrades.length > 0 || trades.length > 0 ? closedFromTrades.length : (state.closed || 0);
  const winsCount = closedFromTrades.length > 0 || trades.length > 0 ? winsFromTrades.length : (state.wins || 0);
  const winRateText = closedCount > 0 ? `${((winsCount / closedCount) * 100).toFixed(0)}% (${winsCount}/${closedCount})` : 'no closed trades';
  const maxSlots = isPyOptionEnabled(serverSettings, 'max_open_positions', true)
    ? Math.max(1, Number(serverSettings.max_open_positions || draftSettings.max_open_positions || 3))
    : 0;
  const slotsFull = (maxSlots > 0 && positionsList.length >= maxSlots) || scanPaused;
  const cooldownRemainingSec = Number(cooldownSec || state.cooldown_remaining_sec || 0);

  const isLiveMode = mode === 'live';
  const effectiveWalletSol = isLiveMode ? (liveWallet.balanceSol ?? state.wallet_sol ?? null) : null;
  const effectiveCashUsd = isLiveMode
    ? effectiveWalletSol !== null && solPriceUsd
      ? effectiveWalletSol * solPriceUsd
      : state.cash || 0
    : state.cash || 0;
  const cashDisp = fmtUnsignedUsdAndSol(effectiveCashUsd, solPriceUsd, 2);
  const totalValue = effectiveCashUsd + openCost + openPnl;
  const totalValDisp = fmtUnsignedUsdAndSol(totalValue, solPriceUsd, 2);
  const openPnlDisp = fmtSignedUsdAndSol(openPnl, solPriceUsd, 2);
  const derivedRealizedPnl = closedFromTrades.reduce((acc, t) => acc + (parseFloat(t.pnlUsd || t.diffUsd || '0') || 0), 0);
  const effectiveRealizedPnl = closedFromTrades.length > 0 ? derivedRealizedPnl : (state.total_pnl || 0);
  const effectiveDayPnl = closedFromTrades.length > 0 ? derivedRealizedPnl : (state.day_pnl || 0);
  const dayPnlDisp = fmtSignedUsdAndSol(effectiveDayPnl, solPriceUsd, 2);
  const realizedPnlDisp = fmtSignedUsdAndSol(effectiveRealizedPnl, solPriceUsd, 2);

  const filteredTrades = trades.filter((t) => {
    if (!historySearch.trim()) return true;
    const q = historySearch.toLowerCase();
    return (
      t.symbol.toLowerCase().includes(q) ||
      t.mint.toLowerCase().includes(q) ||
      t.action.toLowerCase().includes(q) ||
      (t.tradeStatus || '').toLowerCase().includes(q) ||
      t.reason.toLowerCase().includes(q) ||
      (t.partialReasons || []).some((r) => r.toLowerCase().includes(q))
    );
  });

  const newestFirstLogs = orderLogsNewestFirst(logs);
  const draftValidation = validatePythonSniperSettings({ ...draftSettings, mode }, solPriceUsd);
  const recoverPrincipalOn =
    isPyOptionEnabled(draftSettings, 'recover_principal_enabled', true) &&
    (draftSettings.recover_principal_enabled === true || draftSettings.recover_principal_enabled === 'true');

  let statusText = 'STOPPED';
  let statusBadgeClass = 'bg-slate-500/20 text-slate-500 dark:text-slate-400';
  let dotClass = 'bg-slate-400';

  if (running) {
    if (cooldownRemainingSec > 0) {
      statusText = `RUNNING · RESCAN DELAY (${cooldownRemainingSec}s) · SCAN PAUSED`;
      statusBadgeClass = 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30';
      dotClass = 'bg-amber-500 animate-pulse';
    } else if (slotsFull) {
      const priceHint =
        priceAgeSec !== null && priceAgeSec <= 15
          ? `prices ${priceAgeSec.toFixed(1)}s ago`
          : 'updating prices';
      statusText = maxSlots > 0
        ? `RUNNING · Slots Full (${positionsList.length}/${maxSlots}) · Scan Paused · ${priceHint}`
        : `RUNNING · Scan Paused · ${priceHint}`;
      statusBadgeClass = 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30';
      dotClass = 'bg-amber-500 animate-pulse';
    } else if (positionsList.length > 0) {
      if (priceAgeSec !== null && priceAgeSec <= 15) {
        statusText = `RUNNING · prices updated ${priceAgeSec.toFixed(1)}s ago`;
        statusBadgeClass = 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
        dotClass = 'bg-emerald-500 animate-pulse';
      } else {
        statusText = 'RUNNING · waiting for prices';
        statusBadgeClass = 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30';
        dotClass = 'bg-amber-500 animate-pulse';
      }
    } else {
      statusText = `RUNNING · scanning every ${serverSettings.scan_interval_sec || 1}s`;
      statusBadgeClass = 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
      dotClass = 'bg-emerald-500 animate-pulse';
    }
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-3">
            <span>{isLiveMode ? 'Solana Live Trader - New Launch Sniper' : 'Solana Paper Trader - New Launch Sniper'}</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-mono font-bold tracking-wider uppercase ${
                isLiveMode
                  ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/25'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {isLiveMode ? 'LIVE' : 'PAPER'}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase ${statusBadgeClass}`}>
              <span className={`w-2 h-2 rounded-full ${dotClass}`} />
              {statusText}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold tabular-nums border ${
                running
                  ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30'
                  : 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20'
              }`}
              title={running ? 'Elapsed time since Python bot started' : 'Bot is stopped'}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Runtime {botRuntimeText}</span>
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isLiveMode
              ? 'All DEXes | Brand-new coins only | Hard RPC & RugCheck screen | LIVE MODE: executes real swaps via Jupiter & server wallet.'
              : 'All DEXes | Brand-new coins only | Hard RPC & RugCheck screen | PAPER MODE: no wallet, no real money risk.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Paper / Live Mode Toggle */}
          <div
            className="inline-flex p-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-sm"
            role="group"
            aria-label="Python sniper trading mode"
          >
            <button
              type="button"
              disabled={switchingMode}
              onClick={() => void handleSwitchMode('paper')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase transition-all ${
                !isLiveMode
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Paper
            </button>
            <button
              type="button"
              disabled={switchingMode}
              onClick={() => void handleSwitchMode('live')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase flex items-center gap-1.5 transition-all ${
                isLiveMode
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-rose-500 dark:hover:text-rose-400'
              }`}
            >
              {isLiveMode && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
              <span>Live</span>
            </button>
          </div>

          <div
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] text-xs font-mono flex items-center gap-2 shadow-sm"
            title="Live SOL/USD reference rate updated periodically from Jupiter & DexScreener"
          >
            <span className="text-slate-500 font-semibold">SOL</span>
            <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {solPriceUsd ? `$${solPriceUsd.toFixed(2)}` : 'fetching...'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              if (running) {
                void handleToggle();
              } else {
                const curScanMode =
                  draftSettings.smart_money_scan_mode === 'smart_money_only' ||
                  draftSettings.smart_money_scan_mode === 'sniper_only'
                    ? draftSettings.smart_money_scan_mode
                    : 'both';
                setStartScanMode(curScanMode);
                setStartSmartMoneyFollow(
                  curScanMode === 'sniper_only' ? false : Boolean(draftSettings.smart_money_enabled !== false)
                );
                setShowStartModal(true);
              }
            }}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2 shadow-lg transition-all ${
              running ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20' : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
            }`}
          >
            {running ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{running ? 'Stop bot' : 'Start Python Bot'}</span>
          </button>
        </div>
      </div>

      {/* Live Wallet Status Strip (shown in LIVE mode) */}
      {isLiveMode && (
        <div
          className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 text-xs ${
            !liveWallet.unlocked
              ? 'border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300'
              : (effectiveWalletSol ?? 0) <= 0.001
                ? 'border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300'
                : 'border-emerald-500/30 bg-emerald-500/5 text-slate-800 dark:text-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 font-semibold">
              {liveWallet.unlocked ? (
                <Wallet className="w-4 h-4 text-emerald-500" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-rose-500" />
              )}
              <span>Live Wallet:</span>
              <span className="font-mono font-bold">{liveWallet.maskedPublicKey}</span>
            </div>
            <span className="font-mono px-2 py-0.5 rounded bg-slate-900/10 dark:bg-white/10">
              {liveWallet.unlocked ? 'Signer Unlocked' : 'Signer Locked'}
            </span>
            <span className="font-mono text-slate-600 dark:text-slate-300">
              RPCs healthy: {liveWallet.healthyRpcs}
            </span>
            {liveWallet.unlocked && effectiveWalletSol !== null && effectiveWalletSol <= 0.001 && (
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                No SOL ({effectiveWalletSol.toFixed(4)} SOL / $0.00) in wallet — buys will alert until funded.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefreshWallet()}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-white/60 dark:hover:bg-slate-800 font-semibold flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Balance</span>
            </button>
            {!liveWallet.unlocked && (
              <button
                type="button"
                onClick={() => setAppViewTab('wallets')}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors"
              >
                Unlock Wallet
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPI Cards with USD + SOL side by side */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">{isLiveMode ? 'Wallet balance' : 'Cash (Paper)'}</span>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {cashDisp.usdText}
            </span>
            <span className="font-mono text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
              {effectiveWalletSol !== null ? fmtSolAmount(effectiveWalletSol) : cashDisp.solText}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Est. total value</span>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {totalValDisp.usdText}
            </span>
            <span className="font-mono text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
              {totalValDisp.solText}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Open PnL (est.)</span>
          <div className={`mt-1 flex flex-wrap items-baseline gap-x-2 font-mono tabular-nums ${openPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            <span className="text-lg font-bold">{openPnlDisp.usdText}</span>
            <span className="text-xs font-semibold opacity-85">{openPnlDisp.solText}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Today&apos;s PnL</span>
          <div className={`mt-1 flex flex-wrap items-baseline gap-x-2 font-mono tabular-nums ${(state.day_pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            <span className="text-lg font-bold">{dayPnlDisp.usdText}</span>
            <span className="text-xs font-semibold opacity-85">{dayPnlDisp.solText}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Realized PnL</span>
          <div className={`mt-1 flex flex-wrap items-baseline gap-x-2 font-mono tabular-nums ${(state.total_pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            <span className="text-lg font-bold">{realizedPnlDisp.usdText}</span>
            <span className="text-xs font-semibold opacity-85">{realizedPnlDisp.solText}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Win rate</span>
          <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-2 block truncate">
            {winRateText}
          </span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-fit">
        {[
          { id: 'positions', label: `Open positions (${positionsList.length})`, icon: Activity },
          { id: 'history', label: `Trade history (${trades.length})`, icon: History },
          { id: 'smart_money', label: 'Smart Money', icon: Users },
          { id: 'logs', label: 'Scan log', icon: Terminal },
          { id: 'settings', label: `Settings${isSettingsDirty ? ' •' : ''}`, icon: Sliders },
          { id: 'pro_desk', label: 'Pro Desk', icon: ShieldCheck },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content: Open Positions */}
      {activeTab === 'positions' && (() => {
        const isSmartPosition = (p: typeof positionsList[number]) =>
          Boolean(p.smart_money_entry || (Array.isArray(p.smart_wallets_hit) && p.smart_wallets_hit.length > 0));
        const smartMoneyPositionsCount = positionsList.filter(isSmartPosition).length;
        const visiblePositions = openPositionsSmartOnly ? positionsList.filter(isSmartPosition) : positionsList;

        return (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Live Active Positions</span>
              <span className="text-[11px] text-slate-400 font-mono">
                (1s live refresh · Jupiter &amp; DexScreener quotes{priceAgeSec !== null && positionsList.length > 0 ? ` · updated ${priceAgeSec.toFixed(1)}s ago` : ''})
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {cooldownRemainingSec > 0 && running && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <PauseCircle className="w-3 h-3" />
                  <span>Rescan delay: {cooldownRemainingSec}s left</span>
                </span>
              )}
              {slotsFull && running && cooldownRemainingSec <= 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <PauseCircle className="w-3 h-3" />
                  <span>Scan auto-paused until a slot frees</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setOpenPositionsSmartOnly((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                  openPositionsSmartOnly
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
                    : 'bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/40'
                }`}
                title="Filter open positions to show only buys backed by tracked Smart Money / Whale wallets"
              >
                <Users className="w-3 h-3" />
                <span>Whale Buys Only ({smartMoneyPositionsCount})</span>
              </button>
              <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
                {positionsList.length} of {maxSlots} slots in use
              </span>
            </div>
          </div>

          {positionsList.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <p className="font-semibold text-slate-700 dark:text-slate-300">No open positions currently.</p>
              <p>When the Python bot discovers brand-new coins that pass the rug screen, they appear here with live 1s USD &amp; SOL pricing.</p>
            </div>
          ) : visiblePositions.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5">
              <p className="font-semibold text-slate-700 dark:text-slate-300">No open positions triggered by tracked Smart Money whales right now.</p>
              <p>{positionsList.length} open position(s) were entered via standard Auto Sniper rules.</p>
              <button
                type="button"
                onClick={() => setOpenPositionsSmartOnly(false)}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-semibold"
              >
                Show all open positions ({positionsList.length})
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-mono text-[11px]">
                    <th className="py-2 px-2 font-semibold">Coin</th>
                    <th className="py-2 px-2 font-semibold text-right">PnL %</th>
                    <th className="py-2 px-2 font-semibold text-right">PnL ($ / SOL)</th>
                    <th className="py-2 px-2 font-semibold text-right">Entry ($ / SOL)</th>
                    <th className="py-2 px-2 font-semibold text-right">
                      <span className="inline-flex items-center gap-1">
                        <span>Price now ($ / SOL)</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                      </span>
                    </th>
                    <th className="py-2 px-2 font-semibold text-right">Peak / Low</th>
                    <th className="py-2 px-2 font-semibold text-right">Held</th>
                    <th className="py-2 px-2 font-semibold">Coin key</th>
                    <th className="py-2 px-2 font-semibold">Dev wallet</th>
                    <th className="py-2 px-2 font-semibold">Entry Signal</th>
                    <th className="py-2 px-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono">
                  {visiblePositions.map((p) => {
                    const heldMins = (Date.now() / 1000 - p.opened) / 60;
                    const currentPrice = p.current_price !== undefined && p.current_price > 0 ? p.current_price : p.entry_price;
                    const inProfit = currentPrice >= p.entry_price;
                    const pnlPct = p.pnl_pct !== undefined ? p.pnl_pct : (currentPrice / p.entry_price - 1) * 100;
                    const pnlUsd = p.pnl_usd !== undefined ? p.pnl_usd : p.cost * (pnlPct / 100);
                    const pnlDisp = fmtSignedUsdAndSol(pnlUsd, solPriceUsd, 2);
                    const peakPct = p.peak_pct !== undefined ? p.peak_pct : p.peak_price ? (p.peak_price / p.entry_price - 1) * 100 : 0;
                    const lowPct = p.low_pct !== undefined ? p.low_pct : p.low_price ? (p.low_price / p.entry_price - 1) * 100 : 0;
                    const dexLabel = `${p.dex || 'dex'} · ${p.source || 'src'}`;
                    const isConfirmingSell = confirmSellMint === p.mint;

                    return (
                      <tr key={p.mint} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                        {/* Coin */}
                        <td className="py-2.5 px-2">
                          <div className="font-bold text-slate-900 dark:text-slate-100 font-sans text-xs">
                            {p.symbol}
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 uppercase block leading-tight">
                            {dexLabel}
                          </span>
                          {p.last_sell_error && (
                            <span
                              className="mt-1 inline-block px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 border border-rose-500/30 text-[10px] font-mono max-w-[220px] truncate"
                              title={p.last_sell_error}
                            >
                              Sell retry: {p.last_sell_error}
                            </span>
                          )}
                        </td>

                        {/* PnL % */}
                        <td className={`py-2.5 px-2 text-right font-bold text-xs tabular-nums whitespace-nowrap ${pnlPct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                          <span className="inline-flex items-center gap-0.5 justify-end">
                            {pnlPct >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                            <span>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
                          </span>
                        </td>

                        {/* PnL $ & SOL */}
                        <td className={`py-2.5 px-2 text-right font-bold text-xs tabular-nums ${pnlUsd >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                          <div className="flex flex-wrap items-baseline gap-x-1 justify-end">
                            <span>{pnlDisp.usdText}</span>
                            <span className="text-[10px] font-medium opacity-80 whitespace-nowrap">({pnlDisp.solText})</span>
                          </div>
                        </td>

                        {/* Entry price ($ & SOL) */}
                        <td className="py-2.5 px-2 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                          <div className="flex flex-wrap items-baseline gap-x-1 justify-end">
                            <span>${fmtUsdPrice(p.entry_price)}</span>
                            <span className="text-[10px] text-slate-400 whitespace-nowrap">· {fmtSolPrice(p.entry_price, solPriceUsd)}</span>
                          </div>
                        </td>

                        {/* Price now ($ & SOL): Green if in profit, Red if in loss */}
                        <td className={`py-2.5 px-2 text-right font-bold tabular-nums text-xs rounded ${inProfit ? 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/5' : 'text-rose-500 dark:text-rose-400 bg-rose-500/5'}`}>
                          <div className="flex flex-wrap items-baseline gap-x-1 justify-end">
                            <span>${fmtUsdPrice(currentPrice)}</span>
                            <span className="text-[10px] font-semibold opacity-85 whitespace-nowrap">· {fmtSolPrice(currentPrice, solPriceUsd)}</span>
                          </div>
                        </td>

                        {/* Peak / Low */}
                        <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap text-[11px]">
                          <div>
                            <span className="text-emerald-500/90">+{peakPct.toFixed(1)}%</span>
                            <span className="text-slate-500 mx-1">/</span>
                            <span className="text-rose-500/90">{lowPct.toFixed(1)}%</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-1 mt-0.5">
                            {p.principal_recovered && (
                              <span
                                className="inline-block px-1.5 py-0.2 rounded bg-teal-500/15 text-teal-500 border border-teal-500/30 text-[9px] font-bold uppercase tracking-wider"
                                title={`Principal recovered: $${(p.recovered_usd ?? 0).toFixed(2)}${typeof p.next_scale_out_pct === 'number' && p.next_scale_out_pct > 0 ? ` · Next partial sell at +${p.next_scale_out_pct.toFixed(0)}%` : ''}`}
                              >
                                {typeof p.next_scale_out_pct === 'number' && p.next_scale_out_pct > 0
                                  ? `Principal Safe · Next +${p.next_scale_out_pct.toFixed(0)}%`
                                  : 'Principal Safe'}
                              </span>
                            )}
                            {p.trailing_active && (
                              <span
                                className="inline-block px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 text-[9px] font-bold uppercase tracking-wider"
                                title="Profit target reached — trailing stop is armed and tracking peak"
                              >
                                {typeof p.trailing_floor_pct === 'number'
                                  ? `Trail ≥ +${p.trailing_floor_pct.toFixed(1)}%`
                                  : 'Trail On'}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Held */}
                        <td className="py-2.5 px-2 text-right text-slate-500 tabular-nums whitespace-nowrap">
                          {fmtHeld(heldMins)}
                        </td>

                        {/* Coin key */}
                        <td className="py-2.5 px-2 max-w-[95px]">
                          <div className="flex items-center gap-1">
                            <span className="truncate text-slate-500 dark:text-slate-400 text-[11px]" title={p.mint}>
                              {p.mint}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(p.mint)}
                              className="text-slate-400 hover:text-slate-100 p-0.5 rounded transition-colors shrink-0"
                              title="Copy address"
                            >
                              {copiedKey === p.mint ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>

                        {/* Dev wallet (launches & rug pulls) */}
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          {p.creator ? (
                            (() => {
                              const launches = Math.max(1, Number(p.creator_launches ?? (typeof p.creator_prior_launches === 'number' ? p.creator_prior_launches + 1 : 1)));
                              const rugs = Math.max(0, Number(p.creator_rugged ?? 0));
                              const fastTip =
                                typeof p.creator_fast_rug_min === 'number'
                                  ? ` · Fastest rug: ${p.creator_fast_rug_min.toFixed(1)}m`
                                  : '';
                              const badgeClass =
                                rugs > 0
                                  ? 'bg-rose-500/15 text-rose-500 dark:text-rose-400 border-rose-500/30'
                                  : launches > 3
                                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
                              return (
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1 text-[11px]">
                                    <a
                                      href={`https://solscan.io/account/${p.creator}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-slate-600 dark:text-slate-300 hover:text-teal-500 dark:hover:text-teal-400 transition-colors"
                                      title={`Dev wallet: ${p.creator} (view on Solscan)`}
                                    >
                                      {p.creator.slice(0, 4)}...{p.creator.slice(-4)}
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(p.creator!)}
                                      className="text-slate-400 hover:text-slate-200 p-0.5 rounded transition-colors shrink-0"
                                      title={`Copy dev wallet (${p.creator})`}
                                    >
                                      {copiedKey === p.creator ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    </button>
                                  </div>
                                  <span
                                    className={`inline-block px-1.5 py-0.2 rounded border text-[10px] font-semibold tabular-nums ${badgeClass}`}
                                    title={`Dev wallet launched ${launches} tracked coin(s), ${rugs} rug pull(s)${fastTip}`}
                                  >
                                    {launches} launched · {rugs} {rugs === 1 ? 'rug' : 'rugs'}
                                  </span>
                                </div>
                              );
                            })()
                          ) : (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">Unknown</span>
                          )}
                        </td>

                        {/* Entry Signal (Auto Sniper vs Smart Money Whale Copy) */}
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          {(() => {
                            const hitWallets = Array.isArray(p.smart_wallets_hit) ? p.smart_wallets_hit.filter(Boolean) : [];
                            const details = Array.isArray(p.smart_wallet_details) ? p.smart_wallet_details : [];
                            if (p.smart_money_entry || hitWallets.length > 0) {
                              const walletRows = details.length > 0
                                ? details
                                : hitWallets.map((address) => ({ address, label: undefined, winRate: undefined, source: undefined }));
                              return (
                                <div className="space-y-1">
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-bold"
                                    title={`Bought with tracked Smart Money wallet(s): ${hitWallets.join(', ')}`}
                                  >
                                    <Users className="w-3 h-3 shrink-0" />
                                    <span>Whale Copy{hitWallets.length > 1 ? ` (${hitWallets.length})` : ''}</span>
                                  </span>
                                  {walletRows.map((w) => {
                                    const winHint = typeof w.winRate === 'number' ? ` · ${w.winRate.toFixed(0)}% WR` : '';
                                    const nameHint = w.label ? `${w.label}${winHint}` : (w.winRate !== undefined ? `${w.winRate.toFixed(0)}% WR` : '');
                                    return (
                                      <div key={w.address} className="flex items-center gap-1 text-[11px]">
                                        <a
                                          href={`https://solscan.io/account/${w.address}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
                                          title={`Bought because Smart Money wallet ${w.address} entered${nameHint ? ` (${nameHint})` : ''} — view on Solscan`}
                                        >
                                          {w.address.slice(0, 4)}...{w.address.slice(-4)}
                                        </a>
                                        {nameHint && (
                                          <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[110px]" title={nameHint}>
                                            ({nameHint})
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(w.address)}
                                          className="text-slate-400 hover:text-slate-200 p-0.5 rounded transition-colors shrink-0"
                                          title={`Copy whale wallet (${w.address})`}
                                        >
                                          {copiedKey === w.address ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            }
                            return (
                              <span
                                className="inline-block px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20 text-[10px] font-medium"
                                title="Entered by standard Auto Sniper launch scan filters"
                              >
                                Auto Sniper
                              </span>
                            );
                          })()}
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 px-2 text-right space-x-1.5 whitespace-nowrap">
                          {p.tx_buy && (
                            <a
                              href={`https://solscan.io/tx/${p.tx_buy}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20 text-[11px] font-semibold transition-colors"
                              title="Inspect buy transaction on Solscan"
                            >
                              <span>TX</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          <a
                            href={p.url || `https://dexscreener.com/solana/${p.mint}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20 text-[11px] font-semibold transition-colors"
                          >
                            <span>Chart</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <button
                            type="button"
                            onClick={() => void handleSellNow(p.mint)}
                            className={`px-2 py-1 rounded text-[11px] font-bold transition-colors ${
                              isConfirmingSell
                                ? 'bg-rose-600 text-white hover:bg-rose-500'
                                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20'
                            }`}
                          >
                            {isConfirmingSell ? 'Confirm Sell?' : 'Sell now'}
                          </button>
                          <button
                            type="button"
                            disabled={deletingMint === p.mint}
                            onClick={() => void handleForceDelete(p.mint)}
                            className={`px-2 py-1 rounded text-[11px] font-bold transition-colors disabled:opacity-50 ${
                              confirmDeleteMint === p.mint
                                ? 'bg-amber-600 text-white hover:bg-amber-500'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                            }`}
                            title="Manually clear stuck or rugged position and free slot"
                          >
                            {deletingMint === p.mint
                              ? 'Deleting...'
                              : confirmDeleteMint === p.mint
                                ? 'Confirm Delete?'
                                : 'Force Delete'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Bottom helper row */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (positionsList.length === 0) return;
                  const allKeys = positionsList.map((p) => p.mint).join('\n');
                  handleCopy(allKeys);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
              >
                Copy all coin keys
              </button>
            </div>
            <span className="text-slate-500 dark:text-slate-400 font-mono">
              {maxSlots > 0 ? `${positionsList.length} of ${maxSlots} slots in use` : `${positionsList.length} open (Slot limit OFF)`}
            </span>
          </div>
        </div>
        );
      })()}

      {/* Tab Content: Smart Money Watchlist & Explorer */}
      {activeTab === 'smart_money' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6 shadow-sm">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-teal-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Smart Money &amp; Whale Watchlist Explorer</h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Monitor and follow top-performing Solana meme whales &amp; KOL wallets in real time (<span className="font-mono text-teal-600 dark:text-teal-400">&lt;200ms WebSocket</span>). Note: Whale accumulation can take hours or days to complete.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                <input
                  type="checkbox"
                  checked={Boolean(draftSettings.smart_money_enabled !== false)}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    const curMode = String(draftSettings.smart_money_scan_mode || 'both');
                    const nextMode = !enabled && curMode === 'smart_money_only' ? 'sniper_only' : enabled && curMode === 'sniper_only' ? 'both' : curMode;
                    void saveQuickSniperSettings(
                      { smart_money_enabled: enabled, smart_money_scan_mode: nextMode },
                      enabled ? 'Smart Money following enabled' : 'Smart Money following paused'
                    );
                  }}
                  disabled={savingSmartConfig}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {draftSettings.smart_money_enabled !== false ? 'Following ACTIVE' : 'Following PAUSED'}
                </span>
                <span className={`w-2 h-2 rounded-full ${draftSettings.smart_money_enabled !== false ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              </label>
            </div>
          </div>

          {/* 4 Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-1.5">
              <span className="text-[11px] font-mono text-slate-500 uppercase font-semibold block">Tracked Smart Wallets</span>
              <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>
                  {Array.isArray(draftSettings.smart_wallets) ? draftSettings.smart_wallets.length : 0} /{' '}
                  {Number(draftSettings.smart_money_max_wallets ?? 50) <= 0 ? '∞' : Number(draftSettings.smart_money_max_wallets ?? 50)}
                </span>
                {Array.isArray(draftSettings.smart_wallets) && draftSettings.smart_wallets.length > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-sans font-semibold">
                    Live
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Refresh every {Number(draftSettings.smart_money_refresh_interval_sec || 30)}s · Set limit 0 for Unlimited.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-1.5">
              <span className="text-[11px] font-mono text-slate-500 uppercase font-semibold block">Active Scan Mode</span>
              <div className="text-base font-bold font-mono text-teal-600 dark:text-teal-400">
                {draftSettings.smart_money_scan_mode === 'smart_money_only'
                  ? 'Whale Wallets Only'
                  : draftSettings.smart_money_scan_mode === 'sniper_only'
                    ? 'Sniper Bot Only'
                    : 'Both (Sniper + Whales)'}
              </div>
              <p className="text-[11px] text-slate-500">
                {draftSettings.smart_money_follow_older_coins !== false
                  ? `Follows whale coins up to ${Number(draftSettings.smart_money_max_coin_age_hours ?? 72) || '∞'}h old`
                  : 'New launches only'}
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-1.5">
              <span className="text-[11px] font-mono text-slate-500 uppercase font-semibold block">Confluence &amp; Boost</span>
              <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {draftSettings.smart_money_min_confluence ?? 1}W · +{draftSettings.smart_money_size_boost_pct ?? 35}%
              </div>
              <p className="text-[11px] text-slate-500">Min whale confluence before boosting buy size.</p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-1.5">
              <span className="text-[11px] font-mono text-slate-500 uppercase font-semibold block">Auto-Exit on Dump</span>
              <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100">
                {draftSettings.smart_money_auto_exit_on_sell !== false ? 'Enabled' : 'Disabled'}
              </div>
              <p className="text-[11px] text-slate-500">Emergency market-sell if tracked whale exits.</p>
            </div>
          </div>

          {/* Solscan Portfolio vs Defi Activities + 1h-72h+ Held Coins Notice */}
          <div className="p-3.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.04] text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-semibold text-sky-700 dark:text-sky-300">
                How to inspect coins on Solscan &amp; follow 1h–1d+ whale holdings:
              </p>
              <p>
                Solscan&apos;s <span className="font-semibold">Portfolio</span> tab only shows tokens the whale is <span className="font-semibold">still holding</span> right now. When a whale already sold a winning trade in profit (tagged <span className="font-mono text-amber-500">Closed Profit</span>), look in their <span className="font-semibold">Defi Activities</span> tab or click the coin mint address directly. Active <span className="font-semibold">1h–72h+</span> holdings in whale portfolios are scanned automatically on-chain via RPC.
              </p>
            </div>
          </div>

          {/* Quick Action, Scan Mode, Custom Wallet Limit & Refresh Interval Bar */}
          <div className="flex flex-col gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={discoveringWhales}
                  onClick={() => void handleDiscoverWhales()}
                  className="px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-50"
                >
                  <Search className={`w-3.5 h-3.5 ${discoveringWhales ? 'animate-spin' : ''}`} />
                  <span>{discoveringWhales ? 'Scanning Pools & Portfolios...' : 'Scan & Discover Active Whales'}</span>
                </button>

                {/* Scan Mode Selector */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs">
                  <span className="text-slate-500 font-medium">Mode:</span>
                  <select
                    value={String(draftSettings.smart_money_scan_mode || 'both')}
                    onChange={(e) => {
                      const nextMode = e.target.value as 'both' | 'smart_money_only' | 'sniper_only';
                      const enabledFlag = nextMode !== 'sniper_only';
                      void saveQuickSniperSettings(
                        {
                          smart_money_scan_mode: nextMode,
                          smart_money_enabled: enabledFlag,
                        },
                        `Scan mode set to ${
                          nextMode === 'smart_money_only'
                            ? 'Whale Wallets Only'
                            : nextMode === 'sniper_only'
                              ? 'Sniper Bot Only'
                              : 'Both (Sniper + Whales)'
                        }`
                      );
                    }}
                    disabled={savingSmartConfig}
                    className="bg-transparent font-bold text-teal-600 dark:text-teal-400 focus:outline-none cursor-pointer"
                  >
                    <option value="both">Both (Sniper + Whales)</option>
                    <option value="smart_money_only">Whale Wallets Only</option>
                    <option value="sniper_only">Sniper Bot Only</option>
                  </select>
                </div>

                {/* Custom Wallet Search / Track Limit (0 = Unlimited) */}
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  title="Maximum smart wallets to discover & track. Enter 0 for Unlimited (up to 5000)."
                >
                  <span className="text-slate-500 font-medium">Wallets Limit:</span>
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step={25}
                    value={draftSettings.smart_money_max_wallets ?? 50}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(5000, parseInt(e.target.value || '0', 10) || 0));
                      setDraftSettings({ ...draftSettings, smart_money_max_wallets: val });
                      markSettingsDirty(true);
                    }}
                    className="w-16 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 font-mono">
                    {Number(draftSettings.smart_money_max_wallets ?? 50) <= 0 ? '(∞)' : ''}
                  </span>
                </div>

                {/* Refresh Interval Seconds */}
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  title="How often (in seconds) background whale discovery & portfolio scanning refreshes."
                >
                  <span className="text-slate-500 font-medium">Refresh (s):</span>
                  <input
                    type="number"
                    min={10}
                    max={86400}
                    step={5}
                    value={draftSettings.smart_money_refresh_interval_sec ?? 30}
                    onChange={(e) => {
                      const val = Math.max(10, Math.min(86400, parseInt(e.target.value || '30', 10) || 30));
                      setDraftSettings({ ...draftSettings, smart_money_refresh_interval_sec: val });
                      markSettingsDirty(true);
                    }}
                    className="w-16 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isSettingsDirty && (
                  <button
                    type="button"
                    disabled={savingSmartConfig}
                    onClick={() =>
                      void saveQuickSniperSettings(
                        {
                          smart_money_max_wallets: Number(draftSettings.smart_money_max_wallets ?? 50),
                          smart_money_refresh_interval_sec: Number(draftSettings.smart_money_refresh_interval_sec ?? 30),
                          smart_money_auto_discover: draftSettings.smart_money_auto_discover !== false,
                          smart_money_prioritize_entries: draftSettings.smart_money_prioritize_entries !== false,
                          smart_money_follow_older_coins: draftSettings.smart_money_follow_older_coins !== false,
                          smart_money_max_coin_age_hours: Number(draftSettings.smart_money_max_coin_age_hours ?? 72),
                          smart_money_scan_mode: String(draftSettings.smart_money_scan_mode || 'both'),
                          smart_money_enabled: draftSettings.smart_money_enabled !== false,
                          smart_wallets: Array.isArray(draftSettings.smart_wallets) ? draftSettings.smart_wallets : [],
                        },
                        'Smart Money config saved'
                      )
                    }
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingSmartConfig ? 'Saving...' : 'Save Config'}</span>
                  </button>
                )}
                {Array.isArray(draftSettings.smart_wallets) && draftSettings.smart_wallets.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopy(draftSettings.smart_wallets.join('\n'))}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors"
                    >
                      Copy All ({draftSettings.smart_wallets.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftSettings({ ...draftSettings, smart_wallets: [] });
                        markSettingsDirty(true);
                        pushToast({ kind: 'info', title: 'Watchlist cleared (click Save Config to persist)' });
                      }}
                      className="px-3 py-1.5 rounded-lg border border-rose-500/20 text-rose-500 hover:bg-rose-500/10 text-xs font-bold transition-colors"
                    >
                      Clear All
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Second Row: Auto-Discover, Prioritize Whale Buys, Follow 1h-72h+ Held Coins */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <input
                  type="checkbox"
                  checked={Boolean(draftSettings.smart_money_auto_discover !== false)}
                  onChange={(e) => {
                    setDraftSettings({ ...draftSettings, smart_money_auto_discover: e.target.checked });
                    markSettingsDirty(true);
                  }}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Auto-Discover</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <input
                  type="checkbox"
                  checked={Boolean(draftSettings.smart_money_prioritize_entries !== false)}
                  onChange={(e) => {
                    setDraftSettings({ ...draftSettings, smart_money_prioritize_entries: e.target.checked });
                    markSettingsDirty(true);
                  }}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Prioritize Whale Buys</span>
              </label>

              <label
                className="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                title="Allows following coins that whales have held for 1h–72h+ instead of only brand-new launches."
              >
                <input
                  type="checkbox"
                  checked={Boolean(draftSettings.smart_money_follow_older_coins !== false)}
                  onChange={(e) => {
                    setDraftSettings({ ...draftSettings, smart_money_follow_older_coins: e.target.checked });
                    markSettingsDirty(true);
                  }}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Follow 1h–72h+ Whale Coins</span>
              </label>

              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <span className="text-slate-500 font-medium">Max Coin Age (h):</span>
                <input
                  type="number"
                  min={0}
                  max={720}
                  step={6}
                  value={draftSettings.smart_money_max_coin_age_hours ?? 72}
                  disabled={draftSettings.smart_money_follow_older_coins === false}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(720, parseInt(e.target.value || '72', 10) || 0));
                    setDraftSettings({ ...draftSettings, smart_money_max_coin_age_hours: val });
                    markSettingsDirty(true);
                  }}
                  className="w-14 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none disabled:opacity-50"
                />
                <span className="text-[10px] text-slate-400 font-mono">
                  {Number(draftSettings.smart_money_max_coin_age_hours ?? 72) === 0 ? '(Any age)' : 'h'}
                </span>
              </div>
            </div>
          </div>

          {/* Discovered Whales Suggestion Panel */}
          {discoveredWhales.length > 0 && (
            <div className="p-4 rounded-xl border border-teal-500/30 bg-teal-500/[0.03] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Recently Discovered Active Whales ({discoveredWhales.length})</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const current = Array.isArray(draftSettings.smart_wallets) ? draftSettings.smart_wallets : [];
                    const toAdd = discoveredWhales.map((w) => w.address);
                    const merged = Array.from(new Set([...current, ...toAdd]));
                    setDraftSettings({ ...draftSettings, smart_wallets: merged });
                    markSettingsDirty(true);
                    setDiscoveredWhales([]);
                    pushToast({ kind: 'success', title: 'All discovered whales added to watchlist' });
                  }}
                  className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline"
                >
                  + Add All to Watchlist
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {discoveredWhales.map((w) => {
                  const isTracked = Array.isArray(draftSettings.smart_wallets) && draftSettings.smart_wallets.includes(w.address);
                  return (
                    <div
                      key={w.address}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <span className="font-bold text-slate-900 dark:text-slate-100">{w.label}</span>
                        <span className="text-emerald-500 font-bold">{w.winRate} Win</span>
                      </div>
                      <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                        <span>
                          Recent: <strong className="text-slate-800 dark:text-slate-200">${w.recentToken}</strong>
                          {w.recentAction && (
                            <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${w.recentAction === 'HOLDING' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
                              {w.recentAction === 'HOLDING' ? 'Holding' : 'Closed Profit'}
                            </span>
                          )}
                        </span>
                        <span>+{w.totalProfitSol} SOL</span>
                      </div>
                      {w.recentMint && (
                        <div className="space-y-1 bg-slate-50 dark:bg-slate-900/70 px-2 py-1.5 rounded border border-slate-200/70 dark:border-slate-800">
                          <div className="flex items-start justify-between gap-1.5 font-mono text-[10px]">
                            <a
                              href={`https://solscan.io/token/${w.recentMint}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-teal-600 dark:text-teal-400 hover:underline break-all select-all"
                              title={`Open coin page on Solscan: ${w.recentMint}`}
                            >
                              {w.recentMint}
                            </a>
                            <button
                              type="button"
                              onClick={() => handleCopy(w.recentMint!)}
                              className="text-slate-400 hover:text-slate-200 shrink-0 mt-0.5"
                              title="Copy coin address"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-sans">
                            <a
                              href={`https://dexscreener.com/solana/${w.recentMint}?maker=${w.address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-600 dark:text-teal-300 hover:bg-teal-500/25 font-semibold"
                              title="Open DexScreener coin chart filtered to this whale wallet's trades"
                            >
                              <span>Coin + Wallet</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                            <a
                              href={`https://solscan.io/token/${w.recentMint}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-teal-400 font-semibold"
                            >
                              <span>Coin ↗</span>
                            </a>
                            <a
                              href={`https://solscan.io/account/${w.address}#defiactivities`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 font-semibold"
                            >
                              <span>Wallet ↗</span>
                            </a>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                        <a
                          href={`https://solscan.io/account/${w.address}#defiactivities`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-slate-400 hover:text-teal-400"
                        >
                          {w.address.slice(0, 4)}...{w.address.slice(-4)} ↗
                        </a>
                        <button
                          type="button"
                          disabled={isTracked}
                          onClick={() => {
                            const current = Array.isArray(draftSettings.smart_wallets) ? draftSettings.smart_wallets : [];
                            if (!current.includes(w.address)) {
                              setDraftSettings({ ...draftSettings, smart_wallets: [...current, w.address] });
                              markSettingsDirty(true);
                              pushToast({ kind: 'success', title: `Added ${w.label} to watchlist` });
                            }
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            isTracked
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                              : 'bg-teal-600 hover:bg-teal-500 text-white'
                          }`}
                        >
                          {isTracked ? 'Tracked' : '+ Add'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add Wallet Address Input */}
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30">
            <input
              type="text"
              placeholder="Enter Custom Solana Wallet Address (e.g. 5W9...)"
              value={newSmartWalletInput}
              onChange={(e) => setNewSmartWalletInput(e.target.value)}
              className="flex-1 min-w-[280px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              type="button"
              onClick={() => {
                const addr = newSmartWalletInput.trim();
                if (!addr) return;
                const current = Array.isArray(draftSettings.smart_wallets) ? draftSettings.smart_wallets : [];
                if (current.includes(addr)) {
                  pushToast({ kind: 'info', title: 'Wallet already in watchlist' });
                  return;
                }
                const updated = [...current, addr];
                setDraftSettings({ ...draftSettings, smart_wallets: updated });
                markSettingsDirty(true);
                setNewSmartWalletInput('');
                pushToast({ kind: 'success', title: 'Smart wallet added (click Save Config to persist)' });
              }}
              className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-colors"
            >
              Add Wallet Address
            </button>
          </div>

          {/* Tracked Wallets Table */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Tracked Smart Wallets ({Array.isArray(draftSettings.smart_wallets) ? draftSettings.smart_wallets.length : 0} /{' '}
                {Number(draftSettings.smart_money_max_wallets ?? 50) <= 0 ? 'Unlimited' : Number(draftSettings.smart_money_max_wallets ?? 50)})
              </h4>
              {Array.isArray(draftSettings.smart_wallets) && draftSettings.smart_wallets.length > 0 && (
                <input
                  type="text"
                  placeholder="Filter wallet, coin, or mint..."
                  value={smartWalletSearch}
                  onChange={(e) => setSmartWalletSearch(e.target.value)}
                  className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 font-mono w-60"
                />
              )}
            </div>

            {(!Array.isArray(draftSettings.smart_wallets) || draftSettings.smart_wallets.length === 0) ? (
              <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                <p className="font-semibold text-slate-700 dark:text-slate-300">
                  {discoveringWhales ? 'Scanning live Solana pools and WebSocket traders...' : 'Auto-Discovering Active Profitable Solana Wallets'}
                </p>
                <p className="max-w-md mx-auto">
                  Real non-creator wallets with verified positive SOL profits are automatically discovered from live PumpPortal streams and GeckoTerminal winning pools (rugger wallets are automatically excluded).
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={discoveringWhales}
                    onClick={() => void handleDiscoverWhales()}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow-sm disabled:opacity-50"
                  >
                    {discoveringWhales ? 'Scanning Now...' : 'Scan & Discover Active Whales Now'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl max-h-[460px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px]">
                      <th className="py-2.5 px-3 font-semibold">#</th>
                      <th className="py-2.5 px-3 font-semibold">Wallet Profile &amp; Source</th>
                      <th className="py-2.5 px-3 font-semibold">Recent / Held Coin &amp; Address</th>
                      <th className="py-2.5 px-3 font-semibold">Wallet Address</th>
                      <th className="py-2.5 px-3 font-semibold">Est. Win Rate / PnL</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {(draftSettings.smart_wallets as string[])
                      .map((addr, idx) => ({ addr, idx, profile: smartWalletProfiles[addr] }))
                      .filter(({ addr, profile }) => {
                        const q = smartWalletSearch.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          addr.toLowerCase().includes(q) ||
                          String(profile?.label || '').toLowerCase().includes(q) ||
                          String(profile?.recentToken || '').toLowerCase().includes(q) ||
                          String(profile?.recentMint || '').toLowerCase().includes(q) ||
                          String(profile?.source || '').toLowerCase().includes(q) ||
                          (Array.isArray(profile?.heldMints) &&
                            profile.heldMints.some(
                              (h) =>
                                h.symbol.toLowerCase().includes(q) ||
                                h.mint.toLowerCase().includes(q)
                            ))
                        );
                      })
                      .map(({ addr, idx, profile }) => {
                        const label = profile?.label || `Discovered Trader #${idx + 1}`;
                        const subLine = [
                          profile?.category || 'Custom / Observed Wallet',
                          profile?.source || '',
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        const winRate = profile?.winRate || 'Observed';
                        const pnlSol =
                          typeof profile?.totalProfitSol === 'number' && profile.totalProfitSol > 0
                            ? `+${profile.totalProfitSol.toFixed(2)} SOL`
                            : '';
                        const recentSym = profile?.recentToken ? `$${profile.recentToken}` : null;
                        const recentMint = profile?.recentMint || null;
                        const heldList = Array.isArray(profile?.heldMints) ? profile.heldMints : [];
                        return (
                          <tr key={addr} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                            <td className="py-2.5 px-3 text-slate-400 font-semibold">{idx + 1}</td>
                            <td className="py-2.5 px-3">
                              <span className="font-bold text-slate-900 dark:text-slate-100 block">{label}</span>
                              <span className="text-[10px] text-slate-500 font-sans block">{subLine}</span>
                            </td>
                            <td className="py-2.5 px-3 max-w-[300px]">
                              {recentSym || recentMint ? (
                                <div className="space-y-1.5">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-bold text-slate-900 dark:text-slate-100">
                                      {recentSym || 'Token'}
                                    </span>
                                    {profile?.recentAction && (
                                      <span
                                        className={`text-[9px] px-1.5 py-0.5 rounded font-sans font-bold uppercase ${
                                          profile.recentAction === 'HOLDING'
                                            ? 'bg-emerald-500/15 text-emerald-500'
                                            : 'bg-amber-500/15 text-amber-500'
                                        }`}
                                        title={
                                          profile.recentAction === 'HOLDING'
                                            ? 'Whale currently holds this coin on-chain (visible in Solscan Portfolio)'
                                            : 'Whale already exited in profit (visible in Solscan Defi Activities tab, not Portfolio)'
                                        }
                                      >
                                        {profile.recentAction === 'HOLDING' ? 'Holding' : 'Exited Profit'}
                                      </span>
                                    )}
                                  </div>
                                  {recentMint && (
                                    <div className="space-y-1">
                                      <div className="flex items-start gap-1.5 text-[10px]">
                                        <a
                                          href={`https://dexscreener.com/solana/${recentMint}?maker=${addr}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-teal-600 dark:text-teal-400 hover:underline break-all select-all font-mono"
                                          title={`Open coin chart + this whale's trades: ${recentMint}`}
                                        >
                                          {recentMint}
                                        </a>
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(recentMint)}
                                          className="text-slate-400 hover:text-slate-200 shrink-0 mt-0.5"
                                          title="Copy direct coin mint address"
                                        >
                                          <Copy className="w-3 h-3" />
                                        </button>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-1 text-[10px] font-sans">
                                        <a
                                          href={`https://dexscreener.com/solana/${recentMint}?maker=${addr}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Open coin page filtered directly to this whale wallet's trades"
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-600 dark:text-teal-300 hover:bg-teal-500/25 font-semibold"
                                        >
                                          <span>Coin + Wallet</span>
                                          <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                        <a
                                          href={`https://solscan.io/token/${recentMint}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Open Coin page on Solscan"
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-teal-400 font-semibold"
                                        >
                                          <span>Coin ↗</span>
                                        </a>
                                        <a
                                          href={`https://solscan.io/account/${addr}#defiactivities`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Open Wallet swaps & Defi Activities on Solscan"
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 font-semibold"
                                        >
                                          <span>Wallet ↗</span>
                                        </a>
                                      </div>
                                    </div>
                                  )}
                                  {heldList.length > 1 && (
                                    <div className="flex flex-wrap gap-1 pt-0.5">
                                      {heldList.slice(1, 3).map((h) => (
                                        <a
                                          key={h.mint}
                                          href={`https://dexscreener.com/solana/${h.mint}?maker=${addr}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-teal-400"
                                          title={`${h.mint} (${h.ageHours}h old) — view coin & wallet trades`}
                                        >
                                          +${h.symbol} ({h.ageHours}h)
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">Waiting for next trade...</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300 select-all">
                              <span title={addr}>{addr.slice(0, 8)}...{addr.slice(-6)}</span>
                            </td>
                            <td className="py-2.5 px-3 tabular-nums">
                              <span className="font-bold text-emerald-500 block">{winRate}</span>
                              {pnlSol && <span className="text-[10px] text-teal-500 font-semibold block">{pnlSol}</span>}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Live (&lt;200ms)</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleCopy(addr)}
                                className="px-2 py-1 rounded bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20 text-[11px] font-semibold transition-colors"
                              >
                                Copy
                              </button>
                              <a
                                href={`https://solscan.io/account/${addr}#defiactivities`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View wallet swaps & Defi Activities on Solscan (shows closed profit coins)"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 text-[11px] font-semibold transition-colors"
                              >
                                <span>Activities</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <a
                                href={`https://solscan.io/account/${addr}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View current Solscan Portfolio balances"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20 text-[11px] font-semibold transition-colors"
                              >
                                <span>Portfolio</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <button
                                type="button"
                                onClick={() => {
                                  const current = Array.isArray(draftSettings.smart_wallets) ? draftSettings.smart_wallets : [];
                                  const updated = current.filter((w: string) => w !== addr);
                                  setDraftSettings({ ...draftSettings, smart_wallets: updated });
                                  markSettingsDirty(true);
                                  pushToast({ kind: 'info', title: 'Wallet removed (click Save Config to persist)' });
                                }}
                                className="px-2 py-1 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-[11px] font-bold transition-colors"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Smart Money Live Activity & Whale Stream Log Console */}
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-500 animate-pulse" />
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Smart Money &amp; Whale Stream Activity Log
                </h4>
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 font-semibold">
                  {running ? 'WS Stream Live (<200ms)' : 'Engine Standby'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleClearLogs();
                  }}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  Clear stream log
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300 max-h-56 overflow-y-auto space-y-1.5 shadow-inner">
              {(() => {
                const smLogs = logs.filter(
                  (l) =>
                    l.message.includes('[SmartMoney]') ||
                    l.message.toLowerCase().includes('whale') ||
                    l.message.toLowerCase().includes('smart_money') ||
                    l.message.toLowerCase().includes('confluence')
                );
                if (smLogs.length === 0) {
                  const trackedCount = Array.isArray(draftSettings.smart_wallets) ? draftSettings.smart_wallets.length : 0;
                  return (
                    <div className="space-y-1.5 text-slate-400 text-[11px]">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        <span>[SmartMoney] WebSocket trade listener connected (<span className="text-teal-400">&lt;200ms latency</span>).</span>
                      </div>
                      <div>
                        [SmartMoney] Actively monitoring {trackedCount} tracked whale wallet(s) across PumpPortal &amp; DEX launch transactions...
                      </div>
                      <div className="text-slate-500">
                        [SmartMoney] Auto-exit guard active: watching open mints for smart wallet dump exits ({draftSettings.smart_money_auto_exit_on_sell !== false ? 'Enabled' : 'Disabled'}).
                      </div>
                      <div className="text-slate-500">
                        [SmartMoney] Confluence trigger: minimum {draftSettings.smart_money_min_confluence ?? 1} wallet(s) required for +{draftSettings.smart_money_size_boost_pct ?? 35}% conviction boost.
                      </div>
                    </div>
                  );
                }
                return smLogs.slice(-50).map((l) => (
                  <div key={l.id} className="flex items-start gap-2 leading-relaxed text-[11px]">
                    <span className="text-slate-500 shrink-0 select-none">[{l.timestamp}]</span>
                    <span className={l.message.includes('★') ? 'text-amber-400 font-bold' : l.message.includes('Discovered') ? 'text-teal-400' : 'text-slate-300'}>
                      {l.message}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Tab Content: Trade History */}
      {activeTab === 'history' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                {isLiveMode
                  ? `Live Wallet Trade Ledger (${trades.length} ${trades.length === 1 ? 'trade' : 'trades'})`
                  : `Full Paper Trade Ledger (${trades.length} ${trades.length === 1 ? 'trade' : 'trades'})`}
              </h2>
              <span className="text-[11px] text-slate-500">
                Win Rate: <strong className="text-slate-900 dark:text-slate-100">{winRateText}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Filter coin or reason..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 font-mono w-48"
              />
              <button
                type="button"
                onClick={() => void handleExportCsv()}
                disabled={exportingCsv}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                title="Export closed trades and PnL ledger to CSV"
              >
                <Download className="w-3.5 h-3.5 text-emerald-500" />
                <span>{exportingCsv ? 'Exporting...' : 'Export CSV'}</span>
              </button>
            </div>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              No trades match the filter or have been recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-mono text-[11px]">
                    <th className="py-2 px-2 font-semibold">Time</th>
                    <th className="py-2 px-2 font-semibold">Status</th>
                    <th className="py-2 px-2 font-semibold">Outcome</th>
                    <th className="py-2 px-2 font-semibold">Coin</th>
                    <th className="py-2 px-2 font-semibold text-right">Buy Price ($ / SOL)</th>
                    <th className="py-2 px-2 font-semibold text-right">Sell Price ($ / SOL)</th>
                    <th className="py-2 px-2 font-semibold text-right">Buy / Exit ($ &amp; Diff)</th>
                    <th className="py-2 px-2 font-semibold text-right">PnL ($ / SOL)</th>
                    <th className="py-2 px-2 font-semibold text-right">PnL %</th>
                    <th className="py-2 px-2 font-semibold">Reason</th>
                    <th className="py-2 px-2 font-semibold text-center">Chart</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono">
                  {filteredTrades.map((t, idx) => {
                    const status = t.tradeStatus || (t.action === 'BUY' ? 'OPEN' : t.action === 'PARTIAL' ? 'PARTIAL' : 'CLOSED');
                    const isOpenOnly = status === 'OPEN';
                    const isPartial = status === 'PARTIAL';
                    const numPnlUsd = parseFloat(t.pnlUsd);
                    const numPnlPct = parseFloat(t.pnlPct);
                    const buyTotalNum = parseFloat(t.buyAmountUsd ?? t.amount ?? '0');
                    const exitTotalNum = parseFloat(t.exitAmountUsd ?? (isOpenOnly ? '' : t.amount) ?? '');
                    const hasExitTotal = !isOpenOnly && Number.isFinite(exitTotalNum);
                    const diffNum = Number.isFinite(parseFloat(t.diffUsd || ''))
                      ? parseFloat(t.diffUsd!)
                      : hasExitTotal && Number.isFinite(buyTotalNum)
                        ? exitTotalNum - buyTotalNum
                        : NaN;

                    const tradeSolPx = t.solPriceUsd ? parseFloat(t.solPriceUsd) : null;
                    const effectiveSolPx = tradeSolPx && Number.isFinite(tradeSolPx) && tradeSolPx > 0 ? tradeSolPx : solPriceUsd;

                    const hasPnl = !isOpenOnly && !isNaN(numPnlUsd);
                    const isProfit = hasPnl && numPnlUsd > 0;
                    const isLoss = hasPnl && numPnlUsd < 0;

                    const buyDisp = fmtUnsignedUsdAndSol(Number.isFinite(buyTotalNum) ? buyTotalNum : 0, effectiveSolPx, 2);
                    const exitDisp = hasExitTotal ? fmtUnsignedUsdAndSol(exitTotalNum, effectiveSolPx, 2) : null;
                    const diffDisp = !isNaN(diffNum) ? fmtSignedUsdAndSol(diffNum, effectiveSolPx, 2) : null;
                    const pnlDisp = fmtSignedUsdAndSol(isNaN(numPnlUsd) ? 0 : numPnlUsd, effectiveSolPx, 4);

                    const chartUrl = (t.dexscreener || (t.mint ? `https://dexscreener.com/solana/${t.mint}` : '')).trim();
                    const hasEntryTimeDiff = Boolean(t.entryTime && t.exitTime && t.entryTime !== t.exitTime);

                    return (
                      <tr key={`${t.mint || idx}-${t.entryTime || t.time}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                        {/* Time */}
                        <td className="py-2 px-2 text-slate-500 whitespace-nowrap text-[11px]" title={hasEntryTimeDiff ? `Bought: ${t.entryTime}\nSold: ${t.exitTime}` : t.time}>
                          <div>{fmtDate(t.time)}</div>
                          {hasEntryTimeDiff && (
                            <div className="text-[10px] text-slate-400">
                              In: {fmtDate(t.entryTime!)}
                            </div>
                          )}
                        </td>

                        {/* Status badge */}
                        <td className="py-2 px-2 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isOpenOnly
                                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                                : isPartial
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                            }`}
                          >
                            {isOpenOnly ? 'OPEN' : isPartial ? 'PARTIAL' : 'CLOSED'}
                          </span>
                        </td>

                        {/* Outcome badge */}
                        <td className="py-2 px-2 whitespace-nowrap">
                          {isOpenOnly ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/10 text-sky-400">
                              HOLDING
                            </span>
                          ) : isPartial ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/15 text-teal-400 border border-teal-500/30">
                              SCALED
                            </span>
                          ) : isProfit ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                              <span>✓ PROFIT</span>
                            </span>
                          ) : isLoss ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
                              <span>✗ LOSS</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/20 text-slate-400">
                              EVEN
                            </span>
                          )}
                        </td>

                        {/* Coin */}
                        <td className="py-2 px-2">
                          <div className="font-bold text-slate-900 dark:text-slate-100 font-sans text-xs">
                            {t.symbol}
                          </div>
                          {t.mint && (
                            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                              <span className="truncate max-w-[65px]">{t.mint}</span>
                              <button
                                type="button"
                                onClick={() => handleCopy(t.mint)}
                                className="hover:text-slate-300"
                                title="Copy mint"
                              >
                                {copiedKey === t.mint ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          )}
                        </td>

                        {/* Buy Price ($ & SOL) */}
                        <td className="py-2 px-2 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                          {t.entryPrice ? (
                            <div className="flex flex-wrap items-baseline gap-x-1 justify-end">
                              <span>${fmtUsdPrice(t.entryPrice)}</span>
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">· {fmtSolPrice(t.entryPrice, effectiveSolPx)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        {/* Sell Price ($ & SOL) */}
                        <td
                          className={`py-2 px-2 text-right tabular-nums font-semibold ${
                            isOpenOnly
                              ? 'text-slate-500 font-normal'
                              : isProfit
                                ? 'text-emerald-500 dark:text-emerald-400'
                                : isLoss
                                  ? 'text-rose-500 dark:text-rose-400'
                                  : 'text-slate-300'
                          }`}
                        >
                          {!isOpenOnly && t.exitPrice ? (
                            <div className="flex flex-wrap items-baseline gap-x-1 justify-end">
                              <span>${fmtUsdPrice(t.exitPrice)}</span>
                              <span className="text-[10px] font-normal opacity-80 whitespace-nowrap">· {fmtSolPrice(t.exitPrice, effectiveSolPx)}</span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* Buy Total / Exit Total & Difference */}
                        <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                          {isOpenOnly ? (
                            <div>
                              <div className="text-slate-700 dark:text-slate-200">
                                Buy {buyDisp.usdText} <span className="text-[10px] text-slate-400">({buyDisp.solText})</span>
                              </div>
                              <div className="text-[10px] text-slate-400">Exit —</div>
                            </div>
                          ) : (
                            <div>
                              <div className="text-slate-700 dark:text-slate-200">
                                <span className="text-slate-400">{buyDisp.usdText}</span>
                                <span className="text-slate-500 mx-1">→</span>
                                <span className="font-semibold">{exitDisp ? exitDisp.usdText : '—'}</span>
                              </div>
                              {diffDisp && (
                                <div className={`text-[10px] font-bold ${diffNum > 0 ? 'text-emerald-500 dark:text-emerald-400' : diffNum < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-slate-400'}`}>
                                  Diff: {diffDisp.usdText} ({diffDisp.solText})
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* PnL ($ & SOL) */}
                        <td
                          className={`py-2 px-2 text-right font-bold tabular-nums text-xs ${
                            isOpenOnly ? 'text-slate-400' : isProfit ? 'text-emerald-500 dark:text-emerald-400' : isLoss ? 'text-rose-500 dark:text-rose-400' : 'text-slate-400'
                          }`}
                        >
                          {isOpenOnly ? (
                            '—'
                          ) : (
                            <div className="flex flex-wrap items-baseline gap-x-1 justify-end">
                              <span>{pnlDisp.usdText}</span>
                              <span className="text-[10px] font-medium opacity-80 whitespace-nowrap">({pnlDisp.solText})</span>
                            </div>
                          )}
                        </td>

                        {/* PnL (%) */}
                        <td
                          className={`py-2 px-2 text-right font-bold tabular-nums text-xs whitespace-nowrap ${
                            isOpenOnly ? 'text-slate-400' : isProfit ? 'text-emerald-500 dark:text-emerald-400' : isLoss ? 'text-rose-500 dark:text-rose-400' : 'text-slate-400'
                          }`}
                        >
                          {isOpenOnly ? '—' : !isNaN(numPnlPct) ? `${numPnlPct >= 0 ? '+' : ''}${numPnlPct.toFixed(2)}%` : '—'}
                        </td>

                        {/* Exit reason */}
                        <td className="py-2 px-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                                t.reason.startsWith('principal_recovery')
                                  ? 'bg-teal-500/15 text-teal-500 border border-teal-500/30'
                                  : t.reason.startsWith('scale_out')
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : t.reason.startsWith('take_profit')
                                      ? 'bg-emerald-500/10 text-emerald-500'
                                      : t.reason.startsWith('trailing_stop')
                                        ? 'bg-amber-500/10 text-amber-500'
                                        : t.reason.startsWith('manual')
                                          ? 'bg-blue-500/10 text-blue-500'
                                          : t.reason.startsWith('rugpull') || t.reason.startsWith('rug_')
                                            ? 'bg-rose-500/10 text-rose-400'
                                            : 'bg-slate-500/10 text-slate-400'
                              }`}
                            >
                              {t.reason || '—'}
                            </span>
                            {(t.exitCount ?? 0) > 1 && (
                              <span
                                className="text-[10px] text-slate-400"
                                title={(t.partialReasons || []).join(' → ')}
                              >
                                ({t.exitCount} exits)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* DexScreener & Solscan TX links */}
                        <td className="py-2 px-2 text-center">
                          <div className="inline-flex items-center gap-1 justify-center">
                            {t.txBuy && (
                              <a
                                href={`https://solscan.io/tx/${t.txBuy}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20 text-[11px] font-semibold transition-colors whitespace-nowrap"
                                title="Inspect buy transaction on Solscan"
                              >
                                <span>{t.txSell ? 'Buy TX' : 'Solscan'}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            {t.txSell && (
                              <a
                                href={`https://solscan.io/tx/${t.txSell}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20 text-[11px] font-semibold transition-colors whitespace-nowrap"
                                title="Inspect sell transaction on Solscan"
                              >
                                <span>{t.txBuy ? 'Sell TX' : 'Solscan'}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            {chartUrl ? (
                              <a
                                href={chartUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20 text-[11px] font-semibold transition-colors whitespace-nowrap"
                                title="Inspect chart on DexScreener"
                              >
                                <span>DexScreener</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              !t.txSell && !t.txBuy && <span className="text-slate-600">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Scan Log (Newest at top) */}
      {activeTab === 'logs' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#070B12] p-4 space-y-3 font-mono text-xs shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400 pb-2 border-b border-slate-800">
            <span>Live Python Sniper Console Output · Newest entries at top</span>
            <div className="flex items-center gap-3">
              <span>{logs.length} log events</span>
              <button
                type="button"
                onClick={() => void handleClearLogs()}
                disabled={clearingLogs || logs.length === 0}
                className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-[11px] font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                title="Clear console scan log output"
              >
                <Trash2 className="w-3 h-3 text-rose-400" />
                <span>{clearingLogs ? 'Clearing...' : 'Clear logs'}</span>
              </button>
            </div>
          </div>
          <div className="h-[450px] overflow-y-auto space-y-1 pr-2">
            {newestFirstLogs.length === 0 ? (
              <div className="text-slate-500 py-8 text-center">No scan log events yet. Start the Python bot to stream live console activity.</div>
            ) : (
              newestFirstLogs.map((l) => {
                const color =
                  l.tag === 'buy'
                    ? 'text-emerald-400 font-semibold'
                    : l.tag === 'sell'
                      ? 'text-sky-400 font-semibold'
                      : l.tag === 'reject'
                        ? 'text-slate-500'
                        : l.tag === 'warn'
                          ? 'text-amber-400'
                          : 'text-slate-300';
                return (
                  <div key={l.id} className={`${color} leading-relaxed`}>
                    <span className="text-slate-600 mr-2">[{l.timestamp}]</span>
                    <span>{l.message}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Settings matching gui.py */}
      {activeTab === 'settings' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Python Bot Configuration (settings.json)
                </h2>
                {isSettingsDirty && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
                    Unsaved edits
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Configure your trade sizing ($ / SOL), slippage, rug screen, age windows, Python executable path, and candidate sources.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftSettings({
                    ...draftSettings,
                    take_profit_pct: 25,
                    trailing_stop_pct: 8,
                    stop_loss_pct: 20,
                    max_hold_minutes: 60,
                    auto_rug_exit: true,
                    rug_liq_drop_pct: 50,
                    slippage_pct: 3,
                    use_real_swap_quotes: true,
                    min_age_minutes: 0,
                    max_age_minutes: 2,
                    ultra_early_grace_sec: 0,
                    min_liquidity_usd: 5000,
                    min_volume_m5_usd: 2000,
                    min_buys_m5: 8,
                    min_buy_sell_ratio_m5: 1.5,
                    min_recent_buys_60s: 3,
                    max_price_change_m5_pct: 200,
                    use_rugcheck: true,
                    strict_rugcheck: true,
                    require_lp_locked: false,
                    block_insider_bundles: true,
                    block_creator_dump: true,
                    check_creator_history: true,
                    max_creator_launches: 5,
                    max_creator_rugged_coins: 0,
                    creator_fast_rug_window_min: 60,
                    max_dev_hold_pct: 5,
                    rugcheck_max_score: 55,
                    max_top10_holder_pct: 35,
                    priority_fee_tier: 'fast',
                    recover_principal_enabled: false,
                    use_promoted_feeds: false,
                    fast_live_buy_enabled: true,
                    parallel_rug_screen_enabled: true,
                    jupiter_quota_guard_enabled: true,
                    direct_dex_fallback_enabled: true,
                    early_rug_shield_enabled: true,
                    anti_rug_tight_score_enabled: false,
                    anti_rug_pool_depth_check_enabled: true,
                    anti_rug_sell_sim_enabled: true,
                    anti_rug_copycat_cooldown_enabled: true,
                    option_enabled: {
                      ...(draftSettings.option_enabled && typeof draftSettings.option_enabled === 'object'
                        ? draftSettings.option_enabled
                        : {}),
                      min_age_minutes: false,
                      early_rug_shield_enabled: true,
                    },
                    enabled_platforms: Array.isArray(draftSettings.enabled_platforms)
                      ? draftSettings.enabled_platforms
                      : [],
                  });
                  markSettingsDirty(true);
                  pushToast({
                    kind: 'info',
                    title: 'Quick Profit & Safe Anti-Rug preset loaded',
                    body: 'Review settings and click Apply and Save Python Settings.',
                  });
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 transition-colors"
              >
                Apply Quick Profit &amp; Safe Preset
              </button>
              <button
                type="button"
                onClick={() => void handleResetDefaults('settings')}
                disabled={resettingDefaults !== null}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${resettingDefaults === 'settings' ? 'animate-spin' : ''}`} />
                <span>{resettingDefaults === 'settings' ? 'Resetting…' : 'Reset Settings to Default'}</span>
              </button>
              {isSettingsDirty && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftSettings({ ...serverSettings });
                    markSettingsDirty(false);
                    pushToast({ kind: 'info', title: 'Edits discarded' });
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                >
                  Discard Changes
                </button>
              )}
              {!isLiveMode ? (
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 transition-colors shadow-sm ${
                    confirmReset ? 'bg-rose-600 hover:bg-rose-500' : 'bg-amber-600 hover:bg-amber-500'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{confirmReset ? 'Confirm Reset Account?' : 'Reset Account & History'}</span>
                </button>
              ) : (
                <span className="px-3 py-1.5 rounded-xl text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  Live ledger is immutable
                </span>
              )}
            </div>
          </div>

          {(Number(draftSettings.min_liquidity_usd ?? 0) < 1500 ||
            Number(draftSettings.ultra_early_grace_sec ?? 0) > 0 ||
            draftSettings.use_rugcheck === false ||
            draftSettings.strict_rugcheck === false ||
            draftSettings.early_rug_shield_enabled === false ||
            Number(draftSettings.max_top10_holder_pct ?? 100) > 45 ||
            Number(draftSettings.rugcheck_max_score ?? 100) > 60) && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-bold">Weak Anti-Rug Filter Settings Detected</p>
                  <p className="text-[11px] opacity-90">
                    Low liquidity (&lt;$1,500), non-zero ultra-early bypass, disabled RugCheck/Early-Launch Rug Shield, or high Top-10% (&gt;45%) increases rugpull risk on brand-new coins. Click <strong>Apply Quick Profit &amp; Safe Preset</strong> to harden protection.
                  </p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSaveSettings} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 text-xs">
              {PYTHON_SETTINGS_METADATA.map(([key, label, kind]) => {
                const val = draftSettings[key];
                const defaultOptOn = key === 'min_age_minutes' ? false : true;
                const rawOptToggle = isPyOptionEnabled(draftSettings, key, defaultOptOn);
                const optEnabled =
                  kind === 'bool'
                    ? rawOptToggle && (val === undefined ? true : val === true || val === 'true')
                    : rawOptToggle;
                const toggleOption = (checked: boolean) => {
                  const nextToggles = {
                    ...(draftSettings.option_enabled && typeof draftSettings.option_enabled === 'object'
                      ? draftSettings.option_enabled
                      : {}),
                    [key]: checked,
                  };
                  if (kind === 'bool') {
                    setDraftSettings({
                      ...draftSettings,
                      [key]: checked,
                      option_enabled: nextToggles,
                    });
                  } else {
                    setDraftSettings({
                      ...draftSettings,
                      option_enabled: nextToggles,
                    });
                  }
                  markSettingsDirty(true);
                };

                const isUsdField = USD_SETTING_KEYS.has(key);
                const numericVal = parseFloat(String(val ?? ''));
                const solEquivalent =
                  optEnabled && isUsdField && !isNaN(numericVal) && solPriceUsd
                    ? fmtSolAmount(usdToSol(numericVal, solPriceUsd))
                    : null;
                const ageHoursHelper =
                  optEnabled &&
                  (key === 'min_age_minutes' || key === 'max_age_minutes' || key === 'creator_fast_rug_window_min') &&
                  !isNaN(numericVal) &&
                  numericVal >= 60
                    ? `= ${(numericVal / 60).toFixed(1)}h`
                    : null;
                const timeHelper =
                  optEnabled && key === 'rescan_delay_after_sell_sec'
                    ? !isNaN(numericVal) && numericVal > 0
                      ? `≈ ${(numericVal / 60).toFixed(1)} min (${numericVal}s)`
                      : '0s (immediate)'
                    : ageHoursHelper;
                const trailHelper =
                  key === 'trailing_stop_pct'
                    ? optEnabled
                      ? formatTrailingModeHint(
                          isPyOptionEnabled(draftSettings, 'take_profit_pct', true)
                            ? parseFloat(String(draftSettings.take_profit_pct ?? 0)) || 0
                            : 0,
                          !isNaN(numericVal) ? numericVal : 0
                        )
                      : 'Disabled — trailing stop rule ignored.'
                    : null;
                const stopLossHelper =
                  key === 'stop_loss_pct'
                    ? optEnabled && !isNaN(numericVal) && numericVal > 0
                      ? `Force-sells if PnL drops to -${numericVal}% to cap downside loss.`
                      : 'Disabled — holds through dips (exits only on Take Profit / Trailing).'
                    : null;
                const purposeNote = optEnabled
                  ? trailHelper || stopLossHelper || PYTHON_SETTING_NOTES[key] || null
                  : 'Disabled — bot ignores and skips this setting.';
                const isDynamicHint = optEnabled && Boolean(trailHelper || stopLossHelper);

                const hasTpRecoveryError =
                  key === 'take_profit_pct' && recoverPrincipalOn && !draftValidation.valid;

                return (
                  <div
                    key={key}
                    className={`space-y-1.5 rounded-xl border p-2.5 transition-colors ${
                      optEnabled
                        ? 'border-slate-200/80 dark:border-slate-800/80 bg-white/40 dark:bg-slate-900/30'
                        : 'border-slate-200/40 dark:border-slate-800/40 bg-slate-100/50 dark:bg-slate-900/15 opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          id={`py-opt-${key}`}
                          type="checkbox"
                          checked={optEnabled}
                          onChange={(e) => toggleOption(e.target.checked)}
                          aria-label={`Enable ${label}`}
                          className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
                        />
                        <label
                          htmlFor={`py-set-${key}`}
                          className={`font-sans font-medium text-slate-700 dark:text-slate-300 cursor-pointer truncate ${
                            !optEnabled ? 'line-through opacity-60' : ''
                          }`}
                          title={label}
                        >
                          {label}
                        </label>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!optEnabled && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-mono font-bold text-slate-500">
                            OFF
                          </span>
                        )}
                        {solEquivalent && (
                          <span className="font-mono text-[11px] font-semibold text-teal-600 dark:text-teal-400 whitespace-nowrap">
                            ≈ {solEquivalent}
                          </span>
                        )}
                        {timeHelper && (
                          <span className="font-mono text-[11px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                            {timeHelper}
                          </span>
                        )}
                      </div>
                    </div>
                    {kind === 'bool' ? (
                      <select
                        id={`py-set-${key}`}
                        disabled={!optEnabled}
                        value={val === true || val === 'true' ? 'true' : 'false'}
                        onChange={(e) => {
                          const boolVal = e.target.value === 'true';
                          setDraftSettings({
                            ...draftSettings,
                            [key]: boolVal,
                            option_enabled: {
                              ...(draftSettings.option_enabled && typeof draftSettings.option_enabled === 'object'
                                ? draftSettings.option_enabled
                                : {}),
                              [key]: boolVal,
                            },
                          });
                          markSettingsDirty(true);
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-slate-900 dark:text-slate-100 disabled:opacity-40"
                      >
                        <option value="true">True (Enabled)</option>
                        <option value="false">False (Disabled)</option>
                      </select>
                    ) : kind === 'tier' ? (
                      <select
                        id={`py-set-${key}`}
                        disabled={!optEnabled}
                        value={String(val || 'fast')}
                        onChange={(e) => {
                          setDraftSettings({ ...draftSettings, [key]: e.target.value });
                          markSettingsDirty(true);
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-slate-900 dark:text-slate-100 disabled:opacity-40"
                      >
                        <option value="standard">Standard (auto)</option>
                        <option value="fast">Fast (high priority)</option>
                        <option value="turbo">Turbo (veryHigh + urgent exits)</option>
                      </select>
                    ) : (
                      <input
                        id={`py-set-${key}`}
                        type={kind === 'int' || kind === 'float' ? 'number' : 'text'}
                        step={kind === 'float' ? 'any' : '1'}
                        disabled={!optEnabled}
                        value={val ?? ''}
                        placeholder={key === 'custom_rpc_url' ? 'https://mainnet.helius-rpc.com/?api-key=...' : undefined}
                        onChange={(e) => {
                          setDraftSettings({ ...draftSettings, [key]: e.target.value });
                          markSettingsDirty(true);
                        }}
                        className={`w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 disabled:opacity-40 ${
                          hasTpRecoveryError
                            ? 'border-rose-500 focus:ring-rose-500'
                            : 'border-slate-200 dark:border-slate-800 focus:ring-teal-500'
                        }`}
                      />
                    )}
                    {purposeNote && (
                      <p
                        className={`text-[11px] leading-snug ${
                          !optEnabled
                            ? 'font-sans text-slate-400 italic'
                            : isDynamicHint
                              ? 'font-mono font-medium text-teal-600 dark:text-teal-400'
                              : 'font-sans text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {purposeNote}
                      </p>
                    )}
                    {hasTpRecoveryError && draftValidation.error && (
                      <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[11px] space-y-1.5">
                        <p className="font-semibold leading-snug">{draftValidation.error}</p>
                        {draftValidation.recovery && (
                          <button
                            type="button"
                            onClick={() => {
                              setDraftSettings({
                                ...draftSettings,
                                take_profit_pct: draftValidation.recovery!.minTpPct,
                              });
                              markSettingsDirty(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-[10px] transition-colors"
                          >
                            Set Take profit to +{draftValidation.recovery.minTpPct.toFixed(1)}%
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

                {(() => {
                  const selectedWebsites: string[] = Array.isArray(draftSettings.enabled_platforms)
                    ? draftSettings.enabled_platforms.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean)
                    : [];
                  const toggleWebsite = (siteId: string) => {
                    const next = selectedWebsites.includes(siteId)
                      ? selectedWebsites.filter((id) => id !== siteId)
                      : [...selectedWebsites, siteId];
                    setDraftSettings({ ...draftSettings, enabled_platforms: next });
                    markSettingsDirty(true);
                  };
                  const setWebsites = (next: string[]) => {
                    setDraftSettings({ ...draftSettings, enabled_platforms: next });
                    markSettingsDirty(true);
                  };

                  return (
                    <div
                      data-testid="sniper-website-filter"
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                              Target Websites / Launchpads Filter
                            </h3>
                            <span
                              data-testid="sniper-website-status"
                              className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
                                selectedWebsites.length === 0
                                  ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30'
                                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                              }`}
                            >
                              {selectedWebsites.length === 0
                                ? 'All Websites Active'
                                : `${selectedWebsites.length} Selected Only`}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Leave all unchecked to search every website, or check specific websites to scan &amp; buy ONLY coins from those platforms.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setWebsites([])}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              selectedWebsites.length === 0
                                ? 'bg-teal-600 text-white border-teal-600'
                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            All Websites (Any)
                          </button>
                          <button
                            type="button"
                            onClick={() => setWebsites(['pumpfun'])}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              selectedWebsites.length === 1 && selectedWebsites[0] === 'pumpfun'
                                ? 'bg-teal-600 text-white border-teal-600'
                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            Pump.fun Only
                          </button>
                          <button
                            type="button"
                            onClick={() => setWebsites(['axiom'])}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              selectedWebsites.length === 1 && selectedWebsites[0] === 'axiom'
                                ? 'bg-teal-600 text-white border-teal-600'
                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            Axiom / Trenches
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                        {SNIPER_WEBSITE_OPTIONS.map((site) => {
                          const checked = selectedWebsites.includes(site.id);
                          return (
                            <label
                              key={site.id}
                              htmlFor={`py-site-${site.id}`}
                              className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-colors cursor-pointer select-none ${
                                checked
                                  ? 'border-teal-500/60 bg-teal-500/10 dark:bg-teal-500/15'
                                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] hover:border-slate-300 dark:hover:border-slate-700'
                              }`}
                            >
                              <input
                                id={`py-site-${site.id}`}
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleWebsite(site.id)}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
                              />
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                                    {site.name}
                                  </span>
                                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0">
                                    {site.domain}
                                  </span>
                                </div>
                                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                  {site.note}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Separate Section: Speed & Anti-Rug Protections (Checkboxes) */}
                {(() => {
                  const isModEnabled = (mod: SniperProtectionModuleOption) => {
                    const raw = draftSettings[mod.key];
                    return raw === undefined ? mod.defaultValue : raw === true || raw === 'true';
                  };
                  const enabledCount = SNIPER_PROTECTION_MODULES.filter(isModEnabled).length;
                  const toggleModule = (key: string, nextVal: boolean) => {
                    setDraftSettings({ ...draftSettings, [key]: nextVal });
                    markSettingsDirty(true);
                  };
                  const applyProtectionPreset = (mode: 'all' | 'recommended' | 'none') => {
                    const patch: Record<string, boolean> = {};
                    for (const mod of SNIPER_PROTECTION_MODULES) {
                      if (mode === 'all') patch[mod.key] = true;
                      else if (mode === 'none') patch[mod.key] = false;
                      else patch[mod.key] = mod.defaultValue;
                    }
                    setDraftSettings({ ...draftSettings, ...patch });
                    markSettingsDirty(true);
                  };
                  const speedModules = SNIPER_PROTECTION_MODULES.filter((m) => m.group === 'speed');
                  const safetyModules = SNIPER_PROTECTION_MODULES.filter((m) => m.group === 'safety');

                  return (
                    <div
                      data-testid="sniper-protection-modules"
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                              Speed &amp; Anti-Rug Protections
                            </h3>
                            <span
                              data-testid="sniper-protection-status"
                              className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
                                enabledCount === 0
                                  ? 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30'
                                  : 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30'
                              }`}
                            >
                              {enabledCount} / {SNIPER_PROTECTION_MODULES.length} Active
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Check any option to enable it; uncheck to make the bot ignore and skip that rule. Linked settings appear below each option.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => applyProtectionPreset('all')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              enabledCount === SNIPER_PROTECTION_MODULES.length
                                ? 'bg-teal-600 text-white border-teal-600'
                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            Enable All ({SNIPER_PROTECTION_MODULES.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => applyProtectionPreset('recommended')}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Recommended Defaults
                          </button>
                          <button
                            type="button"
                            onClick={() => applyProtectionPreset('none')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                              enabledCount === 0
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            Uncheck All
                          </button>
                        </div>
                      </div>

                      {/* Speed Subsection */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                          <Zap className="w-3.5 h-3.5" />
                          <span>Buy &amp; Execution Speed Modules</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {speedModules.map((mod) => {
                            const checked = isModEnabled(mod);
                            return (
                              <label
                                key={mod.key}
                                htmlFor={`py-prot-${mod.key}`}
                                className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-colors cursor-pointer select-none ${
                                  checked
                                    ? 'border-teal-500/60 bg-teal-500/10 dark:bg-teal-500/15'
                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                              >
                                <input
                                  id={`py-prot-${mod.key}`}
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => toggleModule(mod.key, e.target.checked)}
                                  className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
                                />
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                                      {mod.label}
                                    </span>
                                    <span
                                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                                        checked
                                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                      }`}
                                    >
                                      {checked ? 'ACTIVE' : 'OFF'}
                                    </span>
                                  </div>
                                  <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                                    {mod.description}
                                  </p>
                                  <p className="text-[10px] font-mono text-teal-700 dark:text-teal-400">
                                    Linked to: {mod.linkedTo}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      {/* Safety Subsection */}
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Anti-Rug &amp; Capital Safety Modules</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {safetyModules.map((mod) => {
                            const checked = isModEnabled(mod);
                            return (
                              <label
                                key={mod.key}
                                htmlFor={`py-prot-${mod.key}`}
                                className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-colors cursor-pointer select-none ${
                                  checked
                                    ? 'border-teal-500/60 bg-teal-500/10 dark:bg-teal-500/15'
                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                              >
                                <input
                                  id={`py-prot-${mod.key}`}
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => toggleModule(mod.key, e.target.checked)}
                                  className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
                                />
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                                      {mod.label}
                                    </span>
                                    <span
                                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                                        checked
                                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                      }`}
                                    >
                                      {checked ? 'ACTIVE' : 'OFF'}
                                    </span>
                                  </div>
                                  <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                                    {mod.description}
                                  </p>
                                  <p className="text-[10px] font-mono text-teal-700 dark:text-teal-400">
                                    Linked to: {mod.linkedTo}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {recoverPrincipalOn && (
                  <div
                    className={`rounded-xl border p-4 text-xs space-y-1.5 ${
                      draftValidation.valid
                        ? 'border-teal-500/30 bg-teal-500/5 text-slate-700 dark:text-slate-300'
                        : 'border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between gap-2">
                      <span>Principal Recovery &amp; Scale-Out Strategy Preview</span>
                      {draftValidation.recovery && (
                        <span className="font-mono text-[11px]">
                          Min TP required: +{draftValidation.recovery.minTpPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {draftValidation.valid && draftValidation.recovery ? (
                      <p className="font-mono text-[11px] leading-relaxed">
                        Invest <strong>${draftValidation.recovery.tradeSizeUsd.toFixed(2)}</strong> → at{' '}
                        <strong>+{parseFloat(String(draftSettings.take_profit_pct || 0))}%</strong> sell{' '}
                        <strong>{draftValidation.recovery.recoverSellPct}%</strong> (recovers your $
                        {draftValidation.recovery.targetRecoveryUsd.toFixed(2)} incl. fees &amp; slippage)
                        {parseFloat(String(draftSettings.scale_out_sell_pct || 0)) > 0 &&
                        parseFloat(String(draftSettings.scale_out_step_gain_pct || 0)) > 0
                          ? ` → then sell ${parseFloat(String(draftSettings.scale_out_sell_pct))}% of remaining every extra +${parseFloat(String(draftSettings.scale_out_step_gain_pct))}% pump`
                          : ''}
                        {parseFloat(String(draftSettings.trailing_stop_pct || 0)) > 0
                          ? ` → trailing stop exits -${parseFloat(String(draftSettings.trailing_stop_pct))}% from peak on remaining bag.`
                          : ' → remaining bag holds for scale-outs / max hold.'}
                      </p>
                    ) : (
                      <p className="text-[11px] font-medium">
                        {draftValidation.error || 'Take Profit % must cover your investment + fees before saving.'}
                      </p>
                    )}
                  </div>
                )}

                {!draftValidation.valid && !recoverPrincipalOn && draftValidation.error && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-400 font-semibold">
                    {draftValidation.error}
                  </div>
                )}

                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <span className={`text-xs ${!draftValidation.valid ? 'text-rose-500 font-semibold' : 'text-slate-500'}`}>
                    {!draftValidation.valid
                      ? draftValidation.error || 'Fix highlighted settings before saving.'
                      : isSettingsDirty
                        ? 'You have unsaved changes. Click Apply to save.'
                        : 'Settings are synced with settings.json.'}
                  </span>
                  <button
                    type="submit"
                    disabled={!draftValidation.valid}
                    className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 disabled:bg-slate-400 disabled:cursor-not-allowed text-white transition-colors shadow-sm"
                  >
                    Apply and Save Python Settings
                  </button>
                </div>
              </form>
            </div>
          )}

      {/* Tab Content: Pro Desk */}
      {activeTab === 'pro_desk' && (
        <div className="space-y-6 pb-12 max-w-[1400px] mx-auto">
          {/* Header Banner */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
                    Python Sniper Pro Trader Intelligence &amp; Execution Desk
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Advanced anti-Sybil bundling protection, smart-money tracking, zero-lag WS exits, Jito dontfront MEV shield, ATA rent reclaim &amp; What-If backtester.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleResetDefaults('pro_desk')}
                disabled={resettingDefaults !== null}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${resettingDefaults === 'pro_desk' ? 'animate-spin' : ''}`} />
                {resettingDefaults === 'pro_desk' ? 'Resetting…' : 'Reset Pro Desk to Default'}
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-semibold text-xs transition-colors shadow-lg shadow-teal-600/20"
              >
                <Save className="w-4 h-4" />
                Save Pro Desk Settings
              </button>
            </div>
          </div>

          {/* GROUP 1: Deeper Wallet & Scam Intelligence */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <Users className="w-5 h-5 text-teal-500" />
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  Group 1 — Deeper Wallet &amp; Scam Intelligence (Anti-Sybil &amp; Smart Money)
                </h3>
              </div>
              <span className="font-mono text-xs text-slate-400">3 Advanced Modules</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 1.1 Anti-Sybil */}
              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('anti_sybil_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Anti-Sybil Shared-Funder Cluster</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('anti_sybil_enabled')}
                      onChange={(e) => togglePyOpt('anti_sybil_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Detects if top early buyers were freshly created and funded from the same CEX/distributor hot wallet minutes before launch.</p>
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Fresh Wallet Window (Minutes)</label>
                    <input
                      type="number"
                      value={draftSettings.fresh_wallet_minutes ?? 30}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, fresh_wallet_minutes: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('anti_sybil_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Max Shared Funder Count</label>
                    <input
                      type="number"
                      value={draftSettings.max_shared_funder_count ?? 3}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, max_shared_funder_count: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('anti_sybil_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              {/* 1.2 Smart Money */}
              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('smart_money_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Smart Money / Whale Watchlist</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('smart_money_enabled')}
                      onChange={(e) => togglePyOpt('smart_money_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Prioritizes coins bought by tracked profitable KOL wallets and auto-exits instantly if they sell.</p>
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">Bot Scan Strategy Mode</label>
                    <select
                      value={String(draftSettings.smart_money_scan_mode || 'both')}
                      onChange={(e) => {
                        const modeVal = e.target.value;
                        setDraftSettings({
                          ...draftSettings,
                          smart_money_scan_mode: modeVal,
                          smart_money_enabled: modeVal !== 'sniper_only',
                        });
                        markSettingsDirty(true);
                      }}
                      className="w-full px-2 py-1.5 rounded-lg font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    >
                      <option value="both">Both (Sniper + Whale Wallets)</option>
                      <option value="smart_money_only">Whale Wallets Only (No Random Launches)</option>
                      <option value="sniper_only">Sniper Bot Only (Ignore Whale Wallets)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">Min Confluence</label>
                      <input
                        type="number"
                        value={draftSettings.smart_money_min_confluence ?? 1}
                        onChange={(e) => {
                          setDraftSettings({ ...draftSettings, smart_money_min_confluence: Number(e.target.value) });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled')}
                        className="w-full px-2 py-1.5 rounded-lg font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">Size Boost %</label>
                      <input
                        type="number"
                        value={draftSettings.smart_money_size_boost_pct ?? 35}
                        onChange={(e) => {
                          setDraftSettings({ ...draftSettings, smart_money_size_boost_pct: Number(e.target.value) });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled')}
                        className="w-full px-2 py-1.5 rounded-lg font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">Max Wallets (0=∞)</label>
                      <input
                        type="number"
                        min={0}
                        max={5000}
                        value={draftSettings.smart_money_max_wallets ?? 50}
                        onChange={(e) => {
                          setDraftSettings({
                            ...draftSettings,
                            smart_money_max_wallets: Math.max(0, Math.min(5000, Number(e.target.value) || 0)),
                          });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled')}
                        className="w-full px-2 py-1.5 rounded-lg font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">Refresh (sec)</label>
                      <input
                        type="number"
                        min={10}
                        max={86400}
                        value={draftSettings.smart_money_refresh_interval_sec ?? 30}
                        onChange={(e) => {
                          setDraftSettings({
                            ...draftSettings,
                            smart_money_refresh_interval_sec: Math.max(10, Math.min(86400, Number(e.target.value) || 30)),
                          });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled')}
                        className="w-full px-2 py-1.5 rounded-lg font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">Max Coin Age (h)</label>
                      <input
                        type="number"
                        min={0}
                        max={720}
                        value={draftSettings.smart_money_max_coin_age_hours ?? 72}
                        onChange={(e) => {
                          setDraftSettings({
                            ...draftSettings,
                            smart_money_max_coin_age_hours: Math.max(0, Math.min(720, Number(e.target.value) || 0)),
                          });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled') || draftSettings.smart_money_follow_older_coins === false}
                        className="w-full px-2 py-1.5 rounded-lg font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftSettings.smart_money_auto_discover !== false}
                        onChange={(e) => {
                          setDraftSettings({ ...draftSettings, smart_money_auto_discover: e.target.checked });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled')}
                        className="rounded text-teal-600 disabled:opacity-50"
                      />
                      <span className="text-[11px] text-slate-700 dark:text-slate-300">
                        Auto-discover profitable active whales (
                        {Number(draftSettings.smart_money_max_wallets ?? 50) <= 0
                          ? 'Unlimited'
                          : `up to ${Number(draftSettings.smart_money_max_wallets ?? 50)}`}
                        )
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftSettings.smart_money_follow_older_coins !== false}
                        onChange={(e) => {
                          setDraftSettings({ ...draftSettings, smart_money_follow_older_coins: e.target.checked });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled')}
                        className="rounded text-teal-600 disabled:opacity-50"
                      />
                      <span className="text-[11px] text-slate-700 dark:text-slate-300">
                        Follow 1h–72h+ coins actively held or bought by whales
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftSettings.smart_money_prioritize_entries !== false}
                        onChange={(e) => {
                          setDraftSettings({ ...draftSettings, smart_money_prioritize_entries: e.target.checked });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled')}
                        className="rounded text-teal-600 disabled:opacity-50"
                      />
                      <span className="text-[11px] text-slate-700 dark:text-slate-300">Prioritize whale-bought coins #1 in launch queue</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftSettings.smart_money_auto_exit_on_sell !== false}
                        onChange={(e) => {
                          setDraftSettings({ ...draftSettings, smart_money_auto_exit_on_sell: e.target.checked });
                          markSettingsDirty(true);
                        }}
                        disabled={!isPyOptEnabled('smart_money_enabled')}
                        className="rounded text-teal-600 disabled:opacity-50"
                      />
                      <span className="text-[11px] text-slate-700 dark:text-slate-300">Auto-exit immediately if tracked wallet dumps</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* 1.3 Reused Socials */}
              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('reused_socials_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Reused Socials Detection</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('reused_socials_enabled')}
                      onChange={(e) => togglePyOpt('reused_socials_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Blocks serial ruggers recycling the same Telegram group, X profile, or Website URL across tokens.</p>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Max Allowed Social Reuse Count</label>
                  <input
                    type="number"
                    value={draftSettings.max_social_reuse_count ?? 2}
                    onChange={(e) => {
                      setDraftSettings({ ...draftSettings, max_social_reuse_count: Number(e.target.value) });
                      markSettingsDirty(true);
                    }}
                    disabled={!isPyOptEnabled('reused_socials_enabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* GROUP 2: Zero-Lag Exits & MEV */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <Zap className="w-5 h-5 text-amber-500" />
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  Group 2 — Zero-Lag Exits &amp; MEV / Wallet Protection (WS Streaming &amp; Jito Shield)
                </h3>
              </div>
              <span className="font-mono text-xs text-slate-400">3 Execution Modules</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('ws_exit_stream_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Live WebSocket Exit Streaming</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('ws_exit_stream_enabled')}
                      onChange={(e) => togglePyOpt('ws_exit_stream_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Subscribes directly to bought mint trades (&lt;200ms) to catch dump spikes &amp; TP wicks instantly.</p>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('jito_dontfront_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Jito Sandwich Protection (dontfront)</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('jito_dontfront_enabled')}
                      onChange={(e) => togglePyOpt('jito_dontfront_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Injects Jito anti-sandwich markers and block-engine tips to prevent MEV front-running.</p>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Jito Tip Amount (SOL)</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={draftSettings.jito_tip_sol ?? 0.0002}
                    onChange={(e) => {
                      setDraftSettings({ ...draftSettings, jito_tip_sol: Number(e.target.value) });
                      markSettingsDirty(true);
                    }}
                    disabled={!isPyOptEnabled('jito_dontfront_enabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('orphan_sweep_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Orphan Token Auto-Adopter</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('orphan_sweep_enabled')}
                      onChange={(e) => togglePyOpt('orphan_sweep_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Scans wallet accounts periodically so buys that timed out on RPC confirmation are adopted into monitoring.</p>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={handlePyRunOrphanSweep}
                    disabled={pySweepLoading || !isPyOptEnabled('orphan_sweep_enabled')}
                    className="w-full py-2 px-3 rounded-xl bg-amber-600/20 border border-amber-500/40 hover:bg-amber-600/30 text-amber-300 font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${pySweepLoading ? 'animate-spin' : ''}`} />
                    {pySweepLoading ? 'Sweeping Wallet…' : 'Run Manual Orphan Sweep'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* GROUP 3: Market Structure & Entry Timing */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <TrendingDown className="w-5 h-5 text-indigo-500" />
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  Group 3 — Market Structure &amp; Entry Timing (Migrations, Wash-Trading &amp; SOL Regimes)
                </h3>
              </div>
              <span className="font-mono text-xs text-slate-400">5 Timing Filters</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('post_migration_pullback_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Post-Migration Pullback Reclaim</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('post_migration_pullback_enabled')}
                      onChange={(e) => togglePyOpt('post_migration_pullback_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Waits for post-migration dump after graduation and buys the first higher-low bounce.</p>
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Min Dip %</label>
                    <input
                      type="number"
                      value={draftSettings.migration_min_dip_pct ?? 15}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, migration_min_dip_pct: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('post_migration_pullback_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Wait Secs</label>
                    <input
                      type="number"
                      value={draftSettings.migration_wait_sec ?? 45}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, migration_wait_sec: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('post_migration_pullback_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('pre_migration_curve_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Pre-Migration Curve Surge</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('pre_migration_curve_enabled')}
                      onChange={(e) => togglePyOpt('pre_migration_curve_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Snipes bonding curves approaching graduation within specified completion bounds.</p>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Min Curve %</label>
                    <input
                      type="number"
                      value={draftSettings.pre_migration_curve_min_pct ?? 75}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, pre_migration_curve_min_pct: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('pre_migration_curve_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Max Curve %</label>
                    <input
                      type="number"
                      value={draftSettings.pre_migration_curve_max_pct ?? 92}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, pre_migration_curve_max_pct: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('pre_migration_curve_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('wash_trade_filter_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Wash-Trading / Fake Volume Filter</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('wash_trade_filter_enabled')}
                      onChange={(e) => togglePyOpt('wash_trade_filter_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Checks unique buyer wallets vs total txns to filter out synthetic green candles.</p>
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Min Unique Makers Ratio</label>
                    <input
                      type="number"
                      step="0.05"
                      value={draftSettings.min_unique_makers_ratio ?? 0.25}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, min_unique_makers_ratio: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('wash_trade_filter_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Min Unique Traders (5m)</label>
                    <input
                      type="number"
                      value={draftSettings.min_unique_traders_5m ?? 6}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, min_unique_traders_5m: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('wash_trade_filter_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('sol_regime_filter_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">SOL Market Regime ("Red Market Pause")</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('sol_regime_filter_enabled')}
                      onChange={(e) => togglePyOpt('sol_regime_filter_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Automatically pauses entries or halves position size when SOL drops fast in 15 minutes.</p>
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">SOL 15m Drop Threshold %</label>
                    <input
                      type="number"
                      step="0.1"
                      value={draftSettings.sol_regime_max_drop_pct ?? 2.0}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, sol_regime_max_drop_pct: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('sol_regime_filter_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Action</label>
                    <select
                      value={draftSettings.sol_regime_action ?? 'pause'}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, sol_regime_action: e.target.value });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('sol_regime_filter_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    >
                      <option value="pause">Pause New Entries</option>
                      <option value="half_size">Half Position Size</option>
                    </select>
                  </div>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('anti_top_wick_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Anti-Top-Wick Guard</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('anti_top_wick_enabled')}
                      onChange={(e) => togglePyOpt('anti_top_wick_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Waits for a brief pause or micro-dip if a coin pumped heavily in the last 15s.</p>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Max Short Spike %</label>
                  <input
                    type="number"
                    value={draftSettings.max_short_spike_pct ?? 70}
                    onChange={(e) => {
                      setDraftSettings({ ...draftSettings, max_short_spike_pct: Number(e.target.value) });
                      markSettingsDirty(true);
                    }}
                    disabled={!isPyOptEnabled('anti_top_wick_enabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* GROUP 4: Dynamic Sizing & Capital Efficiency */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <Coins className="w-5 h-5 text-emerald-500" />
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  Group 4 — Dynamic Sizing &amp; Capital Efficiency (Conviction, Streaks &amp; Meta Caps)
                </h3>
              </div>
              <span className="font-mono text-xs text-slate-400">3 Capital Modules</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('conviction_sizing_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Conviction-Based Sizing</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('conviction_sizing_enabled')}
                      onChange={(e) => togglePyOpt('conviction_sizing_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Risks 0.5x on unproven micro-launches and 1.5x–2x on A+ setups.</p>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Min Multiplier</label>
                    <input
                      type="number"
                      step="0.1"
                      value={draftSettings.conviction_min_mult ?? 0.5}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, conviction_min_mult: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('conviction_sizing_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Max Multiplier</label>
                    <input
                      type="number"
                      step="0.1"
                      value={draftSettings.conviction_max_mult ?? 1.5}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, conviction_max_mult: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('conviction_sizing_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('streak_throttle_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Drawdown / Losing-Streak Throttle</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('streak_throttle_enabled')}
                      onChange={(e) => togglePyOpt('streak_throttle_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Automatically halves position size or pauses after taking N consecutive stop-losses.</p>
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Streak Loss Limit</label>
                    <input
                      type="number"
                      value={draftSettings.streak_loss_limit ?? 3}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, streak_loss_limit: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('streak_throttle_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Cooldown (Mins)</label>
                    <input
                      type="number"
                      value={draftSettings.streak_cooldown_minutes ?? 20}
                      onChange={(e) => {
                        setDraftSettings({ ...draftSettings, streak_cooldown_minutes: Number(e.target.value) });
                        markSettingsDirty(true);
                      }}
                      disabled={!isPyOptEnabled('streak_throttle_enabled')}
                      className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-4 transition-colors ${
                  isPyOptEnabled('narrative_cap_enabled')
                    ? 'border-teal-500/40 bg-teal-500/[0.03]'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">Meta / Narrative Duplicate Cap</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPyOptEnabled('narrative_cap_enabled')}
                      onChange={(e) => togglePyOpt('narrative_cap_enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                </div>
                <p className="text-xs text-slate-500">Limits concurrent open positions sharing the same keyword or ticker stem.</p>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Max Same Narrative Positions</label>
                  <input
                    type="number"
                    value={draftSettings.max_same_narrative_positions ?? 1}
                    onChange={(e) => {
                      setDraftSettings({ ...draftSettings, max_same_narrative_positions: Number(e.target.value) });
                      markSettingsDirty(true);
                    }}
                    disabled={!isPyOptEnabled('narrative_cap_enabled')}
                    className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* GROUP 5: Hidden Profit Leaks (ATA Rent & Scorecard) */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <Activity className="w-5 h-5 text-teal-500" />
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  Group 5 — Hidden Profit Leaks (ATA Rent Reclaim &amp; DEX Slippage Scorecard)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => void loadPyRentAudit()}
                className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pyRentLoading ? 'animate-spin' : ''}`} />
                Refresh ATA Audit
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 block">
                  Empty ATA Rent Reclaim (~0.002 SOL/acc)
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Every token traded locks SOL in Associated Token Accounts. Reclaiming empty accounts puts that SOL straight back to work.
                </p>
                {pyRentReport ? (
                  <div className="space-y-3 font-mono text-xs">
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Empty ATAs:</span>
                        <span className="font-bold">{pyRentReport.emptyCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Dust Accounts:</span>
                        <span className="font-bold">{pyRentReport.dustCount}</span>
                      </div>
                      <div className="flex justify-between text-teal-600 dark:text-teal-400 font-bold pt-1 border-t border-slate-200 dark:border-slate-800">
                        <span>Reclaimable SOL:</span>
                        <span>
                          {(pyRentReport.emptyReclaimableSol + pyRentReport.dustReclaimableSol).toFixed(4)} SOL
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={pyBurnDust}
                          onChange={(e) => setPyBurnDust(e.target.checked)}
                          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        <span className="text-slate-700 dark:text-slate-300">Include dust accounts (&lt; $0.05 value)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handlePyReclaimRent(pyBurnDust)}
                        disabled={pyRentLoading}
                        className="w-full py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs transition-colors disabled:opacity-50 shadow-md shadow-teal-600/20"
                      >
                        {pyRentLoading ? 'Processing…' : 'Reclaim All ATA Rent'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic">Audit report loading…</div>
                )}
              </div>

              <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                    DEX Slippage &amp; Latency Scorecard
                  </span>
                  <span className="text-xs text-slate-400 font-mono">Real vs Quoted Execution</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                        <th className="pb-2 font-medium">DEX / Platform</th>
                        <th className="pb-2 font-medium">Trades</th>
                        <th className="pb-2 font-medium">Avg Slippage</th>
                        <th className="pb-2 font-medium">Max Slippage</th>
                        <th className="pb-2 font-medium">Avg Latency</th>
                        <th className="pb-2 font-medium">Win Rate</th>
                        <th className="pb-2 font-medium">Net P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {pyScorecardRows.map((row) => (
                        <tr key={`${row.dex}-${row.platform}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                          <td className="py-2.5 font-bold text-slate-900 dark:text-slate-100 uppercase">
                            {row.dex} <span className="text-[10px] text-slate-400">({row.platform})</span>
                          </td>
                          <td className="py-2.5 tabular-nums">{row.tradeCount}</td>
                          <td className="py-2.5 tabular-nums text-amber-600 dark:text-amber-400">
                            {row.avgSlippagePct.toFixed(2)}%
                          </td>
                          <td className="py-2.5 tabular-nums text-rose-600 dark:text-rose-400">
                            {row.maxSlippagePct.toFixed(2)}%
                          </td>
                          <td className="py-2.5 tabular-nums">{row.avgLatencyMs.toFixed(0)}ms</td>
                          <td className="py-2.5 tabular-nums font-semibold text-teal-600 dark:text-teal-400">
                            {row.winRatePct.toFixed(1)}%
                          </td>
                          <td
                            className={`py-2.5 tabular-nums font-bold ${
                              row.netPnlSol >= 0 ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                          >
                            {row.netPnlSol >= 0 ? '+' : ''}
                            {row.netPnlSol.toFixed(3)} SOL
                          </td>
                        </tr>
                      ))}
                      {pyScorecardRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-slate-400 italic">
                            No execution telemetry recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* GROUP 6: Local What-If Strategy Backtester */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <BarChart3 className="w-5 h-5 text-purple-500" />
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  Group 6 — Local Strategy What-If Backtester
                </h3>
              </div>
              <span className="font-mono text-xs text-slate-400">Historical Replay Simulator</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form onSubmit={handlePyRunBacktest} className="lg:col-span-1 space-y-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 block">Simulation Parameters</span>
                <div className="space-y-3 font-mono text-xs">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Lookback Hours</label>
                    <input
                      type="number"
                      value={pyBacktestReq.lookbackHours}
                      onChange={(e) => setPyBacktestReq({ ...pyBacktestReq, lookbackHours: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Take Profit %</label>
                      <input
                        type="number"
                        value={pyBacktestReq.takeProfitPct}
                        onChange={(e) => setPyBacktestReq({ ...pyBacktestReq, takeProfitPct: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Stop Loss %</label>
                      <input
                        type="number"
                        value={pyBacktestReq.stopLossPct}
                        onChange={(e) => setPyBacktestReq({ ...pyBacktestReq, stopLossPct: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-700 dark:text-slate-300">Enable Trailing Stop</span>
                    <input
                      type="checkbox"
                      checked={pyBacktestReq.trailingEnabled}
                      onChange={(e) => setPyBacktestReq({ ...pyBacktestReq, trailingEnabled: e.target.checked })}
                      className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    />
                  </div>
                  {pyBacktestReq.trailingEnabled && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Trailing Drop %</label>
                      <input
                        type="number"
                        value={pyBacktestReq.trailingDropPct}
                        onChange={(e) => setPyBacktestReq({ ...pyBacktestReq, trailingDropPct: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={pyBacktestLoading}
                    className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2 shadow-md shadow-purple-600/20 disabled:opacity-50"
                  >
                    <Play className={`w-3.5 h-3.5 ${pyBacktestLoading ? 'animate-spin' : ''}`} />
                    {pyBacktestLoading ? 'Running Backtest…' : 'Run Strategy Backtest'}
                  </button>
                </div>
              </form>

              <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 block">Backtest Comparison Results</span>
                {pyBacktestResult ? (
                  <div className="space-y-4 font-mono text-xs">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 space-y-1">
                        <span className="text-[10px] text-slate-400 block uppercase">Sample Size</span>
                        <span className="font-bold text-sm tabular-nums">{pyBacktestResult.sampleSize}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 space-y-1">
                        <span className="text-[10px] text-slate-400 block uppercase">Evaluated Trades</span>
                        <span className="font-bold text-sm tabular-nums">{pyBacktestResult.evaluatedTrades}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 space-y-1">
                        <span className="text-[10px] text-slate-400 block uppercase">Filtered Out</span>
                        <span className="font-bold text-sm tabular-nums text-amber-500">{pyBacktestResult.filteredOutCount}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 space-y-1">
                        <span className="text-[10px] text-slate-400 block uppercase">Unit</span>
                        <span className="font-bold text-sm uppercase text-teal-500">{pyBacktestResult.pnlUnit}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                        <span className="font-bold text-slate-400 block uppercase text-[10px]">Baseline Strategy</span>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Win Rate:</span>
                          <span className="font-bold tabular-nums">{pyBacktestResult.baselineWinRatePct.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Net P&amp;L:</span>
                          <span
                            className={`font-bold tabular-nums ${
                              pyBacktestResult.baselineNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                          >
                            {pyBacktestResult.baselineNetPnl >= 0 ? '+' : ''}
                            {pyBacktestResult.baselineNetPnl.toFixed(3)} {pyBacktestResult.pnlUnit}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Max Drawdown:</span>
                          <span className="font-bold tabular-nums text-rose-500">
                            -{pyBacktestResult.baselineMaxDrawdown.toFixed(3)} {pyBacktestResult.pnlUnit}
                          </span>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/[0.03] space-y-2">
                        <span className="font-bold text-purple-400 block uppercase text-[10px]">Simulated Strategy</span>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Win Rate:</span>
                          <span className="font-bold tabular-nums text-purple-600 dark:text-purple-300">
                            {pyBacktestResult.simulatedWinRatePct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Net P&amp;L:</span>
                          <span
                            className={`font-bold tabular-nums ${
                              pyBacktestResult.simulatedNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                          >
                            {pyBacktestResult.simulatedNetPnl >= 0 ? '+' : ''}
                            {pyBacktestResult.simulatedNetPnl.toFixed(3)} {pyBacktestResult.pnlUnit}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Max Drawdown:</span>
                          <span className="font-bold tabular-nums text-rose-500">
                            -{pyBacktestResult.simulatedMaxDrawdown.toFixed(3)} {pyBacktestResult.pnlUnit}
                          </span>
                        </div>
                      </div>
                    </div>

                    {pyBacktestResult.notes.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 text-[11px] text-slate-500 space-y-1">
                        <span className="font-semibold block text-slate-700 dark:text-slate-300">Simulation Notes:</span>
                        <ul className="list-disc list-inside space-y-0.5">
                          {pyBacktestResult.notes.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-12 text-center text-slate-400 italic text-xs">
                    Run a strategy backtest simulation to compare historical trade performance.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}


      {/* Start Bot Whale Follow Confirmation Modal */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-emerald-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Start Python Sniper Bot</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowStartModal(false)}
                className="text-slate-400 hover:text-slate-200 text-xs font-mono font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <p>
                Choose how the Python bot selects coins to trade in <span className="font-bold uppercase text-teal-500">{mode}</span> mode:
              </p>

              <div className="space-y-2">
                {[
                  {
                    id: 'both' as const,
                    title: 'Both: Sniper Launches + Whale Wallets',
                    desc: 'Snipes safe new launches AND copies tracked whale wallets (including 1h–72h+ held coins).',
                  },
                  {
                    id: 'smart_money_only' as const,
                    title: 'Whale Wallets Only (Smart Money Copy)',
                    desc: 'Only buys coins actively bought or held on-chain by your tracked profitable whale wallets.',
                  },
                  {
                    id: 'sniper_only' as const,
                    title: 'Sniper Bot Only (New Launches Only)',
                    desc: 'Scans new token launches via your Sniper filters and ignores Smart Money wallet triggers.',
                  },
                ].map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                      startScanMode === opt.id
                        ? 'border-teal-500 bg-teal-500/[0.06]'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="startScanMode"
                      checked={startScanMode === opt.id}
                      onChange={() => {
                        setStartScanMode(opt.id);
                        setStartSmartMoneyFollow(opt.id !== 'sniper_only');
                      }}
                      className="mt-0.5 text-teal-600 focus:ring-teal-500"
                    />
                    <div className="space-y-0.5">
                      <span className="font-bold text-slate-900 dark:text-slate-100 block">{opt.title}</span>
                      <span className="text-[11px] text-slate-500 block">{opt.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                Note: Whale wallet trades can take hours or days to materialize; on-chain portfolio scanning also tracks coins they have already been holding for 1h–72h+.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowStartModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingSmartConfig}
                onClick={async () => {
                  setShowStartModal(false);
                  const wantSmart = startScanMode !== 'sniper_only' && startSmartMoneyFollow;
                  const curMode = String(draftSettings.smart_money_scan_mode || 'both');
                  if (startScanMode !== curMode || wantSmart !== Boolean(draftSettings.smart_money_enabled !== false)) {
                    await saveQuickSniperSettings({
                      smart_money_scan_mode: startScanMode,
                      smart_money_enabled: wantSmart,
                    });
                  }
                  await handleToggle();
                }}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                Start Bot Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
