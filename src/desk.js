// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// TRADE DESK: turns the live picture into specific, falsifiable paper trades and keeps score.
// Claude proposes ideas grounded in the live snapshot AND the historical event study (public-data/research.json).
// The server — not the model — fixes the entry at the live price, builds stop/target levels, computes
// reward:risk and expected value, then marks every idea to market and closes it on stop, target or expiry.
// Results are scored in R (multiples of the risk taken) with a hit rate and a Brier score for calibration.
// Paper trading only: nothing here places orders.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bus, log, MODE, hashId } from "./util.js";
import { load, save } from "./store.js";
import { prices } from "./prices.js";
import { analyst, snapshot, structuredCall } from "./analyst.js";

const RESEARCH_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public-data", "research.json");
export const research = (() => { try { return JSON.parse(fs.readFileSync(RESEARCH_FILE, "utf8")); } catch { return null; } })();

// Tradeable instruments: outrights are scored in %, spreads in $/bbl
const px = (s) => prices[s]?.price;
export const INSTR = {
  BRENT: { label: "Brent crude (ICE, front month)", unit: "%", get: () => px("BZ=F") },
  WTI: { label: "WTI crude (NYMEX, front month)", unit: "%", get: () => px("CL=F") },
  BRENT_WTI: { label: "Brent–WTI spread", unit: "$/bbl", get: () => (px("BZ=F") != null && px("CL=F") != null ? px("BZ=F") - px("CL=F") : null) },
  CRACK_321: { label: "3-2-1 crack spread (refining margin)", unit: "$/bbl",
    get: () => (px("RB=F") != null && px("HO=F") != null && px("CL=F") != null ? (2 * px("RB=F") * 42 + px("HO=F") * 42 - 3 * px("CL=F")) / 3 : null) },
  ULSD: { label: "ULSD diesel (NYMEX)", unit: "%", get: () => px("HO=F") },
  RBOB: { label: "RBOB gasoline (NYMEX)", unit: "%", get: () => px("RB=F") },
  TTF: { label: "Dutch TTF gas", unit: "%", get: () => px("TTF=F") },
  HENRY_HUB: { label: "Henry Hub gas", unit: "%", get: () => px("NG=F") },
  GOLD: { label: "Gold", unit: "%", get: () => px("GC=F") },
  FRO: { label: "Frontline (crude tankers, NYSE)", unit: "%", get: () => px("FRO") },
  DHT: { label: "DHT Holdings (VLCCs, NYSE)", unit: "%", get: () => px("DHT") },
  STNG: { label: "Scorpio Tankers (product tankers, NYSE)", unit: "%", get: () => px("STNG") },
};

const stored = load(`desk-${MODE}`, { ideas: [], runs: [] });
export const desk = { ideas: stored.ideas || [], runs: stored.runs || [], running: false, error: null, enabled: false };
const persist = () => save(`desk-${MODE}`, { ideas: desk.ideas.slice(0, 300), runs: desk.runs.slice(0, 100) });

// ---------------------------------------------------------------- scoring
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
function pnl(idea, price) {
  const dir = idea.direction === "LONG" ? 1 : -1;
  const move = dir * (price - idea.entry);
  return { R: r2(move / Math.abs(idea.entry - idea.stop)),
    pct: idea.unit === "%" ? r2((move / idea.entry) * 100) : null, abs: r2(move) };
}
function markAll() {
  let changed = false;
  for (const i of desk.ideas) {
    if (i.status !== "open") continue;
    const p = INSTR[i.instrument]?.get();
    if (p == null) continue;
    const dir = i.direction === "LONG" ? 1 : -1;
    i.mark = r2(p); i.markTime = new Date().toISOString();
    Object.assign(i, { live: pnl(i, p) });
    let exit = null;
    if (dir * (p - i.stop) <= 0) exit = ["stopped", i.stop];
    else if (dir * (p - i.target) >= 0) exit = ["target", i.target];
    else if (Date.now() >= Date.parse(i.expires)) exit = ["expired", p];
    if (exit) {
      i.status = exit[0]; i.exit = r2(exit[1]); i.closed = new Date().toISOString();
      i.result = pnl(i, exit[1]);
      log("desk", `${i.instrument} ${i.direction} closed (${i.status}) ${i.result.R}R`);
    }
    changed = true;
  }
  if (changed) bus.emit("desk", deskView());
}
export function closeIdea(id, reason) {
  const i = desk.ideas.find((x) => x.id === id && x.status === "open");
  const p = i && INSTR[i.instrument]?.get();
  if (!i || p == null) return false;
  Object.assign(i, { status: "closed", exit: r2(p), closed: new Date().toISOString(), result: pnl(i, p), closeReason: reason });
  return true;
}

