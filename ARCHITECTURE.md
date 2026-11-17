# Architecture

**Trading can lose all of your money.** This document describes how Solana Spot Bot isolates risk, separates execution ledgers, and routes every trading decision through deterministic, fail-closed stages.

---

## High-Level System Topology

```text
[Discovery Sources]
  GeckoTerminal | Jupiter Tokens v2 | DexScreener | PumpPortal WS
        |
        v
[Provider Abstraction Layer]  (rate limiter, circuit breaker, TTL cache, silent 429 backoff)
        |
        v
[Pipeline Orchestrator (server/engine/pipeline.ts)]
  1. Hard Filters (filters.ts)       -> min age, liquidity, volume, MC/liq ratio, cooldowns
  2. Security Gate (security.ts)     -> Mint/Freeze auth, Token-2022 extensions, RugCheck,
                                        top holder %, LP lock/burn, Jupiter round-trip quote
  3. Scoring Engine (scoring.ts)     -> 0..100 score across momentum, liquidity, holders, security
  4. Sizing & Fees (sizing.ts/fees)  -> capped exposure, daily loss limit, ATA rent, net EV gate
  5. Execution Engine
       ├── Paper Engine              -> real Jupiter quote + 2–8s worst-price window + fill fail sim
       ├── Testnet Engine            -> isolated simulated ledger
       └── Live Engine               -> server signer + 2-RPC confirmation + Paper-vs-Live gap log
        |
        v
[SQLite WAL Store (server/store/db.ts)]  <--->  [Express API + SSE Stream (/api/*)]
                                                         |
                                                         v
                                                [React + Zustand UI (src/)]
```

---

## Backend Modules (`server/`)

### 1. Configuration & Defaults (`server/config/`)
- `env.ts`: Binds `127.0.0.1` (`HOST` override) on `PORT` (`3000` default). Generates a cryptographically random 32-byte hex `BOT_API_TOKEN` into `.env` on first boot if missing.
- `defaults.ts`: Defines `HARD_LIMITS` (e.g., max SL 20%, min token age 5 min, max exposure cap), preset profiles (`safe`, `balanced`, `aggressive`), and strict `validateSettingsUpdate()` checks.

### 2. Provider Abstraction (`server/providers/`)
- `base.ts`: `HttpProvider` enforces per-domain minimum request spacing, exponential backoff on transient failures, silent backoff on HTTP `429` without spamming logs, request timeouts, TTL response caching, and automatic circuit-breaker tripping after repeated errors.
- `rpcPool.ts`: `SolanaRpcPool` maintains at least 3 public Solana RPC endpoints plus user-configured `SOLANA_RPC_URL*` endpoints from `.env`. Critical balance (`getAgreedBalanceSol`, `getAgreedTokenBalanceUi`) and transaction confirmation (`getAgreedSignatureConfirmation`) calls query multiple healthy endpoints and require agreement between at least two endpoints.
- Market & security providers: `jupiter.ts` (Tokens v2, Price v3, Swap v1 quote & swap), `dexscreener.ts`, `geckoterminal.ts`, `rugcheck.ts`, and `pumpportal.ts` (WebSocket stream).

### 3. Trading & Risk Engine (`server/engine/`)
- `filters.ts`: Rejects tokens failing age, liquidity floor, volume, market-cap/liquidity bounds, duplicate active positions, or cooldowns. Every rejection writes an explicit reason code to SQLite.
- `security.ts`: Fail-closed checks combining on-chain mint inspection (mint authority, freeze authority, Token-2022 transfer fee / permanent delegate / transfer hook extensions, holder concentration), RugCheck risk flags, LP lock status, and a real Jupiter round-trip buy+sell quote check to detect unsellable honeypots or excessive price impact.
- `exits.ts`: Evaluates open positions deterministically for Stop-Loss, Take-Profit, Trailing Stop, Stagnation/Max-Hold timeout, Rug-Pull emergency exit, and Global Kill Switch. Supports partial TP exits and break-even stop promotion.
- `paperEngine.ts`: Models real-world friction using live Jupiter quotes, a randomized decision-to-fill latency window (`minDelayMs..maxDelayMs`), worst-price fill selection, liquidity re-validation at fill time, 24h competition adverse slippage, full fee/rent accounting, and probabilistic buy/sell failures (`no route` keeps the position open).
- `liveEngine.ts`: Executes real swaps exclusively with the unlocked server-side signer, checks gas reserve + wallet exposure + daily loss limit, polls two RPCs for confirmation, and records `paper_vs_live_gaps` comparing quoted vs actual on-chain fill prices.
- `replay.ts`: Deterministic historical/synthetic stress-test simulator validating filters, sizing, and exit rules offline.

### 4. Persistence (`server/store/db.ts`)
Uses `better-sqlite3` in `WAL` journal mode with explicit mode isolation (`paper`, `testnet`, `live`).
Tables include:
- `settings` & `settings_history`
- `positions` & `trades` (strictly scoped by `mode` and optional `archived_session_id` on Paper reset)
- `trade_events`, `seen_tokens`, `rejections`, `attempted_mints`, `cooldowns`
- `rpc_health`, `events`, `paper_vs_live_gaps`, `app_meta`

---

## Frontend Architecture (`src/`)

- **State Management**: `src/store/useBotStore.ts` (Zustand) keeps the session `apiToken` in `sessionStorage` / memory, bootstraps state via `/api/bootstrap`, and consumes live SSE updates from `/api/stream`.
- **Views (`src/components/views/`)**:
  - `DashboardView`: KPI metrics, Lightweight Charts equity curve, open positions, recent trades, and live Paper-vs-Live reality gap stats.
  - `PositionsView`: Active positions with manual sell & emergency controls.
  - `ScannerView`: Live candidate stream, rejection reasons, scoring breakdown, and Mint Probe security inspector.
  - `ShadowCompareView`: Side-by-side comparison of Paper vs Live fills on shared signals.
  - `HistoryView`: Closed trades table, P&L breakdown by label (`confirmed` / `simulated` / `est.`), and CSV export (`trades_log.csv`).
  - `SettingsView`: Preset switcher, hard-limited risk inputs, exit rules, discovery toggles.
  - `WalletsView`: Encrypted keystore creation/import/unlock/lock, SOL balance, RPC health matrix.
  - `LogsView` & `RiskCentreView`: Structured event log, circuit-breaker diagnostics, and safety gate status.
