# Changelog

All notable changes to **Solana Spot Bot** are documented in this file.

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
