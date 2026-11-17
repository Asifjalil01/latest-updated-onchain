# Changelog

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
