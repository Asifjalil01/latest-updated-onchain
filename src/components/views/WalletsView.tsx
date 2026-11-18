import React, { useState } from 'react';
import { Check, Copy, Lock, RefreshCw, Unlock } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { HoverTip, InfoTooltip, SemanticStatusText, formatSol, formatUsd } from '../ui/Primitives';

interface BrowserSolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  disconnect?: () => Promise<void>;
}

export function WalletsView() {
  const {
    walletDiagnostics,
    feeProfiles,
    rpcs,
    colorBlindSafe,
    apiFetch,
    hydrateAll,
    pushToast,
  } = useBotStore();

  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [passphraseInput, setPassphraseInput] = useState('');
  const [unlockPassphrase, setUnlockPassphrase] = useState('');
  const [watchAddress, setWatchAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleRefreshDiagnostics = async () => {
    setBusy(true);
    try {
      await apiFetch('/api/rpc/check', { method: 'POST' });
      await hydrateAll();
      pushToast({ kind: 'info', title: 'Wallet & RPC diagnostics refreshed' });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Refresh failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSetSigner = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/signer/set', {
        method: 'POST',
        body: JSON.stringify({
          privateKey: privateKeyInput,
          passphrase: passphraseInput,
        }),
      });
      setPrivateKeyInput('');
      setPassphraseInput('');
      await hydrateAll();
      pushToast({ kind: 'success', title: 'Encrypted keystore created and unlocked' });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Signer setup failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUnlockSigner = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/signer/unlock', {
        method: 'POST',
        body: JSON.stringify({ passphrase: unlockPassphrase }),
      });
      setUnlockPassphrase('');
      await hydrateAll();
      pushToast({ kind: 'success', title: 'Server signer unlocked' });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Unlock failed',
        body: err instanceof Error ? err.message : 'Invalid passphrase',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleLockOrClear = async (action: 'lock' | 'clear') => {
    setBusy(true);
    try {
      await apiFetch(`/api/signer/${action}`, { method: 'POST' });
      await hydrateAll();
      pushToast({
        kind: 'info',
        title: action === 'lock' ? 'Server signer locked' : 'Encrypted keystore cleared',
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Action failed',
        body: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleBrowserConnect = async (kind: 'phantom' | 'solflare') => {
    const win = window as unknown as {
      phantom?: { solana?: BrowserSolanaProvider };
      solana?: BrowserSolanaProvider;
      solflare?: BrowserSolanaProvider;
    };
    const providerObj =
      kind === 'phantom' ? (win.phantom?.solana ?? win.solana) : win.solflare;
    if (!providerObj) {
      pushToast({
        kind: 'warn',
        title: `${kind === 'phantom' ? 'Phantom' : 'Solflare'} extension not detected`,
        body: 'If you are running inside an embedded preview iframe, open the app directly in your browser tab or use the Server-Side Encrypted Signer on the left for Live autonomous trading.',
      });
      return;
    }
    try {
      const resp = await providerObj.connect();
      const addr = resp.publicKey?.toString?.() ?? '';
      if (!addr) {
        throw new Error('Wallet did not return a public key.');
      }
      await apiFetch('/api/wallet/connect', {
        method: 'POST',
        body: JSON.stringify({ provider: kind, address: addr }),
      });
      await hydrateAll();
      pushToast({ kind: 'success', title: `Connected ${kind} (${addr.slice(0, 4)}...${addr.slice(-4)})` });
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Connection rejected or cancelled';
      pushToast({
        kind: 'error',
        title: 'Wallet connect failed',
        body: errMsg,
      });
    }
  };

  const handleWatchOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = watchAddress.trim();
    if (cleaned.length < 32) return;
    setBusy(true);
    try {
      await apiFetch('/api/wallet/connect', {
        method: 'POST',
        body: JSON.stringify({ provider: 'watch_only', address: cleaned }),
      });
      setWatchAddress('');
      await hydrateAll();
      pushToast({
        kind: 'info',
        title: 'Wallet address connected (Watch-Only)',
        body: cleaned.length > 50 || cleaned.startsWith('[')
          ? 'Public address extracted from your key. To enable autonomous Live buys/sells, also save it in the Server-Side Encrypted Signer panel.'
          : undefined,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Connect failed',
        body: err instanceof Error ? err.message : 'Invalid address',
      });
    } finally {
      setBusy(false);
    }
  };

  const copyAddr = () => {
    if (!walletDiagnostics?.address) return;
    void navigator.clipboard.writeText(walletDiagnostics.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Wallets, Encrypted Signer &amp; RPC Pool
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Private keys are encrypted with AES-256-GCM + scrypt and never leave the server or
            appear in logs.
          </p>
        </div>

        <HoverTip text="Re-queries all Solana RPC endpoints for slot consensus and refreshes wallet balance and Live readiness status.">
          <button
            type="button"
            onClick={() => void handleRefreshDiagnostics()}
            disabled={busy}
            className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            <span>Refresh Diagnostics</span>
          </button>
        </HoverTip>
      </div>

      {/* Diagnostics Panel */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold flex items-center">
            Wallet Diagnostics
            <InfoTooltip text="Live connection status, verified 2-RPC SOL balance, and whether autonomous Live execution is permitted." />
          </h2>
          <SemanticStatusText
            status={walletDiagnostics?.liveReady ? 'ok' : 'warn'}
            text={walletDiagnostics?.liveReady ? 'LIVE READY' : 'NOT READY FOR LIVE'}
            colorBlindSafe={colorBlindSafe}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
          <div>
            <span className="text-slate-500 inline-flex items-center">
              Provider
              <InfoTooltip text="Active wallet connection type (encrypted server keystore, Phantom, Solflare, or watch-only)." />
            </span>
            <span className="font-semibold uppercase block">
              {walletDiagnostics?.provider ?? 'none'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 inline-flex items-center">
              Network
              <InfoTooltip text="Solana cluster targeted by the signer and RPC pool (mainnet-beta or devnet/testnet)." />
            </span>
            <span className="font-mono block">{walletDiagnostics?.network ?? 'mainnet-beta'}</span>
          </div>
          <div>
            <span className="text-slate-500 inline-flex items-center">
              Address
              <InfoTooltip text="Public Solana wallet address derived from your signer or connected wallet." />
            </span>
            <div className="flex items-center gap-1.5 font-mono">
              <span>{walletDiagnostics?.maskedAddress ?? 'none'}</span>
              {walletDiagnostics?.address && (
                <HoverTip text="Copy full public wallet address to clipboard.">
                  <button
                    type="button"
                    onClick={copyAddr}
                    aria-label="Copy wallet address"
                    className="text-slate-400 hover:text-teal-500"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </HoverTip>
              )}
            </div>
          </div>
          <div>
            <span className="text-slate-500 inline-flex items-center">
              RPC Agreed Balance
              <InfoTooltip text="SOL balance confirmed across at least 2 independent Solana RPC endpoints before allowing Live trades." />
            </span>
            <span className="font-mono font-semibold tabular-nums block">
              {walletDiagnostics?.balanceSol !== null && walletDiagnostics?.balanceSol !== undefined
                ? `${formatSol(walletDiagnostics.balanceSol, 4)} (${formatUsd(walletDiagnostics.balanceUsd)})`
                : 'Unavailable'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 inline-flex items-center">
              Signing Capability
              <InfoTooltip text="Shows whether the server can sign autonomous swaps without interactive browser popups." />
            </span>
            <span className="font-mono block">{walletDiagnostics?.signingCapability ?? 'none'}</span>
          </div>
          <div>
            <span className="text-slate-500 inline-flex items-center">
              Sync State
              <InfoTooltip text="Consensus status across the configured Solana RPC endpoints (synced = multi-RPC agreement passed)." />
            </span>
            <span className="font-mono uppercase block">{walletDiagnostics?.syncState ?? 'unavailable'}</span>
          </div>
        </div>

        {walletDiagnostics && walletDiagnostics.liveNotReadyReasons.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/70 text-xs text-amber-600 dark:text-amber-400 space-y-1">
            <p className="font-semibold">Live Readiness Blockers:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {walletDiagnostics.liveNotReadyReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Server Signer + Browser/Watch-Only */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold flex items-center">
              Server-Side Encrypted Signer (Required for Live)
              <InfoTooltip text="Stores your trading key locally encrypted with scrypt + AES-256-GCM so automated buys and stop-losses sign instantly without browser confirmation popups." />
            </h2>
            {walletDiagnostics?.signerUnlocked ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500">
                <Unlock className="w-3.5 h-3.5" />
                Unlocked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                <Lock className="w-3.5 h-3.5" />
                Locked
              </span>
            )}
          </div>

          {walletDiagnostics?.keystoreExists && !walletDiagnostics?.signerUnlocked && (
            <form onSubmit={(e) => void handleUnlockSigner(e)} className="flex gap-2">
              <input
                type="password"
                value={unlockPassphrase}
                onChange={(e) => setUnlockPassphrase(e.target.value)}
                placeholder="Enter keystore passphrase…"
                className="flex-1 px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              />
              <HoverTip text="Decrypt the saved server keystore into memory so Live mode can sign transactions autonomously.">
                <button
                  type="submit"
                  disabled={busy || !unlockPassphrase}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-teal-600 text-white"
                >
                  Unlock
                </button>
              </HoverTip>
            </form>
          )}

          <form onSubmit={(e) => void handleSetSigner(e)} className="space-y-3">
            <p className="text-xs text-slate-500">
              <strong>Autonomous Live Auto-Confirm:</strong> Once unlocked, the bot signs and sends Live buys &amp; sells automatically without browser popups. Private keys (Base58 or 64-byte JSON array) are encrypted locally using scrypt + AES-256-GCM.
            </p>
            <input
              type="password"
              value={privateKeyInput}
              onChange={(e) => setPrivateKeyInput(e.target.value)}
              placeholder="Solana private key (Base58 or [byte, ...])"
              className="w-full px-3 py-2 rounded-xl font-mono text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            />
            <input
              type="password"
              value={passphraseInput}
              onChange={(e) => setPassphraseInput(e.target.value)}
              placeholder="Encryption passphrase (min 8 chars)"
              className="w-full px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            />
            <div className="flex flex-wrap gap-2">
              <HoverTip text="Encrypt your private key with your passphrase on disk and immediately unlock it for autonomous Live execution.">
                <button
                  type="submit"
                  disabled={busy || !privateKeyInput || passphraseInput.length < 8}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40"
                >
                  Encrypt &amp; Save Keystore
                </button>
              </HoverTip>
              {walletDiagnostics?.signerUnlocked && (
                <HoverTip text="Clear the decrypted key from memory (keeps the encrypted keystore file on disk for later unlock).">
                  <button
                    type="button"
                    onClick={() => void handleLockOrClear('lock')}
                    className="px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700"
                  >
                    Lock Signer
                  </button>
                </HoverTip>
              )}
              {walletDiagnostics?.keystoreExists && (
                <HoverTip text="Permanently wipe the encrypted keystore file from the server.">
                  <button
                    type="button"
                    onClick={() => void handleLockOrClear('clear')}
                    className="px-3 py-2 rounded-xl text-xs font-medium text-rose-500 border border-rose-500/30"
                  >
                    Delete Keystore
                  </button>
                </HoverTip>
              )}
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          <h2 className="font-display text-sm font-bold flex items-center">
            Browser Wallets (Manual Only) &amp; Watch-Only
            <InfoTooltip text="Connect a browser wallet for balance display or paste any Solana public address to monitor it in read-only mode." />
          </h2>
          <p className="text-xs text-slate-500">
            Phantom and Solflare popup signing cannot execute automated stop-loss exits and are
            strictly blocked from automated Live mode.
          </p>
          <div className="flex flex-wrap gap-2">
            <HoverTip text="Request public address connection from your Phantom browser extension (display/manual only).">
              <button
                type="button"
                onClick={() => void handleBrowserConnect('phantom')}
                className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Connect Phantom (Manual)
              </button>
            </HoverTip>
            <HoverTip text="Request public address connection from your Solflare browser extension (display/manual only).">
              <button
                type="button"
                onClick={() => void handleBrowserConnect('solflare')}
                className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Connect Solflare (Manual)
              </button>
            </HoverTip>
          </div>

          <form onSubmit={(e) => void handleWatchOnly(e)} className="flex gap-2 pt-2">
            <input
              type="text"
              value={watchAddress}
              onChange={(e) => setWatchAddress(e.target.value)}
              placeholder="Watch-only Solana public key…"
              className="flex-1 px-3 py-2 rounded-xl font-mono text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            />
            <button
              type="submit"
              disabled={busy || watchAddress.trim().length < 32}
              className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800"
            >
              Watch
            </button>
          </form>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/70 space-y-2">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center">
              Solana RPC Endpoint Pool (2-Endpoint Agreement Required)
              <InfoTooltip text="Live mode requires at least 2 independent RPC nodes to agree on wallet balances and transaction confirmations before risking real SOL." />
            </h3>
            <div className="space-y-1.5 text-xs font-mono">
              {rpcs.map((r) => (
                <div key={r.url} className="flex items-center justify-between">
                  <span className="truncate max-w-[240px]">{r.label}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-slate-500">{r.latencyMs}ms</span>
                    <SemanticStatusText
                      status={r.healthy ? 'ok' : 'error'}
                      text={r.healthy ? `Slot ${r.slot}` : 'Down'}
                      colorBlindSafe={colorBlindSafe}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Display-Only Wallet Fee Profile Matrix */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-3">
        <div>
          <h2 className="font-display text-sm font-bold flex items-center">
            Wallet Fee Profiles (Display-Only Reference)
            <InfoTooltip text="Informational comparison of popular Solana wallet built-in swap fees vs direct Jupiter routing used by this bot." />
          </h2>
          <p className="text-xs text-slate-500">
            Informational comparison only — never alters real swap fee calculations.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 px-3">Wallet</th>
                <th className="py-2 px-3">Network</th>
                <th className="py-2 px-3">Trading Support</th>
                <th className="py-2 px-3">Display Swap Fee</th>
                <th className="py-2 px-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {feeProfiles.map((fp) => (
                <tr key={fp.id}>
                  <td className="py-2.5 px-3 font-semibold">{fp.name}</td>
                  <td className="py-2.5 px-3">{fp.network}</td>
                  <td className="py-2.5 px-3">
                    <SemanticStatusText
                      status={fp.tradingSupported ? 'ok' : 'warn'}
                      text={fp.tradingSupported ? 'Solana Supported' : 'Not supported yet'}
                      colorBlindSafe={colorBlindSafe}
                    />
                  </td>
                  <td className="py-2.5 px-3 font-mono">{fp.displaySwapFeePct}</td>
                  <td className="py-2.5 px-3 text-slate-500">{fp.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
