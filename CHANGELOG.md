# Changelog

All notable changes to **Solana Spot Bot** are documented in this file.

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
