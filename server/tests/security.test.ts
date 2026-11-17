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

