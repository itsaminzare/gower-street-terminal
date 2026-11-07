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

function quoteFrom({ meta: m, closes }) {
  const c = closes.filter((x) => x != null);
  const price = m.regularMarketPrice ?? c.at(-1);
  const prev = m.chartPreviousClose ?? m.previousClose;
  return { price, prev, change: price - prev, pct: ((price - prev) / prev) * 100, spark: c.slice(-78),
    time: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString(), currency: m.currency };
}

const lastAlertPct = {};
async function poll() {
  const data = await sparkBatch(INSTRUMENTS.map((i) => i.sym));
  let ok = 0;
  INSTRUMENTS.forEach((inst) => {
    const d = data.get(inst.sym);
    if (!d) return;
    const r = { value: quoteFrom(d) };
    ok++;
    prices[inst.sym] = { ...inst, ...r.value };
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
  chartCache.set(key, { t: Date.now(), data });
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
