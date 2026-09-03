import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yahooFinance from 'yahoo-finance2';

dotenv.config();
if (typeof yahooFinance.suppressNotices === 'function') {
  yahooFinance.suppressNotices(['yahooSurvey']);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const portfolioPath = path.join(__dirname, 'portfolio.json');
const settingsPath = path.join(__dirname, 'settings.json');
const snapshotsPath = path.join(__dirname, 'snapshots.json');
let secTickerCache = null;

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const CASH_BALANCE = Number(process.env.CASH_BALANCE || 1272.27);

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

function cleanSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
}

async function loadPortfolio() {
  try { return JSON.parse(await fs.readFile(portfolioPath, 'utf8')); }
  catch { return []; }
}
async function savePortfolio(portfolio) {
  await fs.writeFile(portfolioPath, JSON.stringify(portfolio, null, 2));
}
async function loadSettings() {
  try { return JSON.parse(await fs.readFile(settingsPath, 'utf8')); }
  catch { return { cashBalance: CASH_BALANCE }; }
}
async function saveSettings(settings) {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}
async function loadSnapshots() {
  try { return JSON.parse(await fs.readFile(snapshotsPath, 'utf8')); }
  catch { return []; }
}
async function saveSnapshots(snapshots) {
  await fs.writeFile(snapshotsPath, JSON.stringify(snapshots, null, 2));
}
async function upsertSnapshot(snapshot) {
  const snapshots = await loadSnapshots();
  const date = new Date().toISOString().slice(0, 10);
  const item = { date, updatedAt: new Date().toISOString(), ...snapshot };
  const existing = snapshots.findIndex(row => row.date === date);
  if (existing >= 0) snapshots[existing] = { ...snapshots[existing], ...item };
  else snapshots.push(item);
  const recent = snapshots
    .filter(row => row.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-730);
  await saveSnapshots(recent);
  return recent;
}
function sma(values, window) {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}
function linearForecast(points, daysAhead = 7) {
  const recent = points.slice(-45).filter(p => Number.isFinite(p.close));
  if (recent.length < 10) return [];
  const n = recent.length;
  const xs = recent.map((_, i) => i + 1);
  const ys = recent.map(p => p.close);
  const avgX = xs.reduce((a, b) => a + b, 0) / n;
  const avgY = ys.reduce((a, b) => a + b, 0) / n;
  const numerator = xs.reduce((sum, x, i) => sum + (x - avgX) * (ys[i] - avgY), 0);
  const denominator = xs.reduce((sum, x) => sum + (x - avgX) ** 2, 0) || 1;
  const slope = numerator / denominator;
  const intercept = avgY - slope * avgX;
  const lastDate = new Date(recent.at(-1).date);
  return Array.from({ length: daysAhead }, (_, i) => {
    const d = new Date(lastDate);
    d.setDate(d.getDate() + i + 1);
    return { date: d.toISOString().slice(0, 10), predictedClose: Math.max(0, intercept + slope * (n + i + 1)) };
  });
}
function signalFromStats(lastClose, sma20, sma50, forecast) {
  const next = forecast?.at(-1)?.predictedClose;
  if (!sma20 || !sma50 || !next) return 'Not enough data';
  if (lastClose > sma20 && sma20 > sma50 && next > lastClose) return 'Bullish trend';
  if (lastClose < sma20 && sma20 < sma50 && next < lastClose) return 'Bearish trend';
  return 'Mixed / sideways';
}

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value = '') {
  return decodeXml(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function tagValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function parseGoogleNewsRss(xml, sourceLabel, topic) {
  return Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).map(match => {
    const item = match[1];
    const title = stripTags(tagValue(item, 'title'));
    const link = stripTags(tagValue(item, 'link'));
    const description = stripTags(tagValue(item, 'description'));
    const publishedAt = tagValue(item, 'pubDate');
    const source = stripTags(tagValue(item, 'source')) || sourceLabel;
    return { title, link, description, publishedAt, source, topic };
  }).filter(item => item.title && item.link);
}

async function fetchRss(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 portfolio-stock-tracker' }
    });
    if (!response.ok) throw new Error(`News request failed with ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function getNewsForQuery(query, topic, limit = 6, days = 7) {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', `${query} when:${days}d`);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');
  const xml = await fetchRss(url);
  return parseGoogleNewsRss(xml, 'Google News', topic).slice(0, limit);
}

async function getRecentEarningsReleaseDate(symbol) {
  const articles = await getNewsForQuery(`${symbol} earnings results revenue EPS`, symbol, 1, 45).catch(() => []);
  const publishedAt = articles[0]?.publishedAt;
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dedupeNews(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.title.toLowerCase()}|${item.link}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toYahooDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function yahooRaw(value) {
  return value?.fmt ?? value?.raw ?? value ?? null;
}

function yahooNumber(value) {
  const raw = value?.raw ?? value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function yahooDate(value) {
  const raw = value?.raw ?? value;
  if (!raw) return null;
  if (typeof raw === 'number') return new Date(raw * 1000).toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? String(raw) : parsed.toISOString();
}

function yahooPeriod(value) {
  const date = yahooDate(value);
  return date ? date.slice(0, 10) : null;
}

async function fetchYahooJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 portfolio-stock-tracker'
      }
    });
    if (!response.ok) throw new Error(`Yahoo request failed with ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, userAgent = 'portfolio-stock-tracker local-app contact@example.com') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'user-agent': userAgent
      }
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function yahooQuote(symbol) {
  const url = new URL('https://query1.finance.yahoo.com/v7/finance/quote');
  url.searchParams.set('symbols', symbol);
  const data = await fetchYahooJson(url);
  return data.quoteResponse?.result?.[0] || {};
}

