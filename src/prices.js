// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Energy & shipping prices from Yahoo Finance's public chart endpoint (delayed ~10-15 min for futures).
import { bus, fetchJSON, log } from "./util.js";
import { raiseAlert } from "./alerts.js";

export const INSTRUMENTS = [
  { sym: "BZ=F", label: "BRENT", unit: "$/bbl", group: "energy" },
  { sym: "CL=F", label: "WTI", unit: "$/bbl", group: "energy" },
  { sym: "NG=F", label: "HENRY HUB", unit: "$/MMBtu", group: "energy" },
  { sym: "TTF=F", label: "DUTCH TTF", unit: "€/MWh", group: "energy" },
  { sym: "HO=F", label: "ULSD", unit: "$/gal", group: "energy" },
  { sym: "RB=F", label: "RBOB", unit: "$/gal", group: "energy" },
  { sym: "GC=F", label: "GOLD", unit: "$/oz", group: "macro" },
  { sym: "FRO", label: "FRONTLINE", unit: "$", group: "shipping" },
  { sym: "DHT", label: "DHT", unit: "$", group: "shipping" },
  { sym: "STNG", label: "SCORPIO TK", unit: "$", group: "shipping" },
  { sym: "BDRY", label: "DRY BULK ETF", unit: "$", group: "shipping" },
];

export const prices = {};
export const priceStatus = { ok: false, lastPoll: null, error: null };

/**
 * Many symbols in ONE request via Yahoo's spark endpoint (hosting IPs are shared and rate-limited,
 * so one call per refresh instead of one per symbol). Returns Map sym -> {meta, timestamps, closes}.
 */
