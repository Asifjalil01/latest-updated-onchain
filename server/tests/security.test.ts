import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { evaluateSecurityRules } from '../engine/security';
import type { OnChainTokenInspection } from '../providers/rpcPool';
import type { NormalizedRugCheckResult } from '../providers/rugcheck';

function makeCleanOnChain(): OnChainTokenInspection {
  return {
    mint: 'TokenMint1111111111111111111111111111111111',
    decimals: 6,
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    isToken2022: false,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    disallowedExtensions: [],
    supplyUi: 1_000_000,
    top10HoldersPct: 22,
    singleMaxHolderPct: 5.5,
    holders: [],
  };
}

function makeCleanRugCheck(): NormalizedRugCheckResult {
  return {
    available: true,
    normalizedRiskScore: 10,
    rugged: false,
    lpLockedOrBurnedPct: 95,
    riskNames: [],
    criticalRisks: [],
    creator: 'Creator1111111111111111111111111111111111',
  };
}

test('security: rejects when RugCheck report is missing (fail closed)', () => {
  const res = evaluateSecurityRules(
    {
      onChain: makeCleanOnChain(),
      rugCheck: null,
      sellRouteExists: true,
      sellQuoteImpactPct: 0.8,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(res.passed, false);
  assert.ok(res.criticalFlags.includes('RUGCHECK_MISSING'));
});

test('security: rejects when top-10 non-pool holders exceed 35%', () => {
  const concentrated: OnChainTokenInspection = {
    ...makeCleanOnChain(),
    top10HoldersPct: 41.2,
  };
  const res = evaluateSecurityRules(
    {
      onChain: concentrated,
      rugCheck: makeCleanRugCheck(),
      sellRouteExists: true,
      sellQuoteImpactPct: 0.8,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(res.passed, false);
  assert.ok(res.criticalFlags.includes('TOP10_CONCENTRATION'));
});

test('security: rejects when sell route is missing', () => {
  const res = evaluateSecurityRules(
    {
      onChain: makeCleanOnChain(),
      rugCheck: makeCleanRugCheck(),
      sellRouteExists: false,
      sellQuoteImpactPct: null,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(res.passed, false);
  assert.ok(res.criticalFlags.includes('NO_SELL_ROUTE'));
});

test('security: uses RugCheck holder fallback when RPC getTokenLargestAccounts is rate-limited, and fails closed if both lack holders', () => {
  const onChainNoHolders: OnChainTokenInspection = {
    ...makeCleanOnChain(),
    holderInspectionAvailable: false,
    top10HoldersPct: 0,
    singleMaxHolderPct: 0,
    holders: [],
  };

  // Fails closed when RugCheck also lacks topHolders
  const missingHolders = evaluateSecurityRules(
    {
      onChain: onChainNoHolders,
      rugCheck: makeCleanRugCheck(),
      sellRouteExists: true,
      sellQuoteImpactPct: 0.5,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(missingHolders.passed, false);
  assert.ok(missingHolders.criticalFlags.includes('HOLDER_DATA_UNAVAILABLE'));

  // Passes when RugCheck supplies clean non-pool holder concentration
  const withRugCheckHolders = evaluateSecurityRules(
    {
      onChain: onChainNoHolders,
      rugCheck: {
        ...makeCleanRugCheck(),
        top10HoldersPct: 24.5,
        singleMaxHolderPct: 4.8,
        holders: [
          {
            address: 'Holder11111111111111111111111111111111111',
            amount: 48_000,
            pct: 4.8,
            isExcludedPoolOrBurn: false,
          },
        ],
      },
      sellRouteExists: true,
      sellQuoteImpactPct: 0.5,
    },
    DEFAULT_SETTINGS
  );
  assert.equal(withRugCheckHolders.passed, true, `Unexpected rejection: ${withRugCheckHolders.reasons.join('; ')}`);
});

test('security: skips top-10 non-pool holder limit when enforceMaxTop10Holders is unchecked', () => {
  const concentrated: OnChainTokenInspection = {
    ...makeCleanOnChain(),
    top10HoldersPct: 41.2,
  };
  const bypassed = evaluateSecurityRules(
    {
      onChain: concentrated,
      rugCheck: makeCleanRugCheck(),
      sellRouteExists: true,
      sellQuoteImpactPct: 0.8,
    },
    {
      ...DEFAULT_SETTINGS,
      enforceMaxTop10Holders: false,
    }
  );
  assert.equal(bypassed.passed, true, `Unexpected rejection when top-10 rule disabled: ${bypassed.reasons.join('; ')}`);
});

test('v1.37.0: creator history blocks serial launchers, prior ruggers & fast-ruggers, and bypasses when unchecked', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { BotDatabase } = await import('../store/db');
  const { inspectCreatorHistory } = await import('../providers/creatorHistory');

  // 1. evaluateSecurityRules enforcement vs bypass
  const fastRugReport = evaluateSecurityRules(
    {
      onChain: makeCleanOnChain(),
      rugCheck: makeCleanRugCheck(),
      sellRouteExists: true,
      sellQuoteImpactPct: 0.8,
      creatorHistory: {
        creatorAddress: 'CreatorSerial111111111111111111111111111111',
        launchCount: 8,
        ruggedCount: 2,
        fastestRugMinutes: 14.5,
        flaggedByRugCheckRisk: false,
        ruggedMints: ['RugMintA', 'RugMintB'],
      },
    },
    {
      ...DEFAULT_SETTINGS,
      creatorHistoryEnabled: true,
      maxCreatorLaunches: 5,
      maxCreatorRuggedCoins: 0,
      creatorFastRugWindowMinutes: 60,
    }
  );
  assert.equal(fastRugReport.passed, false);
  assert.ok(fastRugReport.criticalFlags.includes('CREATOR_SERIAL_LAUNCHER'));
  assert.ok(fastRugReport.criticalFlags.includes('CREATOR_RUG_HISTORY'));
  assert.ok(fastRugReport.criticalFlags.includes('CREATOR_FAST_RUGGER'));
  assert.equal(fastRugReport.deployerFlagged, true);

  // Unchecking creatorHistoryEnabled bypasses all creator checks
  const creatorDisabled = evaluateSecurityRules(
    {
      onChain: makeCleanOnChain(),
      rugCheck: makeCleanRugCheck(),
      sellRouteExists: true,
      sellQuoteImpactPct: 0.8,
      creatorHistory: {
        creatorAddress: 'CreatorSerial111111111111111111111111111111',
        launchCount: 8,
        ruggedCount: 2,
        fastestRugMinutes: 14.5,
        flaggedByRugCheckRisk: true,
        ruggedMints: ['RugMintA'],
      },
    },
    {
      ...DEFAULT_SETTINGS,
      creatorHistoryEnabled: false,
    }
  );
  assert.equal(creatorDisabled.passed, true, `Unexpected rejection: ${creatorDisabled.reasons.join('; ')}`);

  // Unchecking individual optionToggles bypasses only those specific creator checks
  const individualDisabled = evaluateSecurityRules(
    {
      onChain: makeCleanOnChain(),
      rugCheck: makeCleanRugCheck(),
      sellRouteExists: true,
      sellQuoteImpactPct: 0.8,
      creatorHistory: {
        creatorAddress: 'CreatorSerial111111111111111111111111111111',
        launchCount: 8,
        ruggedCount: 2,
        fastestRugMinutes: 14.5,
        flaggedByRugCheckRisk: false,
        ruggedMints: ['RugMintA'],
      },
    },
    {
      ...DEFAULT_SETTINGS,
      creatorHistoryEnabled: true,
      optionToggles: {
        maxCreatorLaunches: false,
        maxCreatorRuggedCoins: false,
        creatorFastRugWindowMinutes: false,
      },
    }
  );
  assert.equal(individualDisabled.passed, true);

  // 2. Database + inspectCreatorHistory end-to-end rug speed tracking
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-creator-db-'));
  const db = new BotDatabase(path.join(tmpDir, 'test.db'));
  try {
    const now = 1_760_000_000_000;
    const creator = 'DevWallet1111111111111111111111111111111111';
    db.recordCreatorObservation({
      creator,
      mint: 'OldRuggedMint111111111111111111111111111111',
      symbol: 'OLDRUG',
      createdAtMs: now - 30 * 60_000,
      rugged: false,
      nowMs: now - 30 * 60_000,
    });
    // Drain happens 12 minutes after launch
    db.markMintRuggedForCreator('OldRuggedMint111111111111111111111111111111', 'EMERGENCY_LIQUIDITY_DRAIN', now - 18 * 60_000);

    const summary = await inspectCreatorHistory({
      creatorAddress: creator,
      currentMint: 'NewMint22222222222222222222222222222222222',
      currentPoolCreatedAtMs: now,
      currentSymbol: 'NEW2',
      rugCheck: makeCleanRugCheck(),
      db,
      nowMs: now,
      bypassCache: true,
    });
    assert.equal(summary.launchCount, 1);
    assert.equal(summary.ruggedCount, 1);
    assert.equal(summary.fastestRugMinutes, 12);
    assert.deepEqual(summary.ruggedMints, ['OldRuggedMint111111111111111111111111111111']);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});



