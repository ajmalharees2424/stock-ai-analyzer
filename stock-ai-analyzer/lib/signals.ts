import { ComponentScore, RuleBasedSignal, SignalLabel } from "./types";

function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function scoreToLabel(score: number): SignalLabel {
  if (score >= 0.5) return "Strong Bullish";
  if (score >= 0.15) return "Bullish";
  if (score > -0.15) return "Neutral";
  if (score > -0.5) return "Bearish";
  return "Strong Bearish";
}

// Base weights, used before redistribution when a component is unavailable.
// These sum to 1. Chosen to weight trend/momentum (the most information-dense,
// least noisy signals) higher than volume and sentiment.
const BASE_WEIGHTS = {
  trend: 0.3,
  momentum: 0.25,
  volatility: 0.15,
  volume: 0.1,
  sentiment: 0.2,
} as const;

export interface CompositeInputs {
  price: number;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macdHistogram: number | null;
  bollingerPercentB: number | null;
  recentReturn5d: number | null;
  volumeRatio: number | null;
  /** -1 (bearish) to 1 (bullish). Pass null when sentiment data isn't available (this is also how the backtest calls this function, since point-in-time historical sentiment isn't available from the API). */
  sentimentScore: number | null;
}

interface RawComponent {
  name: string;
  score: number | null;
  note: string;
}

function trendComponent(price: number, sma50: number | null, sma200: number | null): RawComponent {
  const parts: number[] = [];
  const notes: string[] = [];

  if (sma50 !== null && sma50 !== 0) {
    const pctFromSma50 = (price - sma50) / sma50;
    parts.push(clip(pctFromSma50 / 0.1, -1, 1));
    notes.push(`price is ${(pctFromSma50 * 100).toFixed(1)}% ${pctFromSma50 >= 0 ? "above" : "below"} SMA50`);
  }
  if (sma50 !== null && sma200 !== null && sma200 !== 0) {
    const pctSma50VsSma200 = (sma50 - sma200) / sma200;
    parts.push(clip(pctSma50VsSma200 / 0.05, -1, 1));
    notes.push(
      `SMA50 is ${(pctSma50VsSma200 * 100).toFixed(1)}% ${pctSma50VsSma200 >= 0 ? "above" : "below"} SMA200 (${
        pctSma50VsSma200 >= 0 ? "bullish" : "bearish"
      } structure)`
    );
  }
  if (parts.length === 0) return { name: "Trend", score: null, note: "Not enough history yet (need 50+ days)." };
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  return { name: "Trend", score, note: notes.join("; ") + "." };
}

function momentumComponent(rsi14: number | null, macdHistogram: number | null, price: number): RawComponent {
  const parts: number[] = [];
  const notes: string[] = [];

  if (rsi14 !== null) {
    parts.push(clip((rsi14 - 50) / 25, -1, 1));
    let zone = "";
    if (rsi14 >= 70) zone = " (overbought zone, watch for a pullback)";
    else if (rsi14 <= 30) zone = " (oversold zone, watch for a bounce)";
    notes.push(`RSI(14) is ${rsi14.toFixed(1)}${zone}`);
  }
  if (macdHistogram !== null && price !== 0) {
    const normalized = macdHistogram / price;
    parts.push(clip(normalized / 0.01, -1, 1));
    notes.push(`MACD histogram is ${macdHistogram >= 0 ? "positive" : "negative"} (${macdHistogram.toFixed(3)})`);
  }
  if (parts.length === 0) return { name: "Momentum", score: null, note: "Not enough history yet." };
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  return { name: "Momentum", score, note: notes.join("; ") + "." };
}

function volatilityPositionComponent(bollingerPercentB: number | null): RawComponent {
  if (bollingerPercentB === null) {
    return { name: "Volatility Position", score: null, note: "Not enough history yet (need 20+ days)." };
  }
  const score = clip((bollingerPercentB - 0.5) * 2, -1, 1);
  let position: string;
  if (bollingerPercentB >= 1) position = "at or above the upper Bollinger Band";
  else if (bollingerPercentB >= 0.5) position = "in the upper half of the Bollinger range";
  else if (bollingerPercentB > 0) position = "in the lower half of the Bollinger range";
  else position = "at or below the lower Bollinger Band";
  return {
    name: "Volatility Position",
    score,
    note: `Price is ${position} (%B = ${bollingerPercentB.toFixed(2)}).`,
  };
}

