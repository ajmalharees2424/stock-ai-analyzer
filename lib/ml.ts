import { FullIndicatorSeries } from "./indicators";
import {
  evaluateAccuracy,
  majorityBaselineAccuracy,
  predictProbability,
  trainLogisticRegression,
} from "./logisticRegression";
import { MlModelResult, OhlcvBar } from "./types";

const FEATURE_NAMES = [
  "RSI(14)",
  "MACD histogram (% of price)",
  "Price vs SMA20 (%)",
  "Price vs SMA50 (%)",
  "Bollinger %B",
  "Volume ratio (5d/20d avg)",
  "ROC(10)",
  "ATR(14) (% of price)",
];

const MIN_ROWS = 150; // need enough rows for a meaningful chronological train/test split
const TRAIN_FRACTION = 0.75;

function buildFeatureRow(bars: OhlcvBar[], series: FullIndicatorSeries, i: number): number[] | null {
  const price = bars[i].close;
  const rsi14 = series.rsi14[i];
  const macdHist = series.macdHistogram[i];
  const sma20 = series.sma20[i];
  const sma50 = series.sma50[i];
  const bb = series.bollingerPercentB[i];
  const volRatio = series.volumeRatio[i];
  const roc10 = series.roc10[i];
  const atr14 = series.atr14[i];

  if (
    rsi14 === null ||
    macdHist === null ||
    sma20 === null ||
    sma50 === null ||
    bb === null ||
    volRatio === null ||
    roc10 === null ||
    atr14 === null ||
    price === 0
  ) {
    return null;
  }

  return [
    rsi14,
    (macdHist / price) * 100,
    ((price - sma20) / sma20) * 100,
    ((price - sma50) / sma50) * 100,
    bb,
    volRatio,
    roc10,
    (atr14 / price) * 100,
  ];
}

/**
 * Trains a small logistic regression model fresh, on this ticker's own
 * history, to predict whether price will be higher `forwardDays` trading
 * days later. Uses a chronological (not random) 75/25 train/test split so
 * the reported accuracy is genuinely out-of-sample — the model is scored
 * only on data it never saw during training, and that data comes strictly
 * after the training window in time (no shuffling, which would leak future
 * information into training).
 */
export function runMlPipeline(bars: OhlcvBar[], series: FullIndicatorSeries, forwardDays = 10): MlModelResult {
  const closes = bars.map((b) => b.close);
  const rows: { x: number[]; y: number }[] = [];
  const lastLabelableIndex = closes.length - 1 - forwardDays;

  for (let i = 0; i <= lastLabelableIndex; i++) {
    const x = buildFeatureRow(bars, series, i);
    if (!x) continue;
    const y = closes[i + forwardDays] > closes[i] ? 1 : 0;
    rows.push({ x, y });
  }

  if (rows.length < MIN_ROWS) {
    return {
      trained: false,
      reason: `Only ${rows.length} valid historical rows available (need at least ${MIN_ROWS}). This usually means the ticker doesn't have enough trading history yet.`,
      forwardDays,
      trainSamples: 0,
      testSamples: 0,
      outOfSampleAccuracy: null,
      outOfSampleBaseline: null,
      currentPredictionProbabilityUp: null,
      featureNames: FEATURE_NAMES,
      note: "Model not trained.",
    };
  }

  const splitIdx = Math.floor(rows.length * TRAIN_FRACTION);
  const trainRows = rows.slice(0, splitIdx);
  const testRows = rows.slice(splitIdx);

  const model = trainLogisticRegression(
    trainRows.map((r) => r.x),
    trainRows.map((r) => r.y)
  );
  const outOfSampleAccuracy = evaluateAccuracy(
    model,
    testRows.map((r) => r.x),
    testRows.map((r) => r.y)
  );
  const outOfSampleBaseline = majorityBaselineAccuracy(testRows.map((r) => r.y));

  const liveFeatures = buildFeatureRow(bars, series, closes.length - 1);
  const currentPredictionProbabilityUp = liveFeatures ? predictProbability(model, liveFeatures) : null;

  return {
    trained: true,
    forwardDays,
    trainSamples: trainRows.length,
    testSamples: testRows.length,
    outOfSampleAccuracy,
    outOfSampleBaseline,
    currentPredictionProbabilityUp,
    featureNames: FEATURE_NAMES,
    note:
      "Logistic regression trained fresh on this ticker's own history (chronologically first 75%), scored on the most recent 25% it never trained on. Compare 'out-of-sample accuracy' to the baseline — if they're close, the model isn't adding much beyond guessing the majority class.",
  };
}
