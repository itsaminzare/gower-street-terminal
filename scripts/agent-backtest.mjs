// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// AGENT BACKTEST: runs the SAME trade-desk agent (same prompt, schema, maths and risk checks as the live desk)
// on each of the 20 historical incidents, giving it ONLY what was knowable that day:
//   - the incident headline, the prices at the last close before it, and trailing 5/20-day moves
//   - base rates computed from EARLIER incidents only
// Trades are entered at the first daily close AFTER the news was public (the initial jump is not captured),
// followed along real daily closes to stop / target / horizon, and charged round-trip costs.
// Benchmarks: cash (0), buy-and-hold Brent over the same 20 trading days, and a naive "buy the headline" rule.
// Caveat, stated in the output: the model may know how these events played out (training-data contamination),
// so the live paper record is the only truly unseen test.
//   node scripts/agent-backtest.mjs            (needs ANTHROPIC_API_KEY; ANALYST_MODEL picks the Claude model; ~20 model calls)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { INSTRUMENTS, DEFAULT_LIMITS, baseRate, priceIdea, riskChecks, systemPrompt, SCHEMA, r2 } from "../src/desk-core.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(path.join(ROOT, ".env")); } catch { /* optional */ }
const research = JSON.parse(fs.readFileSync(path.join(ROOT, "public-data", "research.json"), "utf8"));
const { daily } = JSON.parse(fs.readFileSync(path.join(ROOT, "public-data", "prices-daily.json"), "utf8"));
const PROVIDER = "claude";
const MODEL = (process.env.ANALYST_MODEL || "claude-haiku-5-5").trim();
const client = new Anthropic();

const series = Object.fromEntries(Object.entries(daily).map(([k, rows]) => [k, rows]));
const idxOnOrBefore = (k, d) => { const s = series[k]; let i = -1; for (let j = 0; j < s.length && s[j][0] <= d; j++) i = j; return i; };
const TRADEABLE = Object.entries(INSTRUMENTS).filter(([, v]) => v.research && series[v.research]).map(([k]) => k);

function pointInTimeStudy(asOf) {
  const prior = research.events.filter((e) => e.date < asOf);
  const keys = ["BRENT", "WTI", "BRENT_WTI", "CRACK", "FRO", "STNG", "GOLD"];
  const fam = {};
  for (const f of ["shipping", "escalation"]) {
    const ev = prior.filter((e) => e.family === f);
    fam[f] = { n: ev.length, ...Object.fromEntries(keys.map((k) => [k, Object.fromEntries([1, 5, 20].map((h) => {
      const v = ev.map((e) => e.moves[k]?.[h]).filter((x) => x != null).sort((a, b) => a - b);
      if (!v.length) return [`${h}d`, "n/a"];
      const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      return [`${h}d`, `median ${r2(m)}, up ${v.filter((x) => x > 0).length}/${v.length}`];
    }))]))};
  }
  return { earlier_incidents: prior.map((e) => ({ date: e.date, kind: e.kind, title: e.title })), by_family: fam };
}

// Follow a trade along daily closes after entry; close on stop/target (at the level) or at the horizon close
function simulate(idea, k, entryIdx) {
  const s = series[k], dir = idea.direction === "LONG" ? 1 : -1;
  const lastIdx = Math.min(s.length - 1, entryIdx + Math.max(1, Math.round(idea.horizonDays * 5 / 7)));
  for (let i = entryIdx + 1; i <= lastIdx; i++) {
    const c = s[i][1];
    if (dir * (c - idea.stop) <= 0) return { exit: idea.stop, exitDate: s[i][0], how: "stopped" };
    if (dir * (c - idea.target) >= 0) return { exit: idea.target, exitDate: s[i][0], how: "target" };
  }
  return { exit: s[lastIdx][1], exitDate: s[lastIdx][0], how: "expired" };
}
function score(idea, exit) {
  const dir = idea.direction === "LONG" ? 1 : -1;
  const move = dir * (exit - idea.entry), risk = Math.abs(idea.entry - idea.stop);
  return { R: r2((move - idea.costAbs) / risk), bookPct: r2(((move - idea.costAbs) / risk) * idea.riskPct) };
}

