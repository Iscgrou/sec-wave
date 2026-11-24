/**
 * PayamFeed — Deterministic Institutional Multi-Asset OHLCV Generator & Tick Stepper
 * Produces mathematically coherent market structure (swings, liquidity sweeps,
 * displacement candles, MSS breaks, and FVG/OB POI zones) for all 5 assets.
 * Used both as initial historical context and as deterministic replay/live ticks
 * when no external Layer-5 Companion Bridge is attached.
 */

import { ASSET_SPECS, type AssetSymbol, type CandleBar } from '../types';

/** Deterministic Mulberry32 PRNG for reproducible historical structure */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ASSET_SEEDS: Readonly<Record<AssetSymbol, number>> = Object.freeze({
  XAUUSD: 20261101,
  XAGUSD: 20261102,
  WTI: 20261103,
  BTCUSD: 20261104,
  NAS100: 20261105,
});

/** Asset bias scenarios so the 5 assets exhibit realistic, varied market structures */
const ASSET_SCENARIO: Readonly<
  Record<AssetSymbol, { bias: 'BULL_SWEEP' | 'BEAR_SWEEP' | 'RANGE_CHOP'; drift: number }>
> = Object.freeze({
  XAUUSD: { bias: 'BULL_SWEEP', drift: 0.14 },
  XAGUSD: { bias: 'BULL_SWEEP', drift: 0.11 },
  WTI: { bias: 'BEAR_SWEEP', drift: -0.12 },
  BTCUSD: { bias: 'BULL_SWEEP', drift: 0.16 },
  NAS100: { bias: 'RANGE_CHOP', drift: 0.02 },
});

function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Generates `count` 15-minute institutional OHLCV bars ending near `nowSec`.
 * The final 14 bars encode an authentic market pattern (either bullish liquidity
 * sweep + displacement + MSS, bearish liquidity sweep + displacement + MSS,
 * or tight range compression that defaults to NO_TRADE per I6).
 */
