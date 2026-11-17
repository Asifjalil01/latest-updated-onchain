# Security Model

**Trading can lose all of your money.** Solana Spot Bot is designed around defense-in-depth so that no single API outage, bad token contract, or misconfiguration can silently drain funds or expose key material.

---

## 1. API Authentication (`x-api-token`)
- On first startup, `server/config/env.ts` checks `.env` for `BOT_API_TOKEN`. If missing, it generates a 256-bit cryptographically random hex token and appends it to `.env`.
- Every state-changing route (`POST`, `PUT`, `PATCH`, `DELETE`), signer route, settings route, and export route requires the `x-api-token` header validated with constant-time comparison (`crypto.timingSafeEqual`).
- Missing or invalid tokens immediately return `HTTP 401`.
- The server binds to `127.0.0.1` by default (`HOST` env var required to expose beyond loopback).

---

## 2. Private Key & Signer Security
- **Accepted key sources only**:
  1. `SOLANA_PRIVATE_KEY` environment variable (Base58 string or JSON byte array), or
  2. Encrypted keystore file (`./data/signer.enc.json` by default) protected with **AES-256-GCM** and a 256-bit key derived via **`scrypt`** (`N=16384, r=8, p=1`) from the user's passphrase.
- **Zero plain-text persistence**: Private keys are never written unencrypted to disk, never persisted in SQLite, never printed to logs, and never returned by any API endpoint.
- **Address masking**: Logs and diagnostic events mask wallet addresses (e.g., `AbCd...wXyZ`) while keeping full validation intact internally.
- **No automated browser-popup signing**: Live automated execution is strictly blocked unless the server-side signer is unlocked. Browser wallet popups (Phantom/Solflare) are disallowed for automated trading/exits.

---

## 3. Fail-Closed Trading Gates
The bot refuses to buy (`FAIL_CLOSED`) whenever any of the following conditions occur:
- Market metadata, liquidity, or token age is missing or stale.
- Mint authority or freeze authority is still active (`!= null`).
- Token-2022 dangerous extensions are detected (transfer fees above threshold, permanent delegate, or custom transfer hooks).
- Top holder concentration or LP lock checks fail or time out.
- Jupiter round-trip buy+sell simulation fails (`NO_SELL_ROUTE`) or indicates excessive price impact / hidden sell tax.
- At least two healthy Solana RPC endpoints do not agree on wallet SOL balance or confirmation status.
- Active exposure exceeds `maxWalletExposureSol` or daily realized loss exceeds `dailyLossLimitSol`.

---

## 4. Live Mode Safeguards & Kill Switch
- **Always boots in Paper / Stopped**: Live mode is never persisted across restarts or auto-started.
- **Explicit confirmation**: Switching to Live requires typing `ENABLE LIVE` in the confirmation modal while reviewing active TP, SL, trade size, max exposure, and daily loss limit.
- **Confirmation invalidation**: Editing any risk limit after confirming Live mode automatically clears the confirmation hash and forces re-confirmation.
- **Kill Switch (`POST /api/kill`)**: Immediately halts the orchestrator loop, cancels pending entries, and attempts emergency high-slippage exits on open positions.
