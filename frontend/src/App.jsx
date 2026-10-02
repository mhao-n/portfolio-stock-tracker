import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, BriefcaseBusiness, CalendarDays, Command, Download, Edit3, ExternalLink, LayoutGrid, Moon, Newspaper, Plus, RefreshCw, Save, Search, ShieldAlert, Star, Sun, Table2, Trash2, Upload, Wallet, X } from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const COLORS = ['var(--blue)', 'var(--green)', 'var(--warning)', 'var(--red)', 'var(--purple)', 'var(--teal)', 'var(--orange)', 'var(--text-soft)'];
const SORT_OPTIONS = [
  { value: 'value', label: 'Position value' },
  { value: 'price', label: 'Stock price' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'stockDay', label: 'Stock day change $' },
  { value: 'stockDayPercent', label: 'Stock day change %' },
  { value: 'positionDay', label: 'Position day change $' }
];
const HOLDING_COLUMNS = [
  { key: 'price', label: 'Price' },
  { key: 'shares', label: 'Shares' },
  { key: 'avgCost', label: 'Avg Cost' },
  { key: 'value', label: 'Value' },
  { key: 'day', label: 'Day' },
  { key: 'gain', label: 'Gain/Loss' },
  { key: 'signal', label: 'Signal' }
];
const DEFAULT_HOLDING_COLUMNS = HOLDING_COLUMNS.map(column => column.key);
const SCENARIOS = {
  conservative: { label: 'Conservative', prior: 0.72, signal: 0.70, range: 1.18 },
  base: { label: 'Base', prior: 1, signal: 1, range: 1 },
  aggressive: { label: 'Aggressive', prior: 1.25, signal: 1.20, range: 0.92 }
};

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function compactMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const amount = Number(value);
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return money(amount);
}

function num(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return `${Number(value).toFixed(2)}%`;
}

function signedMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const amount = Number(value);
  return `${amount >= 0 ? '+' : ''}${money(amount)}`;
}

function signedPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const amount = Number(value);
  return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)}%`;
}

function storageValue(key, fallback) {
  try { return localStorage.getItem(key) || fallback; }
  catch { return fallback; }
}

function storageJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function shortDate(value) {
  if (!value) return '--';
  const date = typeof value === 'number'
    ? new Date(value > 1000000000000 ? value : value * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseDateValue(value) {
  if (!value) return null;
  const date = typeof value === 'number'
    ? new Date(value > 1000000000000 ? value : value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseMetric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[$,%]/g, '').replace(/[^\d.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGrowthPercent(value) {
  const parsed = parseMetric(value);
  if (parsed === null) return null;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function annualizedMomentum(history) {
  const closes = (history || []).filter(p => Number.isFinite(p.close));
  if (closes.length < 20) return null;
  const first = closes[0].close;
  const last = closes.at(-1).close;
  if (!first || !last) return null;
  return (Math.pow(last / first, 252 / closes.length) - 1) * 100;
}

function returnOverWindow(history, days) {
  const closes = (history || []).filter(p => Number.isFinite(p.close));
  if (closes.length < days + 1) return null;
  const start = closes.at(-days - 1).close;
  const end = closes.at(-1).close;
  return start ? ((end - start) / start) * 100 : null;
}

function dailyVolatility(history) {
  const closes = (history || []).filter(p => Number.isFinite(p.close)).map(p => p.close);
  if (closes.length < 22) return null;
  const returns = closes.slice(1).map((close, i) => Math.log(close / closes[i])).filter(Number.isFinite);
  const avg = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - avg) ** 2, 0) / Math.max(returns.length - 1, 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function maxDrawdown(history) {
  const closes = (history || []).filter(p => Number.isFinite(p.close)).map(p => p.close);
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  closes.forEach(close => {
    peak = Math.max(peak, close);
    worst = Math.min(worst, peak ? ((close - peak) / peak) * 100 : 0);
  });
  return Math.abs(worst);
}

function scoreToReturn(score, maxAbsReturn = 28) {
  return (clamp(score, -100, 100) / 100) * maxAbsReturn;
}

function scoreLabel(score) {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

function riskLabel(score) {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

function priorAnnualReturn(holding) {
  const symbol = String(holding.symbol || '').toUpperCase();
  const sector = String(holding.fundamentals?.sector || '').toLowerCase();
  const industry = String(holding.fundamentals?.industry || '').toLowerCase();
  const speculative = new Set(['OKLO', 'RKLB']);
  const broadMarket = new Set(['VOO']);
  const growthEtf = new Set(['VOOG']);
  const semis = new Set(['AMD', 'MU', 'SNDK', 'WDC']);
  const softwareGrowth = new Set(['CRWD', 'NOW']);

  if (broadMarket.has(symbol)) return 8.5;
  if (growthEtf.has(symbol)) return 10.5;
  if (speculative.has(symbol)) return 14;
  if (semis.has(symbol) || industry.includes('semiconductor')) return 12.5;
  if (softwareGrowth.has(symbol) || sector.includes('technology')) return 11.5;
  return 9;
}

function projectionForHolding(holding, scenario = 'base') {
  const settings = SCENARIOS[scenario] || SCENARIOS.base;
  const value = Number(holding.value || 0);
  const price = Number(holding.price || 0);
  const target = parseMetric(holding.fundamentals?.targetMeanPrice);
  const targetUpside = target && price ? ((target - price) / price) * 100 : null;
  const earningsGrowths = (holding.fundamentals?.earningsTrends || [])
    .map(t => parseGrowthPercent(t.growth))
    .filter(v => Number.isFinite(v));
  const earningsGrowth = earningsGrowths.length ? earningsGrowths.reduce((a, b) => a + b, 0) / earningsGrowths.length : null;
  const momentum = annualizedMomentum(holding.history);
  const oneMonthReturn = returnOverWindow(holding.history, 21);
  const threeMonthReturn = returnOverWindow(holding.history, 63);
  const sixMonthReturn = returnOverWindow(holding.history, 126);
  const volatility = dailyVolatility(holding.history);
  const drawdown = maxDrawdown(holding.history);
  const smaTrend = holding.sma20 && holding.sma50 ? ((holding.sma20 - holding.sma50) / holding.sma50) * 100 : null;
  const riskScore = clamp(((volatility ?? 35) * 0.85) + ((drawdown ?? 15) * 0.95), 0, 100);
  const riskPenalty = riskScore * 0.08;
  const riskAdjustedMomentum = [
    Number.isFinite(oneMonthReturn) ? clamp(oneMonthReturn * 4, -45, 45) : null,
    Number.isFinite(threeMonthReturn) ? clamp(threeMonthReturn * 2, -45, 45) : null,
    Number.isFinite(sixMonthReturn) ? clamp(sixMonthReturn, -45, 45) : null
  ].filter(Number.isFinite);
  const momentumScore = riskAdjustedMomentum.length
    ? riskAdjustedMomentum.reduce((sum, v) => sum + v, 0) / riskAdjustedMomentum.length - riskPenalty
    : null;
  const trendScore = [
    smaTrend,
    holding.price && holding.sma20 ? ((holding.price - holding.sma20) / holding.sma20) * 100 : null,
    holding.price && holding.sma50 ? ((holding.price - holding.sma50) / holding.sma50) * 100 : null
  ].filter(Number.isFinite).reduce((sum, v, _, arr) => sum + clamp(v * 4, -35, 35) / arr.length, 0);
  const pe = parseMetric(holding.fundamentals?.forwardPE ?? holding.fundamentals?.trailingPE);
  const margin = parseGrowthPercent(holding.fundamentals?.profitMargins);
  const revenueGrowth = parseGrowthPercent(holding.fundamentals?.revenueGrowth);
  const fundamentalInputs = [
    Number.isFinite(earningsGrowth) ? clamp(earningsGrowth, -30, 30) : null,
    Number.isFinite(revenueGrowth) ? clamp(revenueGrowth, -25, 25) : null,
    Number.isFinite(margin) ? clamp(margin, -20, 25) : null,
    Number.isFinite(pe) ? clamp(20 - pe, -20, 15) : null
  ].filter(Number.isFinite);
  const fundamentalScore = fundamentalInputs.length ? fundamentalInputs.reduce((sum, v) => sum + v, 0) / fundamentalInputs.length : null;
  const analystScore = Number.isFinite(targetUpside) ? clamp(targetUpside, -35, 35) : null;
  const newsSentimentScore = 0;
  const factors = [
    { name: 'risk-adjusted momentum', value: momentumScore, weight: 0.30 },
    { name: 'trend', value: trendScore, weight: 0.20 },
    { name: 'fundamentals', value: fundamentalScore, weight: 0.20 },
    { name: 'analyst target', value: analystScore, weight: 0.15 },
    { name: 'news/policy sentiment', value: newsSentimentScore, weight: 0.15 }
  ].filter(f => Number.isFinite(f.value));
  const factorScore = factors.length
    ? factors.reduce((sum, f) => sum + f.value * f.weight, 0) / factors.reduce((sum, f) => sum + f.weight, 0)
    : 0;
  const signalReturn = scoreToReturn(factorScore, 32) * settings.signal;
  const priorReturn = priorAnnualReturn(holding) * settings.prior;
  const dataCompleteness = factors.length / 5;
  const signalWeight = clamp(0.25 + dataCompleteness * 0.35 + ((100 - riskScore) / 100) * 0.15, 0.25, 0.70);
  const expectedAnnualReturn = clamp((priorReturn * (1 - signalWeight)) + (signalReturn * signalWeight), -25, 35);
  const rangeWidth = clamp((7 + riskScore * 0.24 + (5 - Math.min(factors.length, 5)) * 1.6) * settings.range, 9, 34);
  const lowAnnualReturn = clamp(expectedAnnualReturn - rangeWidth, -45, 45);
  const highAnnualReturn = clamp(expectedAnnualReturn + rangeWidth, -45, 45);
  const confidenceScore = clamp((factors.length / 5) * 72 + (100 - riskScore) * 0.28, 0, 100);
  const strongest = factors.reduce((best, f) => Math.abs(f.value) > Math.abs(best.value) ? f : best, { name: 'limited data', value: 0 });
  const reason = strongest.name === 'limited data'
    ? 'limited usable data'
    : `${strongest.name} is the biggest driver`;

  return {
    symbol: holding.symbol,
    value,
    expectedAnnualReturn,
    lowAnnualReturn,
    highAnnualReturn,
    oneYearValue: value * (1 + expectedAnnualReturn / 100),
    lowOneYearValue: value * (1 + lowAnnualReturn / 100),
    highOneYearValue: value * (1 + highAnnualReturn / 100),
    threeYearValue: value * Math.pow(1 + expectedAnnualReturn / 100, 3),
    momentum,
    oneMonthReturn,
    threeMonthReturn,
    sixMonthReturn,
    volatility,
    drawdown,
    earningsGrowth,
    targetUpside,
    smaTrend,
    riskScore,
    riskLabel: riskLabel(riskScore),
    confidenceScore,
    confidenceLabel: scoreLabel(confidenceScore),
    priorReturn,
    signalReturn,
    reason
  };
}

function sectorForHolding(holding) {
  const symbol = String(holding.symbol || '').toUpperCase();
  if (symbol === 'VOO' || symbol === 'VOOG') return 'Broad Market ETF';
  if (symbol === 'RKLB') return 'Aerospace';
  if (symbol === 'OKLO') return 'Energy';
  if (symbol === 'TOTDF') return 'Consumer Cyclical';
  return holding.fundamentals?.sector || 'Other';
}

function riskDashboardForHoldings(holdings, totalValue) {
  const valued = (holdings || []).filter(h => Number(h.value || 0) > 0);
  const largest = [...valued].sort((a, b) => Number(b.value || 0) - Number(a.value || 0))[0];
  const sectorTotals = valued.reduce((groups, holding) => {
    const sector = sectorForHolding(holding);
    groups[sector] = (groups[sector] || 0) + Number(holding.value || 0);
    return groups;
  }, {});
  const largestSector = Object.entries(sectorTotals).sort((a, b) => b[1] - a[1])[0];
  const weightedVolatility = totalValue
    ? valued.reduce((sum, h) => sum + (dailyVolatility(h.history) || 0) * (Number(h.value || 0) / totalValue), 0)
    : null;
  const weightedDrawdown = totalValue
    ? valued.reduce((sum, h) => sum + (maxDrawdown(h.history) || 0) * (Number(h.value || 0) / totalValue), 0)
    : null;
  const speculativeSymbols = new Set(['OKLO', 'RKLB']);
  const speculativeValue = valued
    .filter(h => speculativeSymbols.has(String(h.symbol).toUpperCase()))
    .reduce((sum, h) => sum + Number(h.value || 0), 0);
  const highVolCount = valued.filter(h => (dailyVolatility(h.history) || 0) >= 60).length;

  return {
    largestSymbol: largest?.symbol || '--',
    largestWeight: totalValue && largest ? (Number(largest.value || 0) / totalValue) * 100 : null,
    largestSector: largestSector?.[0] || '--',
    largestSectorWeight: totalValue && largestSector ? (largestSector[1] / totalValue) * 100 : null,
    weightedVolatility,
    weightedDrawdown,
    speculativeWeight: totalValue ? (speculativeValue / totalValue) * 100 : null,
    highVolCount
  };
}

function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function dashboardToCsv(dashboard) {
  const rows = [
    ['Symbol', 'Name', 'Shares', 'Average Cost', 'Price', 'Value', 'Day Change', 'Day Change %', 'Unrealized Gain', 'Unrealized Gain %', 'Sector', 'Earnings Period', 'EPS Avg', 'Revenue Avg', 'Growth'],
    ...(dashboard?.holdings || []).map(h => [
      h.symbol,
      h.name,
      h.shares,
      h.avgCost,
      h.price,
      h.value,
      h.dayChange,
      h.dayChangePercent,
      h.unrealizedGain,
      h.unrealizedGainPercent,
      sectorForHolding(h),
      h.fundamentals?.earningsTrends?.[0]?.period || '',
      h.fundamentals?.earningsTrends?.[0]?.earningsEstimateAvg || '',
      h.fundamentals?.earningsTrends?.[0]?.revenueEstimateAvg || '',
      h.fundamentals?.earningsTrends?.[0]?.growth || ''
    ])
  ];
  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

function StatCard({ label, value, sub, positive, className = '' }) {
  return <div className={`stat-card ${className}`}>
    <span>{label}</span>
    <strong className={positive === true ? 'good' : positive === false ? 'bad' : ''}>{value}</strong>
    {sub && <small>{sub}</small>}
  </div>;
}

function HoldingCard({ holding, onDelete, onUpdate, pinned, onTogglePin }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ shares: holding.shares, avgCost: holding.avgCost });
  const chartData = useMemo(() => {
    const history = holding.history?.slice(-75).map(p => ({ date: p.date.slice(5), close: Number(p.close.toFixed(2)) })) || [];
    const forecast = holding.forecast?.map(p => ({ date: p.date.slice(5), close: Number(p.predictedClose.toFixed(2)), predicted: true })) || [];
    return [...history, ...forecast];
  }, [holding]);

  const dayPositive = Number(holding.dayChange || 0) >= 0;
  const gainPositive = Number(holding.unrealizedGain || 0) >= 0;
  const positionDayChange = Number(holding.shares || 0) * Number(holding.dayChange || 0);
  async function saveEdit(e) {
    e.preventDefault();
    await onUpdate({ symbol: holding.symbol, shares: editForm.shares, avgCost: editForm.avgCost });
    setEditing(false);
  }

  return <section className="holding-card">
    <div className="holding-top">
      <div>
        <div className="symbol-row">
          <h2>{holding.symbol}</h2>
          <button onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}</button>
          <button className={pinned ? 'pin active' : 'pin'} onClick={() => onTogglePin(holding.symbol)} title={pinned ? 'Unpin holding' : 'Pin holding'}><Star size={17}/></button>
          <button className="pin" onClick={() => setEditing(true)} title="Edit holding"><Edit3 size={17}/></button>
        </div>
        <p>{holding.name}</p>
      </div>
      <button className="icon danger" onClick={() => onDelete(holding.symbol)} title="Remove holding"><Trash2 size={18}/></button>
    </div>

    {editing && (
      <form className="inline-edit" onSubmit={saveEdit}>
        <input type="number" step="any" value={editForm.shares} onChange={e => setEditForm({ ...editForm, shares: e.target.value })} aria-label={`${holding.symbol} shares`} />
        <input type="number" step="any" value={editForm.avgCost} onChange={e => setEditForm({ ...editForm, avgCost: e.target.value })} aria-label={`${holding.symbol} average cost`} />
        <button><Save size={16}/> Save</button>
        <button type="button" className="secondary" onClick={() => setEditing(false)}><X size={16}/> Cancel</button>
      </form>
    )}

    <div className="holding-grid">
      <StatCard label="Price" value={money(holding.price)} sub={`Day: ${signedMoney(holding.dayChange)} (${signedPct(holding.dayChangePercent)})`} positive={dayPositive} />
      <StatCard label="Position Value" value={money(holding.value)} sub={`${num(holding.shares)} shares @ ${money(holding.avgCost)}`} />
      <StatCard label="Position Day Change" value={signedMoney(positionDayChange)} sub={signedPct(holding.dayChangePercent)} positive={positionDayChange >= 0} />
      <StatCard label="Unrealized P/L" value={money(holding.unrealizedGain)} sub={pct(holding.unrealizedGainPercent)} positive={gainPositive} />
      <StatCard className="signal-card" label="Signal" value={holding.signal} sub={`SMA20 ${money(holding.sma20)} - SMA50 ${money(holding.sma50)}`} />
    </div>

    {holding.dataStatus === 'error' && (
      <div className="notice error inline-error">Yahoo data unavailable for {holding.symbol}: {holding.dataError || 'unknown error'}</div>
    )}

    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={190}>
        <AreaChart data={chartData} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" minTickGap={38} />
          <YAxis domain={['auto', 'auto']} width={64} />
          <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} labelStyle={{ color: 'var(--text)' }} formatter={(v) => money(v)} />
          <Area type="monotone" dataKey="close" stroke="var(--blue)" fill="var(--blue)" strokeWidth={2} fillOpacity={0.10} />
        </AreaChart>
      </ResponsiveContainer>
    </div>

    {open && <div className="details">
      <div className="mini-grid">
        <StatCard label="Day High / Low" value={`${money(holding.dayHigh)} / ${money(holding.dayLow)}`} />
        <StatCard label="Prev Close" value={money(holding.previousClose)} />
        <StatCard label="Volume" value={num(holding.volume, 0)} sub={`Avg ${num(holding.avgVolume, 0)}`} />
        <StatCard label="52W High / Low" value={`${holding.fundamentals?.fiftyTwoWeekHigh || '--'} / ${holding.fundamentals?.fiftyTwoWeekLow || '--'}`} />
        <StatCard label="Market Cap" value={holding.fundamentals?.marketCap || '--'} />
        <StatCard label="P/E" value={`T: ${holding.fundamentals?.trailingPE || '--'} - F: ${holding.fundamentals?.forwardPE || '--'}`} />
        <StatCard label="Target Mean Price" value={holding.fundamentals?.targetMeanPrice || '--'} />
        <StatCard label="Latest Earnings Period" value={holding.fundamentals?.earningsTrends?.[0]?.period || '--'} sub={`EPS ${holding.fundamentals?.earningsTrends?.[0]?.earningsEstimateAvg || '--'}`} />
      </div>

      <h3>Earnings / Revenue Estimates</h3>
      <div className="earnings-table">
        <div className="row head"><span>Period</span><span>EPS Avg</span><span>Revenue Avg</span><span>Growth</span></div>
        {(holding.fundamentals?.earningsTrends || []).map((t, i) => (
          <div className="row" key={i}><span>{t.period}</span><span>{t.earningsEstimateAvg || '--'}</span><span>{t.revenueEstimateAvg || '--'}</span><span>{t.growth || '--'}</span></div>
        ))}
      </div>
    </div>}
  </section>;
}

function HoldingsTable({ holdings, pinnedSymbols, visibleColumns, onTogglePin, onUpdate, onDelete }) {
  const [editingSymbol, setEditingSymbol] = useState('');
  const [editForm, setEditForm] = useState({ shares: '', avgCost: '' });
  const shownColumns = HOLDING_COLUMNS.filter(column => visibleColumns.includes(column.key));
  const gridTemplate = `42px minmax(90px, .65fr) ${shownColumns.map(column => column.key === 'signal' ? 'minmax(150px, 1.1fr)' : 'minmax(100px, 1fr)').join(' ')} 110px`;
  function startEdit(holding) {
    setEditingSymbol(holding.symbol);
    setEditForm({ shares: holding.shares, avgCost: holding.avgCost });
  }
  async function saveEdit(symbol) {
    await onUpdate({ symbol, shares: editForm.shares, avgCost: editForm.avgCost });
    setEditingSymbol('');
  }
  return <div className="holdings-table">
    <div className="holdings-table-row head" style={{ gridTemplateColumns: gridTemplate }}>
      <span></span>
      <span>Symbol</span>
      {shownColumns.map(column => <span key={column.key}>{column.label}</span>)}
      <span></span>
    </div>
    {holdings.map(holding => {
      const editing = editingSymbol === holding.symbol;
      const positionDayChange = Number(holding.shares || 0) * Number(holding.dayChange || 0);
      const cells = {
        price: <span>{money(holding.price)}</span>,
        shares: editing ? <input type="number" step="any" value={editForm.shares} onChange={e => setEditForm({ ...editForm, shares: e.target.value })}/> : <span>{num(holding.shares)}</span>,
        avgCost: editing ? <input type="number" step="any" value={editForm.avgCost} onChange={e => setEditForm({ ...editForm, avgCost: e.target.value })}/> : <span>{money(holding.avgCost)}</span>,
        value: <span>{money(holding.value)}</span>,
        day: <span className={positionDayChange >= 0 ? 'good' : 'bad'}>{signedMoney(positionDayChange)} <small>{signedPct(holding.dayChangePercent)}</small></span>,
        gain: <span className={Number(holding.unrealizedGain || 0) >= 0 ? 'good' : 'bad'}>{money(holding.unrealizedGain)} <small>{pct(holding.unrealizedGainPercent)}</small></span>,
        signal: <span>{holding.signal}</span>
      };
      return <div className="holdings-table-row" key={holding.symbol} style={{ gridTemplateColumns: gridTemplate }}>
        <button className={pinnedSymbols.includes(holding.symbol) ? 'pin active' : 'pin'} onClick={() => onTogglePin(holding.symbol)} title={pinnedSymbols.includes(holding.symbol) ? 'Unpin holding' : 'Pin holding'}><Star size={16}/></button>
        <strong>{holding.symbol}</strong>
        {shownColumns.map(column => <React.Fragment key={column.key}>{cells[column.key]}</React.Fragment>)}
        <span className="row-actions">
          {editing
            ? <>
                <button className="pin" onClick={() => saveEdit(holding.symbol)} title="Save"><Save size={16}/></button>
                <button className="pin" onClick={() => setEditingSymbol('')} title="Cancel"><X size={16}/></button>
              </>
            : <button className="pin" onClick={() => startEdit(holding)} title="Edit"><Edit3 size={16}/></button>}
          <button className="pin danger" onClick={() => onDelete(holding.symbol)} title="Remove"><Trash2 size={16}/></button>
        </span>
      </div>;
    })}
  </div>;
}

function PortfolioSnapshotPanel({ snapshots = [] }) {
  const chartData = snapshots.slice(-90).map(row => ({
    date: String(row.date || '').slice(5),
    totalValue: Number(row.totalValue || 0),
    holdingsValue: Number(row.holdingsValue || 0),
    cashBalance: Number(row.cashBalance || 0)
  })).filter(row => row.totalValue > 0);
  const latest = snapshots.at(-1);
  const first = chartData[0];
  const last = chartData.at(-1);
  const change = first && last ? last.totalValue - first.totalValue : null;
  return <section className="panel snapshot-panel">
    <div className="panel-head">
      <div>
        <h2>Portfolio History</h2>
        <p>Daily value snapshots saved locally when the dashboard refreshes.</p>
      </div>
      <div className="snapshot-stats">
        <strong>{money(latest?.totalValue)}</strong>
        <span className={Number(change || 0) >= 0 ? 'good' : 'bad'}>{signedMoney(change)}</span>
      </div>
    </div>
    {chartData.length > 1 ? (
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={chartData} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={32} />
            <YAxis tickFormatter={compactMoney} width={72} />
            <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} labelStyle={{ color: 'var(--text)' }} formatter={(value, name) => [money(value), name]} />
            <Area type="monotone" dataKey="totalValue" name="Total value" stroke="var(--green)" fill="var(--green)" fillOpacity={0.18} strokeWidth={2} />
            <Area type="monotone" dataKey="holdingsValue" name="Holdings value" stroke="var(--blue)" fill="var(--blue)" fillOpacity={0.10} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    ) : <div className="empty-state">Refresh on another day to build the portfolio history chart.</div>}
  </section>;
}

function BenchmarkPanel({ dashboard, benchmarks, loading, error, onRefresh }) {
  const benchmarkRows = benchmarks?.benchmarks || [];
  const colors = ['var(--green)', 'var(--blue)', 'var(--warning)', 'var(--purple)'];
  const baseHistory = benchmarkRows[0]?.history?.slice(-90) || [];
  const portfolioSnapshots = (dashboard?.snapshots || []).slice(-90).filter(row => Number(row.totalValue || 0) > 0);
  const portfolioFirst = portfolioSnapshots[0]?.totalValue;
  const portfolioByDate = new Map(portfolioSnapshots.map(row => [
    String(row.date || '').slice(0, 10),
    portfolioFirst ? ((Number(row.totalValue || 0) - Number(portfolioFirst)) / Number(portfolioFirst)) * 100 : null
  ]));
  const chartData = baseHistory.map(row => {
    const dateKey = String(row.date || '').slice(0, 10);
    const item = { date: dateKey.slice(5) };
    benchmarkRows.forEach(benchmark => {
      const match = (benchmark.history || []).find(point => String(point.date || '').slice(0, 10) === dateKey);
      item[benchmark.symbol] = match?.normalized ?? null;
    });
    if (portfolioByDate.has(dateKey)) item.Portfolio = portfolioByDate.get(dateKey);
    return item;
  });
  const portfolioReturn = portfolioSnapshots.length > 1 && portfolioFirst
    ? ((Number(portfolioSnapshots.at(-1).totalValue || 0) - Number(portfolioFirst)) / Number(portfolioFirst)) * 100
    : null;

  return <section className="panel benchmark-panel">
    <div className="panel-head">
      <div>
        <h2>Benchmark Comparison</h2>
        <p>Compares your saved portfolio history against common market ETFs.</p>
      </div>
      <button className="secondary" onClick={onRefresh}><RefreshCw size={16}/> Refresh</button>
    </div>
    {error && <div className="notice error inline-error">{error}</div>}
    <div className="benchmark-stats">
      <div className="benchmark-chip">
        <span>Portfolio</span>
        <strong className={Number(portfolioReturn || 0) >= 0 ? 'good' : 'bad'}>{portfolioReturn === null ? '--' : signedPct(portfolioReturn)}</strong>
      </div>
      {benchmarkRows.map((benchmark, index) => (
        <div className="benchmark-chip" key={benchmark.symbol}>
          <span><i style={{ background: colors[index % colors.length] }} />{benchmark.symbol}</span>
          <strong className={Number(benchmark.returnPercent || 0) >= 0 ? 'good' : 'bad'}>{benchmark.returnPercent === null ? '--' : signedPct(benchmark.returnPercent)}</strong>
          <small>{benchmark.name}</small>
        </div>
      ))}
    </div>
    {loading ? <div className="empty-state">Loading benchmark data...</div> : chartData.length > 1 ? (
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={28} />
            <YAxis tickFormatter={value => `${Number(value).toFixed(0)}%`} width={56} />
            <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} labelStyle={{ color: 'var(--text)' }} formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name]} />
            <Area type="monotone" dataKey="Portfolio" name="Portfolio" stroke="var(--red)" fill="var(--red)" fillOpacity={0.08} strokeWidth={2} connectNulls />
            {benchmarkRows.map((benchmark, index) => (
              <Area key={benchmark.symbol} type="monotone" dataKey={benchmark.symbol} name={benchmark.symbol} stroke={colors[index % colors.length]} fill={colors[index % colors.length]} fillOpacity={0.10} strokeWidth={2} connectNulls />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    ) : <div className="empty-state">No benchmark chart data loaded yet.</div>}
  </section>;
}

function CommandPalette({ open, query, actions, onQueryChange, onClose }) {
  const filtered = actions.filter(action => action.label.toLowerCase().includes(query.trim().toLowerCase()));
  if (!open) return null;
  function run(action) {
    action.run();
    onQueryChange('');
    onClose();
  }
  return <div className="command-backdrop" onMouseDown={onClose}>
    <section className="command-palette" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="command-input">
        <Command size={18}/>
        <input autoFocus placeholder="Search commands..." value={query} onChange={e => onQueryChange(e.target.value)} />
      </div>
      <div className="command-list">
        {filtered.map(action => (
          <button type="button" className="command-item" key={action.label} onClick={() => run(action)}>
            <span>{action.label}</span>
            {action.hint && <kbd>{action.hint}</kbd>}
          </button>
        ))}
        {!filtered.length && <div className="empty-state">No commands found.</div>}
      </div>
    </section>
  </div>;
}

function BreakdownTab({ dashboard }) {
  const [scenario, setScenario] = useState('base');
  const holdings = dashboard?.holdings || [];
  const totalValue = Number(dashboard?.totalValue || 0);
  const allocation = holdings
    .filter(h => Number(h.value || 0) > 0)
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .map((h, index) => ({
      name: h.symbol,
      value: Number(h.value || 0),
      percent: totalValue ? (Number(h.value || 0) / totalValue) * 100 : 0,
      color: COLORS[index % COLORS.length]
    }));
  if (Number(dashboard?.cashBalance || 0) > 0) {
    allocation.push({
      name: 'Cash',
      value: Number(dashboard.cashBalance),
      percent: totalValue ? (Number(dashboard.cashBalance) / totalValue) * 100 : 0,
      color: COLORS[allocation.length % COLORS.length]
    });
  }
  const sectorAllocation = Object.values(holdings.reduce((groups, holding) => {
    const value = Number(holding.value || 0);
    if (value <= 0) return groups;
    const sector = sectorForHolding(holding);
    groups[sector] ||= { name: sector, value: 0, symbols: [] };
    groups[sector].value += value;
    groups[sector].symbols.push(holding.symbol);
    return groups;
  }, {}))
    .sort((a, b) => b.value - a.value)
    .map((item, index) => ({
      ...item,
      percent: totalValue ? (item.value / totalValue) * 100 : 0,
      color: COLORS[index % COLORS.length]
    }));
  if (Number(dashboard?.cashBalance || 0) > 0) {
    sectorAllocation.push({
      name: 'Cash',
      value: Number(dashboard.cashBalance),
      symbols: ['Cash'],
      percent: totalValue ? (Number(dashboard.cashBalance) / totalValue) * 100 : 0,
      color: COLORS[sectorAllocation.length % COLORS.length]
    });
  }
  const projections = holdings.map(holding => projectionForHolding(holding, scenario)).filter(p => p.value > 0);
  const riskStats = riskDashboardForHoldings(holdings, totalValue);
  const current = projections.reduce((sum, p) => sum + p.value, 0);
  const oneYear = projections.reduce((sum, p) => sum + p.oneYearValue, 0);
  const lowOneYear = projections.reduce((sum, p) => sum + p.lowOneYearValue, 0);
  const highOneYear = projections.reduce((sum, p) => sum + p.highOneYearValue, 0);
  const threeYear = projections.reduce((sum, p) => sum + p.threeYearValue, 0);
  const weightedReturn = current ? projections.reduce((sum, p) => sum + p.expectedAnnualReturn * p.value, 0) / current : null;
  const weightedLowReturn = current ? projections.reduce((sum, p) => sum + p.lowAnnualReturn * p.value, 0) / current : null;
  const weightedHighReturn = current ? projections.reduce((sum, p) => sum + p.highAnnualReturn * p.value, 0) / current : null;
  const weightedRisk = current ? projections.reduce((sum, p) => sum + p.riskScore * p.value, 0) / current : null;
  const weightedConfidence = current ? projections.reduce((sum, p) => sum + p.confidenceScore * p.value, 0) / current : null;
  const projectionChart = [
    { label: 'Today', value: current },
    { label: '1Y Low', value: lowOneYear },
    { label: '1Y', value: oneYear },
    { label: '1Y High', value: highOneYear },
    { label: '3Y', value: threeYear }
  ];

  return <div className="breakdown-grid">
    <div className="breakdown-left">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Portfolio Breakdown</h2>
            <p>Current allocation by market value.</p>
          </div>
        </div>
        <div className="pie-layout">
          <div className="pie-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                  {allocation.map(item => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} labelStyle={{ color: 'var(--text)' }} formatter={(v) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="allocation-list">
            {allocation.length ? allocation.map(item => (
              <div className="allocation-row" key={item.name}>
                <span className="swatch" style={{ background: item.color }} />
                <strong>{item.name}</strong>
                <span>{money(item.value)}</span>
                <span>{pct(item.percent)}</span>
              </div>
            )) : <div className="empty-state">Add holdings to see allocation.</div>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Sector Breakdown</h2>
            <p>Current allocation grouped by sector or asset type.</p>
          </div>
        </div>
        <div className="pie-layout">
          <div className="pie-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={sectorAllocation} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                  {sectorAllocation.map(item => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} labelStyle={{ color: 'var(--text)' }} formatter={(v) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="allocation-list">
            {sectorAllocation.length ? sectorAllocation.map(item => (
              <div className="allocation-row sector-row" key={item.name}>
                <span className="swatch" style={{ background: item.color }} />
                <strong>{item.name}</strong>
                <span>{money(item.value)}</span>
                <span>{pct(item.percent)}</span>
                <small>{item.symbols.join(', ')}</small>
              </div>
            )) : <div className="empty-state">Add holdings to see sector allocation.</div>}
          </div>
        </div>
      </section>
    </div>

    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Growth Projection</h2>
          <p>Uses risk-adjusted momentum, trend, fundamentals, analyst targets, and news/policy sentiment.</p>
        </div>
        <div className="segmented">
          {Object.entries(SCENARIOS).map(([key, item]) => (
            <button className={scenario === key ? 'active' : ''} key={key} onClick={() => setScenario(key)}>{item.label}</button>
          ))}
        </div>
      </div>
      <div className="projection-summary">
        <StatCard label="Expected 1Y Return Range" value={`${pct(weightedLowReturn)} to ${pct(weightedHighReturn)}`} sub={`Base ${pct(weightedReturn)}`} positive={Number(weightedReturn || 0) >= 0} />
        <StatCard label="Projected 1Y Value" value={money(oneYear)} sub={`${money(lowOneYear)} to ${money(highOneYear)}`} positive={oneYear >= current} />
        <StatCard label="Projected 3Y Value" value={money(threeYear)} sub={money(threeYear - current)} positive={threeYear >= current} />
        <StatCard label="Risk / Confidence" value={`${riskLabel(weightedRisk)} / ${scoreLabel(weightedConfidence)}`} sub={`${num(weightedRisk, 0)} risk - ${num(weightedConfidence, 0)} confidence`} />
      </div>
      <div className="chart-wrap projection-chart">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={projectionChart} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis width={78} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
            <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} labelStyle={{ color: 'var(--text)' }} formatter={(v) => money(v)} />
            <Area type="monotone" dataKey="value" stroke="var(--blue)" fill="var(--blue)" strokeWidth={2} fillOpacity={0.10} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="projection-table">
        <div className="projection-row head"><span>Holding</span><span>1Y range</span><span>Risk / confidence</span><span>Why</span></div>
        {projections.map(p => (
          <div className="projection-row" key={p.symbol}>
            <span>{p.symbol}</span>
            <strong className={p.expectedAnnualReturn >= 0 ? 'good' : 'bad'}>{pct(p.lowAnnualReturn)} to {pct(p.highAnnualReturn)}</strong>
            <span>{p.riskLabel} / {p.confidenceLabel}</span>
            <small>{p.reason}. Prior {pct(p.priorReturn)} - Signal {pct(p.signalReturn)} - 3M {pct(p.threeMonthReturn)} - Vol {pct(p.volatility)}</small>
          </div>
        ))}
      </div>
      <p className="model-note">Projection is a planning estimate, not financial advice. The range widens when volatility, drawdown, or missing data make the estimate less reliable.</p>
    </section>
    <section className="panel risk-panel">
      <div className="panel-head">
        <div>
          <h2>Risk Dashboard</h2>
          <p>Concentration, volatility, drawdown, and speculative exposure checks.</p>
        </div>
        <ShieldAlert size={22}/>
      </div>
      <div className="risk-grid">
        <StatCard label="Largest Holding" value={riskStats.largestSymbol} sub={pct(riskStats.largestWeight)} positive={riskStats.largestWeight < 25} />
        <StatCard label="Largest Sector" value={riskStats.largestSector} sub={pct(riskStats.largestSectorWeight)} positive={riskStats.largestSectorWeight < 45} />
        <StatCard label="Weighted Volatility" value={pct(riskStats.weightedVolatility)} sub="Annualized from daily moves" positive={riskStats.weightedVolatility < 45} />
        <StatCard label="Weighted Drawdown" value={pct(riskStats.weightedDrawdown)} sub="6-month max drawdown blend" positive={riskStats.weightedDrawdown < 20} />
        <StatCard label="Speculative Exposure" value={pct(riskStats.speculativeWeight)} sub="OKLO + RKLB" positive={riskStats.speculativeWeight < 15} />
        <StatCard label="High-Vol Holdings" value={num(riskStats.highVolCount, 0)} sub="Volatility over 60%" positive={riskStats.highVolCount <= 3} />
      </div>
    </section>
  </div>;
}

function NewsCard({ article }) {
  return <a className="news-card" href={article.link} target="_blank" rel="noreferrer">
    <div className="news-meta">
      <span>{article.topic}</span>
      <span>{article.source}</span>
      <span>{dateLabel(article.publishedAt)}</span>
    </div>
    <h3>{article.title}</h3>
    {article.description && <p>{article.description}</p>}
    <small>Open story <ExternalLink size={13} /></small>
  </a>;
}

function NewsGroup({ group }) {
  const [lead, ...rest] = group.articles || [];
  return <section className="news-group">
    <div className="news-group-head">
      <div>
        <h3>{group.name}</h3>
        <span>{group.symbol} - {money(group.value)}</span>
      </div>
    </div>
    {lead ? (
      <div className="story-cluster">
        <a className="lead-story" href={lead.link} target="_blank" rel="noreferrer">
          <div className="news-meta">
            <span>{lead.source}</span>
            <span>{dateLabel(lead.publishedAt)}</span>
          </div>
          <h4>{lead.title}</h4>
          {lead.description && <p>{lead.description}</p>}
          <small>Open story <ExternalLink size={13} /></small>
        </a>
        <div className="side-stories">
          {rest.map(article => (
            <a className="side-story" href={article.link} target="_blank" rel="noreferrer" key={`${article.title}-${article.link}`}>
              <div className="news-meta">
                <span>{article.source}</span>
                <span>{dateLabel(article.publishedAt)}</span>
              </div>
              <h4>{article.title}</h4>
            </a>
          ))}
        </div>
      </div>
    ) : <div className="empty-state">No recent headlines found for {group.symbol}.</div>}
  </section>;
}

function NewsTab({ news, loading, error, onRefresh }) {
  return <div className="news-view">
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Portfolio News</h2>
          <p>Recent headlines for companies in your holdings.</p>
        </div>
        <button onClick={onRefresh}><RefreshCw size={16}/> Refresh News</button>
      </div>
      {loading && <div className="notice">Loading latest news...</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="news-groups">
        {(news?.portfolioGroups || []).map(group => <NewsGroup key={group.symbol} group={group} />)}
      </div>
      {!loading && !error && !(news?.portfolioGroups || []).length && <div className="empty-state">No portfolio headlines found.</div>}
    </section>

    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>President / Policy News</h2>
          <p>Market-relevant White House, economy, tariff, and regulation headlines.</p>
        </div>
      </div>
      <div className="news-grid policy-news">
        {(news?.policyNews || []).map(article => <NewsCard key={`${article.title}-${article.link}`} article={article} />)}
      </div>
      {!loading && !error && !(news?.policyNews || []).length && <div className="empty-state">No policy headlines found.</div>}
    </section>
  </div>;
}

function EarningsHistoryCharts({ rows }) {
  const chartRows = rows
    .filter(row => (row.history || []).some(item => Number.isFinite(item.revenue) || Number.isFinite(item.eps)))
    .slice(0, 8);
  if (!chartRows.length) return null;
  return <section className="earnings-history-panel">
    <div className="panel-head">
      <div>
        <h2>Earnings History</h2>
        <p>Last reported quarters from Yahoo fundamentals data.</p>
      </div>
    </div>
    <div className="earnings-history-grid">
      {chartRows.map(row => {
        const data = (row.history || []).map(item => ({
          date: String(item.date || '').slice(2, 7),
          revenue: item.revenue,
          eps: item.eps,
          growth: item.revenueGrowthYoY
        }));
        return <div className="mini-chart-card" key={row.symbol}>
          <div className="mini-chart-head">
            <strong>{row.symbol}</strong>
            <span>{row.reportDate || row.period || '--'}</span>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={16} />
              <YAxis yAxisId="left" tickFormatter={compactMoney} width={58} />
              <YAxis yAxisId="right" orientation="right" width={36} />
              <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} labelStyle={{ color: 'var(--text)' }} formatter={(value, name) => [name === 'revenue' ? compactMoney(value) : num(value, 2), name]} />
              <Area yAxisId="left" type="monotone" dataKey="revenue" name="revenue" stroke="var(--blue)" fill="var(--blue)" fillOpacity={0.18} strokeWidth={2} />
              <Area yAxisId="right" type="monotone" dataKey="eps" name="eps" stroke="var(--green)" fill="var(--green)" fillOpacity={0.10} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>;
      })}
    </div>
  </section>;
}

function EarningsTab({ dashboard, earningsNews, loading, error, onRefresh }) {
  const [earningsSort, setEarningsSort] = useState({ key: 'value', dir: 'desc' });
  const reportBySymbol = Object.fromEntries((earningsNews?.reports || []).map(report => [report.symbol, report]));
  const rows = useMemo(() => (dashboard?.holdings || [])
    .map(holding => {
      const report = reportBySymbol[holding.symbol] || {};
      return {
        symbol: holding.symbol,
        name: holding.name,
        value: holding.value,
        isFund: report.isFund,
        quoteType: report.quoteType,
        status: report.status,
        reportDate: report.reportDate || null,
        reportDateSource: report.reportDateSource || null,
        period: report.period || null,
        epsActual: report.epsActual,
        epsEstimate: report.epsEstimate,
        surprisePercent: report.surprisePercent,
        revenue: report.revenue,
        growth: report.growth,
        growthBasis: report.growthBasis,
        history: report.history || [],
        source: report.source || null
      };
    })
    .sort((a, b) => String(a.symbol).localeCompare(String(b.symbol))), [dashboard, earningsNews]);
  const earningsColumns = [
    { key: 'symbol', label: 'Symbol', type: 'text' },
    { key: 'reportDate', label: 'Report Date', type: 'date' },
    { key: 'period', label: 'Fiscal Period', type: 'date' },
    { key: 'epsActual', label: 'EPS', type: 'number' },
    { key: 'revenue', label: 'Revenue', type: 'number' },
    { key: 'growth', label: 'Growth', type: 'number' },
    { key: 'growthBasis', label: 'Basis', type: 'text' },
    { key: 'source', label: 'Source', type: 'text' },
    { key: 'value', label: 'Position', type: 'number' }
  ];
  const sortedRows = useMemo(() => {
    const column = earningsColumns.find(item => item.key === earningsSort.key) || earningsColumns[0];
    const direction = earningsSort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const aValue = a[column.key];
      const bValue = b[column.key];
      const aMissing = aValue === null || aValue === undefined || aValue === '';
      const bMissing = bValue === null || bValue === undefined || bValue === '';
      if (aMissing && bMissing) return String(a.symbol).localeCompare(String(b.symbol));
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (column.type === 'number') {
        const diff = Number(aValue) - Number(bValue);
        return diff === 0 ? String(a.symbol).localeCompare(String(b.symbol)) : diff * direction;
      }
      if (column.type === 'date') {
        const diff = new Date(aValue).getTime() - new Date(bValue).getTime();
        return diff === 0 ? String(a.symbol).localeCompare(String(b.symbol)) : diff * direction;
      }
      const diff = String(aValue).localeCompare(String(bValue));
      return diff === 0 ? String(a.symbol).localeCompare(String(b.symbol)) : diff * direction;
    });
  }, [rows, earningsSort]);
  function setEarningsColumn(key) {
    setEarningsSort(current => current.key === key
      ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' });
  }

  const withInfo = rows.filter(row => row.period || row.epsActual !== null || row.revenue !== null || row.growth !== null);
  const growthRows = rows
    .map(row => ({ ...row, growthValue: Number(row.growth) }))
    .filter(row => Number.isFinite(row.growthValue))
    .sort((a, b) => b.growthValue - a.growthValue);

  return <div className="earnings-view">
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Latest Earnings Info</h2>
          <p>Last reported fiscal quarter from Yahoo, with SEC fallback when Yahoo is stale.</p>
        </div>
        <button onClick={onRefresh}><RefreshCw size={16}/> Refresh Earnings</button>
      </div>
      {loading && <div className="notice">Loading latest earnings reports...</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="projection-summary">
        <StatCard label="With Reports" value={num(withInfo.length, 0)} sub={`${num(rows.length, 0)} holdings tracked`} />
        <StatCard label="Highest Reported Growth" value={growthRows[0]?.symbol || '--'} sub={growthRows[0] ? `${signedPct(growthRows[0].growthValue)} ${growthRows[0].growthBasis || ''}` : 'No growth data'} positive={Number(growthRows[0]?.growthValue || 0) >= 0} />
        <StatCard label="Tracked Holdings" value={num(rows.length, 0)} />
        <StatCard label="Missing Info" value={num(rows.length - withInfo.length, 0)} />
      </div>
      <div className="earnings-table full-table">
        <div className="earnings-row head">
          {earningsColumns.map(column => (
            <button type="button" key={column.key} className="table-sort" onClick={() => setEarningsColumn(column.key)}>
              <span>{column.label}</span>
              <span className={earningsSort.key === column.key ? 'sort-arrow active' : 'sort-arrow'}>{earningsSort.key === column.key && earningsSort.dir === 'asc' ? '↑' : '↓'}</span>
            </button>
          ))}
        </div>
        {sortedRows.map(row => (
          <div className="earnings-row" key={row.symbol}>
            <strong>{row.symbol}</strong>
            <span title={row.reportDateSource ? `Report date source: ${row.reportDateSource}` : ''}>{row.reportDate || '--'}</span>
            <span>{row.period || (row.isFund ? 'ETF / fund' : '--')}</span>
            <span>{num(row.epsActual, 2)}</span>
            <span>{compactMoney(row.revenue)}</span>
            <span className={Number(row.growth || 0) >= 0 ? 'good' : 'bad'}>{row.growth === null || row.growth === undefined ? (row.growthBasis || '--') : signedPct(row.growth)}</span>
            <span>{row.growthBasis || '--'}</span>
            <span>{row.source || '--'}</span>
            <span>{money(row.value)}</span>
          </div>
        ))}
      </div>
      <EarningsHistoryCharts rows={rows} />
    </section>
  </div>;
}

function sortValue(holding, sortBy) {
  if (sortBy === 'price') return Number(holding.price || 0);
  if (sortBy === 'value') return Number(holding.value || 0);
  if (sortBy === 'quantity') return Number(holding.shares || 0);
  if (sortBy === 'stockDay') return Number(holding.dayChange || 0);
  if (sortBy === 'stockDayPercent') return Number(holding.dayChangePercent || 0);
  if (sortBy === 'positionDay') return Number(holding.shares || 0) * Number(holding.dayChange || 0);
  return Number(holding.value || 0);
}

function App() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ symbol: '', shares: '', avgCost: '' });
  const [activeTab, setActiveTab] = useState('holdings');
  const [holdingView, setHoldingView] = useState(() => storageValue('holdingView', 'cards'));
  const [holdingSearch, setHoldingSearch] = useState('');
  const [pinnedSymbols, setPinnedSymbols] = useState(() => storageJson('pinnedHoldings', []));
  const [cashForm, setCashForm] = useState('');
  const [theme, setTheme] = useState(() => storageValue('theme', window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') === 'light' ? 'light' : 'dark');
  const [sortBy, setSortBy] = useState('value');
  const [sortDir, setSortDir] = useState('desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => storageJson('visibleHoldingColumns', DEFAULT_HOLDING_COLUMNS));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [benchmarks, setBenchmarks] = useState(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState('');
  const [news, setNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [earningsNews, setEarningsNews] = useState(null);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState('');
  const importInputRef = useRef(null);
  const searchInputRef = useRef(null);

  async function loadDashboard() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/dashboard`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load dashboard');
      setDashboard(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDashboard(); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);
  useEffect(() => {
    setCashForm(dashboard?.cashBalance ?? '');
  }, [dashboard?.cashBalance]);
  useEffect(() => {
    try { localStorage.setItem('holdingView', holdingView); } catch {}
  }, [holdingView]);
  useEffect(() => {
    try { localStorage.setItem('pinnedHoldings', JSON.stringify(pinnedSymbols)); } catch {}
  }, [pinnedSymbols]);
  useEffect(() => {
    try { localStorage.setItem('visibleHoldingColumns', JSON.stringify(visibleColumns)); } catch {}
  }, [visibleColumns]);
  useEffect(() => {
    function onKeyDown(e) {
      const target = e.target;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (commandOpen && e.key === 'Escape') {
        setCommandOpen(false);
        setCommandQuery('');
        return;
      }
      if (isTyping && e.key !== 'Escape') return;
      if (e.key === '/') {
        e.preventDefault();
        setActiveTab('holdings');
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (e.key.toLowerCase() === 'r') {
        loadDashboard();
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        setActiveTab(['holdings', 'breakdown', 'earnings', 'news'][Number(e.key) - 1]);
      } else if (e.key === 'Escape') {
        setSortOpen(false);
        setColumnsOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandOpen]);

  async function loadBenchmarks() {
    setBenchmarkLoading(true);
    setBenchmarkError('');
    try {
      const res = await fetch(`${API}/api/benchmarks?symbols=SPY,QQQ,VOO`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load benchmarks');
      setBenchmarks(data);
    } catch (e) {
      setBenchmarkError(e.message);
    } finally {
      setBenchmarkLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'holdings' && !benchmarks && !benchmarkLoading) loadBenchmarks();
  }, [activeTab, benchmarks, benchmarkLoading]);

  async function loadNews() {
    setNewsLoading(true);
    setNewsError('');
    try {
      const res = await fetch(`${API}/api/news`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load news');
      setNews(data);
    } catch (e) {
      setNewsError(e.message);
    } finally {
      setNewsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'news' && !news && !newsLoading) loadNews();
  }, [activeTab, news, newsLoading]);

  async function loadEarningsNews() {
    setEarningsLoading(true);
    setEarningsError('');
    try {
      const res = await fetch(`${API}/api/earnings`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load earnings news');
      setEarningsNews(data);
    } catch (e) {
      setEarningsError(e.message);
    } finally {
      setEarningsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'earnings' && !earningsLoading && !earningsNews?.reports) loadEarningsNews();
  }, [activeTab, earningsNews, earningsLoading]);

  async function addHolding(e) {
    e.preventDefault();
    await updateHolding(form, true);
  }

  async function updateHolding(item, clearForm = false) {
    const res = await fetch(`${API}/api/portfolio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    });
    if (res.ok) {
      if (clearForm) setForm({ symbol: '', shares: '', avgCost: '' });
      await loadDashboard();
    } else {
      const data = await res.json();
      setError(data.error || 'Could not save holding');
    }
  }

  async function deleteHolding(symbol) {
    await fetch(`${API}/api/portfolio/${symbol}`, { method: 'DELETE' });
    loadDashboard();
  }

  async function saveCash(e) {
    e.preventDefault();
    const res = await fetch(`${API}/api/settings/cash`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cashBalance: cashForm })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not save cash balance');
      return;
    }
    await loadDashboard();
  }

  function togglePinned(symbol) {
    setPinnedSymbols(current => current.includes(symbol)
      ? current.filter(item => item !== symbol)
      : [...current, symbol]);
  }

  function exportJson() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`portfolio-backup-${stamp}.json`, JSON.stringify(dashboard || {}, null, 2), 'application/json');
  }

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`portfolio-holdings-${stamp}.csv`, dashboardToCsv(dashboard), 'text/csv');
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch(`${API}/api/portfolio/import`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not import portfolio');
      setNews(null);
      setEarningsNews(null);
      await loadDashboard();
    } catch (e) {
      setError(e.message || 'Could not import portfolio');
    }
  }

  const visibleHoldings = useMemo(() => {
    const query = holdingSearch.trim().toLowerCase();
    return (dashboard?.holdings || []).filter(holding => !query
      || holding.symbol.toLowerCase().includes(query)
      || String(holding.name || '').toLowerCase().includes(query)
      || sectorForHolding(holding).toLowerCase().includes(query));
  }, [dashboard, holdingSearch]);

  const sortedHoldings = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...visibleHoldings].sort((a, b) => {
      const pinDiff = Number(pinnedSymbols.includes(b.symbol)) - Number(pinnedSymbols.includes(a.symbol));
      if (pinDiff !== 0) return pinDiff;
      const diff = sortValue(a, sortBy) - sortValue(b, sortBy);
      if (diff !== 0) return diff * direction;
      return String(a.symbol).localeCompare(String(b.symbol));
    });
  }, [visibleHoldings, pinnedSymbols, sortBy, sortDir]);
  const selectedSort = SORT_OPTIONS.find(option => option.value === sortBy) || SORT_OPTIONS[0];
  function toggleColumn(key) {
    setVisibleColumns(current => {
      if (current.includes(key)) {
        const next = current.filter(item => item !== key);
        return next.length ? next : current;
      }
      return [...current, key];
    });
  }
  const commandActions = [
    { label: 'Refresh dashboard', hint: 'R', run: loadDashboard },
    { label: 'Go to Holdings', hint: '1', run: () => setActiveTab('holdings') },
    { label: 'Go to Portfolio Breakdown', hint: '2', run: () => setActiveTab('breakdown') },
    { label: 'Go to Earnings', hint: '3', run: () => setActiveTab('earnings') },
    { label: 'Go to News', hint: '4', run: () => setActiveTab('news') },
    { label: 'Focus holdings search', hint: '/', run: () => { setActiveTab('holdings'); setTimeout(() => searchInputRef.current?.focus(), 0); } },
    { label: 'Switch to card view', run: () => setHoldingView('cards') },
    { label: 'Switch to table view', run: () => setHoldingView('table') },
    { label: 'Toggle theme', run: () => setTheme(current => current === 'dark' ? 'light' : 'dark') },
    { label: 'Refresh benchmarks', run: loadBenchmarks },
    { label: 'Export JSON', run: exportJson },
    { label: 'Export CSV', run: exportCsv }
  ];

  return <main>
    <header className="app-header">
      <div>
        <p className="eyebrow">Portfolio Stock Tracker</p>
        <h1>Your portfolio</h1>
      </div>
      <div className="header-actions">
        <button onClick={() => setCommandOpen(true)} title="Open command palette"><Command size={18}/> Commands</button>
        <button onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} title="Toggle theme" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>} {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <input ref={importInputRef} className="file-input" type="file" accept=".json,application/json" onChange={importJson} />
        <button onClick={() => importInputRef.current?.click()}><Upload size={18}/> Import</button>
        <button onClick={exportJson} disabled={!dashboard}><Download size={18}/> JSON</button>
        <button onClick={exportCsv} disabled={!dashboard}><Download size={18}/> CSV</button>
        <button className="refresh" onClick={loadDashboard}><RefreshCw size={18}/> Refresh</button>
      </div>
    </header>

    <section className="summary">
      <StatCard label="Total Value" value={money(dashboard?.totalValue)} sub={dashboard?.cashBalance ? `Cash ${money(dashboard.cashBalance)} - Updated ${new Date(dashboard.updatedAt).toLocaleString()}` : dashboard?.updatedAt ? `Updated ${new Date(dashboard.updatedAt).toLocaleString()}` : ''} />
      <StatCard label="Total Cost" value={money(dashboard?.totalCost)} />
      <StatCard label="Portfolio Day Change" value={signedMoney(dashboard?.dayValueChange)} sub={signedPct(dashboard?.dayValueChangePercent)} positive={Number(dashboard?.dayValueChange || 0) >= 0} />
      <StatCard label="Total Gain / Loss" value={money(dashboard?.totalGain)} sub={pct(dashboard?.totalGainPercent)} positive={Number(dashboard?.totalGain || 0) >= 0} />
      <form className="stat-card cash-card" onSubmit={saveCash}>
        <span>Cash Balance</span>
        <div className="cash-edit">
          <Wallet size={21}/>
          <input type="number" step="any" value={cashForm} onChange={e => setCashForm(e.target.value)} aria-label="Cash balance" />
          <button title="Save cash"><Save size={16}/></button>
        </div>
        <small>{dashboard?.holdings?.length || 0} holdings tracked</small>
      </form>
    </section>

    <form className="add-form" onSubmit={addHolding}>
      <input aria-label="Ticker symbol" placeholder="Ticker e.g. TSLA" value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })}/>
      <input aria-label="Shares" placeholder="Shares" type="number" step="any" value={form.shares} onChange={e => setForm({ ...form, shares: e.target.value })}/>
      <input aria-label="Average cost" placeholder="Average cost" type="number" step="any" value={form.avgCost} onChange={e => setForm({ ...form, avgCost: e.target.value })}/>
      <button><Plus size={18}/> Add / Update</button>
    </form>

    {loading && <div className="notice">Loading online stock data...</div>}
    {error && <div className="notice error">{error}</div>}

    <div className="tabs-row">
      <nav className="tabs" aria-label="Dashboard views">
        <button className={activeTab === 'holdings' ? 'active' : ''} onClick={() => setActiveTab('holdings')}><BriefcaseBusiness size={18}/> Holdings</button>
        <button className={activeTab === 'breakdown' ? 'active' : ''} onClick={() => setActiveTab('breakdown')}><BarChart3 size={18}/> Portfolio Breakdown</button>
        <button className={activeTab === 'earnings' ? 'active' : ''} onClick={() => setActiveTab('earnings')}><CalendarDays size={18}/> Earnings</button>
        <button className={activeTab === 'news' ? 'active' : ''} onClick={() => setActiveTab('news')}><Newspaper size={18}/> News</button>
      </nav>
        <div className={`sort-controls ${activeTab === 'holdings' ? '' : 'ghost'}`} aria-hidden={activeTab !== 'holdings'}>
          <label htmlFor="holding-sort">Sort</label>
          <div className="custom-select" id="holding-sort">
            <button
              type="button"
              className={`custom-select-trigger ${sortOpen ? 'open' : ''}`}
              disabled={activeTab !== 'holdings'}
              aria-haspopup="listbox"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen(open => !open)}
            >
              <span>{selectedSort.label}</span>
              <span className="chevron">v</span>
            </button>
            {sortOpen && activeTab === 'holdings' && (
              <div className="custom-select-menu" role="listbox">
                {SORT_OPTIONS.map(option => (
                  <button
                    type="button"
                    key={option.value}
                    className={sortBy === option.value ? 'selected' : ''}
                    role="option"
                    aria-selected={sortBy === option.value}
                    onClick={() => {
                      setSortBy(option.value);
                      setSortOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" disabled={activeTab !== 'holdings'} onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}>{sortDir === 'desc' ? 'High to low' : 'Low to high'}</button>
        </div>
    </div>

    {activeTab === 'holdings' && (
      <>
        <PortfolioSnapshotPanel snapshots={dashboard?.snapshots || []} />
        <BenchmarkPanel dashboard={dashboard} benchmarks={benchmarks} loading={benchmarkLoading} error={benchmarkError} onRefresh={loadBenchmarks} />
        <div className="holdings-toolbar">
          <label className="search-box">
            <Search size={18}/>
            <input ref={searchInputRef} placeholder="Search holdings, company, sector..." value={holdingSearch} onChange={e => setHoldingSearch(e.target.value)} />
          </label>
          <div className="toolbar-actions">
            <div className="columns-picker">
              <button type="button" className="secondary" onClick={() => setColumnsOpen(open => !open)}><Table2 size={17}/> Columns</button>
              {columnsOpen && (
                <div className="columns-menu">
                  {HOLDING_COLUMNS.map(column => (
                    <label key={column.key} className="check-row">
                      <input type="checkbox" checked={visibleColumns.includes(column.key)} onChange={() => toggleColumn(column.key)} />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="segmented">
              <button type="button" className={holdingView === 'cards' ? 'active' : ''} onClick={() => setHoldingView('cards')}><LayoutGrid size={17}/> Cards</button>
              <button type="button" className={holdingView === 'table' ? 'active' : ''} onClick={() => setHoldingView('table')}><Table2 size={17}/> Table</button>
            </div>
          </div>
        </div>
        {holdingSearch && <div className="filter-note">{sortedHoldings.length} of {dashboard?.holdings?.length || 0} holdings shown</div>}
        {holdingView === 'cards' ? (
          <div className="holdings">
            {sortedHoldings.map(h => <HoldingCard key={h.symbol} holding={h} onDelete={deleteHolding} onUpdate={updateHolding} pinned={pinnedSymbols.includes(h.symbol)} onTogglePin={togglePinned}/>) }
          </div>
        ) : (
          <HoldingsTable holdings={sortedHoldings} pinnedSymbols={pinnedSymbols} visibleColumns={visibleColumns} onTogglePin={togglePinned} onUpdate={updateHolding} onDelete={deleteHolding} />
        )}
      </>
    )}

    {activeTab === 'breakdown' && <BreakdownTab dashboard={dashboard} />}

    {activeTab === 'earnings' && <EarningsTab dashboard={dashboard} earningsNews={earningsNews} loading={earningsLoading} error={earningsError} onRefresh={loadEarningsNews} />}

    {activeTab === 'news' && <NewsTab news={news} loading={newsLoading} error={newsError} onRefresh={loadNews} />}
    <CommandPalette open={commandOpen} query={commandQuery} actions={commandActions} onQueryChange={setCommandQuery} onClose={() => setCommandOpen(false)} />
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
