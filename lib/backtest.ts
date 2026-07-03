import { FullIndicatorSeries } from "./indicators";
import { computeCompositeSignal } from "./signals";
import { BacktestBucketStat, BacktestResult, OhlcvBar, SignalLabel } from "./types";

const ALL_LABELS: SignalLabel[] = ["Strong Bullish", "Bullish", "Neutral", "Bearish", "Strong Bearish"];

/**
 * Walks through history day by day, computing what the TECHNICAL-ONLY
 * composite signal (no sentiment — point-in-time historical sentiment isn't
 * available from the API) would have said at each point, using only data
 * available up to that day. Then checks what actually happened `forwardDays`
 * trading days later. Results are grouped by signal label so you can see,
 * e.g., "when this exact stock showed a Bullish signal in the past, price
 * was higher 20 trading days later in X% of Y such occurrences."
 *
 * This is a walk-forward backtest, not a trained/optimized strategy — there
 * is no parameter fitting happening here, so there's no in-sample overfitting
 * risk in the usual sense. The main statistical caveat is sample size: a
 * label that only occurred a handful of times in the available history
 * produces a win rate that isn't trustworthy.
 */
export function backtestRuleBasedSignal(
  bars: OhlcvBar[],
  series: FullIndicatorSeries,
  forwardDays = 20,
  minIndex = 50
): BacktestResult {
  const closes = bars.map((b) => b.close);
  const bucketReturns: Record<SignalLabel, number[]> = {
    "Strong Bullish": [],
    Bullish: [],
    Neutral: [],
    Bearish: [],
    "Strong Bearish": [],
  };

  const lastUsableIndex = closes.length - 1 - forwardDays;
  let totalHistoricalDays = 0;

  for (let i = minIndex; i <= lastUsableIndex; i++) {
    const recentReturn5d = i >= 5 ? (closes[i] - closes[i - 5]) / closes[i - 5] : null;
    const composite = computeCompositeSignal({
      price: closes[i],
      sma50: series.sma50[i],
      sma200: series.sma200[i],
      rsi14: series.rsi14[i],
      macdHistogram: series.macdHistogram[i],
      bollingerPercentB: series.bollingerPercentB[i],
      recentReturn5d,
      volumeRatio: series.volumeRatio[i],
      sentimentScore: null,
    });
    const forwardReturn = (closes[i + forwardDays] - closes[i]) / closes[i];
    bucketReturns[composite.label].push(forwardReturn);
    totalHistoricalDays++;
  }

  const buckets: BacktestBucketStat[] = ALL_LABELS.map((label) => {
    const returns = bucketReturns[label];
    if (returns.length === 0) {
      return { label, occurrences: 0, winRate: null, avgForwardReturnPercent: null };
    }
    const wins = returns.filter((r) => r > 0).length;
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    return {
      label,
      occurrences: returns.length,
      winRate: wins / returns.length,
      avgForwardReturnPercent: avg * 100,
    };
  });

  return {
    forwardDays,
    totalHistoricalDays,
    buckets,
    currentBucketStat: null,
    disclaimer:
      "This shows what happened historically when THIS stock's own technical signal matched the current one — it is not a prediction. Small sample sizes (occurrences below ~20) make win rates unreliable. Markets change regimes; a pattern that held in the past can simply stop working.",
  };
}
