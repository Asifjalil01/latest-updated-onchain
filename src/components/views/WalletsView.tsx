import React, { useState } from 'react';
import { Check, Copy, Lock, RefreshCw, Unlock } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { SemanticStatusText, formatSol, formatUsd } from '../ui/Primitives';

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
      solana?: BrowserSolanaProvider;
      solflare?: BrowserSolanaProvider;
    };
    const providerObj = kind === 'phantom' ? win.solana : win.solflare;
    if (!providerObj) {
      pushToast({
        kind: 'warn',
        title: `${kind} extension not detected`,
        body: 'Browser popup wallets are optional and supported for manual trades only.',
      });
      return;
    }
    try {
      const resp = await providerObj.connect();
      const addr = resp.publicKey.toString();
      await apiFetch('/api/wallet/connect', {
        method: 'POST',
        body: JSON.stringify({ provider: kind, address: addr }),
      });
      await hydrateAll();
      pushToast({ kind: 'info', title: `Connected ${kind} (manual trades only)` });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Wallet connect failed',
        body: err instanceof Error ? err.message : 'Rejected',
      });
    }
  };

  const handleWatchOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (watchAddress.trim().length < 32) return;
    setBusy(true);
    try {
      await apiFetch('/api/wallet/connect', {
        method: 'POST',
        body: JSON.stringify({ provider: 'watch_only', address: watchAddress.trim() }),
      });
      setWatchAddress('');
      await hydrateAll();
      pushToast({ kind: 'info', title: 'Watch-only address connected' });
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

        <button
          type="button"
          onClick={() => void handleRefreshDiagnostics()}
          disabled={busy}
          className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 inline-flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          <span>Refresh Diagnostics</span>
        </button>
      </div>

      {/* Diagnostics Panel */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold">Wallet Diagnostics</h2>
          <SemanticStatusText
            status={walletDiagnostics?.liveReady ? 'ok' : 'warn'}
            text={walletDiagnostics?.liveReady ? 'LIVE READY' : 'NOT READY FOR LIVE'}
            colorBlindSafe={colorBlindSafe}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
          <div>
            <span className="text-slate-500 block">Provider</span>
            <span className="font-semibold uppercase">
              {walletDiagnostics?.provider ?? 'none'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Network</span>
            <span className="font-mono">{walletDiagnostics?.network ?? 'mainnet-beta'}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Address</span>
            <div className="flex items-center gap-1.5 font-mono">
              <span>{walletDiagnostics?.maskedAddress ?? 'none'}</span>
              {walletDiagnostics?.address && (
                <button
                  type="button"
                  onClick={copyAddr}
                  aria-label="Copy wallet address"
                  className="text-slate-400 hover:text-teal-500"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>
          <div>
            <span className="text-slate-500 block">RPC Agreed Balance</span>
            <span className="font-mono font-semibold tabular-nums">
              {walletDiagnostics?.balanceSol !== null && walletDiagnostics?.balanceSol !== undefined
                ? `${formatSol(walletDiagnostics.balanceSol, 4)} (${formatUsd(walletDiagnostics.balanceUsd)})`
                : 'Unavailable'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Signing Capability</span>
            <span className="font-mono">{walletDiagnostics?.signingCapability ?? 'none'}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Sync State</span>
            <span className="font-mono uppercase">{walletDiagnostics?.syncState ?? 'unavailable'}</span>
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
            <h2 className="font-display text-sm font-bold">
              Server-Side Encrypted Signer (Required for Live)
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
              <button
                type="submit"
                disabled={busy || !unlockPassphrase}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-teal-600 text-white"
              >
                Unlock
              </button>
            </form>
          )}

          <form onSubmit={(e) => void handleSetSigner(e)} className="space-y-3">
            <p className="text-xs text-slate-500">
              Encrypt and store a Solana keypair (Base58 or 64-byte JSON array) locally using
              scrypt + AES-256-GCM:
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
              <button
                type="submit"
                disabled={busy || !privateKeyInput || passphraseInput.length < 8}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40"
              >
                Encrypt &amp; Save Keystore
              </button>
              {walletDiagnostics?.signerUnlocked && (
                <button
                  type="button"
                  onClick={() => void handleLockOrClear('lock')}
                  className="px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700"
                >
                  Lock Signer
                </button>
              )}
              {walletDiagnostics?.keystoreExists && (
                <button
                  type="button"
                  onClick={() => void handleLockOrClear('clear')}
                  className="px-3 py-2 rounded-xl text-xs font-medium text-rose-500 border border-rose-500/30"
                >
                  Delete Keystore
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          <h2 className="font-display text-sm font-bold">
            Browser Wallets (Manual Only) &amp; Watch-Only
          </h2>
          <p className="text-xs text-slate-500">
            Phantom and Solflare popup signing cannot execute automated stop-loss exits and are
            strictly blocked from automated Live mode.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleBrowserConnect('phantom')}
              className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Connect Phantom (Manual)
            </button>
            <button
              type="button"
              onClick={() => void handleBrowserConnect('solflare')}
              className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Connect Solflare (Manual)
            </button>
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
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Solana RPC Endpoint Pool (2-Endpoint Agreement Required)
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
          <h2 className="font-display text-sm font-bold">
            Wallet Fee Profiles (Display-Only Reference)
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
