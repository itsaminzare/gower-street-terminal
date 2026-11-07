// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Builds public-data/research.json: the historical event study behind the trade desk, plus the data for the
// Red Sea 2023-24 crisis replay. Run locally (hosting IPs are often blocked by Yahoo):
//   node scripts/build-research.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public-data", "research.json");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" };

// Instruments studied. CRACK and BRENT_WTI are built from the legs ($/bbl).
const SYMS = { BRENT: "BZ=F", WTI: "CL=F", ULSD: "HO=F", RBOB: "RB=F", GOLD: "GC=F", FRO: "FRO", STNG: "STNG", DHT: "DHT" };

// Incidents since 2019 that hit Persian Gulf / Red Sea shipping or regional oil supply.
// `base` = the last daily close BEFORE the news reached the market (weekend / overnight events use the prior close).
export const EVENTS = [
  { id: "fujairah-2019", date: "2019-05-12", base: "2019-05-10", kind: "tanker-attack", zone: "HORMUZ", title: "Four tankers sabotaged off Fujairah" },
  { id: "omangulf-2019", date: "2019-06-13", base: "2019-06-12", kind: "tanker-attack", zone: "HORMUZ", title: "Front Altair and Kokuka Courageous attacked in the Gulf of Oman" },
  { id: "stena-2019", date: "2019-07-19", base: "2019-07-18", kind: "seizure", zone: "HORMUZ", title: "IRGC seizes the tanker Stena Impero in the Strait of Hormuz" },
  { id: "abqaiq-2019", date: "2019-09-14", base: "2019-09-13", kind: "supply-attack", zone: "GULF", title: "Drone and missile strike on Saudi Abqaiq and Khurais (5.7 mb/d offline)" },
  { id: "soleimani-2020", date: "2020-01-03", base: "2020-01-02", kind: "state-strike", zone: "GULF", title: "US strike kills IRGC commander Qassem Soleimani" },
  { id: "alasad-2020", date: "2020-01-08", base: "2020-01-07", kind: "state-strike", zone: "GULF", title: "Iran fires missiles at US bases in Iraq" },
  { id: "mercer-2021", date: "2021-07-29", base: "2021-07-29", kind: "tanker-attack", zone: "HORMUZ", title: "Drone strike on the tanker Mercer Street off Oman" },
  { id: "oct7-2023", date: "2023-10-07", base: "2023-10-06", kind: "state-strike", zone: "REGION", title: "Hamas attack on Israel; regional war risk" },
  { id: "galaxy-2023", date: "2023-11-19", base: "2023-11-17", kind: "seizure", zone: "BAB", title: "Houthis seize the car carrier Galaxy Leader in the Red Sea" },
  { id: "maersk-2023", date: "2023-12-15", base: "2023-12-14", kind: "shipping-disruption", zone: "BAB", title: "Maersk and Hapag-Lloyd pause Red Sea transits; BP follows" },
  { id: "houthistrikes-2024", date: "2024-01-12", base: "2024-01-11", kind: "state-strike", zone: "BAB", title: "US and UK strike Houthi targets in Yemen" },
  { id: "marlin-2024", date: "2024-01-26", base: "2024-01-26", kind: "tanker-attack", zone: "BAB", title: "Houthi missile sets the tanker Marlin Luanda on fire" },
  { id: "iranisrael-2024", date: "2024-04-13", base: "2024-04-12", kind: "state-strike", zone: "REGION", title: "Iran's drone and missile attack on Israel; IRGC seizes MSC Aries near Hormuz" },
  { id: "isfahan-2024", date: "2024-04-19", base: "2024-04-18", kind: "state-strike", zone: "REGION", title: "Israeli strike near Isfahan, Iran" },
  { id: "sounion-2024", date: "2024-08-21", base: "2024-08-20", kind: "tanker-attack", zone: "BAB", title: "Houthis attack the tanker Sounion (1m bbl) in the Red Sea" },
  { id: "iranmissiles-2024", date: "2024-10-01", base: "2024-09-30", kind: "state-strike", zone: "REGION", title: "Iran fires ~180 ballistic missiles at Israel" },
  { id: "israeliran-oct-2024", date: "2024-10-26", base: "2024-10-25", kind: "state-strike", zone: "REGION", title: "Israel strikes Iran, avoiding oil infrastructure" },
  { id: "israeliran-jun-2025", date: "2025-06-13", base: "2025-06-12", kind: "state-strike", zone: "REGION", title: "Israel launches strikes on Iran's nuclear and military sites" },
  { id: "usstrikes-2025", date: "2025-06-22", base: "2025-06-20", kind: "state-strike", zone: "REGION", title: "US strikes Fordow, Natanz and Isfahan" },
  { id: "magicseas-2025", date: "2025-07-06", base: "2025-07-03", kind: "tanker-attack", zone: "BAB", title: "Houthis sink the bulkers Magic Seas and Eternity C" },
];
export const KIND_LABEL = {
  "tanker-attack": "Attack on a tanker or merchant ship", seizure: "Ship seized", "supply-attack": "Attack on oil infrastructure",
  "state-strike": "State military strike / escalation", "shipping-disruption": "Carriers suspend a route",
};
// Kinds pooled together when a single kind has too few cases
const FAMILY = { "tanker-attack": "shipping", seizure: "shipping", "shipping-disruption": "shipping", "supply-attack": "escalation", "state-strike": "escalation" };
const HORIZONS = [1, 5, 20]; // trading days after the base close
// Round-trip trading cost assumptions (spread + fees + slippage), applied to every scored trade.
// Outrights in % of price, spreads in $/bbl. Deliberately conservative for liquid futures/stocks.
export const COSTS = { BRENT: 0.05, WTI: 0.05, ULSD: 0.08, RBOB: 0.08, GOLD: 0.03, FRO: 0.12, STNG: 0.12, DHT: 0.15, BRENT_WTI: 0.04, CRACK: 0.12 };

