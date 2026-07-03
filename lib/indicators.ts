import { IndicatorSnapshot, OhlcvBar } from "./types";

// ---------------------------------------------------------------------------
// All functions below are "causal": the value at index i depends only on
// data at indices <= i. This matters a lot for backtesting — if a value at
// index i could see future data, any backtest built on top of it would be
// silently cheating (lookahead bias) and its stats would be meaningless.
// ---------------------------------------------------------------------------

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    if (i >= period - 1) out[i] = windowSum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values, standard convention.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    // Wilder's smoothing
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MacdResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== null && s !== null ? f - s : null;
  });

  // EMA of the MACD line, but only over the contiguous stretch where it's non-null.
  const firstValid = macdLine.findIndex((v) => v !== null);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  if (firstValid !== -1) {
    const validSlice = macdLine.slice(firstValid) as number[];
    const signalOnSlice = ema(validSlice, signalPeriod);
    for (let i = 0; i < signalOnSlice.length; i++) {
      signalLine[firstValid + i] = signalOnSlice[i];
    }
  }

  const histogram: (number | null)[] = macdLine.map((v, i) => {
    const s = signalLine[i];
    return v !== null && s !== null ? v - s : null;
  });

  return { macd: macdLine, signal: signalLine, histogram };
}

export interface BollingerResult {
  upper: (number | null)[];
  lower: (number | null)[];
  percentB: (number | null)[];
}

export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): BollingerResult {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  const percentB: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = 0; i < closes.length; i++) {
    const mid = middle[i];
    if (mid === null || i < period - 1) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (closes[j] - mid) ** 2;
    const stdDev = Math.sqrt(sumSq / period);
    const u = mid + stdDevMultiplier * stdDev;
    const l = mid - stdDevMultiplier * stdDev;
    upper[i] = u;
    lower[i] = l;
    percentB[i] = u === l ? 0.5 : (closes[i] - l) / (u - l);
  }
  return { upper, lower, percentB };
}

export function atr(bars: OhlcvBar[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < 2) return out;
  const trueRanges: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const highLow = bars[i].high - bars[i].low;
    const highPrevClose = Math.abs(bars[i].high - bars[i - 1].close);
    const lowPrevClose = Math.abs(bars[i].low - bars[i - 1].close);
    trueRanges[i] = Math.max(highLow, highPrevClose, lowPrevClose);
  }
  // Wilder's smoothing, same pattern as RSI.
  if (bars.length < period + 1) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRanges[i];
  let prevAtr = sum / period;
  out[period] = prevAtr;
  for (let i = period + 1; i < bars.length; i++) {
    prevAtr = (prevAtr * (period - 1) + trueRanges[i]) / period;
    out[i] = prevAtr;
  }
  return out;
}

export function rateOfChange(closes: number[], period = 10): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const past = closes[i - period];
    if (past !== 0) out[i] = ((closes[i] - past) / past) * 100;
  }
  return out;
}

/** 5-day average volume divided by 20-day average volume. */
export function volumeRatio(volumes: number[]): (number | null)[] {
  const avg5 = sma(volumes, 5);
  const avg20 = sma(volumes, 20);
  return volumes.map((_, i) => {
    const a5 = avg5[i];
    const a20 = avg20[i];
    return a5 !== null && a20 !== null && a20 !== 0 ? a5 / a20 : null;
  });
}

export interface FullIndicatorSeries {
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  ema12: (number | null)[];
  ema26: (number | null)[];
  rsi14: (number | null)[];
  macd: (number | null)[];
  macdSignal: (number | null)[];
  macdHistogram: (number | null)[];
  bollingerUpper: (number | null)[];
  bollingerLower: (number | null)[];
  bollingerPercentB: (number | null)[];
  atr14: (number | null)[];
  roc10: (number | null)[];
  volumeRatio: (number | null)[];
}

/** Computes every indicator series once, for reuse by signals/backtest/ML. */
export function computeAllIndicators(bars: OhlcvBar[]): FullIndicatorSeries {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const macdResult = macd(closes);
  const bb = bollingerBands(closes);

  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema12: ema(closes, 12),
    ema26: ema(closes, 26),
    rsi14: rsi(closes, 14),
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    bollingerUpper: bb.upper,
    bollingerLower: bb.lower,
    bollingerPercentB: bb.percentB,
    atr14: atr(bars, 14),
    roc10: rateOfChange(closes, 10),
    volumeRatio: volumeRatio(volumes),
  };
}

export function snapshotAt(
  series: FullIndicatorSeries,
  i: number
): IndicatorSnapshot {
  return {
    sma20: series.sma20[i],
    sma50: series.sma50[i],
    sma200: series.sma200[i],
    ema12: series.ema12[i],
    ema26: series.ema26[i],
    rsi14: series.rsi14[i],
    macd: series.macd[i],
    macdSignal: series.macdSignal[i],
    macdHistogram: series.macdHistogram[i],
    bollingerUpper: series.bollingerUpper[i],
    bollingerLower: series.bollingerLower[i],
    bollingerPercentB: series.bollingerPercentB[i],
    atr14: series.atr14[i],
    roc10: series.roc10[i],
    volumeRatio: series.volumeRatio[i],
  };
}
