// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Futures curves for Brent and WTI (individual monthly contracts from Yahoo Finance, delayed)
// and the spreads traders watch for supply stress: time spreads, Brent–WTI, and the 3-2-1 crack.
import { bus, fetchJSON, log } from "./util.js";
import { raiseAlert } from "./alerts.js";
import { prices } from "./prices.js";

const MONTH_CODES = "FGHJKMNQUVXZ";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ROOTS = { brent: "BZ", wti: "CL" };

export const curve = { brent: [], wti: [], spreads: {}, updated: null, error: null };

async function contract(sym) {
  const j = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1mo`);
  const r = j.chart?.result?.[0];
  if (!r?.meta?.regularMarketPrice) throw new Error("no data");
  const closes = (r.indicators?.quote?.[0]?.close || []).map((c, i) => [r.timestamp[i], c]).filter(([, c]) => c != null);
  return {
    // chartPreviousClose is the close before the whole 1-month window, so take yesterday's daily bar instead
    price: r.meta.regularMarketPrice, prev: closes.at(-2)?.[1] ?? null,
    monthAgo: closes[0]?.[1] ?? null, closes, time: r.meta.regularMarketTime,
  };
}

// Load the next ~18 monthly contracts, then drop expired ones (anything before the contract matching the front-month quote)
async function loadCurve(root, frontPrice) {
  const now = new Date();
  const list = [];
  for (let k = 0; k < 18; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    const code = MONTH_CODES[d.getUTCMonth()], yy = String(d.getUTCFullYear()).slice(2);
    list.push({ sym: `${root}${code}${yy}.NYM`, label: `${MONTH_NAMES[d.getUTCMonth()]} ${yy}` });
  }
  const res = await Promise.allSettled(list.map((c) => contract(c.sym)));
  let out = list.map((c, i) => (res[i].status === "fulfilled" ? { ...c, ...res[i].value } : null)).filter(Boolean);
  // Stale = no trade in the last 5 days (expired)
  out = out.filter((c) => Date.now() / 1000 - c.time < 5 * 86400);
  if (frontPrice) {
    const i = out.findIndex((c) => Math.abs(c.price - frontPrice) < 0.02);
    if (i > 0) out = out.slice(i);
  }
  // Thinly traded deferred months sometimes carry stale settlements; flag points far off their neighbours' line
  for (let i = 1; i < out.length - 1; i++) {
    const mid = (out[i - 1].price + out[i + 1].price) / 2;
    if (Math.abs(out[i].price - mid) / mid > 0.03) out[i].suspect = true;
  }
  return out;
}

// Contract at curve position n, skipping suspect prints (takes the nearest clean one after it)
const at = (list, n) => list.slice(n).find((c) => !c.suspect) || null;

function spread(name, a, b, unit = "$/bbl", note = "") {
  if (!a || !b) return null;
  const v = a.price - b.price, prev = a.prev != null && b.prev != null ? a.prev - b.prev : null;
  return { name, value: v, prev, change: prev != null ? v - prev : null, unit, note, legs: [a.sym, b.sym] };
}

const lastAlert = {};
async function poll() {
  try {
    const [brent, wti] = await Promise.all([loadCurve(ROOTS.brent, prices["BZ=F"]?.price), loadCurve(ROOTS.wti, prices["CL=F"]?.price)]);
    if (!brent.length) throw new Error("no Brent contracts");
    curve.brent = brent; curve.wti = wti;
    const s = {};
    s.brentM1M2 = spread("Brent M1–M2", brent[0], at(brent, 1), "$/bbl", "Prompt time spread. Positive = backwardation (tight now).");
    s.brentM1M6 = spread("Brent M1–M6", brent[0], at(brent, 5), "$/bbl", "Six-month backwardation: the market's price for oil now vs later.");
    s.brentM1M12 = spread("Brent M1–M12", brent[0], at(brent, 11), "$/bbl", "One-year curve shape.");
    s.wtiM1M6 = spread("WTI M1–M6", wti[0], at(wti, 5), "$/bbl", "US curve shape.");
    s.brentWti = spread("Brent–WTI", brent[0], wti[0], "$/bbl", "Seaborne vs US inland crude. Widens when Middle East supply is at risk.");
    // 3-2-1 crack: (2 × gasoline + 1 × diesel − 3 × crude) / 3, products quoted $/gal → ×42
    const rb = prices["RB=F"], ho = prices["HO=F"], cl = prices["CL=F"];
    if (rb && ho && cl) {
      const val = (2 * rb.price * 42 + ho.price * 42 - 3 * cl.price) / 3;
      const prev = (2 * rb.prev * 42 + ho.prev * 42 - 3 * cl.prev) / 3;
      s.crack321 = { name: "3-2-1 crack", value: val, prev, change: val - prev, unit: "$/bbl", note: "US refining margin (RBOB, ULSD vs WTI).", legs: ["RB=F", "HO=F", "CL=F"] };
    }
    curve.spreads = Object.fromEntries(Object.entries(s).filter(([, v]) => v));
    curve.updated = new Date().toISOString(); curve.error = null;
    bus.emit("curve", curve);
    // Alerts on sharp daily moves in the key spreads
    for (const [k, sp] of Object.entries(curve.spreads)) {
      // Deferred months (M12) trade thinly and their day-on-day changes are noisy, so only alert on liquid spreads
      if (!["brentM1M2", "brentM1M6", "brentWti", "crack321"].includes(k)) continue;
      const thr = k === "crack321" ? 3 : k === "brentM1M2" ? 0.75 : 1.5;
      if (sp.change != null && Math.abs(sp.change) >= thr) {
        const day = new Date().toDateString();
        const step = Math.trunc(sp.change / thr);
        if (lastAlert[k] === `${day}:${step}`) continue;
        lastAlert[k] = `${day}:${step}`;
        raiseAlert({ severity: Math.abs(sp.change) >= thr * 2 ? "critical" : "warning", kind: "spread-move", key: `spr:${k}:${day}:${step}`,
          source: "Futures curve (Yahoo, delayed)",
          title: `${sp.name} ${sp.change > 0 ? "widened" : "narrowed"} ${Math.abs(sp.change).toFixed(2)} ${sp.unit} today to ${sp.value.toFixed(2)}`,
          detail: sp.note });
      }
    }
  } catch (e) {
    curve.error = e.message;
    log("curve", e.message);
  }
}

export function startCurve() {
  setTimeout(() => poll().then(() => log("curve", `Brent ${curve.brent.length} / WTI ${curve.wti.length} contracts`)), 4000);
  setInterval(poll, 5 * 60_000);
}