async function ask(e) {
  const asOf = e.date;
  const pricesThen = {};
  for (const k of TRADEABLE) {
    const rk = INSTRUMENTS[k].research, i = idxOnOrBefore(rk, e.base);
    if (i < 20) continue;
    const s = series[rk], p = s[i][1];
    const ch = (n) => (INSTRUMENTS[k].unit === "%" ? r2(((p - s[i - n][1]) / s[i - n][1]) * 100) : r2(p - s[i - n][1]));
    pricesThen[k] = { label: INSTRUMENTS[k].label, unit_for_distances: INSTRUMENTS[k].unit, last_close: p, last_close_date: s[i][0], change_5d: ch(5), change_20d: ch(20) };
  }
  const user = `Date: ${asOf}. Trigger: breaking incident.

BREAKING (${asOf}, ${e.zone}): ${e.title}

Allowed instruments, with their last close before the news and trailing moves:
${JSON.stringify(pricesThen)}

No open trades. No live vessel data is available for this exercise.

Point-in-time event study (incidents before ${asOf} only):
${JSON.stringify(pointInTimeStudy(asOf))}`;
  const stream = /haiku/.test(MODEL)
    ? client.messages.stream({ model: MODEL, max_tokens: 8000, output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } }, system: systemPrompt({ asOf }), messages: [{ role: "user", content: user }] })
    : client.beta.messages.stream({ model: MODEL, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", max_tokens: 8000, output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } }, system: systemPrompt({ asOf }), messages: [{ role: "user", content: user }] });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("refusal");
  return { data: JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join("")), model: msg.model };
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function ci(vals) { if (vals.length < 3) return null; const r = rng(7), out = []; for (let i = 0; i < 5000; i++) out.push(mean(vals.map(() => vals[Math.floor(r() * vals.length)]))); out.sort((a, b) => a - b); return [r2(out[250]), r2(out[4750])]; }
function binomP(k, n) { let p = 0; const c = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }; for (let i = k; i <= n; i++) p += c(n, i) / 2 ** n; return Math.round(p * 1000) / 1000; }

const rows = [];
let model = MODEL;
for (const e of research.events) {
  process.stdout.write(`${e.date} ${e.id} … `);
  let out;
  try { out = await ask(e); model = out.model; } catch (err) { console.log("error", err.message); rows.push({ event: e.id, date: e.date, error: err.message, trades: [] }); continue; }
  const trades = [];
  for (const raw of (out.data.ideas || []).slice(0, DEFAULT_LIMITS.maxIdeasPerRun)) {
    const k = raw.instrument, rk = INSTRUMENTS[k]?.research;
    if (!rk || !series[rk]) { trades.push({ instrument: k, direction: raw.direction, skipped: "no price history" }); continue; }
    // Entry at the first close strictly AFTER the base close (news already public)
    const baseIdx = idxOnOrBefore(rk, e.base), entryIdx = baseIdx + 1;
    if (entryIdx >= series[rk].length) continue;
    const priced = priceIdea(raw, series[rk][entryIdx][1]);
    const br = baseRate(research, { analogue: raw.analogue, instrument: k, direction: raw.direction, horizonDays: priced.horizonDays, asOf: e.date });
    const open = trades.filter((t) => t.taken).map((t) => ({ instrument: t.instrument, riskPct: t.riskPct }));
    const rc = riskChecks({ raw, priced, br, open, limits: DEFAULT_LIMITS });
    const idea = { ...priced, direction: raw.direction, horizonDays: priced.horizonDays };
    const t = { instrument: k, direction: raw.direction, horizonDays: priced.horizonDays, probability: priced.probability, riskPct: priced.riskPct,
      entry: priced.entry, entryDate: series[rk][entryIdx][0], stop: priced.stop, target: priced.target, evNet: priced.evNet, analogue: raw.analogue,
      thesis: raw.thesis, taken: rc.pass, blockedBy: rc.pass ? null : rc.blocking };
    if (rc.pass) { const sim = simulate(idea, rk, entryIdx); Object.assign(t, sim, score(idea, sim.exit)); }
    trades.push(t);
  }
  // Benchmarks over the same window: buy-and-hold Brent 20 trading days from the same entry close, and a naive
  // "buy the headline" rule (long Brent, stop 1 s.d. of 5-day moves, target 1.5x, 5 days, 0.5% risk)
  const bi = idxOnOrBefore("BRENT", e.base) + 1, bs = series.BRENT;
  const bh = r2(((bs[Math.min(bs.length - 1, bi + 20)][1] - bs[bi][1]) / bs[bi][1]) * 100 - INSTRUMENTS.BRENT.cost);
  const naiveIdea = { ...priceIdea({ instrument: "BRENT", direction: "LONG", stop_distance: 6.0, target_distance: 9.0, probability: 0.5, horizon_days: 7, risk_pct: 0.5 }, bs[bi][1]), direction: "LONG", horizonDays: 7 };
  const nsim = simulate(naiveIdea, "BRENT", bi), naive = score(naiveIdea, nsim.exit);
  rows.push({ event: e.id, date: e.date, title: e.title, kind: e.kind, regime: out.data.regime, noTrade: out.data.no_trade_reason, trades, benchmark: { buyHoldBrent20dPct: bh, naiveR: naive.R, naiveBookPct: naive.bookPct } });
  console.log(`${trades.filter((t) => t.taken).length} trade(s)${trades.some((t) => !t.taken && t.blockedBy) ? ", some blocked" : ""}`);
}

