import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpProvider } from '../providers/base';
import { PumpPortalWsProvider } from '../providers/pumpportal';

test('HttpProvider: enforces HTTP 429 cooldown without immediate retry loops', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('Too Many Requests', { status: 429 });
  }) as typeof fetch;

  try {
    const provider = new HttpProvider({
      sourceName: 'test_429_source',
      domain: 'test-429.example.invalid',
      minIntervalMs: 0,
      maxRetries: 2,
      cacheTtlMs: 0,
    });

    await assert.rejects(
      () => provider.fetchJson('https://test-429.example.invalid/pools'),
      /HTTP 429/
    );
    assert.equal(fetchCalls, 1, 'Should not immediately retry after receiving HTTP 429');
    assert.equal(provider.isRateLimited(), true);
    assert.equal(provider.getHealth().errorCount, 1);

    // Subsequent call during active cooldown should fail fast without hitting fetch()
    await assert.rejects(
      () => provider.fetchJson('https://test-429.example.invalid/pools2'),
      /Rate limited backoff active/
    );
    assert.equal(fetchCalls, 1, 'Should not invoke fetch() while domain cooldown is active');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PumpPortalWsProvider: reports CLOSED when idle or connecting cleanly and HALF_OPEN/OPEN only on errors', () => {
  const ws = new PumpPortalWsProvider();
  const initialHealth = ws.getHealth();
  assert.equal(initialHealth.circuitState, 'CLOSED');
  assert.equal(initialHealth.errorCount, 0);

  // Start without forcing network dependency check — immediate CONNECTING state with 0 errors must be CLOSED
  ws.start();
  const connectingHealth = ws.getHealth();
  assert.equal(connectingHealth.circuitState, 'CLOSED');

  // Simulate socket connection failure -> HALF_OPEN (< 5 errors) then OPEN (>= 5 errors)
  const internal = ws as unknown as {
    ws: { readyState: number; emit?: (event: string, err?: Error) => void } | null;
    consecutiveErrors: number;
    errorCount: number;
  };
  internal.consecutiveErrors = 1;
  internal.errorCount = 1;
  if (internal.ws) {
    // Ensure readyState !== OPEN
    Object.defineProperty(internal.ws, 'readyState', { value: 3, configurable: true });
  }
  assert.equal(ws.getHealth().circuitState, 'HALF_OPEN');

  internal.consecutiveErrors = 5;
  internal.errorCount = 5;
  assert.equal(ws.getHealth().circuitState, 'OPEN');

  ws.stop();
  const stoppedHealth = ws.getHealth();
  assert.equal(stoppedHealth.circuitState, 'CLOSED');
});

