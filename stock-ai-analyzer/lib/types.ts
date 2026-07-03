// Shared types used across the analysis pipeline.
// Kept in one file so the API route, lib modules, and UI components
// all agree on the exact same shapes.

export interface OhlcvBar {
  date: string; // ISO date, e.g. "2024-03-01"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SignalLabel =
  | "Strong Bullish"
  | "Bullish"
  | "Neutral"
  | "Bearish"
  | "Strong Bearish";

export interface IndicatorSnapshot {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  bollingerPercentB: number | null;
  atr14: number | null;
  roc10: number | null;
  volumeRatio: number | null; // 5-day avg volume / 20-day avg volume
}

export interface ComponentScore {
  name: string;
  score: number; // -1 (bearish) to 1 (bullish)
  weight: number; // normalized weight actually used (0-1, sums to 1 across components)
  note: string;
}

export interface RuleBasedSignal {
  label: SignalLabel;
  score: number; // weighted composite, -1 to 1
  strengthPercent: number; // 0-100, = round(abs(score) * 100)
  components: ComponentScore[];
  convention: string;
}

export interface BacktestBucketStat {
  label: SignalLabel;
  occurrences: number;
  winRate: number | null; // fraction of occurrences with positive forward return
  avgForwardReturnPercent: number | null;
}

export interface BacktestResult {
  forwardDays: number;
  totalHistoricalDays: number;
  buckets: BacktestBucketStat[];
  currentBucketStat: BacktestBucketStat | null;
  disclaimer: string;
}

export interface MlModelResult {
  trained: boolean;
  reason?: string; // present when trained === false
  forwardDays: number;
  trainSamples: number;
  testSamples: number;
  outOfSampleAccuracy: number | null; // 0-1, measured on held-out chronological test set
  outOfSampleBaseline: number | null; // accuracy of always predicting the majority class in test set
  currentPredictionProbabilityUp: number | null; // 0-1
  featureNames: string[];
  note: string;
}

export interface SentimentResult {
  available: boolean;
  reason?: string;
  averageScore: number | null; // roughly -1 (bearish) to 1 (bullish), Alpha Vantage scale
  label: string | null;
  articleCount: number;
}

export interface AnalyzeResponse {
  ticker: string;
  asOf: string;
  latestPrice: number;
  dataPoints: number;
  priceHistory: { date: string; close: number }[];
  indicators: IndicatorSnapshot;
  ruleBasedSignal: RuleBasedSignal;
  backtest: BacktestResult;
  mlModel: MlModelResult;
  sentiment: SentimentResult;
  disclaimer: string;
}

export interface AnalyzeErrorResponse {
  error: string;
}
