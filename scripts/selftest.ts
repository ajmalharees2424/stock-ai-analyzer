/**
 * Self-test for the analysis pipeline, run against SYNTHETIC price data.
 * This does not call Alpha Vantage — it exists to catch bugs in the math
 * itself (indicators, scoring, backtest, ML) independent of the network.
 *
 * Run with: npm run selftest
 */
import { atr, bollingerBands, computeAllIndicators, ema, macd, rsi, sma } from "../lib/indicators";
import {
  evaluateAccuracy,
  majorityBaselineAccuracy,
  predictProbability,
  trainLogisticRegression,
} from "../lib/logisticRegression";
import { runMlPipeline } from "../lib/ml";
import { backtestRuleBasedSignal } from "../lib/backtest";
import { computeCompositeSignal, scoreToLabel } from "../lib/signals";
import { OhlcvBar } from "../lib/types";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (!condition) {
    failures++;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  ok:   ${message}`);
  }
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Generates a plausible-looking daily OHLCV series with a mild upward drift + noise. */
function generateSyntheticBars(days: number, seed: number, drift = 0.0003): OhlcvBar[] {
  const rand = seededRandom(seed);
  const bars: OhlcvBar[] = [];
  let price = 100;
  const start = new Date("2018-01-01T00:00:00Z");

  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + Math.floor((i * 7) / 5)); // skip weekends roughly
    const changePct = drift + (rand() - 0.5) * 0.03;
    const open = price;
    price = Math.max(1, price * (1 + changePct));
    const close = price;
    const high = Math.max(open, close) * (1 + rand() * 0.01);
    const low = Math.min(open, close) * (1 - rand() * 0.01);
    const volume = 1_000_000 + rand() * 500_000;
    bars.push({ date: date.toISOString().slice(0, 10), open, high, low, close, volume });
  }
  return bars;
}

/** Generates a series with a hard, learnable pattern: label = 1 iff a synthetic "momentum" feature is positive. */
function generateSeparableClassificationData(n: number, seed: number) {
  const rand = seededRandom(seed);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const f1 = (rand() - 0.5) * 10;
    const f2 = (rand() - 0.5) * 10;
    const noise = (rand() - 0.5) * 0.5;
    X.push([f1, f2]);
    y.push(f1 + f2 + noise > 0 ? 1 : 0);
  }
  return { X, y };
}

function generateRandomLabels(n: number, seed: number) {
  const rand = seededRandom(seed);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    X.push([rand() * 10, rand() * 10]);
    y.push(rand() > 0.5 ? 1 : 0);
  }
  return { X, y };
}

console.log("--- Indicator math sanity checks ---");
{
  const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const sma3 = sma(closes, 3);
  assert(sma3[sma3.length - 1] === (18 + 19 + 20) / 3, "SMA(3) last value matches manual average");
  assert(sma3[0] === null && sma3[1] === null, "SMA has null for indices before the window fills");

  const ema5 = ema(closes, 5);
  assert(ema5[4] === (10 + 11 + 12 + 13 + 14) / 5, "EMA seed value equals SMA of first `period` values");
  assert(ema5[ema5.length - 1] !== null, "EMA has a value at the end of the series");

  const rsiVals = rsi(closes, 5); // monotonically increasing input -> RSI should be 100 (no losses)
  const lastRsi = rsiVals[rsiVals.length - 1];
  assert(lastRsi !== null && lastRsi > 99, "RSI on a monotonically increasing series approaches 100");

  const bars: OhlcvBar[] = closes.map((c, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: c - 0.2,
    high: c + 0.3,
    low: c - 0.3,
    close: c,
    volume: 1000,
  }));
  const atrVals = atr(bars, 5);
  assert(
    atrVals.every((v) => v === null || v > 0),
    "ATR values are positive (or null before warmup)"
  );

  const bb = bollingerBands(closes, 5, 2);
  for (let i = 0; i < closes.length; i++) {
    if (bb.upper[i] !== null && bb.lower[i] !== null) {
      assert((bb.upper[i] as number) >= (bb.lower[i] as number), `Bollinger upper >= lower at index ${i}`);
    }
  }

  // MACD's slow EMA (default period 26) needs at least 26 points before it can
  // produce anything, so build a longer synthetic close series for this check.
  const longCloses = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3));
  const m = macd(longCloses);
  assert(m.macd.some((v) => v !== null), "MACD line has at least some non-null values given enough data");
  assert(m.macd.slice(0, 25).every((v) => v === null), "MACD line is null before the slow EMA (26) warms up");
}

console.log("\n--- Composite signal label boundaries ---");
{
  assert(scoreToLabel(0.9) === "Strong Bullish", "score 0.9 -> Strong Bullish");
  assert(scoreToLabel(0.3) === "Bullish", "score 0.3 -> Bullish");
  assert(scoreToLabel(0) === "Neutral", "score 0 -> Neutral");
  assert(scoreToLabel(-0.3) === "Bearish", "score -0.3 -> Bearish");
  assert(scoreToLabel(-0.9) === "Strong Bearish", "score -0.9 -> Strong Bearish");

  const allBullish = computeCompositeSignal({
    price: 110,
    sma50: 100,
    sma200: 95,
    rsi14: 65,
    macdHistogram: 0.5,
    bollingerPercentB: 0.9,
    recentReturn5d: 0.03,
    volumeRatio: 1.4,
    sentimentScore: 0.4,
  });
  assert(allBullish.score > 0, "all-bullish inputs produce a positive composite score");
  assert(
    Math.abs(allBullish.components.reduce((s, c) => s + c.weight, 0) - 1) < 1e-9,
    "component weights sum to 1 when all components are available"
  );

  const missingData = computeCompositeSignal({
    price: 50,
    sma50: null,
    sma200: null,
    rsi14: null,
    macdHistogram: null,
    bollingerPercentB: null,
    recentReturn5d: null,
    volumeRatio: null,
    sentimentScore: 0.2,
  });
  assert(missingData.score === missingData.components.find((c) => c.name === "News Sentiment")!.score * 1, "with only sentiment available, composite score equals sentiment's contribution");
  assert(!Number.isNaN(missingData.score), "composite score is not NaN when most components are unavailable");
}

console.log("\n--- Logistic regression sanity checks ---");
{
  const { X: trainX, y: trainY } = generateSeparableClassificationData(400, 1);
  const { X: testX, y: testY } = generateSeparableClassificationData(150, 2);
  const model = trainLogisticRegression(trainX, trainY);
  const acc = evaluateAccuracy(model, testX, testY);
  assert(acc > 0.85, `logistic regression learns a clearly separable pattern (accuracy ${acc.toFixed(2)} > 0.85)`);

  const p = predictProbability(model, [5, 5]);
  assert(p > 0.5, "model predicts high probability for an input strongly on the positive side");

  const { X: randX, y: randY } = generateRandomLabels(400, 3);
  const { X: randTestX, y: randTestY } = generateRandomLabels(150, 4);
  const randModel = trainLogisticRegression(randX, randY);
  const randAcc = evaluateAccuracy(randModel, randTestX, randTestY);
  assert(
    randAcc < 0.7,
    `logistic regression does NOT find fake structure in random labels (accuracy ${randAcc.toFixed(2)} < 0.7 -- if this fails, suspect a label-leakage bug)`
  );

  const baseline = majorityBaselineAccuracy(randTestY);
  assert(baseline >= 0.5 && baseline <= 0.65, `majority baseline on ~balanced random labels is close to 0.5 (got ${baseline.toFixed(2)})`);
}

console.log("\n--- End-to-end pipeline on synthetic OHLCV data ---");
{
  const bars = generateSyntheticBars(1500, 42);
  assert(bars.length === 1500, "generated the requested number of synthetic bars");
  assert(
    bars.every((b) => b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close),
    "every synthetic bar has internally consistent OHLC (high is the max, low is the min)"
  );

  const series = computeAllIndicators(bars);
  assert(series.sma20.length === bars.length, "indicator series length matches input length");
  const lastRsi = series.rsi14[series.rsi14.length - 1];
  assert(lastRsi !== null && lastRsi >= 0 && lastRsi <= 100, "final RSI value is within [0, 100]");

  const backtest = backtestRuleBasedSignal(bars, series, 20, 50);
  const totalOccurrences = backtest.buckets.reduce((s, b) => s + b.occurrences, 0);
  assert(totalOccurrences === backtest.totalHistoricalDays, "backtest bucket occurrences sum to total historical days walked");
  for (const b of backtest.buckets) {
    if (b.winRate !== null) assert(b.winRate >= 0 && b.winRate <= 1, `${b.label} win rate is a valid fraction`);
  }

  const ml = runMlPipeline(bars, series, 10);
  assert(ml.trained === true, "ML pipeline trains successfully with 1500 days of synthetic history");
  if (ml.trained) {
    assert(ml.trainSamples > 0 && ml.testSamples > 0, "ML pipeline produced non-empty train and test sets");
    assert(
      ml.outOfSampleAccuracy !== null && ml.outOfSampleAccuracy >= 0 && ml.outOfSampleAccuracy <= 1,
      "out-of-sample accuracy is a valid fraction"
    );
    assert(
      ml.currentPredictionProbabilityUp !== null &&
        ml.currentPredictionProbabilityUp >= 0 &&
        ml.currentPredictionProbabilityUp <= 1,
      "live prediction probability is a valid fraction"
    );
  }

  const tooShort = generateSyntheticBars(80, 7);
  const shortSeries = computeAllIndicators(tooShort);
  const mlShort = runMlPipeline(tooShort, shortSeries, 10);
  assert(mlShort.trained === false, "ML pipeline correctly refuses to train with too little history, instead of crashing or faking a result");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