async function yahooQuoteSummary(symbol, modules) {
  const url = new URL(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`);
  url.searchParams.set('modules', modules.join(','));
  const data = await fetchYahooJson(url);
  return data.quoteSummary?.result?.[0] || {};
}

async function yahooFundamentalTimeseries(symbol) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tenYearsAgo = nowSeconds - (60 * 60 * 24 * 365 * 10);
  const url = new URL(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('type', [
    'quarterlyDilutedEPS',
    'quarterlyBasicEPS',
    'quarterlyTotalRevenue'
  ].join(','));
  url.searchParams.set('period1', String(tenYearsAgo));
  url.searchParams.set('period2', String(nowSeconds));
  const data = await fetchYahooJson(url);
  return data.timeseries?.result || [];
}

function timeseriesRows(results, key) {
  const item = (results || []).find(row => row?.meta?.type?.includes(key) || row[key]);
  return (item?.[key] || [])
    .map(row => ({
      date: row.asOfDate || row.period || null,
      value: yahooNumber(row.reportedValue) ?? yahooNumber(row)
    }))
    .filter(row => row.date && Number.isFinite(row.value))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function secCikForSymbol(symbol) {
  if (!secTickerCache) {
    const data = await fetchJson('https://www.sec.gov/files/company_tickers.json');
    secTickerCache = Object.values(data).reduce((map, row) => {
      map[String(row.ticker || '').toUpperCase()] = String(row.cik_str).padStart(10, '0');
      return map;
    }, {});
  }
  return secTickerCache[cleanSymbol(symbol)] || null;
}

function secFactUnits(facts, tag) {
  return facts?.facts?.['us-gaap']?.[tag]?.units || {};
}

function secFactEntries(facts, tags, unitPreference) {
  return tags.flatMap(tag => {
    const units = secFactUnits(facts, tag);
    const unitKeys = unitPreference ? [unitPreference] : Object.keys(units);
    return unitKeys.flatMap(unit => (units[unit] || []).map(item => ({ ...item, tag, unit })));
  }).filter(item => item.form && ['10-Q', '10-K'].includes(item.form) && item.fy && item.fp && item.end && Number.isFinite(Number(item.val)));
}

function secQuarterlyEntries(entries) {
  return entries
    .filter(item => {
      const start = item.start ? new Date(item.start) : null;
      const end = new Date(item.end);
      if (Number.isNaN(end.getTime())) return false;
      if (!start || Number.isNaN(start.getTime())) return item.fp !== 'FY';
      const days = Math.round((end - start) / 86400000);
      return days >= 70 && days <= 115;
    })
    .sort((a, b) => new Date(b.end) - new Date(a.end));
}

function previousYearSecValue(entries, item) {
  const end = new Date(item.end);
  return entries.find(candidate => {
    const candidateEnd = new Date(candidate.end);
    return candidateEnd.getUTCFullYear() === end.getUTCFullYear() - 1
      && candidateEnd.getUTCMonth() === end.getUTCMonth()
      && candidateEnd.getUTCDate() === end.getUTCDate();
  })?.val ?? null;
}

async function getSecEarningsReport(symbol) {
  const cik = await secCikForSymbol(symbol);
  if (!cik) return null;
  const facts = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  const revenueTags = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'];
  const epsTags = ['EarningsPerShareDiluted', 'EarningsPerShareBasic'];
  const revenueEntries = secQuarterlyEntries(secFactEntries(facts, revenueTags, 'USD'));
  const epsEntries = secQuarterlyEntries(secFactEntries(facts, epsTags, 'USD/shares'));
  const latestRevenue = revenueEntries[0] || null;
  const latestEps = epsEntries.find(item => item.end === latestRevenue?.end) || epsEntries[0] || null;
  const latestEnd = latestRevenue?.end || latestEps?.end || null;
  const reportDate = latestRevenue?.filed || latestEps?.filed || null;
  if (!latestEnd) return null;
  const revenue = latestRevenue ? Number(latestRevenue.val) : null;
  const priorRevenue = latestRevenue ? Number(previousYearSecValue(revenueEntries, latestRevenue)) : null;
  const revenueGrowthYoY = Number.isFinite(revenue) && Number.isFinite(priorRevenue) && priorRevenue
    ? ((revenue - priorRevenue) / priorRevenue) * 100
    : null;
  const epsActual = latestEps ? Number(latestEps.val) : null;
  const history = Array.from(new Set([...revenueEntries, ...epsEntries].map(item => item.end)))
    .sort((a, b) => new Date(b) - new Date(a))
    .slice(0, 8)
    .map(date => {
      const revenueItem = revenueEntries.find(item => item.end === date);
      const epsItem = epsEntries.find(item => item.end === date);
      const revenueValue = revenueItem ? Number(revenueItem.val) : null;
      const prior = revenueItem ? Number(previousYearSecValue(revenueEntries, revenueItem)) : null;
      return {
        date,
        eps: epsItem ? Number(epsItem.val) : null,
        revenue: revenueValue,
        revenueGrowthYoY: Number.isFinite(revenueValue) && Number.isFinite(prior) && prior ? ((revenueValue - prior) / prior) * 100 : null
      };
    })
    .reverse();
  return {
    symbol,
    reportDate,
    period: latestEnd,
    epsActual,
    revenue,
    revenueGrowthYoY,
    growth: revenueGrowthYoY,
    growthBasis: Number.isFinite(revenueGrowthYoY) ? 'YoY revenue' : null,
    history,
    source: 'SEC',
    status: revenue !== null || epsActual !== null ? 'ok' : 'missing'
  };
}

function newerReport(primary, fallback) {
  if (!fallback) return primary;
  if (!primary?.period) return { ...primary, ...fallback };
  if (!fallback.period) return primary;
  const fallbackDate = new Date(fallback.period);
  const primaryDate = new Date(primary.period);
  if (fallbackDate > primaryDate) return { ...primary, ...fallback, source: fallback.source || 'SEC' };
  if (fallbackDate.getTime() === primaryDate.getTime()) {
    return {
      ...primary,
      reportDate: primary.reportDate || fallback.reportDate || null,
      reportDateSource: primary.reportDate ? primary.reportDateSource : fallback.reportDate ? 'SEC filing' : null,
      history: primary.history?.length ? primary.history : fallback.history,
      source: fallback.reportDate ? `${primary.source || 'Yahoo'} + SEC` : primary.source
    };
  }
  return primary;
}

function earningsDateFrom(summary, quote) {
  const dates = summary.calendarEvents?.earnings?.earningsDate || [];
  const summaryDate = Array.isArray(dates) ? dates[0] : dates;
  return yahooDate(summaryDate)
    || yahooDate(quote.earningsTimestamp)
    || yahooDate(quote.earningsTimestampStart)
    || yahooDate(quote.earningsTimestampEnd);
}

async function yahooChart(symbol) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', '6mo');
  url.searchParams.set('interval', '1d');
  url.searchParams.set('includePrePost', 'false');
  url.searchParams.set('events', 'div,splits');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 portfolio-stock-tracker'
      }
    });

    if (!response.ok) throw new Error(`Yahoo chart request failed with ${response.status}`);

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const yahooError = payload?.chart?.error;
    if (!result) throw new Error(yahooError?.description || `No Yahoo chart data for ${symbol}`);

    const quote = result.indicators?.quote?.[0] || {};
    const timestamps = result.timestamp || [];
    const history = timestamps.map((timestamp, index) => ({
      date: toYahooDate(timestamp),
      open: numberOrNull(quote.open?.[index]),
      high: numberOrNull(quote.high?.[index]),
      low: numberOrNull(quote.low?.[index]),
      close: numberOrNull(quote.close?.[index]),
      volume: numberOrNull(quote.volume?.[index])
    })).filter(point => Number.isFinite(point.close));

    const meta = result.meta || {};
    const latestPoint = history.at(-1) || {};
    const previousPoint = history.at(-2) || {};
    const previousClose = numberOrNull(meta.previousClose) ?? previousPoint.close ?? null;
    const currentPrice = numberOrNull(meta.regularMarketPrice) ?? latestPoint.close ?? null;
    const dayChange = Number.isFinite(currentPrice) && Number.isFinite(previousClose) ? currentPrice - previousClose : null;
    return {
      ok: true,
      symbol,
      meta,
      history,
      quote: {
        symbol,
        shortName: meta.shortName || meta.longName || symbol,
        longName: meta.longName || meta.shortName || symbol,
        currency: meta.currency || 'USD',
        regularMarketPrice: currentPrice,
        regularMarketPreviousClose: previousClose,
        regularMarketChange: dayChange,
        regularMarketChangePercent: Number.isFinite(dayChange) && previousClose ? (dayChange / previousClose) * 100 : null,
        regularMarketDayHigh: numberOrNull(meta.regularMarketDayHigh) ?? latestPoint.high ?? null,
        regularMarketDayLow: numberOrNull(meta.regularMarketDayLow) ?? latestPoint.low ?? null,
        regularMarketVolume: numberOrNull(meta.regularMarketVolume) ?? latestPoint.volume ?? null,
        averageDailyVolume3Month: numberOrNull(meta.averageDailyVolume3Month) ?? null
      }
    };
  } catch (error) {
    return { ok: false, symbol, error: error.message || 'Yahoo chart data unavailable', history: [], quote: { symbol } };
  } finally {
    clearTimeout(timeout);
  }
}

async function getMarketData(symbol) {
  const chart = await yahooChart(symbol);
  if (chart.ok && chart.history.length) {
    const quote = { ...chart.quote };
    const previousClose = quote.regularMarketPreviousClose;
    const price = quote.regularMarketPrice;
    quote.regularMarketChange = Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : null;
    quote.regularMarketChangePercent = Number.isFinite(quote.regularMarketChange) && previousClose ? (quote.regularMarketChange / previousClose) * 100 : null;
    return chart;
  }

  try {
    const q = await yahooFinance.quote(symbol);
    return { ...chart, quote: q || { symbol }, ok: Boolean(q?.regularMarketPrice), error: chart.error };
  } catch (error) {
    return { ...chart, error: chart.error || error.message || 'Yahoo quote data unavailable' };
  }
}

async function getFundamentals(symbol) {
  try {
    const modules = ['summaryDetail','defaultKeyStatistics','financialData','earningsTrend','calendarEvents','assetProfile'];
    const [quote, r] = await Promise.all([
      yahooQuote(symbol).catch(() => ({})),
      yahooQuoteSummary(symbol, modules).catch(() => ({}))
    ]);
    const trends = r.earningsTrend?.trend?.slice(0, 4).map(t => ({
      period: t.period,
      earningsEstimateAvg: yahooRaw(t.earningsEstimate?.avg),
      revenueEstimateAvg: yahooRaw(t.revenueEstimate?.avg),
      epsTrendCurrent: yahooRaw(t.epsTrend?.current),
      growth: yahooRaw(t.growth)
    })) || [];
    const nextEarningsDate = earningsDateFrom(r, quote);
    return {
      sector: r.assetProfile?.sector || null,
      industry: r.assetProfile?.industry || null,
      marketCap: yahooRaw(r.summaryDetail?.marketCap) ?? quote.marketCap ?? null,
      beta: yahooRaw(r.summaryDetail?.beta) ?? quote.beta ?? null,
      trailingPE: yahooRaw(r.summaryDetail?.trailingPE) ?? quote.trailingPE ?? null,
      forwardPE: yahooRaw(r.summaryDetail?.forwardPE) ?? quote.forwardPE ?? null,
      dividendYield: yahooRaw(r.summaryDetail?.dividendYield) ?? quote.trailingAnnualDividendYield ?? null,
      fiftyTwoWeekHigh: yahooRaw(r.summaryDetail?.fiftyTwoWeekHigh) ?? quote.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: yahooRaw(r.summaryDetail?.fiftyTwoWeekLow) ?? quote.fiftyTwoWeekLow ?? null,
      profitMargins: yahooRaw(r.defaultKeyStatistics?.profitMargins),
      revenueGrowth: yahooRaw(r.financialData?.revenueGrowth),
      grossMargins: yahooRaw(r.financialData?.grossMargins),
      targetMeanPrice: yahooRaw(r.financialData?.targetMeanPrice) ?? quote.targetMeanPrice ?? null,
      recommendationMean: yahooRaw(r.financialData?.recommendationMean),
      nextEarningsDate,
      nextEarningsDateSource: nextEarningsDate ? 'Yahoo' : null,
      earningsTrends: trends
    };
  } catch (error) {
    return { error: 'Fundamental data unavailable for this symbol.', nextEarningsDate: null, earningsTrends: [] };
  }
}

async function getLatestEarningsReport(symbol) {
  try {
    const modules = ['quoteType','earningsHistory','earnings','incomeStatementHistoryQuarterly','financialData'];
    const [r, timeseries] = await Promise.all([
      yahooQuoteSummary(symbol, modules).catch(() => ({})),
      yahooFundamentalTimeseries(symbol).catch(() => [])
    ]);
    const quoteType = r.quoteType?.quoteType || r.quoteType?.longName || null;
    const history = [...(r.earningsHistory?.history || [])]
      .sort((a, b) => (yahooNumber(b.quarter) || 0) - (yahooNumber(a.quarter) || 0));
    const statements = [...(r.incomeStatementHistoryQuarterly?.incomeStatementHistory || [])]
      .sort((a, b) => (yahooNumber(b.endDate) || 0) - (yahooNumber(a.endDate) || 0));
    const chartQuarters = [...(r.earnings?.financialsChart?.quarterly || [])].reverse();
    const epsRows = timeseriesRows(timeseries, 'quarterlyDilutedEPS');
    const basicEpsRows = timeseriesRows(timeseries, 'quarterlyBasicEPS');
    const revenueRows = timeseriesRows(timeseries, 'quarterlyTotalRevenue');
    const earningsHistory = Array.from(new Set([...revenueRows, ...epsRows, ...basicEpsRows].map(row => row.date)))
      .sort((a, b) => new Date(b) - new Date(a))
      .slice(0, 8)
      .map(date => {
        const eps = epsRows.find(row => row.date === date)?.value ?? basicEpsRows.find(row => row.date === date)?.value ?? null;
        const revenueValue = revenueRows.find(row => row.date === date)?.value ?? null;
        const priorYearRevenue = revenueRows.find(row => {
          const d = new Date(date);
          const prior = new Date(row.date);
          return prior.getUTCFullYear() === d.getUTCFullYear() - 1 && prior.getUTCMonth() === d.getUTCMonth();
        })?.value ?? null;
        return {
          date,
          eps,
          revenue: revenueValue,
          revenueGrowthYoY: Number.isFinite(revenueValue) && Number.isFinite(priorYearRevenue) && priorYearRevenue
            ? ((revenueValue - priorYearRevenue) / priorYearRevenue) * 100
            : null
        };
      })
      .reverse();

    const latestHistory = history[0] || {};
    const latestStatement = statements[0] || {};
    const latestChart = chartQuarters[0] || {};
    const previousYearStatement = statements[4] || null;
    const previousQuarterStatement = statements[1] || null;
    const revenue = yahooNumber(latestStatement.totalRevenue) ?? yahooNumber(latestChart.revenue) ?? revenueRows[0]?.value ?? null;
    const previousYearRevenue = yahooNumber(previousYearStatement?.totalRevenue) ?? revenueRows[4]?.value ?? null;
    const previousQuarterRevenue = yahooNumber(previousQuarterStatement?.totalRevenue) ?? revenueRows[1]?.value ?? null;
    const revenueGrowthYoY = Number.isFinite(revenue) && Number.isFinite(previousYearRevenue) && previousYearRevenue
      ? ((revenue - previousYearRevenue) / previousYearRevenue) * 100
      : null;
    const revenueGrowthQoQ = Number.isFinite(revenue) && Number.isFinite(previousQuarterRevenue) && previousQuarterRevenue
      ? ((revenue - previousQuarterRevenue) / previousQuarterRevenue) * 100
      : null;
    const reportedDate = yahooPeriod(latestHistory.quarter)
      || yahooPeriod(latestStatement.endDate)
      || latestChart.date
      || revenueRows[0]?.date
      || epsRows[0]?.date
      || basicEpsRows[0]?.date
      || null;
    const epsActual = yahooNumber(latestHistory.epsActual) ?? yahooNumber(latestChart.earnings) ?? epsRows[0]?.value ?? basicEpsRows[0]?.value ?? null;
    const previousYearEps = epsRows[4]?.value ?? basicEpsRows[4]?.value ?? null;
    const epsGrowthYoY = Number.isFinite(epsActual) && Number.isFinite(previousYearEps) && previousYearEps
      ? ((epsActual - previousYearEps) / Math.abs(previousYearEps)) * 100
      : null;
    const epsEstimate = yahooNumber(latestHistory.epsEstimate);
    const surprisePercent = yahooNumber(latestHistory.surprisePercent);
    const fallbackGrowth = yahooNumber(r.financialData?.revenueGrowth);
    const growth = revenueGrowthYoY
      ?? (Number.isFinite(fallbackGrowth) ? fallbackGrowth * 100 : null)
      ?? revenueGrowthQoQ
      ?? epsGrowthYoY;

    const yahooReport = {
      symbol,
      quoteType,
      isFund: ['ETF', 'MUTUALFUND'].includes(String(quoteType || '').toUpperCase()),
      period: reportedDate,
      epsActual,
      epsEstimate,
      epsDifference: yahooNumber(latestHistory.epsDifference),
      surprisePercent,
      revenue,
      revenueGrowthYoY,
      revenueGrowthQoQ,
      epsGrowthYoY,
      growth,
      history: earningsHistory,
      source: 'Yahoo',
      growthBasis: Number.isFinite(revenueGrowthYoY)
        ? 'YoY revenue'
        : Number.isFinite(fallbackGrowth)
          ? 'TTM revenue'
          : Number.isFinite(revenueGrowthQoQ)
            ? 'QoQ revenue'
            : Number.isFinite(epsGrowthYoY)
              ? 'YoY EPS'
              : revenue === 0
                ? 'Pre-revenue'
                : null,
      status: reportedDate || epsActual !== null || revenue !== null ? 'ok' : 'missing'
    };
    const secReport = await getSecEarningsReport(symbol).catch(() => null);
    const report = newerReport(yahooReport, secReport);
    if (!report.reportDate) {
      const newsDate = await getRecentEarningsReleaseDate(symbol);
      if (newsDate) {
        report.reportDate = newsDate;
        report.reportDateSource = 'News';
      }
    }
    return report;
  } catch (error) {
    const secReport = await getSecEarningsReport(symbol).catch(() => null);
    if (secReport && !secReport.reportDate) {
      const newsDate = await getRecentEarningsReleaseDate(symbol);
      if (newsDate) {
        secReport.reportDate = newsDate;
        secReport.reportDateSource = 'News';
      }
    }
    return secReport || { symbol, status: 'error', error: error.message || 'Latest earnings report unavailable.' };
  }
}

app.get('/', (_, res) => res.send('Portfolio backend is running. Open the website at http://localhost:5173'));
app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/portfolio', async (_, res) => res.json(await loadPortfolio()));
app.get('/api/snapshots', async (_, res) => res.json(await loadSnapshots()));
app.get('/api/benchmarks', async (req, res) => {
  try {
    const symbols = String(req.query.symbols || 'SPY,QQQ,VOO')
      .split(',')
      .map(cleanSymbol)
      .filter(Boolean)
      .slice(0, 6);
    const benchmarks = await Promise.all(symbols.map(async symbol => {
      const data = await getMarketData(symbol);
      const history = (data.history || []).filter(row => Number.isFinite(row.close));
      const first = history[0]?.close;
      const latest = history.at(-1)?.close ?? data.quote?.regularMarketPrice ?? null;
      return {
        symbol,
        name: data.quote?.shortName || data.quote?.longName || symbol,
        price: latest,
        returnPercent: first && latest ? ((latest - first) / first) * 100 : null,
        history: history.map(row => ({
          date: row.date,
          close: row.close,
          normalized: first ? ((row.close - first) / first) * 100 : null
        }))
      };
    }));
    res.json({ updatedAt: new Date().toISOString(), benchmarks });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load benchmarks.' });
  }
});
app.get('/api/news', async (_, res) => {
  try {
    const portfolio = await loadPortfolio();
    const symbols = portfolio.map(p => cleanSymbol(p.symbol)).filter(Boolean);
    const marketData = await Promise.all(symbols.map(symbol => getMarketData(symbol).catch(() => ({ symbol, quote: {} }))));
    const marketMap = Object.fromEntries(marketData.map(data => [data.symbol, data]));
    const topHoldings = portfolio
      .map(holding => {
        const symbol = cleanSymbol(holding.symbol);
        const market = marketMap[symbol] || {};
        const price = market.quote?.regularMarketPrice ?? market.history?.at(-1)?.close ?? 0;
        return {
          symbol,
          name: market.quote?.shortName || market.quote?.longName || symbol,
          value: Number(holding.shares || 0) * Number(price || 0)
        };
      })
      .filter(holding => holding.symbol && holding.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    const companyQueries = topHoldings.map(holding => getNewsForQuery(`${holding.symbol} stock`, holding.symbol, 5).catch(() => []));
    const policyQueries = [
      getNewsForQuery('U.S. president stock market economy tariffs regulation', 'President / Policy', 8).catch(() => []),
      getNewsForQuery('White House economy markets technology stocks', 'President / Policy', 6).catch(() => [])
    ];
    const groups = await Promise.all([...companyQueries, ...policyQueries]);
    const articles = dedupeNews(groups.flat())
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
    const portfolioGroups = topHoldings.map(holding => ({
      ...holding,
      articles: articles.filter(item => item.topic === holding.symbol).slice(0, 5)
    }));
    const portfolioNews = portfolioGroups.flatMap(group => group.articles);
    const policyNews = articles.filter(item => item.topic === 'President / Policy').slice(0, 12);
    res.json({ updatedAt: new Date().toISOString(), portfolioGroups, portfolioNews, policyNews });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load news.' });
  }
});
app.get('/api/earnings', async (_, res) => {
  try {
    const portfolio = await loadPortfolio();
    const symbols = portfolio.map(p => cleanSymbol(p.symbol)).filter(Boolean);
    const reports = await Promise.all(symbols.map(symbol => getLatestEarningsReport(symbol)));
    res.json({ updatedAt: new Date().toISOString(), reports });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load latest earnings reports.' });
  }
});
app.post('/api/portfolio', async (req, res) => {
  const portfolio = await loadPortfolio();
  const item = { symbol: cleanSymbol(req.body.symbol), shares: Number(req.body.shares || 0), avgCost: Number(req.body.avgCost || 0) };
  if (!item.symbol || item.shares < 0 || item.avgCost < 0) return res.status(400).json({ error: 'Invalid symbol, shares, or average cost.' });
  const existing = portfolio.find(p => p.symbol === item.symbol);
  if (existing) Object.assign(existing, item); else portfolio.push(item);
  await savePortfolio(portfolio);
  res.json(portfolio);
});
app.put('/api/portfolio/import', async (req, res) => {
  const source = Array.isArray(req.body) ? req.body : req.body?.holdings;
  if (!Array.isArray(source)) return res.status(400).json({ error: 'Import file must contain a holdings array.' });

  const imported = source.map(item => ({
    symbol: cleanSymbol(item.symbol),
    shares: Number(item.shares || 0),
    avgCost: Number(item.avgCost ?? item.averageCost ?? item.costBasis ?? 0)
  })).filter(item => item.symbol && item.shares >= 0 && item.avgCost >= 0);

  if (!imported.length) return res.status(400).json({ error: 'No valid holdings found in import file.' });

  const bySymbol = new Map();
  imported.forEach(item => bySymbol.set(item.symbol, item));
  const portfolio = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  await savePortfolio(portfolio);
  res.json(portfolio);
});
app.put('/api/settings/cash', async (req, res) => {
  const cashBalance = Number(req.body.cashBalance ?? 0);
  if (!Number.isFinite(cashBalance) || cashBalance < 0) return res.status(400).json({ error: 'Cash balance must be a positive number.' });
  const settings = { ...(await loadSettings()), cashBalance };
  await saveSettings(settings);
  res.json(settings);
});
app.delete('/api/portfolio/:symbol', async (req, res) => {
  const symbol = cleanSymbol(req.params.symbol);
  const portfolio = (await loadPortfolio()).filter(p => p.symbol !== symbol);
  await savePortfolio(portfolio);
  res.json(portfolio);
});
app.get('/api/dashboard', async (_, res) => {
  try {
    const portfolio = await loadPortfolio();
    const settings = await loadSettings();
    const cashBalance = Number(settings.cashBalance ?? CASH_BALANCE);
    const symbols = portfolio.map(p => cleanSymbol(p.symbol)).filter(Boolean);
    const marketData = await Promise.all(symbols.map(symbol => getMarketData(symbol)));
    const marketMap = Object.fromEntries(marketData.map(data => [data.symbol, data]));
    const enriched = await Promise.all(portfolio.map(async holding => {
      const market = marketMap[holding.symbol] || { quote: {}, history: [], error: 'No market data returned.' };
      const q = market.quote || {};
      const history = market.history || [];
      const closes = history.map(p => p.close);
      const forecast = linearForecast(history, 7);
      const lastClose = q.regularMarketPrice ?? closes.at(-1) ?? null;
      const value = Number(holding.shares) * Number(lastClose || 0);
      const costBasis = Number(holding.shares) * Number(holding.avgCost || 0);
      const fundamentals = await getFundamentals(holding.symbol);
      const sma20 = sma(closes, 20);
      const sma50 = sma(closes, 50);
      return {
        ...holding,
        name: q.shortName || q.longName || holding.symbol,
        currency: q.currency || 'USD',
        price: lastClose,
        dayChange: q.regularMarketChange ?? null,
        dayChangePercent: q.regularMarketChangePercent ?? null,
        dayHigh: q.regularMarketDayHigh ?? null,
        dayLow: q.regularMarketDayLow ?? null,
        previousClose: q.regularMarketPreviousClose ?? null,
        volume: q.regularMarketVolume ?? null,
        avgVolume: q.averageDailyVolume3Month ?? null,
        value,
        costBasis,
        unrealizedGain: value - costBasis,
        unrealizedGainPercent: costBasis ? ((value - costBasis) / costBasis) * 100 : null,
        sma20,
        sma50,
        signal: signalFromStats(lastClose, sma20, sma50, forecast),
        history,
        forecast,
        dataStatus: market.ok ? 'ok' : 'error',
        dataError: market.ok ? null : market.error,
        fundamentals
      };
    }));
    const holdingsValue = enriched.reduce((sum, h) => sum + (h.value || 0), 0);
    const holdingsCost = enriched.reduce((sum, h) => sum + (h.costBasis || 0), 0);
    const dayValueChange = enriched.reduce((sum, h) => sum + (Number(h.shares || 0) * Number(h.dayChange || 0)), 0);
    const previousHoldingsValue = holdingsValue - dayValueChange;
    const dayValueChangePercent = previousHoldingsValue ? (dayValueChange / previousHoldingsValue) * 100 : null;
    const totalValue = holdingsValue + cashBalance;
    const totalCost = holdingsCost + cashBalance;
    const snapshots = await upsertSnapshot({
      cashBalance,
      holdingsValue,
      totalValue,
      totalCost,
      dayValueChange,
      dayValueChangePercent,
      holdingsCount: enriched.length
    });
    res.json({
      updatedAt: new Date().toISOString(),
      cashBalance,
      holdingsValue,
      totalValue,
      totalCost,
      dayValueChange,
      dayValueChangePercent,
      totalGain: totalValue - totalCost,
      totalGainPercent: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : null,
      snapshots,
      holdings: enriched
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.listen(PORT, () => console.log(`Portfolio backend running on http://localhost:${PORT}`));