const taken = rows.flatMap((r) => r.trades.filter((t) => t.taken && t.R != null));
const perEventBook = rows.filter((r) => !r.error).map((r) => r2(r.trades.filter((t) => t.taken && t.bookPct != null).reduce((s, t) => s + t.bookPct, 0)));
const naiveBook = rows.filter((r) => !r.error).map((r) => r.benchmark.naiveBookPct);
const wins = taken.filter((t) => t.R > 0).length;
const brier = taken.length ? r2(taken.reduce((s, t) => s + (t.probability - (t.R > 0 ? 1 : 0)) ** 2, 0) / taken.length) : null;
const summary = {
  built: new Date().toISOString(), provider: PROVIDER, model, events: rows.length, eventsTraded: rows.filter((r) => r.trades.some((t) => t.taken)).length,
  ideas: rows.reduce((s, r) => s + r.trades.length, 0), trades: taken.length, blockedByRisk: rows.reduce((s, r) => s + r.trades.filter((t) => t.taken === false).length, 0),
  wins, hitRate: taken.length ? r2(wins / taken.length) : null, pHits: taken.length ? binomP(wins, taken.length) : null,
  avgR: r2(mean(taken.map((t) => t.R))), avgRCI90: ci(taken.map((t) => t.R)), totalR: r2(taken.reduce((s, t) => s + t.R, 0)), brier,
  bookPctPerEvent: r2(mean(perEventBook)), bookPctPerEventCI90: ci(perEventBook), bookPctTotal: r2(perEventBook.reduce((s, x) => s + x, 0)),
  benchmarks: { cash: 0, naiveBuyHeadlineBookPctPerEvent: r2(mean(naiveBook)), naiveBuyHeadlineBookPctTotal: r2(naiveBook.reduce((s, x) => s + x, 0)),
    buyHoldBrent20dPctPerEvent: r2(mean(rows.filter((r) => !r.error).map((r) => r.benchmark.buyHoldBrent20dPct))) },
  method: "Same prompt, schema, maths and risk checks as the live desk. Point-in-time inputs only. Entry at the first daily close after the news; stops/targets checked on daily closes; round-trip costs charged. Book P&L = R x risk% of book.",
  caveat: "The model may already know how these events played out from its training data, which would flatter these results. Treat this as a test of the machinery and of calibration; the live paper record is the only truly unseen test.",
};
fs.writeFileSync(path.join(ROOT, "public-data", "agent-backtest.json"), JSON.stringify({ summary, rows }, null, 0));
console.log(JSON.stringify(summary, null, 1));
