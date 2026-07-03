# Stock Signal Analyzer

A quantitative stock analysis tool: technical indicators + a real (small, honestly-evaluated)
machine learning model + news sentiment, combined into one composite signal — backed by a
**backtest that shows the actual historical hit-rate** of that signal on the stock's own price
history.

## Read this first

**No system predicts stock prices with 100% accuracy — including this one.** If a tool with
genuine, consistent 100% accuracy existed, every trader would use it until the price moved to
erase the edge (this is the efficient market hypothesis, not a limitation of effort). Anything
claiming otherwise is either wrong or lying.

What this tool actually does, honestly:

- Computes standard technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ROC, volume)
  from real price history.
- Combines them into a composite Bullish/Bearish signal using a transparent, documented scoring
  convention (shown in the UI — it's trend-following, not mean-reversion; see the "convention"
  text under the signal).
- Trains a small logistic regression model **fresh, on each ticker's own history**, and reports
  its **out-of-sample accuracy** (measured on a chronological holdout it never trained on) —
  not a made-up confidence number.
- Runs a walk-forward backtest of the rule-based signal: "when this exact signal occurred before
  on this stock, price was higher N days later in X% of Y cases." Small sample sizes are called
  out explicitly rather than hidden.
- Pulls recent news sentiment for the ticker as an additional (optional) input.

This is a genuinely useful decision-support tool and a solid AI/quant portfolio project. It is
**not financial advice**, and it will not make you rich by itself. Treat every number it shows as
one input, not a verdict.

## How it works

```
app/api/analyze/route.ts    orchestrates everything below, returns one JSON response
lib/alphaVantage.ts         fetches daily price history + news sentiment (with error handling)
lib/indicators.ts           SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ROC, volume ratio
lib/signals.ts              combines indicators (+ sentiment) into a weighted composite signal
lib/backtest.ts             walks history day-by-day, checks forward returns per signal label
lib/logisticRegression.ts   small dependency-free logistic regression (gradient descent)
lib/ml.ts                   feature engineering + chronological train/test split + evaluation
app/page.tsx                UI: ticker input, chart, signal breakdown, backtest table, ML stats
scripts/selftest.ts         unit tests for all the math above, run against synthetic data
```

All indicator math is **causal** (a value at day *i* only ever depends on data up to day *i*),
which matters — without that, the backtest would be silently cheating with lookahead bias and
its stats would mean nothing. The self-test suite checks this and a lot more; see below.

## Setup

1. **Get a free API key**: https://www.alphavantage.co/support/#api-key (instant, no credit card).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Add your key locally**:
   ```bash
   cp .env.example .env.local
   # then edit .env.local and paste your key
   ```
4. **Run it**:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000, enter a ticker (e.g. `AAPL`, `MSFT`, `TSLA`), hit Analyze.

5. **(Optional) Run the self-test** — verifies all the math against synthetic data, no API key
   or network needed:
   ```bash
   npm run selftest
   ```

## Deploying to Vercel (via GitHub)

1. Push this project to a new GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. Go to https://vercel.com/new and import that GitHub repo.
3. Vercel auto-detects Next.js — no build config changes needed.
4. Before deploying (or right after, then redeploy), go to **Project Settings → Environment
   Variables** and add:
   - `ALPHA_VANTAGE_API_KEY` = your key
5. Deploy. That's it — the app is fully server-rendered on Vercel's infrastructure, no separate
   backend or database required.

## Important limitations (read before you trust any output)

- **Alpha Vantage's free tier is rate-limited** (historically 25 requests/day on the standard
  free key — check https://www.alphavantage.co/premium/ for current limits, they change this
  periodically). Each analysis uses 2 requests (price history + news sentiment). Server-side
  responses are cached for an hour per ticker (via Next.js's fetch cache) to help stretch this.
  If you see a rate-limit error, that's Alpha Vantage, not a bug — wait or upgrade your key.
- **This uses `TIME_SERIES_DAILY` (unadjusted close)**, not the split/dividend-adjusted endpoint,
  because the adjusted endpoint has at times been restricted to paid Alpha Vantage plans. If you
  have a premium key, you can switch `lib/alphaVantage.ts` to `TIME_SERIES_DAILY_ADJUSTED` for
  more accurate long-term history around stock splits.
- **The backtest and ML model are only as good as available history.** Recently-listed stocks
  will show fewer (or zero) backtest occurrences and the ML model will decline to train — this
  is intentional graceful degradation, not a bug. It's more honest than faking a result.
- **The scoring convention is a choice, not a law of nature.** This tool treats momentum pushing
  toward highs as bullish (trend-following). A mean-reversion trader would read some of the same
  numbers the opposite way. There's no universally "correct" interpretation in technical analysis
  — this tool just tells you plainly which one it's using.
- **Markets change regimes.** A signal that historically worked on a stock can simply stop
  working going forward. The backtest describes the past, not a guarantee about the future.

## Possible extensions

- Add more tickers to a watchlist view (would need a small database — Vercel Postgres or similar
  — since this app currently has no persistence layer by design, to keep deployment simple).
- Swap the news sentiment source or add a second provider for cross-validation.
- Expand the ML feature set (e.g. sector-relative strength, options-implied volatility) — the
  pipeline in `lib/ml.ts` is written to make adding features straightforward.
- Add authentication + saved analyses if this becomes a multi-user product rather than a personal
  tool.
