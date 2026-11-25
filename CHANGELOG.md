# Changelog

All notable changes to **Solana Spot Bot** are documented in this file.

## v1.41.2 — Anti-Glitch Price Stabilization (Eliminates Transient -99% Flash Drops)

**Risk Warning: Trading can lose all of your money.**

### Fixed & Improved
- **Anti-Glitch Single-Poll Price Drop Filter (`sniper/bot.py`, `server/sniperManager.ts`)**:
  - Implemented robust outlier and transient price protection in `check_exits()` and `refreshStoppedOpenPositions()`: momentary zero/low price glitches or unindexed price API hiccups that drop a position's reported price by >70% in a single poll are automatically filtered out and stabilized (retaining the last known valid price) unless a confirmed liquidity collapse or dev dump exit is active. This eliminates erratic `-99%` red flashes during active trades.

---

## v1.41.0 — Best Quick-Profit Defaults + Dedicated Reset-to-Default Buttons for Settings & Pro Desk

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Quick-Profit Default Configuration (`sniper/bot.py`, `sniper/settings.json`, `server/sniperManager.ts`, `server/config/defaults.ts`)**:
  - **Python Sniper Settings Defaults**: Tuned out-of-the-box and preset defaults for faster, safer profit-taking (`+25%` Take Profit arming a tight `8%` trailing stop, `-20%` Stop Loss, `60m` max hold, `+200%` 5m chase cap, `$5,000` min liquidity, `0s` grace bypass, **Early-Launch Rugpull Shield** ON, and fast/parallel anti-rug screening ON).
  - **Pro Desk Defaults (Python Sniper & Spot Bot)**: Enabled optimal execution and protection modules by default (`Anti-Sybil`, `Smart Money`, `Reused Socials`, `Live WebSocket Exits`, `Jito dontfront` with `0.0002 SOL` tip, `Orphan Sweep`, `Wash-Trade Filter`, `SOL Red-Market Regime Pause`, tightened `60%` `Anti-Top-Wick Guard`, `0.6x–1.5x` `Conviction Sizing`, faster `2-loss / 15m` `Streak Throttle`, `Narrative Cap`, and `Auto ATA Rent Reclaim`).