export function scorecard() {
  const closed = desk.ideas.filter((i) => i.status !== "open" && i.result);
  const open = desk.ideas.filter((i) => i.status === "open");
  const wins = closed.filter((i) => i.result.R > 0).length;
  // Brier score of "probability the trade is profitable at exit" (0 = perfect, 0.25 = coin flip)
  const brier = closed.length ? closed.reduce((s, i) => s + (i.probability - (i.result.R > 0 ? 1 : 0)) ** 2, 0) / closed.length : null;
  let cum = 0;
  const equity = [...closed].sort((a, b) => Date.parse(a.closed) - Date.parse(b.closed)).map((i) => ({ t: i.closed, R: r2((cum += i.result.R)) }));
  return { open: open.length, openR: r2(open.reduce((s, i) => s + (i.live?.R || 0), 0)), closed: closed.length, wins,
    hitRate: closed.length ? r2(wins / closed.length) : null, avgR: closed.length ? r2(cum / closed.length) : null, totalR: r2(cum),
    brier: r2(brier), equity };
}
export function deskView() {
  return { enabled: desk.enabled, running: desk.running, error: desk.error, lastRun: desk.runs[0] || null,
    ideas: desk.ideas.slice(0, 60), score: scorecard() };
}

// ---------------------------------------------------------------- research context for the model
function researchBrief() {
  if (!research) return "No historical study available.";
  const S = research.stats, B = research.baseline;
  const pick = ["BRENT", "WTI", "BRENT_WTI", "CRACK", "FRO", "STNG", "GOLD"];
  const fmt = (g) => Object.fromEntries(pick.map((k) => [k, Object.fromEntries(research.horizons.map((h) => {
    const s = g[k]?.[h]; return [`${h}d`, s ? `median ${s.median}, mean ${s.mean}, up ${s.up}/${s.n}, t ${s.t}` : "n/a"];
  }))]));
  return JSON.stringify({
    units: "Outrights in % move from the last close before the news; BRENT_WTI and CRACK in $/bbl change. Horizons in trading days.",
    unconditional_baseline_all_days_since_2019: Object.fromEntries(pick.map((k) => [k, B[k]])),
    by_family: Object.fromEntries(Object.entries(S.family).map(([f, g]) => [f, fmt(g)])),
    by_kind: Object.fromEntries(Object.entries(S.kind).map(([f, g]) => [f, { n: g.BRENT[1]?.n, ...fmt(g) }])),
    events: research.events.map((e) => ({ id: e.id, date: e.date, kind: e.kind, title: e.title,
      brent_1d_5d_20d: [e.moves.BRENT[1], e.moves.BRENT[5], e.moves.BRENT[20]], fro_5d: e.moves.FRO[5], crack_5d: e.moves.CRACK[5] })),
    walk_forward_out_of_sample: research.walkForward.map((w) => ({ rule: `${w.inst} ${w.h}d: trade the sign of the median move of EARLIER same-family events`,
      hits: `${w.hits}/${w.n}`, avg_pnl: `${w.avgPnl}${w.unit}`, always_long_avg: `${w.alwaysLongAvg}${w.unit}`, by_family: w.byFamily })),
  });
}

