# Portfolio Stock Tracker

A local full-stack stock portfolio dashboard with:

- Portfolio holdings stored locally in `backend/src/portfolio.json`
- Live-ish quotes and intraday/day stats from Yahoo Finance public endpoints
- Historical 6-month chart data
- Fundamentals: market cap, beta, P/E, 52-week range, analyst target, next earnings date, earnings/revenue estimate trends when available
- Simple 7-day linear trend forecast and moving-average signal

> This is for education and personal tracking. It is not financial advice. Yahoo Finance data is accessed through public/unofficial endpoints and may break or be rate-limited; for production, use a licensed market-data API such as Polygon, Finnhub, Alpha Vantage, IEX Cloud, or Nasdaq Data Link.

## Requirements

Install Node.js first: https://nodejs.org/

Use Node 18+ because the backend uses built-in `fetch`.

## How to run

Open Command Prompt or PowerShell in this project folder, then run:

```bash
npm install
npm run install:all
npm run dev
```

Then open:

```text
http://localhost:5173
```

The backend runs on:

```text
http://localhost:5000
```

## Project structure

```text
portfolio-stock-tracker/
  backend/
    src/server.js
    src/portfolio.example.json
  frontend/
    src/App.jsx
    src/style.css
```

## Editing your starting portfolio manually

For a fresh local setup, create your portfolio file from the example:

```text
backend/src/portfolio.example.json -> backend/src/portfolio.json
```

Then open:

```text
backend/src/portfolio.json
```

Example:

```json
[
  { "symbol": "AAPL", "shares": 10, "avgCost": 180 },
  { "symbol": "MSFT", "shares": 5, "avgCost": 390 }
]
```

You can also add/update/remove holdings in the website UI.

## Local data

The backend stores holdings in `backend/src/portfolio.json`, settings in `backend/src/settings.json`, and portfolio history in `backend/src/snapshots.json`. These local files and the machine-specific `Start-App.bat` launcher are excluded from Git. The repository includes `.example` files for setting up a new installation.

## Importing a portfolio screenshot

Choose **Manage → Import screenshot**, then paste an image with Ctrl+V, drop it into the dialog, or select a PNG, JPEG, or WebP file (up to 10 MB).

The app recognizes English text locally in the browser using [Tesseract.js](https://github.com/naptha/tesseract.js). The OCR worker, engine, and English model are served by the app and prepared automatically by `npm run dev` and `npm run build`. No API key or paid recognition service is required. Screenshot pixels and recognized text are not uploaded or saved to the portfolio files.

Review and edit the tickers, share quantities, and average costs before confirming. Column mapping can be adjusted for different table layouts; unsupported layouts can be entered manually. Recognition accuracy depends on the screenshot, so this does not guarantee automatic extraction from every brokerage layout.

Only selected holdings are merged into the portfolio. Existing positions outside the screenshot and cash are preserved. A missing average cost keeps an existing holding's saved cost; a new holding needs an average cost. Current market prices are not treated as purchase costs. Costs use USD; convert non-USD costs before importing.

## Notes about predictions

The prediction is intentionally simple: it uses the last ~45 trading days and fits a basic linear trend forward 7 days. It is useful as a demo feature, but it should not be used to make investment decisions.
