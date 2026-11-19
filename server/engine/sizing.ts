import type { BotSettings, SizingResult } from '../types';

export function calculatePositionSize(params: {
  settings: BotSettings;
  availableBalanceSol: number;
  currentExposureSol: number;
  openPositionsCount: number;
  dailyRealizedPnlSol: number;
  poolLiquidityUsd: number;
  solPriceUsd: number | null;
  tokenClassMultiplier: number;
}): SizingResult {
  const {
    settings,
    availableBalanceSol,
    currentExposureSol,
    openPositionsCount,
    dailyRealizedPnlSol,
    poolLiquidityUsd,
    solPriceUsd,
    tokenClassMultiplier,
  } = params;

  if (solPriceUsd === null || !Number.isFinite(solPriceUsd) || solPriceUsd <= 0) {
    return {
      approved: false,
      reason: 'Live SOL/USD price unavailable (fail closed)',
      solAmount: 0,
      usdAmount: 0,
      tokenClassMultiplier,
      cappedBy: 'SOL_PRICE_UNAVAILABLE',
    };
  }

  if (tokenClassMultiplier <= 0) {
    return {
      approved: false,
      reason: 'Token class multiplier is 0 (high_risk_micro rejected)',
      solAmount: 0,
      usdAmount: 0,
      tokenClassMultiplier,
      cappedBy: 'TOKEN_CLASS',
    };
  }

  if (dailyRealizedPnlSol <= -Math.abs(settings.dailyLossLimitSol)) {
    return {
      approved: false,
      reason: `Daily loss limit hit (${dailyRealizedPnlSol.toFixed(4)} <= -${settings.dailyLossLimitSol.toFixed(4)} SOL)`,
      solAmount: 0,
      usdAmount: 0,
      tokenClassMultiplier,
      cappedBy: 'DAILY_LOSS_LIMIT',
    };
  }

  if (openPositionsCount >= settings.maxOpenPositions) {
    return {
      approved: false,
      reason: `Max open positions (${settings.maxOpenPositions}) reached`,
      solAmount: 0,
      usdAmount: 0,
      tokenClassMultiplier,
      cappedBy: 'MAX_OPEN_POSITIONS',
    };
  }

  const remainingExposure = Math.max(0, settings.maxWalletExposureSol - currentExposureSol);
  // Gas reserve check removed: evaluate directly against available wallet balance
  const spendableBalance = Math.max(0, availableBalanceSol);
  const twoPctLiquiditySol = (poolLiquidityUsd * 0.02) / solPriceUsd;
  const targetByClass = settings.tradeSizeSol * tokenClassMultiplier;

  const targetNeedSol = Math.max(0.005, Math.min(targetByClass, settings.maxPositionSizeSol));
  if (spendableBalance <= 0 || spendableBalance < 0.005) {
    const availUsd = spendableBalance * solPriceUsd;
    const needUsd = targetNeedSol * solPriceUsd;
    return {
      approved: false,
      reason: `There is no SOL (${spendableBalance.toFixed(4)} SOL / $${availUsd.toFixed(2)}) in the wallet to trade (need >= ${targetNeedSol.toFixed(4)} SOL / $${needUsd.toFixed(2)}).`,
      solAmount: 0,
      usdAmount: 0,
      tokenClassMultiplier,
      cappedBy: 'INSUFFICIENT_WALLET_SOL',
    };
  }

  const candidates: Array<{ label: string; amount: number }> = [
    { label: 'TRADE_SIZE', amount: targetByClass },
    { label: 'MAX_POSITION_SIZE', amount: settings.maxPositionSizeSol },
    { label: 'MAX_WALLET_EXPOSURE', amount: remainingExposure },
    { label: 'AVAILABLE_SOL', amount: spendableBalance },
  ];
  if (settings.minLiquidityUsd >= 500 || poolLiquidityUsd >= 2000) {
    candidates.push({ label: 'TWO_PCT_POOL_LIQUIDITY', amount: twoPctLiquiditySol });
  }

  candidates.sort((a, b) => a.amount - b.amount);
  const limiting = candidates[0];
  const finalSol = Number(limiting.amount.toFixed(6));

  if (finalSol < 0.005) {
    if (limiting.label === 'AVAILABLE_SOL') {
      const availUsd = spendableBalance * solPriceUsd;
      const needUsd = targetNeedSol * solPriceUsd;
      return {
        approved: false,
        reason: `There is no SOL (${spendableBalance.toFixed(4)} SOL / $${availUsd.toFixed(2)}) in the wallet to trade (need >= ${targetNeedSol.toFixed(4)} SOL / $${needUsd.toFixed(2)}).`,
        solAmount: 0,
        usdAmount: 0,
        tokenClassMultiplier,
        cappedBy: 'INSUFFICIENT_WALLET_SOL',
      };
    }
    return {
      approved: false,
      reason: `Sized amount ${finalSol} SOL ($${(finalSol * solPriceUsd).toFixed(2)}) below 0.005 SOL viable minimum (capped by ${limiting.label})`,
      solAmount: 0,
      usdAmount: 0,
      tokenClassMultiplier,
      cappedBy: limiting.label,
    };
  }

  return {
    approved: true,
    solAmount: finalSol,
    usdAmount: finalSol * solPriceUsd,
    tokenClassMultiplier,
    cappedBy: limiting.label,
  };
}