export function generateHistoricalCandles(
  asset: AssetSymbol,
  count: number = 120,
  nowSec: number = Math.floor(Date.now() / 1000)
): CandleBar[] {
  const spec = ASSET_SPECS[asset];
  const rand = createPrng(ASSET_SEEDS[asset]);
  const scenario = ASSET_SCENARIO[asset];
  const stepSec = 900; // 15m verification lens baseline
  const alignedEnd = Math.floor(nowSec / stepSec) * stepSec;
  const startSec = alignedEnd - (count - 1) * stepSec;

  const bars: CandleBar[] = [];
  let price = spec.defaultPrice - spec.atrBaseline * 1.6 * Math.sign(scenario.drift || 1);
  const atr = spec.atrBaseline;

  for (let i = 0; i < count; i += 1) {
    const time = startSec + i * stepSec;
    const tailIdx = count - 1 - i; // 0 is newest bar

    let open = price;
    let close = open;
    let high = open;
    let low = open;

    if (tailIdx > 12) {
      // Base structural oscillation
      const wave = Math.sin(i * 0.22) * atr * 0.35 + (rand() - 0.48) * atr * 0.72;
      const trendPull = scenario.drift * atr * 0.15;
      close = open + wave + trendPull;
      const upperWick = rand() * atr * 0.38;
      const lowerWick = rand() * atr * 0.38;
      high = Math.max(open, close) + upperWick;
      low = Math.min(open, close) - lowerWick;
    } else if (scenario.bias === 'BULL_SWEEP') {
      // Structured bullish setup: equal lows -> sweep -> strong displacement -> MSS -> shallow pullback into FVG
      if (tailIdx >= 9) {
        // Forming equal-low liquidity shelf
        close = open - atr * 0.12;
        low = Math.min(open, close) - atr * 0.25;
        high = Math.max(open, close) + atr * 0.2;
      } else if (tailIdx === 8) {
        // Liquidity sweep wick below equal lows, closing strong back inside range
        low = open - atr * 1.15;
        close = open + atr * 0.32;
        high = close + atr * 0.18;
      } else if (tailIdx === 7 || tailIdx === 6) {
        // Strong institutional bullish displacement creating FVG & MSS
        close = open + atr * 0.92;
        low = open - atr * 0.12;
        high = close + atr * 0.22;
      } else if (tailIdx >= 3) {
        // Controlled retracement toward FVG / POI zone
        close = open - atr * 0.24;
        high = open + atr * 0.14;
        low = close - atr * 0.16;
      } else {
        // Bullish rejection & stabilization from POI
        close = open + atr * 0.22;
        low = open - atr * 0.18;
        high = close + atr * 0.15;
      }
    } else if (scenario.bias === 'BEAR_SWEEP') {
      // Structured bearish setup: buy-side liquidity sweep -> bearish MSS displacement -> pullback into FVG
      if (tailIdx >= 9) {
        close = open + atr * 0.12;
        high = Math.max(open, close) + atr * 0.25;
        low = Math.min(open, close) - atr * 0.2;
      } else if (tailIdx === 8) {
        // Buy-side sweep wick above highs, closing weak
        high = open + atr * 1.15;
        close = open - atr * 0.34;
        low = close - atr * 0.18;
      } else if (tailIdx === 7 || tailIdx === 6) {
        // Strong bearish displacement & MSS break
        close = open - atr * 0.92;
        high = open + atr * 0.12;
        low = close - atr * 0.22;
      } else if (tailIdx >= 3) {
        // Retracement into bearish FVG / OB
        close = open + atr * 0.24;
        low = open - atr * 0.14;
        high = close + atr * 0.16;
      } else {
        // Bearish rejection & continuation close
        close = open - atr * 0.22;
        high = open + atr * 0.18;
        low = close - atr * 0.15;
      }
    } else {
      // RANGE_CHOP: Tight non-directional compression (deliberately triggers I6 NO_TRADE)
      const chop = (i % 2 === 0 ? 1 : -1) * atr * 0.18;
      close = open + chop;
      high = Math.max(open, close) + atr * 0.16;
      low = Math.min(open, close) - atr * 0.16;
    }

    const bar: CandleBar = {
      time,
      open: roundToDecimals(open, spec.decimals),
      high: roundToDecimals(Math.max(high, open, close), spec.decimals),
      low: roundToDecimals(Math.min(low, open, close), spec.decimals),
      close: roundToDecimals(close, spec.decimals),
      volume: Math.round(1200 + rand() * 3400 + (tailIdx <= 8 && tailIdx >= 6 ? 2800 : 0)),
    };

    bars.push(bar);
    price = bar.close;
  }

  return bars;
}

/**
 * Generates an HTF (1H aggregated) view from 15m bars for the `Space` HTF toggle.
 */
export function aggregateToHtfCandles(bars: readonly CandleBar[], groupSize: number = 4): CandleBar[] {
  const result: CandleBar[] = [];
  for (let i = 0; i < bars.length; i += groupSize) {
    const slice = bars.slice(i, i + groupSize);
    if (slice.length === 0) continue;
    const first = slice[0];
    const last = slice[slice.length - 1];
    let high = first.high;
    let low = first.low;
    let volume = 0;
    for (const b of slice) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume;
    }
    result.push({
      time: first.time,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });
  }
  return result;
}

/**
 * Computes next live tick deterministically bounded around active price.
 */
export function stepDeterministicTick(
  asset: AssetSymbol,
  currentPrice: number,
  stepIndex: number
): { price: number; bid: number; ask: number; spread: number } {
  const spec = ASSET_SPECS[asset];
  // Smooth quasi-periodic micro-oscillation so live feed moves authentically without runaway drift
  const micro =
    Math.sin(stepIndex * 0.73 + ASSET_SEEDS[asset] * 0.001) * spec.atrBaseline * 0.045 +
    Math.cos(stepIndex * 1.41) * spec.atrBaseline * 0.025;
  const nextPrice = roundToDecimals(
    Math.max(spec.tickSize * 10, currentPrice + micro),
    spec.decimals
  );
  const halfSpread = Math.max(spec.tickSize, roundToDecimals(spec.atrBaseline * 0.012, spec.decimals));
  const bid = roundToDecimals(nextPrice - halfSpread, spec.decimals);
  const ask = roundToDecimals(nextPrice + halfSpread, spec.decimals);
  const spread = roundToDecimals(ask - bid, spec.decimals);
  return { price: nextPrice, bid, ask, spread };
}