function volumeConfirmationComponent(recentReturn5d: number | null, volumeRatio: number | null): RawComponent {
  if (recentReturn5d === null || volumeRatio === null) {
    return { name: "Volume Confirmation", score: null, note: "Not enough history yet." };
  }
  const dirSign = recentReturn5d > 0 ? 1 : recentReturn5d < 0 ? -1 : 0;
  const confirmStrength = clip(volumeRatio - 1, 0, 1);
  const score = dirSign * confirmStrength;
  const volNote =
    volumeRatio > 1
      ? `5-day avg volume is ${volumeRatio.toFixed(2)}x the 20-day avg`
      : `5-day avg volume is below the 20-day avg (${volumeRatio.toFixed(2)}x, weak conviction)`;
  return {
    name: "Volume Confirmation",
    score,
    note: `${volNote}, over a ${recentReturn5d >= 0 ? "+" : ""}${(recentReturn5d * 100).toFixed(1)}% 5-day move.`,
  };
}

function sentimentComponent(sentimentScore: number | null): RawComponent {
  if (sentimentScore === null) {
    return { name: "News Sentiment", score: null, note: "Sentiment data unavailable for this request." };
  }
  const score = clip(sentimentScore, -1, 1);
  return { name: "News Sentiment", score, note: `Average recent news sentiment score: ${score.toFixed(2)}.` };
}

/**
 * Combines indicator + sentiment inputs into a single composite score in
 * [-1, 1] and a label. Any component whose inputs are unavailable (null) is
 * dropped, and its weight is redistributed proportionally across the
 * remaining components — so a fresh listing with no 200-day SMA yet still
 * gets a sensible signal instead of a crash or a silently-wrong zero.
 */
export function computeCompositeSignal(inputs: CompositeInputs): RuleBasedSignal {
  const raw: RawComponent[] = [
    trendComponent(inputs.price, inputs.sma50, inputs.sma200),
    momentumComponent(inputs.rsi14, inputs.macdHistogram, inputs.price),
    volatilityPositionComponent(inputs.bollingerPercentB),
    volumeConfirmationComponent(inputs.recentReturn5d, inputs.volumeRatio),
    sentimentComponent(inputs.sentimentScore),
  ];

  const weightKeys: (keyof typeof BASE_WEIGHTS)[] = ["trend", "momentum", "volatility", "volume", "sentiment"];
  const available = raw
    .map((r, idx) => ({ r, baseWeight: BASE_WEIGHTS[weightKeys[idx]] }))
    .filter((x) => x.r.score !== null);

  const totalAvailableWeight = available.reduce((s, x) => s + x.baseWeight, 0);

  const components: ComponentScore[] = raw.map((r, idx) => {
    const baseWeight = BASE_WEIGHTS[weightKeys[idx]];
    const isAvailable = r.score !== null;
    const normalizedWeight = isAvailable && totalAvailableWeight > 0 ? baseWeight / totalAvailableWeight : 0;
    return {
      name: r.name,
      score: r.score ?? 0,
      weight: normalizedWeight,
      note: r.note,
    };
  });

  let compositeScore = 0;
  if (totalAvailableWeight > 0) {
    for (const x of available) {
      const normalizedWeight = x.baseWeight / totalAvailableWeight;
      compositeScore += (x.r.score as number) * normalizedWeight;
    }
  }
  compositeScore = clip(compositeScore, -1, 1);

  return {
    label: scoreToLabel(compositeScore),
    score: compositeScore,
    strengthPercent: Math.round(Math.abs(compositeScore) * 100),
    components,
    convention:
      "This engine uses a trend-following convention: momentum pushing toward highs (elevated RSI, price near the upper Bollinger Band) is scored as bullish strength, not automatically flagged as 'overbought = sell'. A mean-reversion trader would weigh some of these the opposite way — there is no single universally-correct interpretation in technical analysis, and this tool is transparent about which one it uses.",
  };
}
