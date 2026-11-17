import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import { useBotStore } from '../../store/useBotStore';
import { SemanticStatusText, formatUsd, maskMint } from '../ui/Primitives';
import type { ExplanationRecord, SecurityReport, SeenTokenRecord } from '../../types';

export function ScannerView() {
  const {
    status,
    seenTokens,
    sources,
    colorBlindSafe,
    apiFetch,
    hydrateAll,
    refreshScannerAndHealth,
    pushToast,
  } = useBotStore();

  const [search, setSearch] = useState('');
  const [decisionFilter, setDecisionFilter] = useState<'ALL' | 'BUY' | 'REJECT'>('ALL');
  const [probeMint, setProbeMint] = useState('');
  const [probing, setProbing] = useState(false);
  const [selectedToken, setSelectedToken] = useState<SeenTokenRecord | null>(null);
  const [hoveredErrorSource, setHoveredErrorSource] = useState<string | null>(null);

  useEffect(() => {
    void refreshScannerAndHealth();
  }, [refreshScannerAndHealth]);

  useEffect(() => {
    if (status?.runState !== 'running') return;
    const timer = setInterval(() => {
      void refreshScannerAndHealth();
    }, 3000);
    return () => clearInterval(timer);
  }, [status?.runState, refreshScannerAndHealth]);

  const funnel = status?.funnel ?? {
    discovered: 0,
    validated: 0,
    filtered: 0,
    securityPassed: 0,
    scored: 0,
    bought: 0,
  };

  const decisionCounts = useMemo(() => {
    let buy = 0;
    let reject = 0;
    for (const t of seenTokens) {
      if (t.lastDecision === 'BUY') buy += 1;
      else reject += 1;
    }
    return { all: seenTokens.length, buy, reject };
  }, [seenTokens]);

  const filteredTokens = useMemo(() => {
    const q = search.trim().toLowerCase();
    return seenTokens.filter((t) => {
      if (decisionFilter !== 'ALL' && t.lastDecision !== decisionFilter) return false;
      if (!q) return true;
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.mint.toLowerCase().includes(q) ||
        t.lastReason.toLowerCase().includes(q)
      );
    });
  }, [seenTokens, search, decisionFilter]);

  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [customPageSizeInput, setCustomPageSizeInput] = useState<string>('50');

  const totalPages = Math.ceil(filteredTokens.length / pageSize) || 1;
  const paginatedTokens = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTokens.slice(start, start + pageSize);
  }, [filteredTokens, currentPage, pageSize]);

  const handlePageSizeChange = (val: string) => {
    if (val === 'custom') return;
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      setPageSize(num);
      setCustomPageSizeInput(String(num));
      setCurrentPage(1);
    }
  };

  const handleCustomPageSizeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(customPageSizeInput, 10);
    if (!isNaN(num) && num > 0) {
      setPageSize(num);
      setCurrentPage(1);
    }
  };

  const handleResetSeen = async () => {
    await apiFetch('/api/seen-tokens/reset', { method: 'POST' });
    await hydrateAll();
    pushToast({ kind: 'info', title: 'Seen tokens cache cleared' });
  };

  const handleProbe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!probeMint.trim()) return;
    setProbing(true);
    try {
      const res = await apiFetch<{ explanation: ExplanationRecord }>('/api/probe', {
        method: 'POST',
        body: JSON.stringify({ mint: probeMint.trim() }),
      });
      await hydrateAll();
      pushToast({
        kind: res.explanation.decision === 'BUY' ? 'success' : 'warn',
        title: `Probe: ${res.explanation.symbol} → ${res.explanation.decision}`,
        body: res.explanation.reasons[0] || 'Passed all pipeline gates',
      });
      setProbeMint('');
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Probe failed',
        body: err instanceof Error ? err.message : 'Error probing mint',
      });
    } finally {
      setProbing(false);
    }
  };

  const parsedDrawer = useMemo(() => {
    if (!selectedToken) return null;
    try {
      return JSON.parse(selectedToken.explanationJson) as {
        explanation?: ExplanationRecord;
        securityReport?: SecurityReport;
        security?: SecurityReport;
      };
    } catch {
      return null;
    }
  }, [selectedToken]);

  const drawerSecurity = parsedDrawer?.securityReport ?? parsedDrawer?.security ?? null;
  const drawerExplanation = parsedDrawer?.explanation ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Scanner &amp; Entry Pipeline
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Strict linear fail-closed evaluation: Discover → Validate → Filter → Security →
            Sell-Route → Score → Risk/Size → Execute.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleResetSeen()}
          className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Seen Cache</span>
        </button>
      </div>

      {/* Funnel */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Discovered', value: funnel.discovered },
          { label: 'Validated', value: funnel.validated },
          { label: 'Hard Filtered', value: funnel.filtered },
          { label: 'Security Passed', value: funnel.securityPassed },
          { label: 'Scored', value: funnel.scored },
          { label: 'Executed', value: funnel.bought },
        ].map((stage) => (
          <div
            key={stage.label}
            className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4"
          >
            <span className="text-xs text-slate-500 dark:text-slate-400 block">{stage.label}</span>
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1 block">
              {stage.value}
            </span>
          </div>
        ))}
      </div>

      {/* Source Health + Mint Probe */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Discovery &amp; Data Source Health
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {sources.map((src) => {
              const healthy = src.circuitState === 'CLOSED' && src.errorCount < 5;
              const isHoveringErrors = hoveredErrorSource === src.source;
              const errorEntries =
                src.recentErrors && src.recentErrors.length > 0
                  ? src.recentErrors
                  : src.lastError
                    ? [{ message: src.lastError, atMs: src.lastOkMs ?? Date.now() }]
                    : [];
              return (
                <div
                  key={src.source}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-1 relative"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {src.source}
                    </span>
                    <SemanticStatusText
                      status={healthy ? 'ok' : src.circuitState === 'OPEN' ? 'error' : 'warn'}
                      text={src.circuitState}
                      colorBlindSafe={colorBlindSafe}
                    />
                  </div>
                  <div className="flex items-center justify-between text-slate-500 font-mono tabular-nums">
                    <span>Items: {src.itemsCount}</span>
                    <div
                      className="relative"
                      onMouseEnter={() => setHoveredErrorSource(src.source)}
                      onMouseLeave={() =>
                        setHoveredErrorSource((curr) => (curr === src.source ? null : curr))
                      }
                    >
                      <button
                        type="button"
                        onFocus={() => setHoveredErrorSource(src.source)}
                        onBlur={() =>
                          setHoveredErrorSource((curr) => (curr === src.source ? null : curr))
                        }
                        aria-label={`${src.source} errors: ${src.errorCount}`}
                        className={
                          src.errorCount > 0
                            ? `font-mono underline decoration-dotted underline-offset-2 cursor-help ${
                                src.errorCount >= 5 || src.circuitState === 'OPEN'
                                  ? 'text-rose-500 font-semibold'
                                  : 'text-amber-500 font-semibold'
                              }`
                            : 'font-mono text-slate-500 cursor-default'
                        }
                      >
                        Errors: {src.errorCount}
                      </button>

                      {isHoveringErrors && (
                        <div
                          role="tooltip"
                          className="absolute right-0 top-full mt-1.5 z-40 w-72 sm:w-80 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-900 text-slate-100 p-3 shadow-xl text-left font-sans space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-slate-700/80 pb-1.5">
                            <span className="font-semibold text-xs text-white">
                              {src.source} — Errors ({src.errorCount})
                            </span>
                            {src.rateLimitedUntilMs && src.rateLimitedUntilMs > Date.now() && (
                              <span className="text-[10px] font-mono text-amber-300">
                                Cooldown {Math.ceil((src.rateLimitedUntilMs - Date.now()) / 1000)}s
                              </span>
                            )}
                          </div>
                          {src.errorCount === 0 ? (
                            <p className="text-[11px] text-slate-300">
                              No errors recorded for this source.
                            </p>
                          ) : errorEntries.length > 0 ? (
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                              {errorEntries.map((entry, idx) => (
                                <div
                                  key={`${entry.atMs}-${idx}`}
                                  className="rounded-lg bg-rose-950/60 border border-rose-500/40 px-2 py-1.5 text-[11px]"
                                >
                                  <div className="text-[10px] font-mono text-rose-300">
                                    {new Date(entry.atMs).toLocaleTimeString()}
                                  </div>
                                  <div className="text-rose-100 break-words leading-snug">
                                    {entry.message}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-amber-200">
                              {src.errorCount} error(s) recorded earlier; latest error cleared on recovery.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {src.lastOkMs ? `OK ${new Date(src.lastOkMs).toLocaleTimeString()}` : 'Not polled yet'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Probe Mint Through Pipeline
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Test any Solana token mint against every hard filter, RugCheck, holder check, and
            sell-route test without buying.
          </p>
          <form onSubmit={(e) => void handleProbe(e)} className="space-y-2.5">
            <label htmlFor="probe-mint-input" className="sr-only">
              Solana Token Mint Address
            </label>
            <input
              id="probe-mint-input"
              type="text"
              value={probeMint}
              onChange={(e) => setProbeMint(e.target.value)}
              placeholder="Paste Solana mint address…"
              className="w-full px-3.5 py-2.5 rounded-xl font-mono text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            />
            <button
              type="submit"
              disabled={probing || probeMint.trim().length < 32}
              className="w-full py-2.5 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40"
            >
              {probing ? 'Running Pipeline Probe…' : 'Run Security & Score Probe'}
            </button>
          </form>
        </div>
      </div>

      {/* Evaluated Coins Table */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by symbol, mint, or rejection reason…"
              className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            />
          </div>

          <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {([
              { id: 'ALL', label: `ALL (${decisionCounts.all})` },
              { id: 'BUY', label: `BUY (${decisionCounts.buy})` },
              { id: 'REJECT', label: `REJECT (${decisionCounts.reject})` },
            ] as const).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setDecisionFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium tabular-nums ${
                  decisionFilter === f.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-500'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>


        {seenTokens.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            {status?.runState === 'running' ? (
              <>
                Discovery scan is active — evaluated tokens will appear here live as each candidate completes checks.
              </>
            ) : (
              <>
                No tokens evaluated in the seen cache yet. Click <strong>Scan Once</strong> in the top bar, <strong>Start Bot</strong>, or probe a mint above.
              </>
            )}
          </div>
        ) : filteredTokens.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            No evaluated tokens match the current filter ({decisionFilter}
            {search.trim() ? ` · "${search.trim()}"` : ''}).
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">Token</th>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">Source / DEX</th>
                    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Liquidity</th>
                    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Scores (Q / T)</th>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">Decision</th>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">Reason</th>
                    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {paginatedTokens.map((t) => (
                    <tr
                      key={t.mint}
                      onClick={() => setSelectedToken(t)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {t.symbol}
                        </span>{' '}
                        <span className="font-mono text-slate-500">{maskMint(t.mint)}</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {t.source} · {t.dex}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatUsd(t.liquidityUsd, true)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {t.lastQualityScore} / {t.lastTradeScore}
                      </td>
                      <td className="py-2.5 px-3">
                        <SemanticStatusText
                          status={t.lastDecision === 'BUY' ? 'ok' : 'error'}
                          text={t.lastDecision}
                          colorBlindSafe={colorBlindSafe}
                        />
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-md truncate">
                        {t.lastReason}
                      </td>
                      <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <a
                          href={`https://dexscreener.com/solana/${t.mint}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20 whitespace-nowrap"
                        >
                          <span>DexScreener</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800/70 text-xs">
              <div className="flex items-center gap-2 text-slate-500">
                <span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(filteredTokens.length, currentPage * pageSize)} of {filteredTokens.length} tokens</span>
                <select
                  aria-label="Coins per page"
                  value={[50, 100, 150, 200].includes(pageSize) ? pageSize : 'custom'}
                  onChange={(e) => handlePageSizeChange(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-mono"
                >
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                  <option value={150}>150 per page</option>
                  <option value={200}>200 per page</option>
                  <option value="custom">Custom</option>
                </select>
                <form onSubmit={handleCustomPageSizeSubmit} className="inline-flex items-center gap-1">
                  <input
                    aria-label="Custom coins per page"
                    type="number"
                    min="1"
                    max="1000"
                    value={customPageSizeInput}
                    onChange={(e) => setCustomPageSizeInput(e.target.value)}
                    className="w-16 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-center"
                  />
                  <button type="submit" className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300">Set</button>
                </form>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="font-mono text-slate-600 dark:text-slate-300">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Token Detail Drawer */}
      {selectedToken && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setSelectedToken(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Details for ${selectedToken.symbol}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl h-full overflow-y-auto bg-white dark:bg-[#0D131F] border-l border-slate-200 dark:border-slate-800 p-6 space-y-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                  {selectedToken.symbol} — Pipeline Record
                </h2>
                <p className="font-mono text-xs text-slate-500 mt-1">{selectedToken.mint}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedToken(null)}
                aria-label="Close token details"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {drawerExplanation && (
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="grid grid-cols-3 gap-3 font-mono text-xs tabular-nums">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                    <span className="text-slate-500 font-sans block">Quality Score</span>
                    <span className="text-lg font-bold">{drawerExplanation.qualityScore}/100</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                    <span className="text-slate-500 font-sans block">Trade Score</span>
                    <span className="text-lg font-bold">{drawerExplanation.tradeScore}/100</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                    <span className="text-slate-500 font-sans block">Class</span>
                    <span className="text-sm font-bold">{drawerExplanation.tokenClass}</span>
                  </div>
                </div>

                {drawerExplanation.reasons.length > 0 && (
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold text-rose-500">Rejection / Guard Reasons</p>
                    <ul className="list-disc pl-4 space-y-1 text-slate-600 dark:text-slate-300">
                      {drawerExplanation.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {drawerSecurity && (
              <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                <h3 className="font-display text-sm font-bold">Security Layer Audit</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    Mint Authority Revoked:{' '}
                    <strong>{String(drawerSecurity.mintAuthorityRevoked)}</strong>
                  </div>
                  <div>
                    Freeze Authority Revoked:{' '}
                    <strong>{String(drawerSecurity.freezeAuthorityRevoked)}</strong>
                  </div>
                  <div>
                    RugCheck Risk Score:{' '}
                    <strong className="font-mono">
                      {drawerSecurity.rugCheckScore ?? 'Missing'}
                    </strong>
                  </div>
                  <div>
                    LP Locked/Burned:{' '}
                    <strong className="font-mono">
                      {drawerSecurity.lpLockedOrBurnedPct ?? 'Unknown'}%
                    </strong>
                  </div>
                  <div>
                    Top-10 Non-Pool Holders:{' '}
                    <strong className="font-mono">
                      {drawerSecurity.top10HoldersPct?.toFixed(1) ?? '—'}%
                    </strong>
                  </div>
                  <div>
                    Sell Route Impact:{' '}
                    <strong className="font-mono">
                      {drawerSecurity.sellRouteExists
                        ? `${drawerSecurity.sellRouteImpactPct?.toFixed(2)}%`
                        : 'NO ROUTE'}
                    </strong>
                  </div>
                </div>

                {drawerSecurity.holders.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Top Holder Distribution (Pool/Burn Marked)
                    </p>
                    <div className="space-y-1.5">
                      {drawerSecurity.holders.slice(0, 10).map((h) => (
                        <div key={h.address} className="space-y-0.5 text-[11px] font-mono">
                          <div className="flex justify-between">
                            <span>
                              {maskMint(h.address)}{' '}
                              {h.isExcludedPoolOrBurn ? '(Pool/Burn Excluded)' : ''}
                            </span>
                            <span>{h.pct.toFixed(2)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                h.isExcludedPoolOrBurn ? 'bg-slate-400' : 'bg-teal-500'
                              }`}
                              style={{ width: `${Math.min(100, h.pct * 2)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
