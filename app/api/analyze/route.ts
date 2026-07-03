import { NextRequest, NextResponse } from "next/server";
import { AlphaVantageError, fetchDailySeries, fetchNewsSentiment } from "@/lib/alphaVantage";
import { backtestRuleBasedSignal } from "@/lib/backtest";
import { computeAllIndicators, snapshotAt } from "@/lib/indicators";
import { runMlPipeline } from "@/lib/ml";
import { computeCompositeSignal } from "@/lib/signals";
import { AnalyzeResponse } from "@/lib/types";

export const runtime = "nodejs";

const DISCLAIMER =
  "Educational tool only — not financial advice. No system can predict stock prices with certainty; markets are influenced by unpredictable events, and if a tool with genuine 100% accuracy existed, trading on it would erase the edge instantly (the efficient market hypothesis). Everything here is a statistical signal with a measured, honestly-reported error rate — one input among many, not a guarantee.";

const TICKER_REGEX = /^[A-Za-z0-9.\-]{1,10}$/;
const MIN_BARS_REQUIRED = 60;
const BACKTEST_FORWARD_DAYS = 20;
const BACKTEST_MIN_INDEX = 50;
const ML_FORWARD_DAYS = 10;
const PRICE_HISTORY_POINTS = 180;

export async function GET(request: NextRequest) {
  const tickerParam = request.nextUrl.searchParams.get("ticker");

  if (!tickerParam || !TICKER_REGEX.test(tickerParam.trim())) {
    return NextResponse.json(
      {
        error:
          "Provide a valid ticker symbol, e.g. ?ticker=AAPL (letters, numbers, '.', '-' only, max 10 characters).",
      },
      { status: 400 }
    );
  }
  const ticker = tickerParam.trim().toUpperCase();

  try {
    const [bars, sentiment] = await Promise.all([fetchDailySeries(ticker), fetchNewsSentiment(ticker)]);

    if (bars.length < MIN_BARS_REQUIRED) {
      return NextResponse.json(
        {
          error: `Only ${bars.length} days of price history found for "${ticker}" — not enough to compute reliable indicators. Try a more established ticker.`,
        },
        { status: 422 }
      );
    }

    const series = computeAllIndicators(bars);
    const closes = bars.map((b) => b.close);
    const lastIndex = bars.length - 1;
    const recentReturn5dToday =
      lastIndex >= 5 ? (closes[lastIndex] - closes[lastIndex - 5]) / closes[lastIndex - 5] : null;

    const commonInputs = {
      price: closes[lastIndex],
      sma50: series.sma50[lastIndex],
      sma200: series.sma200[lastIndex],
      rsi14: series.rsi14[lastIndex],
      macdHistogram: series.macdHistogram[lastIndex],
      bollingerPercentB: series.bollingerPercentB[lastIndex],
      recentReturn5d: recentReturn5dToday,
      volumeRatio: series.volumeRatio[lastIndex],
    };

    // Technical-only version of today's signal, used purely to look up the
    // matching bucket in the backtest (which is itself technical-only,
    // since point-in-time historical sentiment isn't available).
    const technicalOnlySignalToday = computeCompositeSignal({ ...commonInputs, sentimentScore: null });

    // The signal actually shown to the user includes sentiment when available.
    const liveSignal = computeCompositeSignal({
      ...commonInputs,
      sentimentScore: sentiment.available ? sentiment.averageScore : null,
    });

    const backtest = backtestRuleBasedSignal(bars, series, BACKTEST_FORWARD_DAYS, BACKTEST_MIN_INDEX);
    backtest.currentBucketStat = backtest.buckets.find((b) => b.label === technicalOnlySignalToday.label) ?? null;

    const mlModel = runMlPipeline(bars, series, ML_FORWARD_DAYS);

    const priceHistory = bars.slice(-PRICE_HISTORY_POINTS).map((b) => ({ date: b.date, close: b.close }));

    const response: AnalyzeResponse = {
      ticker,
      asOf: bars[lastIndex].date,
      latestPrice: closes[lastIndex],
      dataPoints: bars.length,
      priceHistory,
      indicators: snapshotAt(series, lastIndex),
      ruleBasedSignal: liveSignal,
      backtest,
      mlModel,
      sentiment,
      disclaimer: DISCLAIMER,
    };

    return NextResponse.json(response);
  } catch (e) {
    const message =
      e instanceof AlphaVantageError ? e.message : `Unexpected error analyzing "${ticker}": ${(e as Error).message}`;
    const status = e instanceof AlphaVantageError ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
