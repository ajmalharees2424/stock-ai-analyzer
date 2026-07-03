// lib/alphaVantage.ts
import { OhlcvBar, SentimentResult } from "./types";

const TWELVE_DATA_BASE = "https://api.twelvedata.com";

export class AlphaVantageError extends Error {}

function getApiKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) {
    throw new AlphaVantageError(
      "Missing TWELVE_DATA_API_KEY. Get a free key at https://twelvedata.com/ and set it as an environment variable."
    );
  }
  return key;
}

export async function fetchDailySeries(ticker: string): Promise<OhlcvBar[]> {
  const apiKey = getApiKey();
  const url = `${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(
    ticker
  )}&interval=1day&outputsize=5000&apikey=${apiKey}`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new AlphaVantageError(`Twelve Data HTTP error ${res.status} while fetching daily prices.`);
  }

  const data = await res.json();

  if (data.status === "error") {
    throw new AlphaVantageError(`Twelve Data error: ${data.message}`);
  }

  if (!data.values || data.values.length === 0) {
    throw new AlphaVantageError(`No price data returned for ticker "${ticker}". Check the symbol.`);
  }

  // Twelve Data returns newest first – we want oldest first.
  const sorted = data.values.slice().reverse();

  return sorted.map((bar: any) => ({
    date: bar.datetime.slice(0, 10),
    open: parseFloat(bar.open),
    high: parseFloat(bar.high),
    low: parseFloat(bar.low),
    close: parseFloat(bar.close),
    volume: parseFloat(bar.volume),
  }));
}

export async function fetchNewsSentiment(ticker: string): Promise<SentimentResult> {
  try {
    const apiKey = getApiKey();
    const url = `${TWELVE_DATA_BASE}/news?symbol=${encodeURIComponent(
      ticker
    )}&limit=50&apikey=${apiKey}`;

    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return {
        available: false,
        reason: `HTTP ${res.status} from Twelve Data news endpoint.`,
        averageScore: null,
        label: null,
        articleCount: 0,
      };
    }

    const data = await res.json();

    if (data.status === "error") {
      return {
        available: false,
        reason: data.message,
        averageScore: null,
        label: null,
        articleCount: 0,
      };
    }

    const articles = data.news || [];
    if (articles.length === 0) {
      return {
        available: false,
        reason: "No recent news articles found for this ticker.",
        averageScore: null,
        label: null,
        articleCount: 0,
      };
    }

    let sum = 0;
    let count = 0;
    for (const article of articles) {
      if (article.sentiment !== undefined && article.sentiment !== null) {
        sum += parseFloat(article.sentiment);
        count++;
      }
    }

    if (count === 0) {
      return {
        available: false,
        reason: "Articles returned but none had a sentiment score.",
        averageScore: null,
        label: null,
        articleCount: articles.length,
      };
    }

    const averageScore = sum / count;
    const label =
      averageScore >= 0.35
        ? "Bullish"
        : averageScore >= 0.15
        ? "Somewhat-Bullish"
        : averageScore > -0.15
        ? "Neutral"
        : averageScore > -0.35
        ? "Somewhat-Bearish"
        : "Bearish";

    return {
      available: true,
      averageScore,
      label,
      articleCount: count,
    };
  } catch (e) {
    return {
      available: false,
      reason: (e as Error).message,
      averageScore: null,
      label: null,
      articleCount: 0,
    };
  }
}
