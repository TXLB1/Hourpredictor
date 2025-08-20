# Hourly Crypto Prognosis — PWA (iPhone friendly)

A single‑page Progressive Web App (PWA) that fetches live Binance data and produces an **hourly UP/DOWN/ABSTAIN** prognosis for BTC/ETH/XRP/SOL. It updates every minute and **abstains** when confidence is below your chosen threshold.

> **No financial advice. Educational use only.**

## Why this is iPhone‑friendly
- Runs entirely in Safari (no install from App Store needed).
- You can “Add to Home Screen” to make it behave like an app and run full‑screen.
- Uses Binance public REST + WebSocket (no server to run).

## How it works (quick)
- On start, the app downloads ~30 days of **1h** candles to build a **prior** and a simple **Markov conditional prior**.
- It computes a volatility proxy (**ATR 30d**) from those hours.
- It also loads the last ~200 **1m** candles so RSI/slope work immediately.
- During the current hour, each new **1m** close updates:
  - Distance vs hour‑open (normalized by ATR)
  - 10–20 minute slope
  - RSI(14)
- These features generate log‑likelihood tweaks to the prior; the posterior becomes the live **p(up)**.
- If `max(p,1-p) < threshold` → **ABSTAIN**.

## Local run
Just host the folder with any static server (HTTPS recommended for full PWA features). Easiest ways:
- **Netlify/Cloudflare Pages/Vercel**: drag‑and‑drop the folder or connect a repo.
- **GitHub Pages**: push the folder as a repo, enable Pages → deploys as a website.
- Quick local test: `python -m http.server` (then open http://localhost:8000).

## Use on iPhone
1. Deploy the folder (e.g., Netlify or GitHub Pages).
2. Open the site in **Safari**.
3. Tap **Share → Add to Home Screen**.
4. Tap **Start** inside the app.

## Controls
- **Coin**: BTC/ETH/XRP/SOL.
- **Min confidence**: default 0.62 (tweak to be stricter/looser).
- **Start/Stop**: connect/disconnect live WebSocket.

## Interpreting the output
- **Prediction**: UP/DOWN/NO CALL (abstain).
- **Confidence**: `max(p_up, 1 - p_up)`.
- **Signals**: small, transparent list of what the model is “seeing”.

## Implementation notes
- All logic is in `model.js`. Tuning is conservative. You can edit the likelihood weights.
- Price precision is detected using `/api/v3/exchangeInfo`.
- Hour boundaries are detected; on each new hour the app refreshes the prior and resets the hour‑open.
- If WebSocket bumps or you switch networks, hit **Stop** then **Start**.

## Disclaimer
This tool is provided “as‑is” without warranty. Markets are risky. Use at your own risk.