const SYSTEM = `You are the head of the commodities trading desk that owns this terminal. You turn the live maritime-risk picture for the Strait of Hormuz, Bab el-Mandeb / Red Sea, Suez and the Cape into a small number of specific, falsifiable PAPER trades, and you are judged on calibration and risk-adjusted results, not on bold calls.

You get: the live snapshot (AIS stats and alerts, IMF transit counts, credited news, official statements, social posts, prices, futures curve and spreads), the desk's open ideas and track record, and a historical event study of 20 Gulf/Red Sea incidents since 2019 with an out-of-sample (walk-forward) test.

What the study says, and how to use it:
- Next-day direction of crude after a headline is close to a coin flip out of sample. Do not sell 1-day "headline" directional trades as an edge.
- After state strikes / escalation, Brent's median path fades over ~20 trading days; fading that risk premium is the one rule that held out of sample (about 9 of 14), still a small sample.
- After attacks on shipping, crude and tanker equities (FRO, DHT, STNG) rose in-sample over 5 days, but this did not hold up out of sample. Treat it as weak.
- Always quote the base rate you rely on with its sample size (e.g. "shipping incidents: Brent +2.25% median over 5d, up 6/9"), and say when there is no good analogue.

Rules for ideas:
- 0 to 3 ideas. "No trade" is a valid, often correct answer: then give an empty list and explain in no_trade_reason. Never invent events that are not in the snapshot.
- If the AIS feed is in DEMO mode, vessel data is synthetic: base nothing on it, and say so.
- Only use instruments from the allowed list. Do not duplicate an open idea on the same instrument and direction; you may recommend closing an open idea (close_ids) if its thesis is broken.
- stop_distance and target_distance are distances from the live price: in % for outright instruments, in $/bbl for BRENT_WTI and CRACK_321. Size stops to the instrument's normal volatility over the horizon (Brent's daily s.d. is about 2.7%, so a 1-day stop inside 1% is noise).
- probability = your honest probability that the trade is profitable when it closes (stop, target or expiry). Be calibrated: most edges here are small, so most probabilities belong between 0.45 and 0.65.
- Only propose trades with positive expected value under your own numbers: probability × (target_distance / stop_distance) − (1 − probability) must be above zero. The server rejects ideas that fail this check.
- risk_pct = paper risk as % of book if the stop is hit (0.25 to 1.5).
- Attribute evidence to named sources as the snapshot gives them. Social posts are unverified.
- This is research for a paper-trading demo, not investment advice.`;

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["regime", "summary", "ideas", "no_trade_reason", "close_ids"],
  properties: {
    regime: { type: "string", description: "One line: the market regime right now (e.g. 'risk premium building on Red Sea attacks')" },
    summary: { type: "string", description: "2-4 sentences: what the desk is doing and why" },
    ideas: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["instrument", "direction", "horizon_days", "thesis", "evidence", "base_rate", "stop_distance", "target_distance", "probability", "risk_pct", "invalidation"],
      properties: {
        instrument: { type: "string", enum: Object.keys(INSTR) },
        direction: { type: "string", enum: ["LONG", "SHORT"] },
        horizon_days: { type: "integer", description: "Calendar days, 1 to 30" },
        thesis: { type: "string", description: "1-2 sentences" },
        evidence: { type: "array", items: { type: "string" }, description: "Live evidence with sources named" },
        base_rate: { type: "string", description: "The historical analogue and its numbers, or 'no good analogue'" },
        stop_distance: { type: "number" },
        target_distance: { type: "number" },
        probability: { type: "number" },
        risk_pct: { type: "number" },
        invalidation: { type: "string", description: "What news or price action would prove the idea wrong" },
      } } },
    no_trade_reason: { type: "string", description: "Why no (more) trades; empty string if not applicable" },
    close_ids: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "reason"],
      properties: { id: { type: "string" }, reason: { type: "string" } } } },
  },
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const runs = { day: "", count: 0, max: 12 };
export async function runDesk(reason = "scheduled") {
  if (!desk.enabled || desk.running) return { error: desk.error || "busy" };
  const day = new Date().toISOString().slice(0, 10);
  if (runs.day !== day) Object.assign(runs, { day, count: 0 });
  if (runs.count >= runs.max) return { error: `daily desk run limit (${runs.max}) reached` };
  if (INSTR.BRENT.get() == null) return { error: "no live prices yet" };
  runs.count++;
  desk.running = true; desk.error = null; bus.emit("desk", deskView());
  try {
    markAll();
    const open = desk.ideas.filter((i) => i.status === "open").map((i) => ({ id: i.id, instrument: i.instrument, direction: i.direction,
      opened: i.opened, entry: i.entry, mark: i.mark, stop: i.stop, target: i.target, expires: i.expires, pnl_R: i.live?.R, thesis: i.thesis }));
    const live = Object.fromEntries(Object.entries(INSTR).map(([k, v]) => [k, { label: v.label, unit_for_distances: v.unit, price: r2(v.get()) }]));
    const user = `Trigger: ${reason}. Time: ${new Date().toISOString()}.

Allowed instruments with live prices:
${JSON.stringify(live)}

Open paper ideas:
${JSON.stringify(open)}

Track record so far: ${JSON.stringify((({ equity, ...s }) => s)(scorecard()))}

Latest analyst brief headline: ${analyst.brief ? `${analyst.brief.headline} (overall risk ${analyst.brief.overall_risk}, ${analyst.brief.generated})` : "none yet"}

Historical event study:
${researchBrief()}

Live desk snapshot:
${snapshot()}`;
    const { data, model } = await structuredCall({ system: SYSTEM, user, schema: SCHEMA });
    const now = new Date();
    const closedIds = [];
    for (const c of data.close_ids || []) if (closeIdea(c.id, c.reason)) closedIds.push(c.id);
    const made = [], rejected = [];
    for (const raw of (data.ideas || []).slice(0, 3)) {
      const inst = INSTR[raw.instrument]; const entry = inst?.get();
      if (!inst || entry == null) continue;
      if (desk.ideas.some((i) => i.status === "open" && i.instrument === raw.instrument && i.direction === raw.direction)) continue;
      const dir = raw.direction === "LONG" ? 1 : -1;
      const pctUnit = inst.unit === "%";
      const sd = Math.abs(+raw.stop_distance) || (pctUnit ? 2 : 1), td = Math.abs(+raw.target_distance) || sd * 1.5;
      const stopDist = pctUnit ? (entry * clamp(sd, 0.3, 25)) / 100 : clamp(sd, 0.05, 15);
      const tgtDist = pctUnit ? (entry * clamp(td, 0.3, 50)) / 100 : clamp(td, 0.05, 30);
      const p = clamp(+raw.probability || 0.5, 0.05, 0.95);
      const rr = tgtDist / stopDist;
      const horizon = clamp(Math.round(+raw.horizon_days || 5), 1, 30);
      // Risk check: a desk doesn't take trades its own numbers say lose money
      if (p * rr - (1 - p) <= 0) { rejected.push(`${raw.direction} ${raw.instrument} (EV ${(p * rr - (1 - p)).toFixed(2)}R)`); continue; }
      const idea = {
        id: hashId(`${raw.instrument}${raw.direction}${now.toISOString()}`), instrument: raw.instrument, label: inst.label, unit: inst.unit,
        direction: raw.direction, opened: now.toISOString(), expires: new Date(now.getTime() + horizon * 86400_000).toISOString(), horizon_days: horizon,
        entry: r2(entry), stop: r2(entry - dir * stopDist), target: r2(entry + dir * tgtDist), rr: r2(rr), probability: r2(p),
        // Rough EV in R: treat the trade as binary between target (+rr) and stop (-1)
        evR: r2(p * rr - (1 - p)), risk_pct: r2(clamp(+raw.risk_pct || 0.5, 0.1, 2)),
        thesis: raw.thesis, evidence: raw.evidence || [], base_rate: raw.base_rate, invalidation: raw.invalidation,
        status: "open", mark: r2(entry), live: { R: 0, pct: 0, abs: 0 }, model, reason,
      };
      desk.ideas.unshift(idea); made.push(idea.id);
    }
    desk.runs.unshift({ time: now.toISOString(), reason, model, regime: data.regime, summary: data.summary, noTrade: data.no_trade_reason, ideas: made, closed: closedIds, rejected });
    log("desk", `run (${reason}): ${made.length} new idea(s), ${closedIds.length} closed · ${data.regime}`);
    persist();
    return { ok: true };
  } catch (e) {
    desk.error = e.message; log("desk", "error:", e.message);
    return { error: e.message };
  } finally {
    desk.running = false; bus.emit("desk", deskView());
  }
}