- **One-Click "Reset to Default" Buttons on Both Settings & Pro Desk (`PythonSniperView.tsx`, `SettingsView.tsx`, `ProDeskView.tsx`, `server/routes/api.ts`)**:
  - Added scoped reset endpoints (`POST /api/sniper/settings/reset` and `POST /api/settings/reset`) supporting `scope: 'settings' | 'pro_desk' | 'all'`.
  - Added **Reset Settings to Default** and **Reset Pro Desk to Default** buttons in **Python Sniper Bot** (each resets only its own tab's fields to Quick-Profit defaults and saves immediately without wiping the other tab) as well as **Reset to Default** buttons in **Solana Spot Bot** Settings and Pro Desk.
- **UI Field Sync Fix (`PythonSniperView.tsx`)**:
  - Fixed the `jito_dontfront_enabled` key mapping in Python Sniper Pro Desk so the Jito Sandwich Protection toggle and tip amount persist cleanly with `bot.py` and `SniperManager`.

---

## v1.40.0 — Early-Launch Rugpull Shield (Pre-Buy Dev/Bundle Blocking + Instant Dev-Dump & LP-Collapse Auto-Exit)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Early-Launch Rugpull Shield (`early_rug_shield_enabled`, ON by default in `sniper/bot.py`, `SniperManager`, and `PythonSniperView.tsx`)**:
  - **Pre-Buy Launch & Structure Trap Blocking (`passes_filters`)**: Blocks Pump.fun dev sniper bundles (`initial_buy_sol > 8.0 SOL`), thin bonding-curve spoofs (`real_sol < 1.5 SOL`), early 60s dump waves on `<3m` coins, and accelerates honeypot pattern detection (`>= 6` buys / `0` sells after `20s`).
  - **On-Chain Creator Resolution & Dev Holdings Verification (`_resolve_creator_via_rpc`, `_rpc_owner_token_pct`)**: Resolves deployer wallets from the earliest mint transaction fee payer whenever PumpPortal and RugCheck omit `creator`, checks on-chain token ownership if RugCheck omits `creatorBalance`, and records deployer history even on brand-new `<60s` pools.
  - **Dev-Linked Sybil & Pump.fun Bonding Curve Bundle Detection (`_analyze_sybil_details`)**: Extends fresh-wallet funder probing onto Pump.fun bonding curves (excluding curve/pool accounts, with RPC top-holder fallback), probes the deployer wallet alongside top holders to block any shared-funder dev+holder bundle immediately, and blocks coordinated `>= 4` fresh-wallet sniper clusters owning `>= 20%`.
  - **Tighter Early Whale-Split & Hidden Sell-Tax Checks (`_check_sell_route`, `hard_rug_check`)**: Detects Token-2022 / toxic pool hidden sell taxes (`> 30%` roundtrip SOL exit loss even when reported price impact looks low) and caps `<3m` launches at `<= 18%` per single non-pool wallet and `<= 34%` across the top 3 wallets.
  - **Real-Time Post-Buy `creator_dump_exit` & Catastrophic LP-Collapse Exit (`pumpportal.ts`, `sniperManager.ts`, `bot.py monitor()` / `check_exits()`)**: Streams deployer address & `creatorSold` state over PumpPortal WebSocket so an open early position is market-sold immediately when the dev sells, automatically blacklists that dev/socials, and triggers an emergency exit if AMM liquidity collapses (`>= 75%` drained or `< $350` for 2 consecutive polls with no healthy reverse quote).
- **UI Toggle & Safe Preset Hardening (`PythonSniperView.tsx`)**:
  - Added the **Early-Launch Rugpull Shield** card under **Speed & Anti-Rug Protections**, updated the weak-filter warning banner, and upgraded **Apply Quick Profit & Safe Preset** to enable `early_rug_shield_enabled`, `auto_rug_exit`, and pre-buy `anti_rug_sell_sim_enabled`.

---

## v1.39.0 — Python Sniper Bot: Dev Wallet Reputation in Open Positions & Consolidated Single-Row Trade History

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Dev Wallet Address, Launch Count & Rug Pulls in Open Positions (`PythonSniperView.tsx`, `sniper/bot.py`, `server/sniperManager.ts`)**:
  - Persists creator reputation metrics (`creator`, `creator_launches`, `creator_rugged`, `creator_fast_rug_min`) onto open positions from `hard_rug_check` / `_evaluate_creator_history` and continuously enriches them from `sniper/creator_history.json` in `SniperManager.getStatus()`.
  - Added a dedicated **Dev wallet** column in the Python Sniper Bot **Open positions** table showing the truncated deployer address (copyable + Solscan account link) alongside a color-coded reputation badge (`X launched · Y rugs`, highlighting fastest rug time on hover).
- **Single Consolidated Row per Coin Trade in Trade History (`src/utils/sniperFormat.ts`, `server/sniperManager.ts`, `PythonSniperView.tsx`)**:
  - Replaced separate `BUY` / `SELL` event rows in `Trade history` with `consolidateSniperTrades`, updating the existing trade entry in-place once exited (including merging intermediate partial `principal_recovery` / `scale_out` exits into the same coin record).
  - Updated ledger counts (`Trade history (N)` and ledger header) to count actual coin trades instead of raw events, and updated columns to show **Buy Price ($ / SOL)**, **Sell Price ($ / SOL)**, **Buy / Exit ($ & Diff)** (total buy amount, total exit proceeds, and exact net difference), **PnL ($ / SOL)**, **PnL %**, **Status** (`OPEN` / `PARTIAL` / `CLOSED`), and **Reason** in one clean row.

---

## v1.38.2 — Fix Python Sniper Scan Exception (`size_mult` KeyError in `_evaluate_sol_regime`)

**Risk Warning: Trading can lose all of your money.**

### Fixed
- **Python Sniper Bot Scan Exception (`KeyError: 'size_mult'`)**:
  - Fixed an unhandled dictionary key access in `sniper/bot.py` during candidate buy order sizing (`total_size_mult = round(max(0.1, min(3.0, conv_mult * regime["size_mult"] * streak["size_mult"])), 3)`).
  - Updated `_evaluate_sol_regime` to explicitly provide `size_mult` in all return payloads (`1.0` for allow, `0.5` for half size, `0.0` for pause).
  - Hardened dictionary lookups with fallback `.get("size_mult", 1.0)` and defensive `get("action")` checks so buy orders proceed smoothly when launches pass filters.

---

## v1.38.1 — Pro Desk Style & Feature Parity Across Both Bots (`ProDeskView.tsx`, `PythonSniperView.tsx`, `CHANGELOG.md`)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **100% Pro Desk Style, Text & Work Parity on Python Sniper Bot (`PythonSniperView.tsx`)**:
  - Unified the Python Sniper Bot Pro Desk tab layout, card structures, icons, typography, and tool actions to match the Solana Spot Bot Pro Desk (`ProDeskView.tsx`) identically.
  - Added direct interactive tool actions for the Python bot: **ATA Rent Audit & Reclaim** (`/api/sniper/rent/audit`, `/api/sniper/rent/reclaim`), **Manual Orphan Token Wallet Sweep** (`/api/sniper/sweep-orphans`), **Real Slippage & Latency DEX Telemetry Scorecard** (`/api/sniper/telemetry`), and **Local Strategy What-If Backtester** (`/api/sniper/backtest`).
  - Every option on both bots features its own distinct enable/disable toggle checkbox (`optionToggles[key]` / `option_enabled[key]`) controlling active runtime enforcement.

---

## v1.38.0 — Pro Trader Intelligence & Execution Desk (`Pro Desk` Tab on Both Bots, Per-Option Checkboxes, Anti-Sybil, Jito `dontfront`, Live WS Exits, Rent Audit & Backtester)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Dedicated `Pro Desk` Tab Immediately After `Settings` on BOTH Bots (`ProDeskView.tsx`, `PythonSniperView.tsx`, `Sidebar.tsx`)**:
  - Every single Pro Desk capability across all 6 trading intelligence & execution groups includes its own **enable/disable checkbox** (`optionToggles[key]` on Solana Spot Bot; `option_enabled[key]` on Python Sniper Bot). Checked = actively enforced & validated; unchecked = dimmed (`OFF`) and completely bypassed at runtime.
- **Group 1 — Deeper Wallet & Scam Intelligence ("Hidden Rug" Catchers)**:
  - **Fresh-Wallet / Shared-Funder Cluster Detection (`antiSybilEnabled` / `anti_sybil_enabled`)**: Inspects early buyers & top holders for freshly funded wallets (`freshWalletMinutes`) sharing the same distributor/CEX hot-wallet funder above `maxSharedFunderCount` to catch split-wallet bundles.
  - **Smart Money / Whale Watchlist (`smartMoneyEnabled` / `smart_money_enabled`)**: Track profitable KOL/smart wallets (`smartWallets` / `smart_wallets`), boost trade size on confluence (`smartMoneySizeBoostPct` / `smart_money_size_boost_pct`), and optionally auto-exit immediately if tracked smart wallets dump (`smartMoneyAutoExitOnSell` / `smart_money_auto_exit_on_sell`, exit reason `SMART_MONEY_SELL`).
  - **Reused Socials Detection (`reusedSocialsEnabled` / `reused_socials_enabled`)**: Normalizes X/Twitter, Telegram, and website links into persistent history (`social_history` SQLite / `social_history.json`) to block serial ruggers recycling the same socials across new dev wallets.
- **Group 2 — Zero-Lag Exit Speed & MEV / Wallet Protection**:
  - **Live PumpPortal WS Open-Position Price & Trade Streaming (`wsExitStreamEnabled` / `ws_exit_stream_enabled`)**: Subscribes directly to bought mints over WebSocket (`<200ms`) so dump spikes and TP wicks trigger exits without waiting for slow HTTP polling loops.
  - **Jito Sandwich Protection `dontfront` (`jitoDontFrontEnabled` / `jito_dont_front_enabled`)**: Injects the Jito `jitodontfront...` read-only marker into VersionedTransaction messages (with ALT index remapping) and Jito block-engine tips (`jitoTipSol` / `jito_tip_sol`) to block MEV sandwich attacks on volatile swaps.
  - **Orphan Token Auto-Adopter Wallet Sweep (`orphanSweepEnabled` / `orphan_sweep_enabled`)**: Scans wallet SPL/Token-2022 accounts (automatic + manual **Run Orphan Sweep** button) so confirmed buys after RPC timeout are immediately adopted into live TP/SL/Trail monitoring.
- **Group 3 — Market Structure & Pro Entry Timing**:
  - **Post-Migration Pullback / Reclaim (`postMigrationPullbackEnabled` / `post_migration_pullback_enabled`)** & **Pre-Migration Bonding Curve Surge (`preMigrationCurveEnabled` / `pre_migration_curve_enabled`)**: Time entries cleanly around Pump.fun curve graduation or the post-migration dip & reclaim bounce.
  - **Wash-Trading / Fake Volume Filter (`washTradeFilterEnabled` / `wash_trade_filter_enabled`)**: Checks unique buyers/traders vs. total transactions (`minUniqueMakersRatio`, `minUniqueTraders5m`) to skip ping-pong bot volume.
  - **SOL 15m Market Regime Filter (`solRegimeFilterEnabled` / `sol_regime_filter_enabled`)**: Automatically pauses new entries (`pause`) or halves position size (`half_size`) when SOL drops fast (`>= solRegimeMaxDropPct` in 15m).
  - **Anti-Top-Wick Guard (`antiTopWickEnabled` / `anti_top_wick_enabled`)**: Blocks market-buying straight into vertical parabolic candles (`> maxShortSpikePct`).
- **Group 4 — Dynamic Position Sizing & Capital Efficiency**:
  - **Conviction-Based Sizing (`convictionSizingEnabled` / `conviction_sizing_enabled`)**: Scales trade size between `convictionMinMult` and `convictionMaxMult` based on liquidity depth, unique makers, creator reputation, and Smart Money confluence.
  - **Losing-Streak / Drawdown Throttle (`streakThrottleEnabled` / `streak_throttle_enabled`)**: Halves size or pauses new entries for `streakCooldownMinutes` after `streakLossLimit` consecutive stop-losses.
  - **Meta / Narrative Duplicate Cap (`narrativeCapEnabled` / `narrative_cap_enabled`)**: Caps simultaneous open positions sharing the same normalized ticker stem (e.g., `MINIPEPE2` -> `PEPE`) to prevent correlated meta losses.
- **Group 5 — Hidden Profit Leaks (Empty ATA Rent & DEX Scorecard)**:
  - **Empty ATA Rent Audit, Reclaim & Burn Dust (`autoReclaimRent` / `auto_reclaim_rent_enabled`)**: Inspects empty and dust token accounts on both bots (`/api/rent/*`, `/api/sniper/rent/*`), closes zero-balance ATAs (`~0.00204 SOL` each), and includes a two-step **Burn Dust & Reclaim All** action.
  - **Real Slippage & Latency DEX Scorecard**: Persistent execution telemetry (`execution_telemetry` / `telemetry.json`) displaying average/max slippage, fill latency (ms), win rate, and net P&L per DEX and platform.
- **Group 6 — Local Strategy What-If Backtester (`POST /api/backtest`, `POST /api/sniper/backtest`)**:
  - Replay historical closed trades on either bot to compare baseline vs. simulated win rate, net P&L, and max drawdown before risking live SOL.

---

## v1.37.0 — Per-Option Enable/Disable Checkboxes (Both Bots), Owner/Creator Rugpull Speed History & Python Sniper Min–Max Coin Age Gap (`SettingsView.tsx`, `PipelineConfigView.tsx`, `PythonSniperView.tsx`, `bot.py`, `creatorHistory.ts`, `security.ts`, `pipeline.ts`, `db.ts`)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Per-Option Enable/Disable Checkboxes on BOTH Bots (`SettingsView.tsx`, `PipelineConfigView.tsx`, `PythonSniperView.tsx`, `defaults.ts`, `sniperManager.ts`, `bot.py`)**:
  - Every configurable setting on both the **Solana Spot Bot** (`optionToggles` across Sizing, Hard Filters, Creator History, Exit Rules, Paper Simulation Realism, Priority Fees, and Pipeline Rules) and **Python New-Launch Sniper Bot** (`option_enabled` across Sizing, Exits, Age Windows, Entry Filters, Anti-Rug, Creator History, Priority/Jito/RPC) now has an explicit enable/disable checkbox.
  - **Checked**: The setting is active, validated, and enforced during scanning, filtering, sizing, buying, and selling.
  - **Unchecked**: The input dims with an `OFF` badge, validation skips disabled bounds, and both bots completely ignore and bypass that rule.
- **Owner / Creator Launch Count & Rugpull Speed Check on BOTH Bots (`creatorHistory.ts`, `security.ts`, `db.ts`, `pipeline.ts`, `liveEngine.ts`, `bot.py`, `sniperManager.ts`)**:
  - Added real on-chain + RugCheck creator resolution and persistent deployer tracking (`creator_history` SQLite table for Spot Bot; `creator_history.json` for Python Sniper Bot):
    - **Check Toggle (`creatorHistoryEnabled` / `check_creator_history`)**: Enable or disable creator history inspection.
    - **Max Owner Prior Coins Launched (`maxCreatorLaunches` / `max_creator_launches`)**: Rejects tokens from serial deployer wallets above your cap.
    - **Max Owner Prior Rugged Coins (`maxCreatorRuggedCoins` / `max_creator_rugged_coins`)**: Rejects creators with prior rugged or LP-drained launches above your limit.
    - **Fast Rugpull Block Window (`creatorFastRugWindowMinutes` / `creator_fast_rug_window_min`)**: Tracks how many minutes after launch a creator pulled the rug and blocks repeat fast-ruggers automatically. Both bots also automatically flag creators when positions are written off (`rugpull_writeoff`) or drained (`EMERGENCY_LIQUIDITY_DRAIN` / `rug_liquidity_drop`).
- **Python Sniper Bot Min–Max Coin Age Gap (`min_age_minutes` + `max_age_minutes` & Hours Helper) (`bot.py`, `settings.json`, `sniperFormat.ts`, `PythonSniperView.tsx`)**:
  - Added **Sniper window: min coin age (minutes)** (`min_age_minutes`, unchecked by default) right alongside **max coin age (minutes)** so you can specify an exact coin age window (e.g., `5m` to `300m` / `600m` [5h–10h]), complete with `= X.Xh` hours helper badges in the UI and client/server validation ensuring `min_age_minutes <= max_age_minutes`.
  - Updated `bot.py` scanner discovery to also fetch multi-hour pools (`trending_pools`, paginated `pools`, and age-gap DexScreener queries) when targeting older windows, and ensured `"too young"` coins are never blacklisted in `_too_old_mints` so they remain eligible once they mature into your age gap.

---

## v1.36.0 — Axiom.trade Pulse Migrated Coins Exclusive Filter (`PythonSniperView.tsx`, `bot.py`, `settings.json`, `sniperManager.ts`)

**Risk Warning: Trading can lose all of your money.**

### Added
- **Axiom.trade Pulse: Migrated Coins Only (Exclusive Mode) (`PythonSniperView.tsx`, `bot.py`, `settings.json`)**:
  - Added a new exclusive toggle under **Python Sniper Bot → Settings → Speed & Anti-Rug Protections**: `axiom_pulse_migrated_only_enabled`.
  - When checked, the bot **forgets and bypasses all other platform and website filters**, restricting scanning and trading **strictly to migrated coins from Axiom.trade Pulse** (graduated AMM pools such as Pumpswap, Raydium, and Meteora, or verified AMM pools with liquidity `>= $2,000`, filtering out unmigrated bonding curves).
  - When unchecked, the bot uses your standard target website filter selections.

---

## v1.35.0 — Speed & Anti-Rug Protections Checkbox Suite, Fast 1–3s Live Buy Pipeline, Raydium Fallback & Linked Settings Guide (`PythonSniperView.tsx`, `bot.py`, `sniperManager.ts`, `jupiter.ts`, `settings.json`, `api.ts`)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Dedicated "Speed & Anti-Rug Protections" Checkbox Section (`PythonSniperView.tsx`, `settings.json`)**:
  - Added a separate configuration section under **Python Sniper Bot → Settings** containing 10 individual opt-in/opt-out checkboxes split into **Buy & Execution Speed Modules** and **Anti-Rug & Capital Safety Modules**, complete with **Enable All (10)**, **Recommended Defaults**, and **Uncheck All** shortcuts.
  - Every option displays a plain-English explanation of what it does when **checked vs. unchecked**, plus an explicit **Linked to:** line showing every related setting it interacts with or overrides.
- **Buy & Execution Speed Modules (`bot.py`, `sniperManager.ts`, `jupiter.ts`, `api.ts`)**:
  - **Fast Live Buy Pipeline (`fast_live_buy_enabled`)**: Releases `TradingAccount.lock` during live HTTP swap requests, reuses token `decimals` verified during `hard_rug_check` (skipping redundant `inspectTokenOnChain` RPC calls), and caps post-buy RPC balance polling at `750ms` (with detached background `live_state.json` reconciliation) so live buys finish in ~1–3s instead of 8–12s.
  - **Parallel Top-3 Rug Pre-Screening (`parallel_rug_screen_enabled`)**: Screens the top 3 ranked launches concurrently via `ThreadPoolExecutor` so clean coins reach swap execution earlier.
  - **Jupiter 429 Quota Guard (`jupiter_quota_guard_enabled`)**: Pauses background exit reverse-quote polling (`_reverse_quote_prices` / `getReverseExitPrices`) during active live swaps, for `10s` afterward, and while running keyless with open scan slots to avoid Jupiter `HTTP 429` collisions during buys.
  - **Direct PumpPortal & Raydium Instant Swap Fallback (`direct_dex_fallback_enabled`)**: Added direct Raydium Trade API swap execution (`buildRaydiumSwapTransaction`) alongside PumpPortal `trade-local` (`pool='auto'`) fallback when Jupiter returns `429` or has no route on a brand-new pool or urgent exit.
- **Anti-Rug & Capital Safety Modules (`bot.py`, `settings.json`)**:
  - **Tight Anti-Rug Score & Whale Cap (`anti_rug_tight_score_enabled`)**: Hardens `hard_rug_check` thresholds to RugCheck score `< 45`, Top-10 non-pool holders `<= 30%`, and single private wallet `<= 12%`.
  - **Real Pool Depth & MCap/LP Ratio Guard (`anti_rug_pool_depth_check_enabled`)**: Enforces an effective `$2,500` minimum pool depth floor and rejects inflated wash-trade launches with `MCap > 80× Liquidity` (instead of `150×`).
  - **Always Simulate Exit Swap & Tight 10% Impact Cap (`anti_rug_sell_sim_enabled`)**: Forces a live Jupiter `mint -> WSOL` sell simulation before every entry (even when sells already appear on the chart) and lowers the maximum exit price-impact threshold from `15%` to `10%`.
  - **Copycat Ticker Cooldown (`anti_rug_copycat_cooldown_enabled`)**: Places a rug-rejected coin's ticker symbol on a 10-minute cooldown (bypassed only if liquidity reaches `$15,000+`).
  - **Require Burned/Locked LP `>= 80%` (`require_lp_locked`)** & **Auto Emergency Sell on LP Drain (`auto_rug_exit`)**: Restored as explicit checkboxes in the safety section, with unlocked Meteora DLMM/DAMM pools now properly audited when `require_lp_locked` is checked while Pump.fun curves and PumpSwap stay allowed.

---

## v1.34.1 — Fix Jupiter 429 Rate Limits, Missing Buy/Sell Routes (`PumpPortal` Auto-Fallback) & On-Chain Slippage Retries (`base.ts`, `jupiter.ts`, `sniperManager.ts`, `rpcPool.ts`, `bot.py`)

**Risk Warning: Trading can lose all of your money.**

### Fixed & Improved
- **Eliminated `HTTP 429` & `Rate limited backoff active for lite-api.jup.ag` Failures (`base.ts`, `jupiter.ts`, `bot.py`)**:
  - Added short `2.5s–10s` swap-rate-limit cooldown bounds (replacing the old `15s–180s` global blackout on `lite-api.jup.ag`) and prevented HTTP 429 responses from tripping the 60s circuit breaker.
  - Added keyless pacing (`750ms` interval) on `lite-api.jup.ag`, stopped `getQuote()` from firing a second relaxed retry into an active 429, and added automatic failover to `api.jup.ag` when `lite-api.jup.ag` is throttled.
  - Stopped `bot.py` from wasting shared IP Jupiter quota: `hard_rug_check` skips redundant Jupiter sell-route probes when live swap telemetry already shows active sells (`sells >= 2`), enforces shared 429 cooldowns (`_jup_quote_backoff_until`), throttles calm background reverse-quote polling (`4s` when far from TP/SL vs `1.2s` near targets), and spaces consecutive failed live buys by `0.9s`.
- **Automatic PumpPortal `trade-local` (`pool='auto'`) Buy & Sell Fallback (`jupiter.ts`, `sniperManager.ts`)**:
  - When Jupiter has no route yet (fresh Pump.fun / PumpSwap / LaunchLab / Raydium / Bonk launches) or returns `429` / rate-limit backoff, `executeLiveBuy` and `executeLiveSell` automatically build the swap via `https://pumpportal.fun/api/trade-local` (`pool: 'auto'`), sign it locally with your wallet, and broadcast it on-chain.
- **Fixed `On-chain transaction error` Slippage Reverts (`sniperManager.ts`, `rpcPool.ts`)**:
  - Enabled `dynamicSlippage: true` on live Jupiter buy swaps, added a single-shot automatic slippage retry (`8%–15%`) if a tight-slippage (`3%`) fast-launch buy reverts on-chain, and decoded custom Solana slippage error codes (`6001` / `6004` / `0x1771`) clearly in logs.

---

## v1.34.0 — Target Websites & Launchpads Checkboxes (`pump.fun`, `axiom.trade`, `pumpswap`, `letsbonk.fun`, `raydium`, `meteora`, `moonshot`, `bags.fm`, `believe.app`, `gmgn.ai`, `photon`, `bullx.io` & more) (`bot.py`, `settings.json`, `sniperManager.ts`, `PythonSniperView.tsx`)

**Risk Warning: Trading can lose all of your money.**

### Added
- **Target Websites & Launchpads Filter (`PythonSniperView.tsx`, `bot.py`, `settings.json`, `sniperManager.ts`)**:
  - Added a multi-select checkbox grid under **Python Sniper Bot → Settings** covering 17 Solana websites, launchpads, DEXes, and trading terminals: **Pump.fun** (`pump.fun`), **Axiom Trade** (`axiom.trade`), **PumpSwap** (`swap.pump.fun`), **LetsBonk** (`letsbonk.fun`), **Raydium / LaunchLab** (`raydium.io`), **Meteora** (`meteora.ag`), **Moonshot** (`moonshot.cc`), **Bags** (`bags.fm`), **Believe** (`believe.app`), **Boop** (`boop.fun`), **Orca** (`orca.so`), **Jupiter** (`jup.ag`), **GMGN** (`gmgn.ai`), **Photon** (`photon-sol.tinyastro.io`), **BullX** (`bullx.io`), **DexScreener** (`dexscreener.com`), and **GeckoTerminal** (`geckoterminal.com`), each with a concise note showing which coins/pools it searches.
  - Added quick-selection shortcuts (**All Websites (Any)**, **Pump.fun Only**, **Axiom / Trenches**) and saved selections in `enabled_platforms` inside `settings.json`.
  - When one or more website checkboxes are checked, `bot.py` (`matches_enabled_platforms` inside `passes_filters`, `scan_and_buy`, and `probe`) strictly restricts scanning and buying only to coins matching the checked website(s). Leaving all unchecked searches all websites.

---

## v1.33.2 — Unblock Buys (`require_lp_locked` Fix on PumpSwap/Meteora), Streamline Settings & Purpose Notes on Every Field (`bot.py`, `settings.json`, `sniperManager.ts`, `PythonSniperView.tsx`)

**Risk Warning: Trading can lose all of your money.**

### Fixed & Improved
- **Unblocked New-Launch Buys (`sniper/bot.py`, `sniper/settings.json`, `server/sniperManager.ts`, `PythonSniperView.tsx`)**:
  - Fixed `hard_rug_check` rejecting 100% of passing Pump.fun / PumpSwap / Meteora / LaunchLab launches with `LP burned/locked 0% < 80% minimum (rug risk)` (because RugCheck reports `0%` LP lock/burn on canonical non-burnable pools).
  - Set `require_lp_locked: false` and `auto_rug_exit: false` by default (and in **Apply Quick Profit & Safe Preset**), skipped canonical AMM pool types even if `require_lp_locked` is later enabled, prevented RugCheck `Large Amount of LP Unlocked` warnings from tripping the generic `danger` catch-all when LP lock checks are off, and always registered RugCheck market pool pubkeys into `known_pools` so pool balances never inflate Top-10 holder %.
- **Streamlined Settings & Per-Field Purpose Notes (`PythonSniperView.tsx`)**:
  - Commented out `auto_rug_exit`, `rug_liq_drop_pct`, and `require_lp_locked` from the active UI configuration list (`PYTHON_SETTINGS_METADATA`) so they can be easily re-enabled if needed in the future.
  - Added clear, concise purpose notes directly beneath every active Python Sniper setting (including dynamic behavior descriptions for `stop_loss_pct` and `trailing_stop_pct`), and updated the weak-filter alert banner so it no longer flags `require_lp_locked = false`.

---

## v1.33.1 — Prevent False `rug_liquidity_drop` Loss Sells on Dips, Pump.fun Curves & Missing DexScreener Liquidity (`bot.py`, `PythonSniperView.tsx`)

**Risk Warning: Trading can lose all of your money.**

### Fixed
- **Prevented False `rug_liquidity_drop` Exits During Normal Early Dips (`sniper/bot.py`)**:
  - Fixed `monitor()` coercing missing/`None` DexScreener `liquidity.usd` fields into `0.0` (common on newly-indexed or bonding-curve pairs), which previously triggered an immediate 100% LP-drain false alarm seconds after entry even when Stop Loss and Trailing Stop were disabled (`0`).
  - Excluded `pumpfun` bonding-curve tokens from `rug_liquidity_drop` because bonding-curve SOL is program-locked and cannot be LP-pulled, and added automatic entry liquidity baseline recalibration when transitioning from a synthetic PumpPortal curve quote (or `pumpfun` migration) to a DEX pool (`pumpswap`, `raydium`, etc.).
  - Added 2-poll LP-drain confirmation (`liq_drop_streak >= 2`) and live Jupiter reverse-quote protection inside `check_exits()`: mild dips (`> -35%`) with an active Jupiter exit quote no longer falsely trigger `rug_liquidity_drop`, while genuine AMM LP collapses (`>= 2` consecutive confirmed drain polls or `<= -50%` crash with no reverse quote) still trigger emergency exits.
- **Settings Clarity (`PythonSniperView.tsx`)**:
  - Added an inline helper hint under **Auto emergency sell on LP drain (rug exit)** explaining that it skips Pump.fun curves, requires 2 confirmed LP-drain polls, and can be set to `False (Disabled)` to ride all dips strictly to TP/SL/Trail.

---

## v1.33.0 — Sub-20s Direct PumpPortal Curve Entry, Private RPC + Jito/Priority Execution, Anti-Bundle Rug Screening & Momentum Ranking (`pumpportal.ts`, `rpcPool.ts`, `jupiter.ts`, `sniperManager.ts`, `api.ts`, `bot.py`, `settings.json`, `PythonSniperView.tsx`)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Direct PumpPortal Trade Stream & Sub-20s Launch Entry (`pumpportal.ts`, `sniperManager.ts`, `api.ts`, `bot.py`)**:
  - Extended `PumpPortalWsProvider` to auto-subscribe to live `subscribeTokenTrade` streams for brand-new PumpPortal launches, tracking live `vSolInBondingCurve` / `vTokensInBondingCurve` reserves, real-time 60s buy/sell velocity (`buys_60s`, `sells_60s`, `sol_vol_60s`), and creator/dev sell events (`creator_sold`).
  - `/api/sniper/pumpportal-mints` now returns DexScreener-compatible synthetic launch pairs alongside recent mints, allowing `bot.py` (`scan_and_buy`) to price and evaluate fresh coins at **5–20 seconds old** (with Jupiter price backfill) instead of waiting 30–100s for DexScreener indexing.
- **Execution Speed, Private RPC, Priority Tiers, Jito Tips & Real Swap Exit Quotes (`rpcPool.ts`, `jupiter.ts`, `sniperManager.ts`, `api.ts`, `bot.py`, `PythonSniperView.tsx`)**:
  - Added `custom_rpc_url` (e.g. Helius / QuickNode) wired directly into `SolanaRpcPool.setPrimaryCustomRpc` and Python on-chain mint/holder RPC checks, plus live `jupiter_api_key` propagation on `JupiterProvider`.
  - Added `priority_fee_tier` (`standard` | `fast` | `turbo`) and optional `jito_tip_sol` with Jupiter native priority/Jito tip swap parameters, urgent `veryHigh` priority escalation on `trailing_stop` / `stop_loss` / `rug_liquidity_drop` / `manual_exit` sells, and parallel best-effort Jito Block Engine relay when `jito_tip_sol > 0`.
  - Added `use_real_swap_quotes` and `POST /api/sniper/reverse-quotes` (`JupiterProvider.getReverseExitPricesUsd`) so `monitor()` prices open positions using live `mint -> WSOL` reverse quotes reflecting actual executable pool liquidity.
- **Bundled / Insider Rug Detection & Stronger Velocity/Liquidity Defaults (`bot.py`, `settings.json`, `sniperManager.ts`, `PythonSniperView.tsx`)**:
  - Upgraded `hard_rug_check` to block RugCheck `insiderNetworks` / `insidersDetected > 0` clusters (`block_insider_bundles`), bundle/sniper risks, creator/dev holdings exceeding `max_dev_hold_pct` (`5%`), and early bonding-curve creator dumps (`creator_sold`).
  - Tightened default quick-profit entry quality floors to `min_liquidity_usd: $5,000`, `min_volume_m5_usd: $2,000`, `min_buy_sell_ratio_m5: 1.5`, and 60s PumpPortal stream velocity checks (`min_recent_buys_60s: 3`, `buys_60s >= sells_60s`).
- **Momentum-First Candidate Ranking (`bot.py`)**:
  - Added deterministic `score_candidate` and `rank_candidates` in `scan_and_buy()` so when multiple launches pass entry filters in the same scan cycle, slots are allocated to the strongest momentum + turnover + 60s velocity launch first instead of arbitrary dictionary order.

---

## v1.32.1 — Fast Live Buy Execution, Parallel Rug Screening, Streamlined Quick-Profit Settings UI & Young-Coin Rug Score Calibration (`rpcPool.ts`, `liveEngine.ts`, `sniperManager.ts`, `bot.py`, `settings.json`, `PythonSniperView.tsx`)

**Risk Warning: Trading can lose all of your money.**

### Improved
- **Fast Live Buy Execution (`sniperManager.ts`, `rpcPool.ts`, `liveEngine.ts`)**:
  - Parallelized pre-buy checks and quote discovery inside `executeLiveBuy` (`getAgreedTokenBalanceUi`, `inspectTokenOnChain`, stale SOL balance check, and `jupiter.getQuote(..., bypassCache: true)`) in a single concurrent batch, with a `<10s` cached SOL balance fast-path when funded.
  - Enabled `skipPreflight: true` on fast live snipe buy submissions (skipping redundant simulation RPC latency immediately after quoting) and moved post-buy SOL balance refresh into a non-blocking background update using immediate deterministic accounting.
  - Rewrote `SolanaRpcPool.getAgreedSignatureConfirmation` to early-resolve as soon as quorum confirms or fails instead of stalling on a lagging 3rd RPC, lowered per-RPC status timeout from `4500ms` to `1800ms`, and added single healthy-responder confirmation fallback.
  - Reduced `DefaultLiveTxAdapter.pollConfirmation` interval from `650ms` to `350ms` and `reconcileParsedSwapSolDelta` retry delay from `400ms` to `200ms`, cutting typical live buy execution from ~15s down to a few seconds.
- **Parallel Rug Screening & Faster New-Launch Catch Rate (`bot.py`)**:
  - Parallelized `hard_rug_check` using a 3-worker `ThreadPoolExecutor` so on-chain SPL/Token-2022 inspection, RugCheck `/report` fetch, and pre-buy Jupiter sell-route simulation execute concurrently (~1s vs 3–6s sequential) with non-blocking pool teardown on early rejection.
  - Added `_pending_dex_retry` queue (`~2s` retry interval for up to `45s`) so ultra-fresh `pumpportal` launches not yet indexed on DexScreener (`not-on-dexscreener`) are re-checked within ~2 seconds instead of waiting `10s` (`SEEN_TTL_SEC`).
- **Streamlined Quick-Profit Settings UI & Young-Coin Calibration (`PythonSniperView.tsx`, `settings.json`, `bot.py`, `sniperManager.ts`)**:
  - Streamlined `PYTHON_SETTINGS_METADATA` in **Python Sniper Bot → Settings** to show the 20 essential quick-profit and anti-rug controls (`TP 35%`, `Trail 12%`, `SL 30%`, `LP-Drain 50%`, `Slippage 3%`), while cleanly commenting out optional/auto-managed fields in source for easy future re-enabling.
  - Raised default `rugcheck_max_score` from `25` to `55` (and adjusted the UI weak-filter banner threshold to `> 60`) because brand-new `< 2m` Solana tokens baseline around `52/100` on RugCheck while Mint/Freeze Authority, Token-2022 extension, `>=80%` LP Lock/Burn, `<=35%` non-pool Top-10 holders, and Jupiter sell-route checks remain strictly enforced.

---

## v1.32.0 — Trailing-Stop & Live Sell Reliability Fix, Fail-Closed Anti-Rug Protections, and Dev Server Startup Fix (`env.ts`, `jupiter.ts`, `liveEngine.ts`, `rpcPool.ts`, `sniperManager.ts`, `bot.py`, `settings.json`, `PythonSniperView.tsx`)

**Risk Warning: Trading can lose all of your money.**

### Fixed
- **Dev Server CLI Flag Parsing (`server/config/env.ts`)**:
  - Updated `loadAppEnv()` to honor `--port` and `--host` CLI arguments ahead of `PORT`/`HOST` environment variables so `tsx server.ts --port 3000 --host 0.0.0.0` always binds reliably on port `3000`.
- **Trailing Stop Not Selling After Hitting TP (`afk` +73.1% → +25.36% Regression) & Live Sell Execution (`bot.py`, `sniperManager.ts`, `jupiter.ts`, `liveEngine.ts`, `rpcPool.ts`)**:
  - Fixed a state-machine gap in `evaluate_exit_signal` when `recover_principal_enabled=True`: if a coin spiked above `take_profit_pct` (e.g. `+73.1%`) and retraced below TP before recovery closed out (e.g. `+25.36%`) while `trailing_stop_pct > 0`, `trailing_stop` was never evaluated because `principal_recovered` was still `False`. Trailing stop now triggers whenever peak reached TP and PnL pulls back `>= trailing_stop_pct` while still in profit.
  - Prevented `trailing_active` from displaying as `True` when `trailing_stop_pct` is `0`.
  - Wired `stop_loss_pct` (default `35%`) into `evaluate_exit_signal` so losing entries exit before hitting `-100%` write-offs.
  - Hardened `executeLiveSell`: passes `bypassCache: true` to `jupiter.getQuote` so urgent sell retries never reuse stale `1200ms` cached routes, falls back to `inspectTokenOnChain` decimals and single-RPC balance readings when <2 RPCs respond (`getAgreedTokenBalanceUi`), caps per-tier `pollConfirmation` (`14s`/`20s`) within a `95s` Python bridge timeout (previously `55s` timed out mid-retry), uses `skipPreflight: true` on urgent/retry tiers with automatic simulation-failure retry, and reconciles already-landed transactions on confirmation timeout via `findRecentSellSignature` + zero-balance check.
  - Surfaced live sell errors (`last_sell_error`) directly on Open Positions in `PythonSniperView.tsx`.

### Added & Improved
- **Hardened Fail-Closed Anti-Rug Filters & Emergency LP-Drain Exit (`bot.py`, `sniperManager.ts`, `settings.json`, `PythonSniperView.tsx`)**:
  - Updated default `settings.json` & `saveDefaultSettings()` anti-rug floors: `min_liquidity_usd: 3000`, `min_volume_m5_usd: 1500`, `min_buys_m5: 8`, `min_buy_sell_ratio_m5: 1.2`, `ultra_early_grace_sec: 0` (eliminated blind 10s bypass), `rugcheck_max_score: 25`, `max_top10_holder_pct: 35`, `require_lp_locked: true`, `stop_loss_pct: 35`, `auto_rug_exit: true`, `rug_liq_drop_pct: 60`.
  - Upgraded `passes_filters` to reject honeypot buy-only patterns (`>= 12 buys / 0 sells` after `30s`) and inflated `MCap / Liquidity > 150x` pools.
  - Upgraded `hard_rug_check`: rejects Token-2022 disallowed extensions (`TransferFeeConfig`, `PermanentDelegate`, `TransferHook`, `ConfidentialTransferMint`, `MintCloseAuthority`, `DefaultAccountState`, `NonTransferable`), fetches full RugCheck `/report` to check `rugged` flags and enforce `rugcheck_max_score` + fail-closed missing report checks at **all** token ages (`< 180s` no longer bypasses score checks), verifies `>= 80%` LP burn/lock on non-bonding-curve AMMs when `require_lp_locked` is enabled, computes non-pool Top-10 & Single-Max holder percentages via RugCheck/RPC, and runs a pre-buy Jupiter reverse sell-route check (`_check_sell_route`) to block unroutable honeypots.
  - Added real-time liquidity polling in `monitor()` (`entry_liquidity_usd`) + `auto_rug_exit` in `evaluate_exit_signal` to trigger an immediate emergency `rug_liquidity_drop` sell when pool liquidity plunges `>= rug_liq_drop_pct%` (default `60%`).
  - Exposed `stop_loss_pct`, `require_lp_locked`, `auto_rug_exit`, and `rug_liq_drop_pct` in **Python Sniper Bot → Settings**, added a weak-filter warning banner, labeled optional/paper-only fields, and added a 1-click **Apply Safe Anti-Rug Preset** button.

---

## v1.31.0 — Force-Delete Resurrection Fix, Principal Recovery & Scale-Out Ladder, and Tighter New-Coin Rug Filters (`bot.py`, `sniperManager.ts`, `api.ts`, `PythonSniperView.tsx`, `sniperFormat.ts`)

**Risk Warning: Trading can lose all of your money.**

### Fixed
- **Rugged / Deleted Positions No Longer Reappear After `Force Delete` (`sniperManager.ts`, `bot.py`, `PythonSniperView.tsx`)**:
  - Fixed a stopped-mode race condition where the 1-second background quote refresher (`refreshStoppedOpenPositions`) read `live_state.json` / `state.json` before slow Jupiter/DexScreener HTTP fetches and overwrote the state file afterward, resurrecting a position in Open Positions even after `Force Delete` recorded `rugpull_writeoff` in Trade History.
  - Added atomic temp-file writes (`writeStateAtomic`), `stateRevision` abort checks, a `recentlyDeletedMints` grace filter inside both `refreshStoppedOpenPositions` and `getStatus`, and a cross-process `delete_queue.json` / `live_delete_queue.json` drained by `bot.py` (`_drain_delete_queue`), plus a double-click guard and optimistic UI removal on `Force Delete`.

### Added & Improved
- **Principal Recovery & Partial Scale-Out Ladder Linked to Take Profit Validation (`bot.py`, `sniperManager.ts`, `sniperFormat.ts`, `PythonSniperView.tsx`)**:
  - Added `recover_principal_enabled`, `recover_principal_sell_pct` (default `50%`), `scale_out_sell_pct` (default `25%`), and `scale_out_step_gain_pct` (default `+100%`) to Python Sniper Bot settings across both Paper and Live modes.
  - **Step 1 (Money-Back Exit)**: Once a coin hits `take_profit_pct`, sells `recover_principal_sell_pct` (e.g. `50%`) to recover 100% of invested capital plus buy/sell fees, slippage, and live Solana tx costs, marks the position `Principal Safe`, and arms the trailing stop on the remaining bag.
  - **Step 2 (Free-Roll Ladder)**: On further upside pumps (e.g. every additional `+100%`), sells `scale_out_sell_pct` (e.g. `25%`) of the remaining balance (`scale_out_<pct>` in Trade History) while trailing stop protects the remainder (`trailing_stop_<pct>`).
  - **Math-Backed TP Validation & Blocker**: Both UI and server/bot block saving or starting if `take_profit_pct` is too low for the chosen sell % to recover your invested USD + fees + slippage, displaying the exact minimum required percentage and a 1-click quick-fix button.
- **Stronger Young-Coin Rug Screening (`bot.py`, `PythonSniperView.tsx`)**:
  - `hard_rug_check` now always enforces `max_top10_holder_pct`, unlocked LP checks, and Token-2022 transfer-fee / permanent-delegate checks even on `< 3m` coins instead of skipping them, and exposes `ultra_early_grace_sec` directly in Settings.

---

## v1.30.2 — Trailing Stop Pullback Measured from Peak PnL % + Live Floor Badge (`bot.py`, `PythonSniperView.tsx`, `sniperFormat.ts`)

**Risk Warning: Trading can lose all of your money.**

### Fixed
- **Trailing Stop Exit Now Fires on `Peak PnL % - Trailing %` (`bot.py`)**:
  - Fixed trailing drawdown calculation (`drop_from_peak_pct`) so it measures the drop directly in **percentage points from Peak PnL %** (`peak_chg_pct - change_pct >= trailing_stop_pct`), matching Solana Spot Bot's exit floor math (`peakGainPct - allowedDrop`).
  - Previously, measuring `(1 - price / peak_price) * 100` meant a coin that peaked at `+52.5%` and dropped to `+33.78%` (`-18.72%` from peak PnL) only registered as `12.28%` and waited down until `+29.6%`. Now `52.5% - 15% = +37.5%` exit floor triggers `trailing_stop_15` cleanly as soon as PnL crosses below `+37.5%` (such as `+33.78%`).
  - When `take_profit_pct = 0` and `trailing_stop_pct > 0`, the arm threshold is now `max(10, trailing_stop_pct + 5)%` so the initial trailing floor always starts at `+5%+` profit.
- **Exact Trailing Floor Indicator (`PythonSniperView.tsx`, `sniperFormat.ts`)**:
  - Updated the Open Positions `Trail` badge under `Peak / Low` to display the live exit floor (e.g. `Trail ≥ +37.5%`) once trailing stop arms.

---

## v1.30.1 — Profit-Protected Trailing Stop & Take-Profit Activation (`bot.py`, `PythonSniperView.tsx`, `sniperFormat.ts`)

**Risk Warning: Trading can lose all of your money.**

### Fixed
- **Trailing Stop No Longer Sells in a Loss or Cuts Upside Early at Take Profit (`bot.py`)**:
  - Fixed a bug where `trailing_stop_pct` activated at a hardcoded `+10%` peak (`peak_chg >= 10`), causing a 15% pullback from `+10%` (`1.10 * 0.85 = -6.5%`) to trigger `trailing_stop_15` **at a loss** before reaching your Take Profit target.
  - When **both** `take_profit_pct` (e.g., `50%`) and `trailing_stop_pct` (e.g., `15%`) are configured, Take Profit now acts as the **activation threshold**: the bot waits until `+50%` is reached before arming the trailing stop, does **not** force-sell right at `+50%` if momentum continues upward (`+80%`, `+120%`, etc.), and only exits via trailing stop when price pulls back `15%` from the highest peak while remaining strictly in profit above entry.
  - When `take_profit_pct` is `0` (disabled) and `trailing_stop_pct > 0`, trailing stop automatically waits until peak profit exceeds breakeven + `5%` fee/slippage buffer before arming, and uses true drawdown from peak `(1 - price / peak_price) * 100 >= trailing_stop_pct`.
- **UI Indicators & Settings Hints (`PythonSniperView.tsx`, `sniperFormat.ts`)**:
  - Added a live inline rule hint beside `Trailing stop % from peak` in Settings (e.g. `Arms at +50% · exits -15% from peak (profit only)`) and a `Trail On` badge under `Peak / Low` in Open Positions once the profit target is reached and trailing stop is armed.

---

## v1.30.0 — Sub-Minute Launch Discovery Fix, Live Bot Runtime Timer & Clear Scan Logs (`bot.py`, `sniperManager.ts`, `api.ts`, `PythonSniperView.tsx`, `sniperFormat.ts`)

**Risk Warning: Trading can lose all of your money.**

### Fixed & Improved
- **Fixed `pumpportal=0`, GeckoTerminal 429 Drop-Outs & Sub-Minute Pool Discovery (`bot.py`, `sniperManager.ts`, `api.ts`)**:
  - Replaced the broken `api.pumpportal.fun/api/data/coins/new` HTTP call (which consistently returned `pumpportal=0`) with a live bridge endpoint (`/api/sniper/pumpportal-mints`) connected directly to Node's real-time `PumpPortalWsProvider` WebSocket stream (`subscribeNewToken` & `subscribeMigration`).
  - Fixed GeckoTerminal `/new_pools` polling so it fetches `page=1` every 10s with automatic 429 backoff instead of hammering 2 pages every 5s and dropping to `gecko=0`.
  - Cached GeckoTerminal pool metadata (`pool_created_at`, `base_token_price_usd`, `reserve_in_usd`, `transactions.m5`) as an immediate fallback when brand-new `<1m` coins are not yet indexed on DexScreener (`not-on-dexscreener`), and prioritized real-time `pumpportal` & `gecko` launches ahead of older lists so `max_age_minutes` windows (`1m`, `1.5m`, `2m`) actually catch sub-minute coins.
  - Stopped repeatedly re-logging already-expired `too old` coins every 10 seconds while keeping them eligible for immediate re-evaluation whenever `settings.json` changes.
- **Clear Scan Logs Button (`POST /api/sniper/logs/clear`, `PythonSniperView.tsx`)**:
  - Added a **Clear logs** button right inside the Scan log header bar next to the event count to wipe console scan history on both the UI and backend buffer.
- **Live Bot Runtime Timer (`sniperManager.ts`, `PythonSniperView.tsx`, `sniperFormat.ts`)**:
  - Added a real-time `Runtime HH:MM:SS` timer badge in the Python Sniper Bot header (`started_at_ms` / `uptime_sec`) so you can immediately see how long the bot has been running.

---

## v1.29.1 — Live Buy Entry Price & ExactIn Swap Cost Basis Fix (`sniperManager.ts`, `liveEngine.ts`)

**Risk Warning: Trading can lose all of your money.**

### Fixed
- **Live Buy Entry Price & SOL Cost Inflation on PumpSwap / Jupiter (`sniperManager.ts`, `liveEngine.ts`)**:
  - Fixed a reconciliation bug where ancillary on-chain SOL outflows during Jupiter ExactIn swaps (such as PumpSwap accumulator/vault PDA creation, unclosed WSOL ATA rent, protocol fees, or priority tips outside `tx.meta.fee` and `createdAtaRentLamports`) were mistakenly added to `realSolSpent`.
  - Previously, a `$0.50` (`0.0069 SOL`) live buy could record `0.0099 SOL` (`$0.72`) as the swap cost basis, inflating the displayed entry price (e.g., `$0.00002251` instead of Jupiter's true `$0.00001566` entry) and showing false negative PnL% even when the coin was in profit.
  - `executeLiveBuy` (Python Sniper Bridge) and `LiveExecutionEngine.reconcileConfirmedBuy` now cap ExactIn swap cost at `quote.inAmount` (`quotedSolIn`) and track any extra on-chain overhead separately in `rentSol` so live entry price, cost USD, SOL spent, and Take-Profit triggers match actual Jupiter execution.

---

## v1.29.0 — Python Sniper Post-Sell Rescan Delay, Profit & Loss CSV Ledger & History CSV Export (`settings.json`, `bot.py`, `sniperManager.ts`, `api.ts`, `PythonSniperView.tsx`)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Configurable Post-Sell Rescan Delay (`rescan_delay_after_sell_sec`)**:
  - Added new setting `rescan_delay_after_sell_sec` to `settings.json`, `bot.py`, `sniperManager.ts`, and the Python Sniper Bot Settings UI tab.
  - When a coin is sold (Take-Profit, Trailing Stop, Max Hold, or Manual Exit), the bot records the exit timestamp and pauses candidate scanning for the configured duration (e.g., 40 seconds, 60 seconds / 1 min, 180 seconds / 3 mins, etc.).
  - Added live countdown visibility: displays `⏳ RESCAN DELAY (Xs) · SCAN PAUSED` pill in the header and a `Rescan delay: Xs left` badge in the Positions tab while cooldown is active so the user always knows why scanning is paused.
  - Settings UI displays dynamic minute equivalent preview alongside input (e.g. `≈ 1.0 min (60s)`, `≈ 3.0 min (180s)`, or `0s (immediate)`).
- **Dedicated Profit & Loss CSV Ledger (`pnl_history.csv` / `live_pnl_history.csv`)**:
  - Automatically records every closed trade into an itemized PnL ledger with columns: `time`, `symbol`, `mint`, `outcome` (`PROFIT` / `LOSS`), `entry_price`, `exit_price`, `cost_usd`, `proceeds_usd`, `pnl_usd`, `pnl_sol`, `pnl_pct`, `reason`, `hold_seconds`, `dex`, `source`, `sol_price_usd`, `tx_buy`, `tx_sell`, and `dexscreener`.
  - Both Python bot (`TradingAccount._log_pnl`) and Node manager (`appendPnlCsv`) append to the CSV when closing trades, ensuring complete parity across paper and live trading.
- **Export CSV Button in History Tab (`GET /api/sniper/export/trades.csv`, `PythonSniperView.tsx`)**:
  - Added an **Export CSV** button in the Python Sniper Bot Trade History tab with `Download` icon, allowing one-click export and download of the complete PnL ledger (`sniper_paper_pnl_YYYY-MM-DD.csv` or `sniper_live_pnl_YYYY-MM-DD.csv`).
  - Implemented `/api/sniper/export/trades.csv` endpoint supporting authentication via `x-api-token` header or query token, with automatic fallback synthesis from existing trade history if the dedicated ledger is fresh.

---

## v1.28.2 — Python Sniper Force-Delete / Rugpull Position Clear & Trade History Write-off (`sniperManager.ts`, `api.ts`, `PythonSniperView.tsx`)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Force Delete / Clear Rugged Positions (`sniperManager.ts`, `api.ts`, `PythonSniperView.tsx`)**:
  - Added a **Force Delete** button alongside "Sell now" on every open position in the Python Sniper Bot.
  - Allows manually clearing positions that have been rugged, abandoned, or lack sell routes on-chain, immediately freeing up trade slots (`max_open_positions`) and resuming candidate scanning.
  - Automatically records a trade history entry in `trades.csv` / `live_trades.csv` with reason `rugpull_writeoff`, noting the manual clearance and recording the cost basis loss so trade history and analytics remain fully updated.

---

## v1.28.1 — Python Sniper Take-Profit Instant Retry & Rugpull Liquidity Protection (`bot.py`)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Fixed Python Sniper Bot Not Selling on Take-Profit (`bot.py`)**:
  - Removed the 5-second `last_sell_attempt` cooldown for `take_profit` triggers inside `TradingAccount.check_exits()`. When price hits or exceeds `take_profit_pct` (e.g. 60% TP), the bot now attempts to sell on **every 1-second tick** without delay until successfully filled.
  - Paired with progressive slippage escalation up to 5000 bps (50%) and `dynamicSlippage: true`, ensuring fast-moving pump tokens and volatility spikes lock in profits instantly before any liquidity drain or rugpull.

---

## v1.28.0 — Python Sniper Live Trading Mode, Reliable Bot Stop (Process Tree & Signal Halting) & Live Wallet/Tx Visibility

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Live Trading Option in Python Sniper Bot (`bot.py`, `sniperManager.ts`, `api.ts`, `PythonSniperView.tsx`, `sniperFormat.ts`)**:
  - Added a direct **Paper / Live** mode switcher right in the Python Sniper Bot header (`POST /api/sniper/mode`), plus `PAPER` / `LIVE` mode badges and `Live Wallet` status bar showing the connected server wallet public key, Signer Unlocked/Locked status, RPC health count, and one-click `Refresh Balance` or `Unlock Wallet`.
  - Connected `bot.py` and `sniperManager` manual sells to your active **Server Wallet (`ServerSignerManager`)**, **Solana RPC Pool**, and **Jupiter Swap (`JupiterProvider` + `DefaultLiveTxAdapter`)** via an authenticated internal loopback bridge (`/api/sniper/live-wallet`, `/api/sniper/live-buy`, `/api/sniper/live-sell`), keeping private keys strictly inside Node without requiring extra Windows native Python packages.
  - Isolated Live and Paper ledgers cleanly (`live_state.json`, `live_trades.csv`, `live_sell_queue.json` vs `state.json`, `trades.csv`, `sell_queue.json`) so Live real-money history cannot be wiped by `Reset Account & History`.
  - Emits clear no-balance alerts showing both **SOL and USD** (`There is no SOL (0.0000 SOL / $0.00) in the wallet to trade...`) without blacklisting coins, verifies exact on-chain raw integer token balances & ATA rent/fees on swap reconciliation, keeps Live positions open with retry backoff if a sell route temporarily fails, and renders direct **Solscan TX** links on both Open Positions and Trade History rows.
- **Fixed Python Bot Continuing to Buy, Sell & Fill Slots After Clicking Stop (`bot.py`, `sniperManager.ts`, `server.ts`)**:
  - Fixed Windows & POSIX orphaned child-process leaks where `SIGTERM` terminated only the shell/`py.exe` launcher while leaving the underlying `python.exe` process running in the background.
  - `SniperManager.stop()` now writes a cooperative `stop.flag` halt signal, terminates the full OS process tree (`taskkill /PID <pid> /T /F` on Windows and negative-PID process group kill on POSIX), cleans up any orphaned PID recorded in `bot.pid`, and guards delayed child exit callbacks via `runId`.
  - Added cooperative stop checking (`SIGINT`/`SIGTERM`/`SIGBREAK` handlers, `stop.flag` checks before every scan, rug check, buy, monitor tick, sell queue drain, and exit execution, plus 150ms interruptible waits) inside `bot.py`, and ensured `server.ts` cleanly halts the sniper subprocess on shutdown.

---

## v1.27.0 — Reliable Live Sell Routing, Direct Live Mode Switching (No ENABLE LIVE Modal / Gas Reserve Blocker), RPC Self-Healing & Clear No-Balance Buy Alerts

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Fixed `No sell route available` Live Sell Failures (`base.ts`, `jupiter.ts`, `rpcPool.ts`, `liveEngine.ts`)**:
  - Stopped per-token HTTP 4xx (`400`/`404`) Jupiter route responses from retrying or tripping the `jupiter_swap` circuit breaker for 60 seconds across all coins.
  - Added automatic relaxed intermediate-token routing fallback (`restrictIntermediateTokens=false`) in `JupiterProvider.getQuote()` plus wider manual/emergency sell slippage retry and exact Jupiter error diagnostics.
  - Enhanced `getAgreedTokenBalanceUi()` and `executeLiveSell()` to use the exact on-chain raw integer balance (`rawAmount`) and verified mint `decimals`, eliminating sell failures caused by rounding, transfer taxes, or decimals mismatches.
- **Direct Live Mode Switching Without `ENABLE LIVE` Modal (`TopBar.tsx`, `App.tsx`, `RiskCentreView.tsx`, `pipeline.ts`)**:
  - Commented out the `ENABLE LIVE` confirmation popup modal (`LiveConfirmModal`), Risk Centre `Arm Live Confirmation` button/gate, and live-switch confirmation block so clicking **LIVE** shifts immediately into Live mode.
  - Prevented risk settings changes from forcing Live confirmation invalidation or auto-stopping Live mode.
- **Removed `Trade Size + Gas Reserve` Blocker & Added Clear Buy-Time No-SOL / `$` Alerts (`sizing.ts`, `pipeline.ts`, `liveEngine.ts`, `SettingsView.tsx`, `RiskCentreView.tsx`, `DashboardView.tsx`, `useBotStore.ts`)**:
  - Commented out the `Gas Reserve (SOL)` setting box and removed the `trade size + gas reserve` blocker from Live mode switching, Live start readiness, and position sizing.
  - When trying to buy a coin without sufficient SOL in the wallet, sizing and live execution emit an explicit log and toast alert with both SOL and USD (`There is no SOL (0.0000 SOL / $0.00) in the wallet to trade`).
- **RPC Health Self-Healing (`rpcPool.ts`, `pipeline.ts`)**:
  - Auto-probes RPC endpoints inside `refreshWalletDiagnostics()` whenever fewer than 2 endpoints currently read healthy, avoids marking rate-limited (`429`) RPCs permanently unhealthy, and marks endpoints healthy as soon as balance calls succeed.

---

## v1.26.0 — Main Solana Spot Bot Accurate P&L Accounting, Confirmed Fill Entry Prices, 1-Second Live Pricing, Single Total P&L UI, Anti-Rebuy Guard & 429/HMR Stability Fixes

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Fixed History & Open Position P&L Math & Confirmed Entry Price Sync (`db.ts`, `liveEngine.ts`)**:
  - Fixed `db.upsertPosition()` `ON CONFLICT` clause so confirmed on-chain buy reconciliation properly updates `entry_price_usd`, `entry_price_sol`, `break_even_price_usd`, `entry_rent_sol`, `exit_params_json`, and `confirmation_label` (previously stuck on initial pending quote estimates, causing `Entry Price`, `Size In`, and `%` vs `SOL` P&L mismatches across coins).
  - Updated `reconcileParsedSwapSolDelta()` and `reconcileConfirmedBuy()` to measure exact ATA creation rent vs swap SOL outflow and real token balance delta on-chain.
  - Fixed `executeLiveSell()` so `solOut` records true gross swap proceeds before fees/rent and `Total P&L` accurately equals `Returned (Sell) - Used (Buy) - Fees - Unreclaimed Rent`, eliminating the bug where a profitable sell (`$0.82 -> $0.92`) appeared negative (`-$0.08`) due to ATA rent accounting skew.
- **Single Clear Total P&L Across All Views (`PositionsView.tsx`, `HistoryView.tsx`, `DashboardView.tsx`)**:
  - Commented out the confusing `Gross vs Net P&L` explainer banner and separate `Gross P&L` card/drawer blocks, displaying one consistent **Total P&L** (SOL, %, and side-by-side USD) across Dashboard, Open Positions (Cards & Table), and History & Analytics.
- **True 1-Second Live Price Updates (`jupiter.ts`, `dexscreener.ts`, `pipeline.ts`)**:
  - Lowered Jupiter Price v3 cache TTL to `850ms` (with dynamic `api.jup.ag` / `lite-api.jup.ag` routing) and DexScreener batch cache TTL to `4s`, with automatic 10-second SOL/USD refreshes.
  - Added a background 1-second price monitor in `BotOrchestrator` (`refreshOpenPositionPricesTick`) so open position prices still stream live every second when the bot is stopped (never triggering exits while stopped).
- **Eliminated Auto-Stop / 429 Rate-Limit Flood & Vite HMR CSS Reload Loops (`pipeline.ts`, `rpcPool.ts`, `vite.config.ts`, `src/index.css`, `server.ts`)**:
  - Throttled `verifyBalanceAndExternalSell` RPC balance checks from every 1s to once per 20s per position and added 20s RPC cooldowns on HTTP 429 with `disableRetryOnRateLimit: true` on `@solana/web3.js` `Connection` instances.
  - Parallelized RPC 2-of-3 agreement queries and reduced live confirmation poll interval (`650ms`) for faster live execution.
  - Ignored `sniper/**`, `data/**`, `*.db*`, and `.playwright-cli/**` in Vite file-watcher and Tailwind v4 `@source not` scanning, stopping the `/src/index.css` HMR & 429 retry flood that caused bots to stall.
- **Anti-Rebuy Protection & Immediate Slot-Full Pause (`db.ts`, `pipeline.ts`, `liveEngine.ts`)**:
  - Added `hasTradedMint()` check alongside `isMintAttempted()` and cooldown checks so previously sold/traded coins cannot be rebought automatically, and halted remaining candidate buys immediately once `maxOpenPositions` slots are filled.

---

## v1.25.0 — Python Sniper 1-Second Live Pricing, Side-by-Side SOL Conversions, Entry & Exit Trade History Prices, Slot-Full Scan Auto-Pause & Newest-First Scan Log

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **True 1-Second Live Price Updates & Resilient Monitor Loop (`sniper/bot.py`, `sniper/settings.json`, `server/sniperManager.ts`, `PythonSniperView.tsx`)**:
  - Enabled `use_jupiter_price` (`lite-api.jup.ag/price/v3` when no API key is set, `api.jup.ag/price/v3` when an API key is provided) with automatic highest-liquidity DexScreener fallback on every 1-second monitor tick.
  - Wrapped `monitor(acct)` in exception handling inside `run()` and added retry logic for `os.replace()` on Windows so concurrent reads from Node never interrupt 1-second price updates.
  - Added non-blocking 1-second open-position live price refresh in `sniperManager.ts` whenever the Python bot is stopped with open positions, and delegated manual sells via `sell_queue.json` when running so state never races.
  - Updated the header status badge to report live price freshness (`prices updated X.Xs ago` / `waiting for prices` / `Scan Paused`).
- **Live SOL Price & Side-by-Side `$` + `SOL` Display Everywhere (`bot.py`, `sniperManager.ts`, `sniperFormat.ts`, `PythonSniperView.tsx`)**:
  - Added a live SOL/USD price tracker refreshed periodically from Jupiter and DexScreener (`WSOL_MINT`), displayed in the top header (`SOL: $XX.XX`).
  - Added converted `SOL` values side by side with every `$` figure across all KPI cards (`Cash`, `Est. total value`, `Open PnL`, `Today's PnL`, `Realized PnL`), Open Positions (`PnL`, `Entry price`, `Price now`), Trade History (`Entry price`, `Exit price`, `Amount`, `PnL`), and USD Settings fields (`≈ X.XXXX SOL`).
- **Purchase (Entry) & Sale (Exit) Prices in Trade History (`bot.py`, `sniperManager.ts`, `sniperFormat.ts`, `PythonSniperView.tsx`)**:
  - Added chronological `BUY` → `SELL` pairing plus explicit `entry_price` & `sol_price_usd` CSV logging so every closed trade row clearly shows both **Entry price ($ / SOL)** and **Exit price ($ / SOL)**.
- **Auto-Pause Coin Scanning When Position Slots Are Full (`bot.py`, `PythonSniperView.tsx`)**:
  - Automatically pauses candidate scanning as soon as open positions reach `max_open_positions` (e.g. 3/3 slots filled), logging the pause once without wasting API requests.
  - Automatically wakes up and resumes scanning on the next tick as soon as any position sells (TP, trailing stop, max hold, or manual exit) and frees a slot, with live settings hot-reloading (`mtime` check).
- **Newest-First Scan Log Ordering (`PythonSniperView.tsx`, `sniperFormat.ts`)**:
  - Reversed the Scan Log feed so the newest live log entries always appear at the **top** without scrolling.

---

## v1.24.0 — Cross-Platform Python Detection & Isolated Settings Draft State

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Automatic Cross-Platform Python Detection & Windows App Execution Alias Bypass (`sniperManager.ts`, `bot.py`)**:
  - Implemented `detectPythonCommand()` in `server/sniperManager.ts`. On Windows, it automatically probes the official Windows Python Launcher (`py -3`, `py`), system `python`, standard user install directories (`%LOCALAPPDATA%\Programs\Python\Python3*\python.exe`), and `%ProgramFiles%`.
  - Automatically identifies and skips Windows Microsoft Store stub aliases (which cause error 9009: *"Python was not found; run without arguments to install from the Microsoft Store"*).
  - Runs with `shell: true` on Windows, guaranteeing smooth execution for local Python installations (such as Python 3.14.7).
  - Added `python_binary_path` setting allowing manual override (e.g. `auto`, `py`, `python`, or a custom path).
  - Logs the exact detected Python command and runtime version directly to the scan log console.
- **Fixed Settings Input Reversion / Snap-Back Bug (`PythonSniperView.tsx`)**:
  - Separated committed `serverSettings` from local `draftSettings` state with dirty-tracking (`isSettingsDirty`).
  - Previously, 1-second price polling called `setSettings(data.settings)`, overwriting draft values (e.g. changing 50 to 1 snapped back to 50 every second before saving).
  - Form edits are now completely isolated from polling, allowing you to backspace, type, and modify any configuration field without interruptions.
  - Added an **Unsaved edits** badge, a **Discard Changes** button, and an auto-sync mechanism after successful save.
- **Dynamic Start Balance Reset (`sniperManager.ts`, `bot.py`)**:
  - `resetAccount()` now reads `settings.start_balance_usd` dynamically and initializes `state.json` with your custom cash balance (e.g. $1.00 instead of always defaulting to $50.00).
  - `bot.py` now loads and hot-reloads `settings.json` on startup and on paper account initialization.

---

## v1.23.0 — Python Sniper 1-Second Live Price, Green/Red Profit Styling, DexScreener Chart Buttons & Profit/Loss Result Badges

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **1-Second Live Price Updates on Open Positions (`bot.py`, `sniperManager.ts`, `PythonSniperView.tsx`)**:
  - `bot.py`'s exit monitor loop now continuously updates `pos["current_price"]`, `pos["pnl_pct"]`, `pos["pnl_usd"]`, `pos["peak_pct"]`, and `pos["low_pct"]`, saving state atomically to `state.json` on every tick.
  - Open positions in `PythonSniperView` refresh every 1 second (1000ms polling) with live Jupiter and DexScreener pricing.
  - Added visual color coding for Current Price / Price now:
    - **Bold Green** (`text-emerald-500`) when current price is greater than or equal to entry price (in profit).
    - **Bold Red** (`text-rose-500`) when current price drops below entry price (in loss).
  - Added a live pulsing indicator on the table header and status bar (`RUNNING - prices updated 1s ago`).
  - Added dedicated **PnL %**, **PnL $ (est.)**, **Peak %**, and **Low %** columns with signed values and green/red highlights matching the Python GUI screenshot.
- **Fixed Trade History PnL Color Bug & Added Profit/Loss Result Badges (`PythonSniperView.tsx`, `sniperManager.ts`)**:
  - Fixed bug where profitable sell trades (e.g. +$2.37, +$2.21, +$2.62) were rendered in red text because `trades.csv` outputs raw numeric PnL values rather than a string starting with `+`.
  - Converted PnL calculations to robust numeric parsing (`parseFloat`), correctly coloring positive gains in bright emerald green (`+$2.3697`, `+47.39%`) and losses in rose red.
  - Added a prominent **Result / Outcome** badge column:
    - `✓ PROFIT (+47.4%)` in glowing emerald badge for profitable exits.
    - `✗ LOSS (-8.5%)` in glowing rose badge for stopped-out exits.
    - `BOUGHT (ENTRY)` in sky blue badge for new sniper entries.
    - `BREAKEVEN` in neutral slate badge.
  - Added a dedicated **DexScreener** chart link button (`DexScreener ↗`) to every trade row so you can open and review the historical chart for any token anytime.
  - Added instant search/filtering in Trade History by coin symbol, token mint, action, or exit reason.

---

## v1.22.0 — Python Requests Dependency Installation

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Python `requests` Package Installation**:
  - Installed `python3-requests` in the container environment so `bot.py` imports `requests` successfully without `ModuleNotFoundError`.

---

## v1.21.0 — Python Bot Authentication & Full gui.py Settings Integration

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Python Bot API Token Authentication (`PythonSniperView.tsx`)**:
  - Replaced raw `fetch` calls with `apiFetch` in `PythonSniperView` so the required `x-api-token` header is automatically passed for all Python bot control, status, reset, sell, and settings endpoints.
- **Complete `gui.py` Settings Fields (`PythonSniperView.tsx`)**:
  - Integrated all 31 settings fields from the original Python `gui.py` / `bot.py` configuration (`start_balance_usd`, `trade_size_usd`, `max_open_positions`, `daily_loss_limit_usd`, `take_profit_pct`, `trailing_stop_pct`, `max_hold_minutes`, `max_age_minutes`, `scan_interval_sec`, `monitor_interval_sec`, `min_liquidity_usd`, `min_buys_m5`, `min_buy_sell_ratio_m5`, `max_price_change_m5_pct`, `min_volume_m5_usd`, `min_holders`, `use_rugcheck`, `strict_rugcheck`, `rugcheck_max_score`, `max_top10_holder_pct`, `rug_recheck_minutes`, `use_gecko`, `use_jupiter_recent`, `use_jupiter_price`, `use_dex_profiles`, `use_pumpportal`, `use_promoted_feeds`, `slippage_pct`, `fee_pct`, `log_rejects`, `jupiter_api_key`) with proper labels and input types.

---

## v1.20.0 — Integrated Python New-Launch Sniper Bot Section

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Integrated Python New-Launch Sniper Bot (`PythonSniperView.tsx`, `sniperManager.ts`, `api.ts`, `Sidebar.tsx`, `App.tsx`)**:
  - Added a brand new **Python Sniper Bot** section in the sidebar immediately after **Avg Win / Avg Loss**.
  - Fully integrated your uploaded Python sniper script (`bot.py`) into the backend orchestrator via child process management.
  - Provides a complete desktop UI matching `gui.py`: start/stop bot controls, live KPI cards (Cash, Est. Total Value, Open Positions, Today's PnL, Realized PnL, Win Rate), Open Positions tab (with manual Sell and DexScreener links), Trade History tab, Live Scan Console Log, and Settings JSON editor with account reset.

---

## v1.19.0 — Side-by-Side USD ($) P&L, Complete Scanner Funnel Reset Cache, and Dedicated Avg Win / Avg Loss Tab

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Side-by-Side USD ($) P&L Display (`Primitives.tsx`, `PositionsView.tsx`, `HistoryView.tsx`, `DashboardView.tsx`)**:
  - Added USD earnings and losses (`· +$0.14` / `· -$0.08`) directly side by side with Gross P&L and Net P&L (simulated) across Open Positions, Dashboard KPIs, and History closed trades.
- **Scanner Reset Seen Cache Resets Funnel Counters (`api.ts`, `pipeline.ts`, `ScannerView.tsx`)**:
  - Clicking **Reset Seen Cache** in the Scanner tab now fully resets all funnel counters (Discovered, Validated, Hard Filtered, Security Passed, Scored, Executed) back to 0 alongside clearing seen tokens.
- **Dedicated Avg Win / Avg Loss Tab & Analytics (`AvgWinLossView.tsx`, `Sidebar.tsx`, `App.tsx`, `HistoryView.tsx`)**:
  - Added a new **Avg Win / Avg Loss** tab in the Sidebar right after Risk Centre, providing detailed side-by-side SOL and USD ($) performance comparisons of winning vs losing trades, win rates, profit factor, and expectancy.
  - Updated History & Analytics performance summary cards to show Avg Win / Avg Loss in SOL and USD side by side.

---

## v1.18.0 — 5m Dump/Order-Flow Entry Protection, Calibrated Paper Realism, Live Hold Timers, History Hold in Minutes & Bot-Wide Hover Tooltips

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Short-Term 5m/1h Dump & Order-Flow Protection + Calibrated Paper Realism (`types.ts`, `dexscreener.ts`, `geckoterminal.ts`, `filters.ts`, `scoring.ts`, `paperEngine.ts`, `defaults.ts`)**:
  - Added 5-minute price change and 5m/1h buy-vs-sell transaction flow extraction (`priceChange5mPct`, `buys5m`, `sells5m`, `buys1h`, `sells1h`) from DexScreener and GeckoTerminal.
  - Added 5m active dump rejection (`< -2.5%`), 5m blow-off spike rejection (`> +25%`), and 5m/1h seller-dominated flow guards in `evaluateHardFilters` while blending 5m momentum and recent buy pressure into `Trade Score`, preventing tokens that look green on 1h charts from opening immediately into an active 5m sell-off.
  - Fixed `paperEngine.ts` so `delaySec <= 0` executes `0` artificial delay samples instead of running extra worst-price loops, and tuned default Paper Realism (`0.5–2s` delay window, `0.25%` <24h competition penalty, `2%/3%` buy/sell fail probability) + Quick Profit Scalper realism parameters.
- **Live Hold Duration Timer in Positions (`PositionsView.tsx`, `formatters.ts`)**:
  - Added a live 1-second updating `Holding` timer pill (`42s`, `10m 05s`, `1h 15m`, `24h 00m`, `48h 12m`) on every Position card and a `Holding` column in Table view.
- **History & Analytics Hold Duration in Minutes (`HistoryView.tsx`, `formatters.ts`)**:
  - Updated History & Analytics **Hold** column and the Trade Detail drawer to display hold duration cleanly in minutes (e.g. `6.2 min`, `120 min`) with hover details showing exact seconds.
- **Paper Shadow Simulation Realism Guidance & Rent Drag Alert (`SettingsView.tsx`)**:
  - Added an inline plain-language explanation under **Paper Shadow Simulation Realism** plus a 1-click **"Apply Realistic Defaults"** button, and a **Rent Drag Warning** banner in Position Sizing when `Auto-Reclaim ATA Rent` is disabled on small `<= 0.1 SOL` trades.
- **Global Portal Hover Tooltips Across Entire Bot (`Primitives.tsx`, `TopBar.tsx`, `Sidebar.tsx`, all Views)**:
  - Added `HoverTip` and `InfoTooltip` popups across navigation tabs, top bar controls, KPIs, settings, checkboxes, table headers, buttons, and position metrics so hovering any control explains its exact purpose.

---

## v1.17.0 — Auto Jupiter Route/Priority Fees, Verified TP Quotes, Disabled Score Gate Sync & App Version Display

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Auto Jupiter Route Fee Extraction, Adaptive Priority Fees & ATA Rent Reclaim (`jupiter.ts`, `fees.ts`, `paperEngine.ts`, `liveEngine.ts`, `HistoryView.tsx`, `SettingsView.tsx`)**:
  - Added **Auto · Live Jupiter / Network (Adaptive)** priority fee preset (default) querying recent Solana prioritization fee percentiles (`getRecentPrioritizationFees`) capped safely by `maxPriorityFeeSol`.
  - Parsed real DEX AMM route pool fees (`routePlan[].swapInfo`), Jupiter platform fees, and route AMM labels directly from Jupiter quotes, eliminating double-subtraction of LP fees already netted inside `quote.outAmount`.
  - Enabled **Auto-Reclaim ATA Rent on 100% Sell (+0.00204 SOL)** by default so full position exits reclaim the rent deposit instead of wiping out profit on 0.02–0.05 SOL trades, with full itemized Jupiter route/fee/rent breakdown shown in **History & Analytics**.
- **Executable Jupiter Sell Quote Verification Before TP/Trailing Exits (`pipeline.ts`)**:
  - `TAKE_PROFIT` and `TRAILING_STOP` triggers now verify against a live executable Jupiter sell quote (`getQuote`) before selling, preventing phantom spot-tick spikes (e.g. `+18%` spike closing at `+6.7%` and losing after fees) from triggering premature exits.
- **Disabled Min Quality / Trade Score Gate Synchronization (`scoring.ts`, `db.ts`, `api.ts`, `ScannerView.tsx`, `PipelineConfigView.tsx`)**:
  - When **Min Quality / Trade Score** (`enforceMinScores`) is unchecked, `SCORE` gate rejections are completely bypassed (including filter+security-approved `high_risk_micro` promotions), stale `[SCORE]` rejections in `seen_tokens` / `rejections` are automatically cleared on save, `PipelineConfigView` syncs immediately with Settings, and **Scanner** displays a clear **Score Gate: Disabled (Bypassed)** indicator.
- **Visible App Version Badge & Footer (`vite.config.ts`, `Sidebar.tsx`, `App.tsx`, `api.ts`)**:
  - Exposed the build version from `package.json` (`v1.17.0`) in the sidebar header, sidebar footer card, app footer, and `/api/health`.

---

## v1.16.0 — Disabled Stepped Trailing Ladder Take-Profit-Only Mode & Dynamic Next-Tier Progress Target

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Take-Profit-Only Mode When Stepped Trailing Ladder Is Disabled (`exits.ts`, `db.ts`, `PositionsView.tsx`, `SettingsView.tsx`)**:
  - When **Stepped Trailing Ladder** is unchecked in Settings and synced to active positions, `syncOpenPositionsExitParams` and `evaluatePositionExit` immediately clear `trailingArmed` and `trailingFloorPct` so positions exit strictly at your configured **Take-Profit (%) · Unlimited** target.
  - Position cards and table rows now display **Profit Lock Floor: Disabled** and switch the progress bar to **Progress to Take-Profit (+X%) · Trailing Ladder Disabled**, hiding the stepped trailing tier badges when disabled.
- **Dynamic Next-Tier Target & Locked Floor Sync (`PositionsView.tsx`, `db.ts`)**:
  - Fixed a UI desync where the progress bar target and header still displayed `Tier #1 (+1.2%)` even when the position had already cleared earlier tiers and was actively progressing toward a higher tier (e.g., `#7: +6%`).
  - Both the progress bar target (`Target: +6%`), header status (`Tier #6 Locked (+5.0% Floor) · Next: #7 (+6% ➔ +5.8%)`), and `Profit Lock Floor` cell now stay synchronized with the highest cleared tier and the active amber tier in progress.
- **Changelog & Version Tracking**: Updated version to `1.16.0` in `package.json` and documented all changes in `CHANGELOG.md`.

---

## v1.15.0 — Trailing Profit Lock System Fix, Settings Schema Sync, Auto-Stop Mode Switch & Wallet Private Key Parsing

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Stepped Trailing Profit Lock System & Arming (`exits.ts`, `exits.test.ts`)**:
  - Removed restrictive round-trip cost arming offset so that custom user trailing profit lock tiers (e.g. Tier #1 Peak +1.2% / Allowed Drop 0.4%) arm immediately and lock the profit floor as soon as the peak gain threshold is reached on micro-positions.
  - Renamed "Trailing Floor" to **"Profit Lock Floor"** with clear status indicators (`Locked` vs `Pending (+X%)`).
  - Added color-coded badges for all stepped trailing ladder tiers: green for hit/passed tiers, pulsing amber for the currently in-progress tier, and slate for upcoming tiers.
- **Settings Save & Schema Fix (`api.ts`, `SettingsView.tsx`)**:
  - Added `applyToOpenPositions` to `settingsPatchSchema` to eliminate `Unrecognized key: "applyToOpenPositions"` errors when saving settings.
- **Running Mode Switch & Auto-Stop (`pipeline.ts`, `api.ts`, `TopBar.tsx`, `LiveConfirmModal.tsx`)**:
  - Enabled mode switching while the bot is running by adding an `autoStop` flag that automatically stops active bot execution before switching modes or arming Live mode.
- **Robust Wallet Private Key & Keystore Input (`api.ts`, `WalletsView.tsx`)**:
  - Enhanced `/api/wallet/connect` and Server-Side Signer ingestion to automatically parse and extract public keys when users paste raw Base58 private keys or JSON byte arrays (`[1, 2, ... ]`) into wallet/signer inputs.
- **Changelog & Version Tracking**: Updated version to `1.15.0` in `package.json` and documented all improvements in `CHANGELOG.md`.

---

## v1.14.0 — Trailing Profit Lock Badges, Active Position Settings Sync, Uniform Font Heights & Quick-Profit Preset

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Visual Trailing Profit Lock System Badges (`PositionsView.tsx`)**:
  - Replaced ambiguous "Armed > +13.0%" label with real-time status: `Locked at +X%` (when active) or `Inactive (Arms at Tier #1)`.
  - Added visual tier badges on every open position card displaying your exact stepped trailing profit lock system (`#1: +X% ➔ Lock +Y%`, `#2: ...`), highlighting the active locked tier in green.
  - Aligned the progress bar to target the active tier peak gain and turn red during drawdowns or green during profit.
- **Active Position Settings Sync (`PositionsView.tsx`, `SettingsView.tsx`, `api.ts`, `db.ts`)**:
  - Added a **Sync Settings to Open Positions** button in the Open Positions header and an automatic sync checkbox on Settings Save.
  - When Stop-Loss is disabled or exit rules are updated, open positions can be immediately synced to disable stop-loss (`Disabled`) and apply the new take-profit and trailing rules without waiting for new trades.
- **Uniform Position Card Typography & Color Coding (`PositionsView.tsx`, `Primitives.tsx`)**:
  - Unified font sizes across `Entry Price`, `Current Price`, `Gross P&L`, and `Net P&L` to identical `text-xs font-semibold font-mono tabular-nums` with a consistent 20px line height (`h-5`).
  - Current Price turns green when `>= Entry Price` and red when `< Entry Price`.
- **⚡ Quick Profit Scalper Preset (`defaults.ts`, `SettingsView.tsx`, `PipelineConfigView.tsx`)**:
  - Added a 1-click **Quick Profit Scalper** preset button in Settings and Pipeline Rules configured for profitable momentum scalping: 0.1 SOL trade size (eliminating ATA rent fee drag), 15m+ pool age, $25,000+ liquidity, 60%+ buy ratio, tight 4% stop loss, 12% take-profit, and stepped trailing profit locks.
- **Changelog & Version Bump**: Updated version to `1.14.0` in `package.json` and documented all improvements in `CHANGELOG.md`.

---

## v1.13.0 — Slot-Filled Scanner Pausing, Auto-Startup .bat Script, Uniform Position Fonts & Quick-Profit Defaults

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Slot-Filled Scanner Pausing (`pipeline.ts`)**:
  - The scanner and entry pipeline now automatically pauses scanning when active open position slots are full (`openPositions.length >= maxOpenPositions`), resuming scanning instantly once any position is sold/closed.
- **Auto-Startup Batch Script (`start-bot.bat`)**:
  - Added a double-clickable `start-bot.bat` script in the root directory to automatically run `npm install` and `npm run dev`.
- **Uniform Position Card Typography & Color-Coded Prices (`PositionsView.tsx`)**:
  - Standardized all position stat cards to uniform font sizing (`font-mono text-xs tabular-nums`).
  - Current Price now dynamically turns **green** when in profit (`>= entry`) and **red** when in a loss (`< entry`), with clean `"Disabled"` display when stop-loss is turned off.
- **Optimized Quick-Profit Default Settings (`defaults.ts`)**:
  - Tuned default settings (`takeProfitPct: 25`, `stopLossPct: 5`, optimized momentum thresholds) for faster scalp entry and quick profit capture.
- **Changelog & Version Tracking**: Updated version to `1.13.0` in `package.json` and documented all new features in `CHANGELOG.md`.

---

## v1.12.0 — Scanner DexScreener Links, Profit/Loss Progress Bar Colors & Stop-Loss Explanations

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Scanner DexScreener Direct Links (`ScannerView.tsx`)**:
  - Added a direct **DexScreener** link button column on every token row in the Scanner & Entry Pipeline table for instant one-click analysis.
- **Dynamic Profit / Loss Progress Bar Colors (`PositionsView.tsx`)**:
  - The trailing progress bar and percentage display now dynamically turn **red** (`bg-rose-500`, `text-rose-500`) when a position is in a loss, and **green/teal** (`bg-emerald-500`, `text-teal-400`) when in profit.
- **Stop-Loss Tier & Trailing Ladder Clarifications**:
  - Explained that the Stepped Trailing Ladder operates on **Gross P&L percentage** (price movement from entry) while guaranteeing take-home Net P&L protection by never arming or locking a floor below round-trip break-even costs.
  - Confirmed that unchecking the **Enabled** checkbox on Custom Stop-Loss Tiers completely disables stop-loss across the bot.

---

## v1.11.0 — Scanner Pagination, Clear Logs, Position USD Sizing, Separated Entry/Current & Trailing Progress Bar

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Scanner Pagination & Clear Logs (`ScannerView.tsx`, `LogsView.tsx`, `api.ts`, `db.ts`)**:
  - Added pagination to the Scanner evaluated tokens table with default 50 coins per page, a page size dropdown selector (`50`, `100`, `150`, `200`), and a custom per-page input.
  - Added a **Clear Logs** button in the Scanner view (alongside Event Logs) to quickly clear event logs.
- **Positions Enhancements (`PositionsView.tsx`)**:
  - **Side-by-Side Size In USD**: Size In now displays SOL and USD side-by-side (`0.0500 SOL (≈ $3.66 USD)`).
  - **Separated Entry and Current Prices**: Entry Price and Current Price are now displayed in independent vertical columns/rows to eliminate any confusion.
  - **Trailing Progress Bar**: Added a dynamic progress bar on active position cards showing arming progress (>+arming target) or progress towards the take-profit target once the trailing ladder is active.
- **Automated Changelog & Version Tracking**: Updated version to `1.11.0` in `package.json` and documented all new UI enhancements in `CHANGELOG.md`.

---

## v1.10.0 — New Launches Only (5s–5m) Discovery, Optional Holder/Score Checkboxes & Unlimited Min Liquidity ($)

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **New Launches Only (Brand-New Coins Window in Seconds) (`types.ts`, `defaults.ts`, `filters.ts`, `scoring.ts`, `pumpportal.ts`, `geckoterminal.ts`, `pipeline.ts`, `SettingsView.tsx`)**:
  - Added **New Launches Only (Brand-New Coins Window in Seconds)** checkbox with `Min Launch Age (seconds)` and `Max Launch Age (seconds)` inputs (default `5s` to `300s` / `5.0m`, editable to e.g. `5s`, `10s`, `60s`, up to any max seconds).
  - When checked, discovery prioritizes newly launched mints from PumpPortal WebSocket (`new_token`/`migration`, newest first), GeckoTerminal `new_pools`, and Jupiter recent tokens, validates brand-new pairs that lack `1h`/`24h` price-change metrics yet, scales 24h volume/tx/trader requirements so `5s–5m` launches aren't auto-rejected for lacking 24h history, and filters strictly by exact launch age in seconds.
- **Separated Checkboxes for `Max Top-10 Non-Pool Holders (%)` and `Min Quality / Trade Score` (`types.ts`, `defaults.ts`, `security.ts`, `scoring.ts`, `settingsValidation.ts`, `SettingsView.tsx`)**:
  - Added independent checkboxes **`Max Top-10 Non-Pool Holders (%)`** (`enforceMaxTop10Holders`) and **`Min Quality / Trade Score`** (`enforceMinScores`).
  - When checked (default), each rule is enforced as configured; when unchecked, its inputs disable cleanly and that rule is skipped during evaluation (`security.ts` / `scoring.ts`).
- **Unlimited `Min Liquidity ($)` (`defaults.ts`, `api.ts`, `filters.ts`, `scoring.ts`, `fees.ts`, `sizing.ts`, `settingsValidation.ts`, `SettingsView.tsx`)**:
  - Removed the `$50` and `$10,000` minimum restrictions on **Min Liquidity ($)**. Any non-negative amount (`$0`, `$1`, `$50`, `$300`, `$1,000,000+`) is now accepted in both UI and server validation regardless of age mode, with automatic emergency-floor scaling and micro-pool sizing support.
- **Automated Tests**: Updated `filters.test.ts`, `security.test.ts`, and `settingsValidation.test.ts` to verify `5s–300s` launch filtering, unchecked Top-10 holder and Quality/Trade score bypasses, and `$0` / `$1` / `$1,000,000` Min Liquidity support.

---

## v1.9.0 — Live Scanner Table & Source Health Auto-Sync + PumpPortal Initial Handshake Fix

**Risk Warning: Trading can lose all of your money.**

### Fixed & Improved
- **Live `ALL | BUY | REJECT` Table & Source Health Auto-Refresh (`useBotStore.ts`, `ScannerView.tsx`, `pipeline.ts`)**:
  - Previously, the frontend only refreshed `/api/scanner/state` (`seenTokens`) and `/api/source-health` when a trade executed (`trade_event`). When scans discovered and evaluated hundreds of coins with `0` executions, **Discovery & Data Source Health** stayed frozen at `Not polled yet` and the `ALL | BUY | REJECT` table showed empty headers with zero rows despite incoming `rejection` SSE events.
  - Added deduplicated `refreshScannerAndHealth()` in `useBotStore`, triggered automatically whenever SSE `status` funnel counts / scan timestamps / run state change, throttled (`1.2s`) on incoming `rejection` events, on Scanner view mount, and every `3s` while the bot is running.
  - Added `broadcastStatus()` right after Stage 1 discovery completes in `BotOrchestrator.runDiscoveryAndEntryPass()` so `Discovered` counts and provider health cards update before downstream evaluation loops finish.
  - Fixed `ScannerView` empty-state handling so clearing the seen cache or filtering with `0` matches displays clear status messaging instead of a blank table header, and added live counts to the `ALL`, `BUY`, and `REJECT` tabs.
- **PumpPortal WebSocket `HALF_OPEN` False Warning Fix (`pumpportal.ts`)**:
  - `PumpPortalWsProvider` now reports **`CLOSED`** during normal startup WebSocket handshake (`CONNECTING` with `0` errors) and reserves **`HALF_OPEN`** / **`OPEN`** strictly for real connection failures or unexpected pre-open disconnects (`consecutiveErrors > 0`).
- **Automated Tests**: Updated `providers.test.ts` to cover initial `start()` connecting `CLOSED` state and error transitions to `HALF_OPEN` and `OPEN`.

---

## v1.8.0 — GeckoTerminal 429 Cooldown, PumpPortal Idle State & 5–30m Micro-Pool Discovery/Filtering Fix

**Risk Warning: Trading can lose all of your money.**

### Fixed & Improved
- **GeckoTerminal Rate-Limit (`HTTP 429`) Elimination (`base.ts`, `geckoterminal.ts`)**:
  - `HttpProvider` no longer immediately retries inside the same request when receiving an HTTP `429`; it now applies an exponential domain cooldown (`15s` → `30s` → `60s` → `120s`) and exposes `isRateLimited()`.
  - `GeckoTerminalProvider` now paces calls (`2.6s` minimum interval, `65s` cache TTL, max `2` endpoints per uncached scan, and breaks immediately if rate-limited) and adds `trending_pools?duration=5m` to surface active `5–30m` pools without triggering `api.geckoterminal.com` 429 bursts.
- **PumpPortal WebSocket Idle Status & Migration Buffer (`pumpportal.ts`)**:
  - `pumpportal_ws` now reports **`CLOSED`** instead of a false **`HALF_OPEN`** warning whenever the bot is cleanly stopped or idle; `HALF_OPEN` and `OPEN` are reserved for active connection/reconnect states when the bot is running.
  - Separated PumpPortal `migration` events from high-volume `new_token` launches so graduated pools are never evicted before `drainRecentMints()` runs.
- **Discovery Enrichment & `5–30m` + Low-Liquidity Filtering (`jupiter.ts`, `pipeline.ts`, `filters.ts`, `scoring.ts`)**:
  - Added Jupiter `tokens/v2/toptrending/5m` to discovery and a rolling `youngPoolWatchlist` in `BotOrchestrator` so newly launched pools (`<5m`) are re-checked once they mature into the `5–30m` window, while prioritizing active/graduated pools ahead of `$0`-liquidity Pump.fun profiles in DexScreener batch enrichment.
  - Scaled `evaluateHardFilters` (`maxPlannedPriceImpactPct`, `maxPriceChange1hPct`, `minPriceChange1hPct`, `minPriceChange24hPct`, `maxFdvLiquidityRatio`, `minBuyRatio`) and `scoreCandidate` when **Use Custom Pool Age Timeframe** + low liquidity (`e.g. 5–30m, $300`) are enabled, preventing `0.05 SOL` price impact (`~2.4%` on `$300–$1,200` pools) or early `+200%` momentum from wiping out `100%` of valid pools while keeping strict defaults unchanged when unchecked.
- **Automated Tests**: Added `providers.test.ts` and expanded `filters.test.ts` covering HTTP `429` cooldown behavior, PumpPortal stopped `CLOSED` status, and `5–30m` / `$300` micro-pool filtering & scoring.

---

## v1.7.0 — Source Health Error Hover Popups & Custom Low-Liquidity Micro-Pool Support

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Scanner Source Health Hover Error Popup (`base.ts`, `pumpportal.ts`, `types.ts`, `ScannerView.tsx`)**:
  - `HttpProvider` and `PumpPortalWsProvider` now retain a `recentErrors` buffer (up to 10 recent errors with timestamps) instead of wiping `lastError` upon the next successful poll.
  - Hovering or focusing `Errors: N` inside **Scanner → Discovery & Data Source Health** opens a tooltip popup showing the source's recorded error messages, timestamps, and active rate-limit cooldown if applicable.
- **Custom Pool Age Micro-Liquidity Support (`defaults.ts`, `api.ts`, `filters.ts`, `scoring.ts`, `fees.ts`, `settingsValidation.ts`, `SettingsView.tsx`)**:
  - When **Use Custom Pool Age Timeframe (Min–Max Minutes)** is checked (e.g., `1` to `5` minutes), **Min Liquidity ($)** now accepts values down to **$50** (allowing e.g. `$300` micro-pools), while still enforcing the **$10,000** minimum whenever the checkbox is unchecked.
  - Relaxed 24h volume/tx/trader thresholds for custom young/micro-liquidity windows, updated `classifyToken` and liquidity scoring so valid `$300+` pools aren't auto-rejected as `high_risk_micro`, and auto-scaled the per-position `emergencyLiquidityFloorUsd` (`min(floor, minLiquidity * 0.5)`) so micro-pools aren't immediately emergency-exited by the default `$10,000` floor.
  - Lowered **Emergency Liquidity Floor ($)** minimum input to `$0`.
- **Automated Tests**: Added unit tests in `filters.test.ts` and `settingsValidation.test.ts` covering `1–5m` age with `$300` liquidity filtering, scoring, and scaled emergency floor behavior.

---

## v1.6.0 — Independent Stop-Loss / Take-Profit & Visual Field-Level Validation Popups

**Risk Warning: Trading can lose all of your money.**

### Fixed & Improved
- **Decoupled Take-Profit from Stop-Loss (`defaults.ts`, `fees.ts`, `SettingsView.tsx`, `RiskCentreView.tsx`)**:
  - Removed the `Take-profit must be at least 1.5x the max stop-loss` restriction in both settings validation and `snapshotExitParams`. You can now combine any wide stop-loss (e.g., `90%`+) with any take-profit target (e.g., `25%`) independently, and trades exit at your configured Take-Profit `%`.
  - Synchronized hidden `maxPositionSizeSol` automatically with `Trade Size (SOL)` and `Max Wallet Exposure (SOL)` edits in Settings so editable sizing fields never trigger hidden constraint errors.
- **Visual Box Highlighting & Anchored Range Popups on Save (`settingsValidation.ts`, `SettingsView.tsx`, `api.ts`, `db.ts`, `useBotStore.ts`)**:
  - Clicking **Save Settings** now runs comprehensive per-field validation and surfaces structured backend `fieldErrors` (including Zod schema details).
  - Any invalid input box, tier row, checkbox, or section highlights in red (`border-rose-500` + focus ring), displays an inline/anchored popup right next to that box explaining the exact allowed range (e.g., *"Must be a whole number between 1 and 10"*, *"Must be at least $10,000"*), and automatically scrolls/focuses the first invalid field.
- **Automated Tests**: Added `settingsValidation.test.ts` and updated `exits.test.ts` verifying independent `90%` stop-loss + `25%` take-profit execution and per-field error mapping.

---

## v1.5.0 — Custom Pool Age Timeframe Window & Unlimited SL / TP / Trailing Tiers

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Custom Pool Age Timeframe Filter (`filters.ts`, `scoring.ts`, `SettingsView.tsx`)**:
  - Added **Use Custom Pool Age Timeframe (Min–Max Minutes)** checkbox with editable `Min Coin Age (minutes)` and `Max Coin Age (minutes)` inputs (e.g., `5` to `30` minutes).
  - When checked, the scanner & entry pipeline only evaluates and trades coins within that exact age window (not newer or older), and allows coins under 30m to be scored instead of auto-rejected.
  - When unchecked, the bot falls back cleanly to its default age filters (`>= 30m` min pool age).
- **Unlimited Stop-Loss Trigger Drop %, Unlimited Take-Profit %, & Unlimited Trailing Tiers (`api.ts`, `defaults.ts`, `fees.ts`, `exits.ts`, `SettingsView.tsx`)**:
  - Removed the `20%` upper limit on Stop-Loss `Trigger Drop %` across Settings UI, Zod API validation, `snapshotExitParams`, and `evaluatePositionExit` so any stop-loss percentage (`>= 0.5%`) can be configured and enforced.
  - Removed the `500%` upper limit (`max(500)`) on `Take-Profit (%)` that previously triggered `"Invalid settings schema"` when entering targets like `1000%`, allowing unlimited take-profit targets after all custom trailing tiers are cleared.
  - Improved Custom Stepped Trailing Exit Tiers and Custom Stop-Loss Tiers containers with expanded scroll space and automatic scroll-to-bottom on `+ Add Tier` / `+ Add Stop Loss Tier` for unlimited tiers beyond the 13 default rows.
- **Automated Tests**: Updated `exits.test.ts` and `filters.test.ts` to cover custom age timeframe filtering/scoring, `>20%` stop-loss levels, `1000%` take-profit validation, and `20+` trailing ladder tiers.

---

## v1.4.0 — Duplicate Sell Lock, Trailing Break-Even Fix, Open P&L Parity & Rich History Ledger

**Risk Warning: Trading can lose all of your money.**

### Fixed
- **Eliminated Duplicate Position Sells (`pipeline.ts`)**:
  - Added `exitTickInFlight` and per-position `sellingPositionIds` concurrency locks in `BotOrchestrator` so overlapping 1-second exit monitoring ticks or simultaneous manual/auto sell requests can never sell the same open position multiple times or create duplicate trade history entries.
- **Trailing Stop No Longer Arms/Exits Below Break-Even (`exits.ts`)**:
  - Raised trailing arming threshold to `roundTripCostPct + 1.0%` and raised the minimum locked trailing floor from `roundTripCostPct * 0.5` to `roundTripCostPct + 0.5%` so trailing stops never intentionally lock a net-losing floor below round-trip fees and ATA rent.
- **Dashboard & Positions Open P&L Parity (`DashboardView.tsx`, `PositionsView.tsx`)**:
  - Updated Dashboard `Open P&L` KPI and Active Positions preview cards (plus Positions `Net P&L`) to deduct full estimated round-trip costs (entry fees + ATA rent + estimated exit fees via `roundTripCostPct`) and display net percentage, eliminating cases where Dashboard showed green profit while actual take-home net P&L was negative.

### Added & Improved
- **Expanded Trade History Table & Detail Drawer (`HistoryView.tsx`)**:
  - Replaced single `SOL In / Out` column with **Buy → Sell Price** (high-precision token USD via `formatTokenPriceUsd` + token price `%` change), **Used (Buy)** (`SOL` + `$` USD), **Returned (Sell)** (`SOL` + `$` USD), **Fees + Rent** (`SOL` + `$` USD), and **Net P&L** (`SOL` + `$` USD + `%`).
  - Updated the Trade Detail Drawer to display `Buy Price`, `Sell Price`, `Used to Buy` (`SOL` & USD), `Returned After Sell` (`SOL` & USD), and USD equivalents for fees, rent, and net P&L.
- **Automated Tests**: Added unit tests verifying trailing stop break-even floor protection (`exits.test.ts`) and concurrent sell deduplication (`execution.test.ts`).

---

## v1.3.0 — Dashboard USD Equivalents, Custom Stop-Loss Tiers & `npm install` Fix

**Risk Warning: Trading can lose all of your money.**

### Added & Improved
- **Dashboard `$` USD Equivalents**: Added live signed USD (`$`) values alongside SOL amounts across Dashboard KPI cards (`Open P&L`, `Today Realized`, `Net Realized P&L`, `Expectancy`), `Max Drawdown`, `Wallet Exposure`, `Daily Loss Budget Used`, `Gas Reserve`, and Active Positions preview cards (`formatSignedUsd` helper).
- **Custom Stop-Loss Tiers (End-to-End Execution & Settings Layout)**:
  - Moved **Custom Stop-Loss Tiers** directly below **Position Sizing & Risk Caps** in Settings and removed the redundant standalone `Stop-Loss (%) — Max 20%` input from **Exit Rules**.
  - Added `+ Add Stop Loss Tier`, `Delete`, and editable `Trigger Drop %` / `Sell %` controls, automatically syncing `stopLossPct` to the highest tier while enforcing the `20%` hard cap and `TP >= 1.5x Max SL` rule.
  - Wired `stopLossTiers` through `/api/settings` validation, SQLite (`triggered_sl_tiers_json`), and partial/full sell execution across Paper and Live engines.
- **Fixed `npm install` Peer Dependency Conflict (`ERESOLVE`)**:
  - Added npm `overrides` in `package.json` for `@solana/web3.js` and `esbuild` so `npm install` resolves cleanly without `--legacy-peer-deps`.
  - Fixed HTML5 number input `step`/`min` mismatches on Settings tiers so `Save Settings` always submits cleanly.

---

## v1.2.0 — Custom Stepped Trailing Exit Tiers & Live USD/Position Telemetry

### Added & Improved
- **Custom Stepped Trailing Exit Tiers**: Added user-editable trailing profit tiers (`+ Add Tier` / `Delete`) in Settings alongside `Take-Profit (%)` and `Break-Even Recovery Watch`.
- **USD (`$`) Values & Live 1s Position Pricing**: Added `$` USD equivalents in Settings & Positions, clearer Gross vs Net P&L breakdown, and 1-second Entry Price / Current Price updates on open positions.

---

## v1.1.0 — Scanner & Candidate Entry Pipeline Tuning

### Fixed
- Resolved candidate filtering/execution edge cases where discovered/scored coins were not executing entries in Paper mode.

---

## v1.0.0 — Ground-Up Safety-First Rebuild

**Risk Warning: Trading can lose all of your money.**

### Eliminated Legacy Bot Flaws
1. **Replaced plain-text private key handling**: Keys are now accepted only via environment variable or an AES-256-GCM + `scrypt` encrypted keystore unlocked in memory via passphrase. Keys are never logged or returned by any API.
2. **Added mandatory API authentication**: Every state-changing, signer, settings, and export route now enforces constant-time `x-api-token` verification with automatic first-run token generation in `.env`.
3. **Eliminated seconds-old blind buys**: Enforced hard-coded minimum token age, liquidity, volume, and MC/liquidity filters plus persistent cooldowns.
4. **Replaced permissive rug check with fail-closed security gate**: Inspects Mint/Freeze authority, Token-2022 extensions (permanent delegate, transfer hook, transfer fees), top holder concentration, LP lock status, RugCheck risk reports, and live Jupiter round-trip buy+sell quotes. Any missing data blocks the buy.
5. **Replaced optimistic Paper simulation with realistic Shadow Mode**: Paper mode now uses live Jupiter quotes, a 2–8s randomized decision-to-fill worst-price delay window, full fee/priority/rent/tax accounting, liquidity re-checks at fill time, competition penalty for <24h tokens, simulated buy/sell failures (`no route`), and a Paper-vs-Live reality gap tracker.
6. **Removed automated Phantom popup dependency**: Live automated entries and exits require the unlocked server-side signer so exits execute immediately without waiting for interactive browser popups.
7. **Replaced JSON file state with SQLite WAL persistence**: Mode-isolated (`paper`, `testnet`, `live`) tables for positions, trades, rejections, cooldowns, RPC health, and events, plus full unit test coverage (`node:test`) for pure trading math and state transitions.
8. **Added multi-RPC agreement pool & circuit-broken providers**: At least 3 RPC endpoints with two-endpoint agreement for balances and confirmations, plus per-domain rate limits and silent HTTP 429 backoff.
