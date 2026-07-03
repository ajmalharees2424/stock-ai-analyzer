import { OhlcvBar, SentimentResult } from "./types";

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";

export class AlphaVantageError extends Error {}

function getApiKey(): string {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) {
    throw new AlphaVantageError(
      "Missing ALPHA_VANTAGE_API_KEY. Get a free key at https://www.alphavantage.co/support/#api-key and set it as an environment variable (locally in .env.local, or in your Vercel project settings)."
    );
  }
  return key;
}

interface RawDailySeriesResponse {
  "Time Series (Daily)"?: Record<
    string,
    { "1. open": string; "2. high": string; "3. low": string; "4. close": string; "5. volume": string }
  >;
  "Error Message"?: string;
  Note?: string;
  Information?: string;
}

/**
 * Alpha Vantage returns HTTP 200 even for errors/rate limits — the actual
 * signal is one of these keys in the JSON body. Checking for all three
 * covers invalid symbols, hitting the rate limit, and premium-endpoint
 * restrictions, which otherwise all look like "successful" empty responses.
 */
function checkForApiError(data: Record<string, unknown>, context: string): void {
  if (typeof data["Error Message"] === "string") {
    throw new AlphaVantageError(`Alpha Vantage error (${context}): ${data["Error Message"]}`);
  }
  if (typeof data["Note"] === "string") {
    throw new AlphaVantageError(`Alpha Vantage rate limit hit (${context}): ${data["Note"]}`);
  }
  if (typeof data["Information"] === "string") {
    throw new AlphaVantageError(`Alpha Vantage (${context}): ${data["Information"]}`);
  }
}

/**
 * Fetches full daily OHLCV history for a ticker, oldest-first.
 *
 * Uses TIME_SERIES_DAILY (unadjusted close) rather than
 * TIME_SERIES_DAILY_ADJUSTED, because the adjusted endpoint has at times
 * been restricted to paid Alpha Vantage plans — check
 * https://www.alphavantage.co/documentation/ if you have a premium key and
 * want split/dividend-adjusted prices instead.
 */
export async function fetchDailySeries(ticker: string): Promise<OhlcvBar[]> {
  const apiKey = getApiKey();
  const url = `${ALPHA_VANTAGE_BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
    ticker
  )}&outputsize=full&apikey=${apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate: 3600 } });
  } catch (e) {
    throw new AlphaVantageError(`Network error reaching Alpha Vantage: ${(e as Error).message}`);
  }

  if (!res.ok) {
    throw new AlphaVantageError(`Alpha Vantage HTTP error ${res.status} while fetching daily prices.`);
  }

  const data = (await res.json()) as RawDailySeriesResponse;
  checkForApiError(data as Record<string, unknown>, "daily prices");

  const series = data["Time Series (Daily)"];
  if (!series || Object.keys(series).length === 0) {
    throw new AlphaVantageError(`No price data returned for ticker "${ticker}". Check that the symbol is correct.`);
  }

  const bars: OhlcvBar[] = Object.entries(series).map(([date, v]) => ({
    date,
    open: parseFloat(v["1. open"]),
    high: parseFloat(v["2. high"]),
    low: parseFloat(v["3. low"]),
    close: parseFloat(v["4. close"]),
    volume: parseFloat(v["5. volume"]),
  }));

  bars.sort((a, b) => a.date.localeCompare(b.date)); // oldest first
  return bars;
}

interface RawTickerSentiment {
  ticker: string;
  relevance_score: string;
  ticker_sentiment_score: string;
}

interface RawNewsFeedItem {
  overall_sentiment_score: number;
  ticker_sentiment?: RawTickerSentiment[];
}

interface RawNewsSentimentResponse {
  feed?: RawNewsFeedItem[];
  "Error Message"?: string;
  Note?: string;
  Information?: string;
}

function sentimentScoreToLabel(score: number): string {
  if (score >= 0.35) return "Bullish";
  if (score >= 0.15) return "Somewhat-Bullish";
  if (score > -0.15) return "Neutral";
  if (score > -0.35) return "Somewhat-Bearish";
  return "Bearish";
}

/**
 * Fetches recent news sentiment for a ticker. Designed to fail *softly*:
 * any problem (missing key, rate limit, no articles found) returns
 * `available: false` with a reason instead of throwing, because the rest of
 * the analysis is still useful without sentiment — the composite signal
 * just redistributes that weight across the technical components.
 */
export async function fetchNewsSentiment(ticker: string): Promise<SentimentResult> {
  try {
    const apiKey = getApiKey();
    const url = `${ALPHA_VANTAGE_BASE_URL}?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(
      ticker
    )}&limit=50&apikey=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });

    if (!res.ok) {
      return {
        available: false,
        reason: `HTTP ${res.status} from the news sentiment endpoint.`,
        averageScore: null,
        label: null,
        articleCount: 0,
      };
    }

    const data = (await res.json()) as RawNewsSentimentResponse;
    const errorMsg = data["Error Message"] || data["Note"] || data["Information"];
    if (errorMsg) {
      return { available: false, reason: errorMsg, averageScore: null, label: null, articleCount: 0 };
    }

    const feed = data.feed;
    if (!feed || feed.length === 0) {
      return {
        available: false,
        reason: "No recent news articles found for this ticker.",
        averageScore: null,
        label: null,
        articleCount: 0,
      };
    }

    // Prefer relevance-weighted, ticker-specific sentiment when present;
    // fall back to the article's overall sentiment score otherwise.
    let weightedSum = 0;
    let weightTotal = 0;
    let simpleSum = 0;
    let simpleCount = 0;

    for (const item of feed) {
      if (typeof item.overall_sentiment_score === "number") {
        simpleSum += item.overall_sentiment_score;
        simpleCount += 1;
      }
      const tickerMatch = item.ticker_sentiment?.find((t) => t.ticker.toUpperCase() === ticker.toUpperCase());
      if (tickerMatch) {
        const relevance = parseFloat(tickerMatch.relevance_score);
        const score = parseFloat(tickerMatch.ticker_sentiment_score);
        if (!isNaN(relevance) && !isNaN(score) && relevance > 0) {
          weightedSum += score * relevance;
          weightTotal += relevance;
        }
      }
    }

    const averageScore = weightTotal > 0 ? weightedSum / weightTotal : simpleCount > 0 ? simpleSum / simpleCount : null;

    if (averageScore === null) {
      return {
        available: false,
        reason: "Articles were returned but none had a usable sentiment score.",
        averageScore: null,
        label: null,
        articleCount: simpleCount,
      };
    }

    return {
      available: true,
      averageScore,
      label: sentimentScoreToLabel(averageScore),
      articleCount: simpleCount,
    };
  } catch (e) {
    return { available: false, reason: (e as Error).message, averageScore: null, label: null, articleCount: 0 };
  }
}