export async function sparkBatch(symbols, range = "1d", interval = "5m") {
  let lastErr;
  for (const host of ["query1", "query2"]) {
    try {
      const j = await fetchJSON(`https://${host}.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}&range=${range}&interval=${interval}`);
      const out = new Map();
      for (const r of j.spark?.result || []) {
        const resp = r.response?.[0];
        if (!resp?.meta) continue;
        const closes = resp.indicators?.quote?.[0]?.close || [];
        out.set(r.symbol, { meta: resp.meta, timestamps: resp.timestamp || [], closes });
      }
      if (!out.size) throw new Error("empty spark response");
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- CNBC fallback
// Yahoo blocks some shared hosting IPs outright, so CNBC's public quote service is the backup source.
// CNBC's ICE Brent (@LCO) is the benchmark itself; there is no CNBC symbol for Dutch TTF.
const CNBC_UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" };
export const CNBC_SYMBOL = { "BZ=F": "@LCO.1", "CL=F": "@CL.1", "NG=F": "@NG.1", "HO=F": "@HO.1", "RB=F": "@RB.1", "GC=F": "@GC.1",
  FRO: "FRO", DHT: "DHT", STNG: "STNG", BDRY: "BDRY" };
const num = (s) => (s == null || s === "" ? null : Number(String(s).replace(/[,%+]/g, "")));

/** Quotes for CNBC symbols in one request: Map cnbcSym -> {price, prev, time, name, ...} */
export async function cnbcQuotes(symbols) {
  const u = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(symbols.join("|"))}` +
    "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json";
  const j = await fetchJSON(u, { headers: CNBC_UA });
  const out = new Map();
  for (const x of j.FormattedQuoteResult?.FormattedQuote || []) {
    if (x.code !== 0 && x.code !== "0") continue;
    const price = num(x.last), prev = num(x.previous_day_closing) ?? price;
    if (price == null) continue;
    out.set(x.symbol, { price, prev, name: x.name, exchange: x.exchange, currency: x.currencyCode,
      high: num(x.high), low: num(x.low), volume: num(x.volume), high52: num(x.yrhiprice), low52: num(x.yrloprice),
      time: x.last_time ? new Date(x.last_time).toISOString() : new Date().toISOString() });
  }
  if (!out.size) throw new Error("CNBC returned no quotes");
  return out;
}

const lastSpark = {};
async function pollCnbc() {
  const data = await cnbcQuotes(Object.values(CNBC_SYMBOL));
  const res = new Map();
  for (const inst of INSTRUMENTS) {
    const q = data.get(CNBC_SYMBOL[inst.sym]);
    if (!q) continue;
    res.set(inst.sym, { price: q.price, prev: q.prev, change: q.price - q.prev, pct: ((q.price - q.prev) / q.prev) * 100,
      spark: lastSpark[inst.sym] || [], time: q.time, currency: q.currency });
  }
  return res;
}

function quoteFrom({ meta: m, closes }) {
  const c = closes.filter((x) => x != null);
  const price = m.regularMarketPrice ?? c.at(-1);
  const prev = m.chartPreviousClose ?? m.previousClose;
  return { price, prev, change: price - prev, pct: ((price - prev) / prev) * 100, spark: c.slice(-78),
    time: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString(), currency: m.currency };
}

const lastAlertPct = {};
async function poll() {
  // Yahoo first (has intraday sparklines); CNBC if Yahoo refuses this server
  let quotes;
  try {
    const data = await sparkBatch(INSTRUMENTS.map((i) => i.sym));
    quotes = new Map([...data].map(([sym, d]) => [sym, quoteFrom(d)]));
    for (const [sym, q] of quotes) lastSpark[sym] = q.spark;
    priceStatus.source = "Yahoo Finance";
  } catch (yErr) {
    try { quotes = await pollCnbc(); priceStatus.source = "CNBC (Yahoo unavailable)"; }
    catch (cErr) { throw new Error(`Yahoo: ${yErr.message.slice(0, 60)} / CNBC: ${cErr.message.slice(0, 60)}`); }
  }
  let ok = 0;
  INSTRUMENTS.forEach((inst) => {
    const v = quotes.get(inst.sym);
    if (!v) return;
    const r = { value: v };
    ok++;
    prices[inst.sym] = { ...inst, ...r.value, source: priceStatus.source };
    // Flag big oil moves (each further 2% step)
    if (inst.group === "energy" && ["BZ=F", "CL=F"].includes(inst.sym)) {
      const step = Math.trunc(r.value.pct / 2);
      if (Math.abs(step) >= 1 && step !== lastAlertPct[inst.sym]) {
        lastAlertPct[inst.sym] = step;
        raiseAlert({ severity: Math.abs(r.value.pct) >= 4 ? "critical" : "warning", kind: "price-move", key: `px:${inst.sym}:${step}:${new Date().toDateString()}`,
          title: `${inst.label} ${r.value.pct > 0 ? "+" : ""}${r.value.pct.toFixed(2)}% on the day at ${r.value.price.toFixed(2)}`, source: "Yahoo Finance" });
      }
    }
  });
  priceStatus.ok = ok > 0; priceStatus.lastPoll = new Date().toISOString();
  priceStatus.error = ok ? null : "no quotes returned";
  bus.emit("prices", prices);
}

// Detailed history for the enlarged chart view
const RANGES = { "1d": "5m", "5d": "15m", "1mo": "60m", "6mo": "1d", "1y": "1d", "5y": "1wk" };
const chartCache = new Map();
export async function chartHistory(sym, range = "1d") {
  if (!INSTRUMENTS.some((i) => i.sym === sym)) throw new Error("unknown symbol");
  if (!RANGES[range]) throw new Error("bad range");
  const key = `${sym}|${range}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.t < 60_000) return hit.data;
  let data;
  try { data = await yahooChart(sym, range); }
  catch (e) {
    if (!CNBC_SYMBOL[sym]) throw e;
    data = await cnbcChart(sym, range);
  }
  chartCache.set(key, { t: Date.now(), data });
  return data;
}

// CNBC chart files: 1D/5D are intraday; "1M" holds ~1 year of daily bars, "5Y" weekly bars.
const CNBC_RANGE = { "1d": ["1D", 1, 5], "5d": ["5D", 5, 1], "1mo": ["1M", 31, 1], "6mo": ["1M", 183, 1], "1y": ["1M", 366, 1], "5y": ["5Y", 1830, 1] };
async function cnbcChart(sym, range) {
  const [file, days, every] = CNBC_RANGE[range];
  const cs = CNBC_SYMBOL[sym];
  const [j, quotes] = await Promise.all([
    fetchJSON(`https://ts-api.cnbc.com/harmony/app/charts/${file}.json?symbol=${encodeURIComponent(cs)}`, { headers: CNBC_UA }),
    cnbcQuotes([cs]),
  ]);
  const since = Date.now() - days * 86400_000;
  let bars = (j.barData?.priceBars || []).filter((b) => b.tradeTimeinMills >= since && b.close != null);
  // 1D comes in 1-minute bars; merge into 5-minute candles to match the Yahoo view
  if (every > 1) {
    const merged = [];
    for (let i = 0; i < bars.length; i += every) {
      const g = bars.slice(i, i + every);
      merged.push({ tradeTimeinMills: g[0].tradeTimeinMills, open: g[0].open, close: g.at(-1).close,
        high: Math.max(...g.map((b) => +b.high)), low: Math.min(...g.map((b) => +b.low)), volume: g.reduce((a, b) => a + (+b.volume || 0), 0) });
    }
    bars = merged;
  }
  const candles = bars.map((b) => ({ time: Math.floor(b.tradeTimeinMills / 1000), open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume || 0 }));
  const q = quotes.get(cs) || {};
  const inst = INSTRUMENTS.find((i) => i.sym === sym);
  return {
    ...inst, range, interval: { "1D": "5m", "5D": "5m", "1M": "1d", "5Y": "1wk" }[file], candles, source: "CNBC",
    meta: { price: q.price, prevClose: q.prev, dayHigh: q.high, dayLow: q.low, volume: q.volume, high52: q.high52, low52: q.low52,
      currency: q.currency, exchange: q.exchange, name: q.name || inst.label, time: q.time },
  };
}

async function yahooChart(sym, range) {
  const j = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${RANGES[range]}&range=${range}&includePrePost=false`);
  const r = j.chart?.result?.[0];
  if (!r) throw new Error(j.chart?.error?.description || "no data");
  const q = r.indicators?.quote?.[0] || {};
  const candles = [];
  (r.timestamp || []).forEach((t, i) => {
    if (q.close?.[i] == null || q.open?.[i] == null) return;
    candles.push({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume?.[i] || 0 });
  });
  const m = r.meta;
  const inst = INSTRUMENTS.find((i) => i.sym === sym);
  const data = {
    ...inst, range, interval: RANGES[range], candles,
    meta: {
      price: m.regularMarketPrice, prevClose: m.chartPreviousClose ?? m.previousClose,
      dayHigh: m.regularMarketDayHigh, dayLow: m.regularMarketDayLow, volume: m.regularMarketVolume,
      high52: m.fiftyTwoWeekHigh, low52: m.fiftyTwoWeekLow, currency: m.currency,
      exchange: m.fullExchangeName || m.exchangeName, name: m.longName || m.shortName || inst.label,
      time: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString(), tz: m.exchangeTimezoneName,
    },
  };
  return data;
}

// Poll every minute; on errors (e.g. HTTP 429 from a shared hosting IP) back off up to 15 min,
// keeping the last good prices on screen.
export function startPrices() {
  let delay = 60_000, first = true;
  const run = async () => {
    try {
      await poll();
      if (first) log("prices", `${Object.keys(prices).length}/${INSTRUMENTS.length} instruments`);
      delay = 60_000;
    } catch (e) {
      priceStatus.ok = Object.keys(prices).length > 0;
      priceStatus.error = `${e.message.slice(0, 80)}; retrying in ${Math.round(delay / 60_000)} min`;
      log("prices", priceStatus.error);
      delay = Math.min(delay * 2, 15 * 60_000);
    }
    first = false;
    setTimeout(run, delay);
  };
  run();
}
