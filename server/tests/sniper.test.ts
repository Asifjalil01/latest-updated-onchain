import test from 'node:test';
import assert from 'node:assert/strict';
import {
  usdToSol,
  fmtSolAmount,
  fmtSolPrice,
  fmtSignedUsdAndSol,
  fmtUnsignedUsdAndSol,
  pairTradesWithEntryAndExit,
  orderLogsNewestFirst,
} from '../../src/utils/sniperFormat.ts';

test('usdToSol converts USD to SOL accurately when live SOL price is available', () => {
  assert.equal(usdToSol(150, 150), 1);
  assert.equal(usdToSol(75, 150), 0.5);
  assert.equal(usdToSol(50, null), null);
  assert.equal(usdToSol(50, 0), null);
});

test('fmtSignedUsdAndSol and fmtUnsignedUsdAndSol format USD and SOL side by side', () => {
  const signedPos = fmtSignedUsdAndSol(15, 150, 2);
  assert.equal(signedPos.usdText, '+$15.00');
  assert.equal(signedPos.solText, '+0.1000 SOL');

  const signedNeg = fmtSignedUsdAndSol(-7.5, 150, 2);
  assert.equal(signedNeg.usdText, '-$7.50');
  assert.equal(signedNeg.solText, '-0.0500 SOL');

  const unsigned = fmtUnsignedUsdAndSol(300, 150, 2);
  assert.equal(unsigned.usdText, '$300.00');
  assert.equal(unsigned.solText, '2.000 SOL');

  const missingSol = fmtSignedUsdAndSol(10, null, 2);
  assert.equal(missingSol.usdText, '+$10.00');
  assert.equal(missingSol.solText, '— SOL');
});

test('fmtSolAmount and fmtSolPrice handle microcap token prices', () => {
  assert.equal(fmtSolAmount(0.033333), '0.0333 SOL');
  assert.equal(fmtSolPrice(0.000015, 150), '0.0000001000 SOL');
  assert.equal(fmtSolPrice(1.5, 150), '0.010000 SOL');
});

test('pairTradesWithEntryAndExit pairs chronological BUY -> SELL rows with both entryPrice and exitPrice', () => {
  const rows = [
    {
      time: '2026-11-19T06:06:29+00:00',
      action: 'BUY',
      symbol: 'DCTY',
      mint: 'mintDCTY',
      price: '0.00000590',
      amount: '5.0',
      pnlUsd: '',
      pnlPct: '',
      reason: 'sniper_entry',
    },
    {
      time: '2026-11-19T06:07:52+00:00',
      action: 'SELL',
      symbol: 'DCTY',
      mint: 'mintDCTY',
      price: '0.00000867',
      amount: '7.2086',
      pnlUsd: '2.2086',
      pnlPct: '44.17',
      reason: 'take_profit_50',
    },
    {
      time: '2026-11-19T06:10:25+00:00',
      action: 'BUY',
      symbol: 'COCO',
      mint: 'mintCOCO',
      price: '0.00001210',
      amount: '5.0',
      pnlUsd: '',
      pnlPct: '',
      reason: 'sniper_entry',
    },
  ];

  const paired = pairTradesWithEntryAndExit(rows);
  assert.equal(paired.length, 3);
  // Newest first
  assert.equal(paired[0].symbol, 'COCO');
  assert.equal(paired[0].action, 'BUY');
  assert.equal(paired[0].entryPrice, '0.00001210');
  assert.equal(paired[0].exitPrice, '');

  assert.equal(paired[1].symbol, 'DCTY');
  assert.equal(paired[1].action, 'SELL');
  assert.equal(paired[1].entryPrice, '0.00000590');
  assert.equal(paired[1].exitPrice, '0.00000867');

  assert.equal(paired[2].symbol, 'DCTY');
  assert.equal(paired[2].action, 'BUY');
  assert.equal(paired[2].entryPrice, '0.00000590');
  assert.equal(paired[2].exitPrice, '');
});

test('orderLogsNewestFirst places newest log entries at index 0 without mutating original array', () => {
  const input = [{ id: '1' }, { id: '2' }, { id: '3' }];
  const ordered = orderLogsNewestFirst(input);
  assert.deepEqual(
    ordered.map((x) => x.id),
    ['3', '2', '1']
  );
  assert.deepEqual(
    input.map((x) => x.id),
    ['1', '2', '3']
  );
});