// Deterministic PRNG so the bootstrap is reproducible
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function bootstrapCI(vals, stat, n = 5000, lo = 0.05, hi = 0.95) {
  const r = rng(42), out = [];
  for (let i = 0; i < n; i++) { const s = vals.map(() => vals[Math.floor(r() * vals.length)]); out.push(stat(s)); }
  out.sort((a, b) => a - b);
  return [out[Math.floor(lo * n)], out[Math.floor(hi * n)]];
}
// One-sided binomial test: P(X >= k | n, p=0.5)
function binomP(k, n) { let p = 0; const c = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }; for (let i = k; i <= n; i++) p += c(n, i) / 2 ** n; return p; }

async function daily(sym) {
  const p1 = Math.floor(Date.parse("2018-10-01") / 1000), p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`, { headers: UA });
  if (!r.ok) throw new Error(`${sym}: HTTP ${r.status}`);
  const j = await r.json();
  const res = j.chart.result[0], c = res.indicators.quote[0].close;
  const m = new Map();
  res.timestamp.forEach((t, i) => { if (c[i] != null) m.set(new Date((t + res.meta.gmtoffset) * 1000).toISOString().slice(0, 10), c[i]); });
  return m;
}

async function portwatch() {
  const API = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
  const where = "(portname LIKE '%Mandeb%' OR portname LIKE '%Good Hope%' OR portname LIKE '%Suez%' OR portname LIKE '%Hormuz%') AND date >= DATE '2023-09-01' AND date <= DATE '2024-04-30'";
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 2000) {
    const qs = new URLSearchParams({ where, outFields: "date,portname,n_tanker,n_total", orderByFields: "date ASC", resultOffset: String(offset), resultRecordCount: "2000", f: "json" });
    const j = await fetch(`${API}?${qs}`).then((r) => r.json());
    if (j.error) throw new Error(j.error.message);
    rows.push(...(j.features || []).map((f) => f.attributes));
    if (!j.exceededTransferLimit && (j.features || []).length < 2000) break;
  }
  const Z = { BAB: /mandeb/i, CAPE: /good hope/i, SUEZ: /suez/i, HORMUZ: /hormuz/i };
  const out = {};
  for (const r of rows) {
    const z = Object.keys(Z).find((k) => Z[k].test(r.portname)); if (!z) continue;
    (out[z] ||= []).push([new Date(r.date).toISOString().slice(0, 10), r.n_tanker, r.n_total]);
  }
  return out;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

function summarise(vals, base) {
  if (!vals.length) return null;
  const m = mean(vals), s = vals.length > 1 ? sd(vals) : null;
  return { n: vals.length, mean: r2(m), median: r2(median(vals)), up: vals.filter((v) => v > 0).length, sd: r2(s),
    // t-stat of the event mean against the unconditional mean over the same horizon
    t: s && vals.length > 2 ? r2((m - base.mean) / (s / Math.sqrt(vals.length))) : null };
}

const main = async () => {
  console.log("Downloading daily closes…");
  const series = {};
  for (const [k, s] of Object.entries(SYMS)) { series[k] = await daily(s); console.log(` ${k} ${series[k].size} days`); }
  // Derived spreads in $/bbl on days where all legs traded
  const days = [...series.BRENT.keys()].filter((d) => series.WTI.has(d)).sort();
  series.BRENT_WTI = new Map(days.map((d) => [d, series.BRENT.get(d) - series.WTI.get(d)]));
  series.CRACK = new Map(days.filter((d) => series.RBOB.has(d) && series.ULSD.has(d))
    .map((d) => [d, (2 * series.RBOB.get(d) * 42 + series.ULSD.get(d) * 42 - 3 * series.WTI.get(d)) / 3]));
  const SPREADS = new Set(["BRENT_WTI", "CRACK"]);
  const INST = Object.keys(series);

  // Move over h trading days from a base date: % for outrights, $/bbl change for spreads
  const move = (k, base, h) => {
    const dates = [...series[k].keys()].sort();
    let i = dates.findIndex((d) => d >= base);
    if (i < 0) return null;
    if (dates[i] > base) i -= 1; // base date was a holiday: use the close before it
    if (i < 0 || i + h >= dates.length) return null;
    const a = series[k].get(dates[i]), b = series[k].get(dates[i + h]);
    return SPREADS.has(k) ? b - a : ((b - a) / a) * 100;
  };
  // Unconditional distribution (every day 2019-01 → now) for comparison
  const baseline = {};
  for (const k of INST) {
    baseline[k] = {};
    const dates = [...series[k].keys()].sort().filter((d) => d >= "2019-01-01");
    for (const h of HORIZONS) {
      const v = []; for (let i = 0; i + h < dates.length; i++) v.push(move(k, dates[i], h));
      const ok = v.filter((x) => x != null && Number.isFinite(x) && Math.abs(x) < 200);
      baseline[k][h] = { n: ok.length, mean: r2(mean(ok)), sd: r2(sd(ok)), up: r2(ok.filter((x) => x > 0).length / ok.length) };
    }
  }

  const events = EVENTS.map((e) => {
    const moves = {};
    for (const k of INST) { moves[k] = {}; for (const h of HORIZONS) moves[k][h] = r2(move(k, e.base, h)); }
    return { ...e, family: FAMILY[e.kind], moves };
  });

  // Pooled statistics by kind and by family
  const stats = { kind: {}, family: {} };
  for (const [group, key] of [["kind", "kind"], ["family", "family"]]) {
    for (const g of new Set(events.map((e) => e[key]))) {
      stats[group][g] = {};
      for (const k of INST) {
        stats[group][g][k] = {};
        for (const h of HORIZONS) {
          // April 2020 WTI went negative: drop absurd % moves
          const v = events.filter((e) => e[key] === g).map((e) => e.moves[k][h]).filter((x) => x != null && Math.abs(x) < 100);
          stats[group][g][k][h] = summarise(v, baseline[k][h]);
        }
      }
    }
  }

  // Walk-forward test of the desk's playbook: at each event, use ONLY earlier events of the same family to call
  // the direction (sign of their median move), then score the call against what actually happened.
  const PLAY = [["BRENT", 1], ["BRENT", 5], ["BRENT", 20], ["FRO", 5], ["FRO", 20], ["CRACK", 5]];
  const walk = [];
  for (const [k, h] of PLAY) {
    const rows = [];
    events.forEach((e, i) => {
      const prior = events.slice(0, i).filter((p) => p.family === e.family).map((p) => p.moves[k][h]).filter((x) => x != null);
      const actual = e.moves[k][h];
      if (prior.length < 3 || actual == null) return;
      const call = Math.sign(median(prior)) || 1;
      // P&L net of a round-trip trading cost
      rows.push({ id: e.id, call: call > 0 ? "LONG" : "SHORT", priorN: prior.length, priorMedian: r2(median(prior)), actual,
        gross: r2(call * actual), pnl: r2(call * actual - COSTS[k]), longNet: r2(actual - COSTS[k]), hit: call * actual - COSTS[k] > 0 });
    });
    const hits = rows.filter((r) => r.hit).length;
    const byFamily = {};
    for (const f of new Set(events.map((e) => e.family))) {
      const fr = rows.filter((r) => events.find((e) => e.id === r.id).family === f);
      if (fr.length) byFamily[f] = { n: fr.length, hits: fr.filter((r) => r.hit).length, avgPnl: r2(mean(fr.map((r) => r.pnl))) };
    }
    const pn = rows.map((r) => r.pnl), edge = rows.map((r) => r.pnl - r.longNet);
    walk.push({ inst: k, h, n: rows.length, hits, hitRate: rows.length ? r2(hits / rows.length) : null, byFamily,
      cost: COSTS[k], pHits: Math.round(binomP(hits, rows.length) * 1000) / 1000,
      avgPnlCI90: rows.length > 2 ? bootstrapCI(pn, mean).map(r2) : null,
      edgeVsLong: rows.length ? r2(mean(edge)) : null, edgeVsLongCI90: rows.length > 2 ? bootstrapCI(edge, mean).map(r2) : null,
      avgPnl: rows.length ? r2(mean(pn)) : null, alwaysLongAvg: rows.length ? r2(mean(rows.map((r) => r.longNet))) : null,
      unit: SPREADS.has(k) ? "$/bbl" : "%", rows });
  }

  // Red Sea crisis replay data (Sep 2023 → Apr 2024)
  console.log("Downloading IMF PortWatch transits…");
  let transits = {};
  try { transits = await portwatch(); console.log(" ", Object.entries(transits).map(([z, d]) => `${z} ${d.length}d`).join(", ")); }
  catch (e) { console.log(" PortWatch failed:", e.message); const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null; transits = old?.crisis?.transits || {}; }
  const crisisDays = days.filter((d) => d >= "2023-09-01" && d <= "2024-04-30");
  const crisis = {
    from: "2023-09-01", to: "2024-04-30", transits,
    prices: Object.fromEntries(["BRENT", "FRO", "STNG", "CRACK"].map((k) => [k, crisisDays.filter((d) => series[k].has(d)).map((d) => [d, r2(series[k].get(d))])])),
    events: events.filter((e) => e.date >= "2023-09-01" && e.date <= "2024-04-30").map((e) => e.id),
  };

  // Bootstrap 90% intervals for the headline family statistics (mean move)
  for (const f of Object.keys(stats.family)) for (const k of INST) for (const h of HORIZONS) {
    const v = events.filter((e) => e.family === f).map((e) => e.moves[k][h]).filter((x) => x != null && Math.abs(x) < 100);
    if (stats.family[f][k][h] && v.length > 2) stats.family[f][k][h].meanCI90 = bootstrapCI(v, mean).map(r2);
  }
  // Daily closes for the agent backtest (scripts/agent-backtest.mjs scores ideas along the real price path)
  const closes = Object.fromEntries(INST.map((k) => [k, [...series[k]].filter(([d]) => d >= "2019-01-01").sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => [d, r2(v)])]));
  fs.writeFileSync(path.join(path.dirname(OUT), "prices-daily.json"), JSON.stringify({ source: "Yahoo Finance daily closes (front-month continuous futures, NYSE stocks)", built: new Date().toISOString(), daily: closes }));
  const units = Object.fromEntries(INST.map((k) => [k, SPREADS.has(k) ? "$/bbl" : "%"]));
  fs.writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString(), source: "Yahoo Finance daily closes; IMF PortWatch (UN Global Platform)",
    horizons: HORIZONS, units, kindLabel: KIND_LABEL, costs: COSTS, baseline, events, stats, walkForward: walk, crisis }, null, 0));
  console.log("Wrote", OUT);
  for (const w of walk) console.log(` walk-forward ${w.inst} ${w.h}d: ${w.hits}/${w.n} hits (p=${w.pHits}), avg net ${w.avgPnl}${w.unit} [90% CI ${w.avgPnlCI90}] vs long ${w.alwaysLongAvg}; edge ${w.edgeVsLong} [${w.edgeVsLongCI90}]`);
  const s = stats.family;
  for (const f of Object.keys(s)) console.log(` ${f}: Brent 1d median ${s[f].BRENT[1]?.median}% (n=${s[f].BRENT[1]?.n}), 5d ${s[f].BRENT[5]?.median}%, 20d ${s[f].BRENT[20]?.median}%; FRO 5d ${s[f].FRO[5]?.median}%`);
};
main().catch((e) => { console.error(e); process.exit(1); });
