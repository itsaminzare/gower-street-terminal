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

async function quote(sym) {
  let lastErr;
  for (const host of ["query1", "query2"]) {
    try {
      const j = await fetchJSON(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d&includePrePost=false`);
      const r = j.chart?.result?.[0];
      if (!r) throw new Error("no result");
      const m = r.meta;
      const closes = (r.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
      const price = m.regularMarketPrice ?? closes.at(-1);
      const prev = m.chartPreviousClose ?? m.previousClose;
      return { price, prev, change: price - prev, pct: ((price - prev) / prev) * 100, spark: closes.slice(-78),
        time: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString(), currency: m.currency };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const lastAlertPct = {};
async function poll() {
  const res = await Promise.allSettled(INSTRUMENTS.map((i) => quote(i.sym)));
  let ok = 0;
  res.forEach((r, idx) => {
    const inst = INSTRUMENTS[idx];
    if (r.status !== "fulfilled") return;
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
  priceStatus.error = ok ? null : (res[0].reason?.message || "all quotes failed");
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

export function startPrices() {
  poll().then(() => log("prices", `${Object.keys(prices).length}/${INSTRUMENTS.length} instruments`)).catch((e) => log("prices", e.message));
  setInterval(() => poll().catch((e) => log("prices", e.message)), 30_000);
}