export function startDesk(env) {
  bus.on("prices", () => { try { markAll(); } catch (e) { log("desk", "mark error", e.message); } });
  setInterval(persist, 5 * 60_000).unref();
  if (!research) log("desk", "public-data/research.json missing: run node scripts/build-research.mjs");
  if (!analyst.enabled) { desk.error = analyst.error || "Set ANTHROPIC_API_KEY to enable the trade desk"; return; }
  desk.enabled = true;
  if (Number(env.DESK_DAILY_MAX) > 0) runs.max = Number(env.DESK_DAILY_MAX);
  const minutes = Math.max(15, Number(env.DESK_INTERVAL_MIN) || 120);
  // First run once prices and the first brief are in, unless a recent run exists
  const last = desk.runs[0] ? Date.parse(desk.runs[0].time) : 0;
  if (Date.now() - last > minutes * 60_000) setTimeout(() => runDesk("startup"), 120_000);
  setInterval(() => runDesk("scheduled"), minutes * 60_000);
  // Critical alerts prompt a re-look (at most every 30 min)
  let lastAlertRun = 0;
  bus.on("alert", (a) => {
    if (a.severity !== "critical" || Date.now() - lastAlertRun < 30 * 60_000) return;
    lastAlertRun = Date.now();
    setTimeout(() => runDesk(`critical alert: ${a.title}`), 60_000);
  });
}
