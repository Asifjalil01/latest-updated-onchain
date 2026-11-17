# Solana Spot Bot

**Risk Warning: Trading cryptocurrencies, especially newly launched Solana tokens, carries extreme risk. Trading can lose all of your money. This software makes no promise or implication of profit and is provided strictly for technical execution and simulation.**

Solana Spot Bot is a safety-first, full-stack Solana spot trading terminal rebuilt from the ground up to eliminate common failure modes in automated DEX bots: plain-text private keys, unauthenticated local APIs, broken rug checks, optimistic paper simulation, and slow manual popup exits.

---

## Non-Negotiable Safety Defaults

- **Always starts in Paper mode, stopped**: Live execution is never enabled automatically on startup.
- **Fail-closed security gate**: Missing API responses, unknown authority flags, unverified liquidity, or RPC disagreement block buys automatically.
- **Encrypted key handling**: Private keys are accepted only via environment variable (`SOLANA_PRIVATE_KEY`) or an AES-256-GCM + `scrypt` encrypted keystore file unlocked at runtime via passphrase. Private keys are never written in plain text, logged, or returned by any HTTP endpoint.
- **Explicit P&L labeling**: Every P&L figure in the UI, API, and CSV export is explicitly marked `confirmed`, `simulated`, or `est.`.
- **Two-RPC agreement**: Wallet SOL/SPL balances and transaction confirmations require agreement across at least two Solana RPC endpoints in the pool.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env` if you want custom RPC endpoints or paths. On first startup, `server.ts` automatically generates a random `BOT_API_TOKEN` in `.env` if one is not set.

### 3. Run in development
```bash
npm run dev
```
Open `http://127.0.0.1:3000` (or the configured `PORT`). On first visit, enter or claim the local `BOT_API_TOKEN` in the setup modal to authenticate state-changing requests.

### 4. Production build & run
```bash
npm run build
npm start
```

### 5. Optional Electron desktop shell
If you have Electron installed globally or in devDependencies:
```bash
npm run build
npm run electron:start
```

---

## Scripts

- `npm run dev` — Starts the Express + SSE backend and Vite frontend middleware (`127.0.0.1:3000` by default).
- `npm run build` — Builds the Vite React client bundle into `dist/`.
- `npm start` — Runs the production Express server serving `dist/` and `/api/*`.
- `npm run lint` — Runs strict TypeScript type-checking (`tsc --noEmit`).
- `npm test` — Runs the `node:test` suite covering filters, security checks, exit triggers, accounting, paper simulation, replay, and API auth.

---

## Execution Modes

1. **Paper (Shadow Mode)**: Uses real Jupiter v1 quotes for entry and exit size, applies a configurable decision-to-fill delay (2–8s default) taking the worst price inside the window, deducts base fee, priority fee, DEX route fees, token taxes, and ATA rent, re-checks the liquidity floor at fill time, adds an adverse competition penalty on tokens under 24h old, and simulates buy/sell failure rates (`no route` leaves positions open).
2. **Testnet / Devnet**: Isolated simulated ledger for non-mainnet testing.
3. **Live**: Real Jupiter swaps executed strictly via the unlocked server-side signer. Blocked while browser-popup mode is selected. Requires explicit confirmation (`ENABLE LIVE`) with current TP, SL, trade size, max exposure, and daily loss limit displayed—and automatically invalidates confirmation if any risk setting changes.

---

## Project Structure

- `server/` — Express API, SSE stream, SQLite WAL database (`better-sqlite3`), provider pool, AES-256-GCM signer, filters, security engine, scoring, fee/sizing math, exit state machine, paper/live/replay engines.
- `src/` — React 19 + Vite + Tailwind CSS + Zustand terminal UI with Lightweight Charts equity curve, Shadow Compare view, Mint Probe, Risk Centre, and Command Palette (`Ctrl+K`).
- `electron/` — Optional desktop wrapper starting the localhost server.
- `ARCHITECTURE.md` — Detailed pipeline, provider, and database design.
- `SECURITY.md` — Threat model, authentication, keystore cryptography, and fail-closed guarantees.
- `CHANGELOG.md` — Rebuild history and fixed flaws from the legacy bot.
