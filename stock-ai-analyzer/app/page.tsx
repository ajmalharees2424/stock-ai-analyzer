"use client";

import { useState, type FormEvent } from "react";
import PriceChart from "@/components/PriceChart";
import type { AnalyzeErrorResponse, AnalyzeResponse, SignalLabel } from "@/lib/types";

const LABEL_STYLES: Record<SignalLabel, string> = {
  "Strong Bullish": "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  Bullish: "text-emerald-400 border-emerald-500/25 bg-emerald-500/5",
  Neutral: "text-zinc-300 border-zinc-500/30 bg-zinc-500/5",
  Bearish: "text-rose-400 border-rose-500/25 bg-rose-500/5",
  "Strong Bearish": "text-rose-400 border-rose-500/40 bg-rose-500/10",
};

function pct(x: number | null, digits = 1): string {
  return x === null ? "—" : `${(x * 100).toFixed(digits)}%`;
}

function num(x: number | null, digits = 2): string {
  return x === null ? "—" : x.toFixed(digits);
}

function signedPct(x: number | null, digits = 1): string {
  if (x === null) return "—";
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

function isErrorResponse(json: AnalyzeResponse | AnalyzeErrorResponse): json is AnalyzeErrorResponse {
  return "error" in json;
}

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeResponse | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = ticker.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`/api/analyze?ticker=${encodeURIComponent(trimmed)}`);
      const json: AnalyzeResponse | AnalyzeErrorResponse = await res.json();
      if (!res.ok || isErrorResponse(json)) {
        setError(isErrorResponse(json) ? json.error : "Something went wrong.");
      } else {
        setData(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const cbs = data?.backtest.currentBucketStat ?? null;
  const hasReliableBacktestMatch =
    cbs !== null && cbs.occurrences > 0 && cbs.winRate !== null && cbs.avgForwardReturnPercent !== null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Stock Signal Analyzer</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Technical indicators + a trained ML model + news sentiment, combined into one signal — backed by a
          historical backtest of that signal on the stock&apos;s own price history.
        </p>
      </header>

      <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
        Educational tool, not financial advice. No model predicts stock prices with certainty — see the full
        disclaimer at the bottom of each result.
      </div>

      <form onSubmit={handleSubmit} className="mb-8 flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Ticker, e.g. AAPL"
          aria-label="Stock ticker symbol"
          maxLength={10}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={loading || !ticker.trim()}
          className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black transition-opacity disabled:opacity-40"
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <section>
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">{data.ticker}</h2>
              <span className="text-sm text-zinc-400">as of {data.asOf}</span>
            </div>
            <div className="mt-1 text-3xl font-bold">${data.latestPrice.toFixed(2)}</div>
            <p className="mt-1 text-xs text-zinc-500">
              {data.dataPoints.toLocaleString()} trading days of history loaded.
            </p>
          </section>

          <section>
            <PriceChart data={data.priceHistory} />
          </section>

          <section className={`rounded-xl border p-4 ${LABEL_STYLES[data.ruleBasedSignal.label]}`}>
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{data.ruleBasedSignal.label}</span>
              <span className="text-sm">Signal strength: {data.ruleBasedSignal.strengthPercent}%</span>
            </div>
            <p className="mt-2 text-xs opacity-80">{data.ruleBasedSignal.convention}</p>
            <div className="mt-4 space-y-2.5">
              {data.ruleBasedSignal.components.map((c) => (
                <div key={c.name} className="text-xs">
                  <div className="flex justify-between font-medium">
                    <span>{c.name}</span>
                    <span>
                      {c.score >= 0 ? "+" : ""}
                      {c.score.toFixed(2)} · weight {(c.weight * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="opacity-70">{c.note}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">
              Historical backtest ({data.backtest.forwardDays}-day forward return)
            </h3>
            {hasReliableBacktestMatch && cbs ? (
              <p className="text-sm text-zinc-300">
                When this stock&apos;s technical signal was <strong>{cbs.label}</strong> in the past (
                {cbs.occurrences} occurrences across {data.backtest.totalHistoricalDays} trading days analyzed),
                price was higher {data.backtest.forwardDays} trading days later in{" "}
                <strong>{pct(cbs.winRate, 0)}</strong> of cases, with an average forward return of{" "}
                <strong>{signedPct(cbs.avgForwardReturnPercent, 1)}</strong>.
              </p>
            ) : (
              <p className="text-sm text-zinc-400">
                Not enough historical occurrences of this exact signal to report a reliable win rate yet.
              </p>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs text-zinc-400">
                <thead>
                  <tr className="border-b border-zinc-800 text-left">
                    <th className="py-1 pr-2 font-medium">Signal</th>
                    <th className="py-1 pr-2 text-right font-medium">Occurrences</th>
                    <th className="py-1 pr-2 text-right font-medium">Win rate</th>
                    <th className="py-1 text-right font-medium">Avg return</th>
                  </tr>
                </thead>
                <tbody>
                  {data.backtest.buckets.map((b) => (
                    <tr key={b.label} className="border-b border-zinc-900">
                      <td className="py-1 pr-2">{b.label}</td>
                      <td className="py-1 pr-2 text-right">{b.occurrences}</td>
                      <td className="py-1 pr-2 text-right">{pct(b.winRate, 0)}</td>
                      <td className="py-1 text-right">{signedPct(b.avgForwardReturnPercent, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{data.backtest.disclaimer}</p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">
              ML model ({data.mlModel.forwardDays}-day direction)
            </h3>
            {data.mlModel.trained ? (
              <div className="space-y-1">
                <p className="text-sm text-zinc-300">
                  Predicted probability price is higher in {data.mlModel.forwardDays} trading days:{" "}
                  <strong>{pct(data.mlModel.currentPredictionProbabilityUp, 0)}</strong>
                </p>
                <p className="text-xs text-zinc-400">
                  Out-of-sample accuracy: <strong>{pct(data.mlModel.outOfSampleAccuracy, 1)}</strong> on{" "}
                  {data.mlModel.testSamples} held-out test days (vs.{" "}
                  {pct(data.mlModel.outOfSampleBaseline, 1)} baseline from always guessing the majority class) —
                  trained on {data.mlModel.trainSamples} prior days.
                </p>
                <p className="text-[11px] leading-relaxed text-zinc-600">{data.mlModel.note}</p>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">{data.mlModel.reason}</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">News sentiment</h3>
            {data.sentiment.available ? (
              <p className="text-sm text-zinc-300">
                {data.sentiment.label} (score {num(data.sentiment.averageScore, 2)}) across{" "}
                {data.sentiment.articleCount} recent articles.
              </p>
            ) : (
              <p className="text-sm text-zinc-400">Unavailable — {data.sentiment.reason}</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">Raw indicator values</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400 sm:grid-cols-3">
              <div>SMA20: {num(data.indicators.sma20)}</div>
              <div>SMA50: {num(data.indicators.sma50)}</div>
              <div>SMA200: {num(data.indicators.sma200)}</div>
              <div>EMA12: {num(data.indicators.ema12)}</div>
              <div>EMA26: {num(data.indicators.ema26)}</div>
              <div>RSI(14): {num(data.indicators.rsi14, 1)}</div>
              <div>MACD: {num(data.indicators.macd, 3)}</div>
              <div>MACD signal: {num(data.indicators.macdSignal, 3)}</div>
              <div>MACD hist: {num(data.indicators.macdHistogram, 3)}</div>
              <div>Bollinger upper: {num(data.indicators.bollingerUpper)}</div>
              <div>Bollinger lower: {num(data.indicators.bollingerLower)}</div>
              <div>Bollinger %B: {num(data.indicators.bollingerPercentB, 2)}</div>
              <div>ATR(14): {num(data.indicators.atr14)}</div>
              <div>ROC(10): {num(data.indicators.roc10, 2)}%</div>
              <div>Vol ratio (5d/20d): {num(data.indicators.volumeRatio, 2)}</div>
            </div>
          </section>

          <p className="border-t border-zinc-800 pt-4 text-[11px] leading-relaxed text-zinc-600">
            {data.disclaimer}
          </p>
        </div>
      )}
    </main>
  );
}
