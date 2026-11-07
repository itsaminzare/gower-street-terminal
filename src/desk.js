// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// TRADE DESK: an AI agent proposes paper trades; code prices them, checks them against hard risk limits and
// logs everything; a HUMAN approves or rejects each one. Approved trades are marked to market and closed on
// stop, target or expiry, scored in R after costs, with hit rate and Brier score for calibration.
// Paper trading only: nothing here can place an order.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bus, log, MODE, DEMO, hashId } from "./util.js";
import { load, save } from "./store.js";
import { prices } from "./prices.js";
import { analyst, snapshot, structuredCall } from "./analyst.js";
import { INSTRUMENTS, DEFAULT_LIMITS, baseRate, priceIdea, result, riskChecks, systemPrompt, SCHEMA, r2 } from "./desk-core.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch { return null; } };
export const research = readJSON("public-data/research.json");
export const agentBacktest = readJSON("public-data/agent-backtest.json");
const RUN_DIR = path.join(ROOT, "data", `desk-runs-${MODE}`);
fs.mkdirSync(RUN_DIR, { recursive: true });

// Live prices for each tradeable instrument (spreads built from their legs)
const px = (s) => prices[s]?.price;
const LIVE = {
  BRENT: () => px("BZ=F"), WTI: () => px("CL=F"),
  BRENT_WTI: () => (px("BZ=F") != null && px("CL=F") != null ? px("BZ=F") - px("CL=F") : null),
  CRACK_321: () => (px("RB=F") != null && px("HO=F") != null && px("CL=F") != null ? (2 * px("RB=F") * 42 + px("HO=F") * 42 - 3 * px("CL=F")) / 3 : null),
  ULSD: () => px("HO=F"), RBOB: () => px("RB=F"), TTF: () => px("TTF=F"), HENRY_HUB: () => px("NG=F"),
  GOLD: () => px("GC=F"), FRO: () => px("FRO"), DHT: () => px("DHT"), STNG: () => px("STNG"),
};
const live = (k) => LIVE[k]?.();

const stored = load(`desk2-${MODE}`, {});
export const desk = { ideas: stored.ideas || [], runs: stored.runs || [], log: stored.log || [], halted: !!stored.halted,
  running: false, error: null, enabled: false, limits: { ...DEFAULT_LIMITS } };
const persist = () => save(`desk2-${MODE}`, { ideas: desk.ideas.slice(0, 300), runs: desk.runs.slice(0, 100), log: desk.log.slice(0, 1000), halted: desk.halted });

/** Append to the audit log: every proposal, check, approval, rejection, close and halt. */
function audit(actor, action, detail, ideaId = null) {
  desk.log.unshift({ t: new Date().toISOString(), actor, action, detail, ideaId });
  if (desk.log.length > 1000) desk.log.length = 1000;
}

// ---------------------------------------------------------------- mark to market
function closeTrade(i, status, exit, actor, reason) {
  Object.assign(i, { status, exit: r2(exit), closed: new Date().toISOString(), result: result(i, exit), closeReason: reason || null });
  audit(actor, `closed (${status})`, `${i.direction} ${i.instrument} at ${r2(exit)} → ${i.result.R}R after costs${reason ? ` · ${reason}` : ""}`, i.id);
  log("desk", `${i.instrument} ${i.direction} closed (${status}) ${i.result.R}R`);
}
function markAll() {
  let changed = false;
  const now = Date.now();
  for (const i of desk.ideas) {
    if (i.status === "proposed" && now > Date.parse(i.proposed) + desk.limits.proposalTTLmin * 60_000) {
      i.status = "lapsed"; audit("server", "lapsed", `not approved within ${desk.limits.proposalTTLmin} min`, i.id); changed = true; continue;
    }
    if (i.status !== "open") continue;
    const p = live(i.instrument);
    if (p == null) continue;
    const dir = i.direction === "LONG" ? 1 : -1;
    i.mark = r2(p); i.markTime = new Date().toISOString(); i.live = result(i, p);
    if (dir * (p - i.stop) <= 0) closeTrade(i, "stopped", i.stop, "server");
    else if (dir * (p - i.target) >= 0) closeTrade(i, "target", i.target, "server");
    else if (now >= Date.parse(i.expires)) closeTrade(i, "expired", p, "server");
    changed = true;
  }
  if (changed) bus.emit("desk", deskView());
}

export function scorecard() {
  const closed = desk.ideas.filter((i) => ["stopped", "target", "expired", "closed"].includes(i.status) && i.result);
  const open = desk.ideas.filter((i) => i.status === "open");
  const wins = closed.filter((i) => i.result.R > 0).length;
  const brier = closed.length ? closed.reduce((s, i) => s + (i.probability - (i.result.R > 0 ? 1 : 0)) ** 2, 0) / closed.length : null;
  let cum = 0;
  const equity = [...closed].sort((a, b) => Date.parse(a.closed) - Date.parse(b.closed)).map((i) => ({ t: i.closed, R: r2((cum += i.result.R)) }));
  return { open: open.length, openR: r2(open.reduce((s, i) => s + (i.live?.R || 0), 0)), openRisk: r2(open.reduce((s, i) => s + i.riskPct, 0)),
    proposed: desk.ideas.filter((i) => i.status === "proposed").length, closed: closed.length, wins,
    hitRate: closed.length ? r2(wins / closed.length) : null, avgR: closed.length ? r2(cum / closed.length) : null, totalR: r2(cum),
    brier: r2(brier), equity, rejectedByRisk: desk.ideas.filter((i) => i.status === "blocked").length,
    rejectedByHuman: desk.ideas.filter((i) => i.status === "rejected").length };
}
export function deskView() {
  return { enabled: desk.enabled, running: desk.running, error: desk.error, halted: desk.halted, limits: desk.limits, demo: DEMO,
    lastRun: desk.runs[0] || null, ideas: desk.ideas.slice(0, 60), log: desk.log.slice(0, 80), score: scorecard(),
    backtest: agentBacktest ? agentBacktest.summary : null };
}

// ---------------------------------------------------------------- research context for the model
function researchBrief() {
  if (!research) return "No historical study available.";
  const keys = ["BRENT", "WTI", "BRENT_WTI", "CRACK", "FRO", "STNG", "GOLD"];
  const fmt = (g) => Object.fromEntries(keys.map((k) => [k, Object.fromEntries(research.horizons.map((h) => {
    const s = g[k]?.[h]; return [`${h}d`, s ? `median ${s.median}, up ${s.up}/${s.n}` : "n/a"];
  }))]));
  return JSON.stringify({
    units: "Outrights in % from the last close before the news; BRENT_WTI and CRACK in $/bbl. Horizons in trading days.",
    by_family: Object.fromEntries(Object.entries(research.stats.family).map(([f, g]) => [f, fmt(g)])),
    events: research.events.map((e) => ({ date: e.date, kind: e.kind, title: e.title, brent_1d_5d_20d: [e.moves.BRENT[1], e.moves.BRENT[5], e.moves.BRENT[20]], fro_5d: e.moves.FRO[5] })),
    walk_forward_net_of_costs: research.walkForward.map((w) => ({ rule: `${w.inst} ${w.h}d`, hits: `${w.hits}/${w.n}`, p_value: w.pHits, avg_net: w.avgPnl, buy_and_hold_net: w.alwaysLongAvg })),
  });
}

// ---------------------------------------------------------------- one desk run: AI proposes, code checks
const runs = { day: "", count: 0, max: 12 };
const openTrades = () => desk.ideas.filter((i) => i.status === "open");
export async function runDesk(reason = "scheduled") {
  if (!desk.enabled || desk.running) return { error: desk.error || "busy" };
  if (desk.halted) { audit("server", "run refused", "kill switch is ON"); return { error: "desk halted" }; }
  const day = new Date().toISOString().slice(0, 10);
  if (runs.day !== day) Object.assign(runs, { day, count: 0 });
  if (runs.count >= runs.max) return { error: `daily desk run limit (${runs.max}) reached` };
  if (live("BRENT") == null) return { error: "no live prices yet" };
  runs.count++;
  desk.running = true; desk.error = null; bus.emit("desk", deskView());
  const runId = hashId(`run${Date.now()}`);
  try {
    markAll();
    const pricesNow = Object.fromEntries(Object.entries(INSTRUMENTS).map(([k, v]) => [k, { label: v.label, unit_for_distances: v.unit, price: r2(live(k)) }]));
    const openForModel = openTrades().map((i) => ({ id: i.id, instrument: i.instrument, direction: i.direction, entry: i.entry, mark: i.mark, stop: i.stop, target: i.target, expires: i.expires, pnl_R: i.live?.R, thesis: i.thesis }));
    const snap = snapshot();
    const user = `Trigger: ${reason}. Time: ${new Date().toISOString()}.

Allowed instruments with live prices:
${JSON.stringify(pricesNow)}

Open paper trades:
${JSON.stringify(openForModel)}

Track record so far: ${JSON.stringify((({ equity, ...s }) => s)(scorecard()))}

Latest analyst brief: ${analyst.brief ? `${analyst.brief.headline} (overall risk ${analyst.brief.overall_risk}, ${analyst.brief.generated})` : "none yet"}

Historical event study:
${researchBrief()}

Live desk snapshot:
${snap}`;
    // Keep the exact raw input of every run, so each trade can be traced back to the data that produced it
    fs.writeFileSync(path.join(RUN_DIR, `${runId}.json`), JSON.stringify({ runId, time: new Date().toISOString(), reason, prices: pricesNow, snapshot: JSON.parse(snap) }));
    pruneRuns();
    const { data, model } = await structuredCall({ system: systemPrompt(), user, schema: SCHEMA });
    audit("agent", "run", `${data.regime} · ${(data.ideas || []).length} idea(s)`, null);
    const now = new Date();
    for (const c of data.close_ids || []) {
      const i = desk.ideas.find((x) => x.id === c.id && x.status === "open");
      // The agent may only RECOMMEND closing; the human decides. Flag it on the trade.
      if (i) { i.closeAdvice = { reason: c.reason, at: now.toISOString() }; audit("agent", "recommends close", c.reason, i.id); }
    }
    const made = [];
    for (const raw of (data.ideas || []).slice(0, desk.limits.maxIdeasPerRun)) {
      const ref = live(raw.instrument);
      if (!INSTRUMENTS[raw.instrument] || ref == null) continue;
      const priced = priceIdea(raw, ref);
      const br = baseRate(research, { analogue: raw.analogue, instrument: raw.instrument, direction: raw.direction, horizonDays: priced.horizonDays });
      const rc = riskChecks({ raw, priced, br, open: openTrades(), limits: desk.limits, halted: desk.halted, demo: DEMO });
      const inst = INSTRUMENTS[raw.instrument];
      const idea = {
        id: hashId(`${raw.instrument}${raw.direction}${now.toISOString()}${Math.random()}`), runId, instrument: raw.instrument, label: inst.label, unit: inst.unit,
        direction: raw.direction, proposed: now.toISOString(), horizon_days: priced.horizonDays,
        refPrice: priced.entry, entry: priced.entry, stop: priced.stop, target: priced.target, stopDist: priced.stopDist, tgtDist: priced.tgtDist, costAbs: priced.costAbs,
        rr: priced.rr, probability: priced.probability, evR: priced.evNet, riskPct: priced.riskPct,
        thesis: raw.thesis, evidence: raw.evidence || [], invalidation: raw.invalidation,
        status: rc.pass ? "proposed" : "blocked", model, reason,
        trace: {
          runId, inputs: { time: now.toISOString(), aisMode: DEMO ? "SIMULATED" : "live", price: priced.entry, priceSource: prices["BZ=F"]?.source || "Yahoo Finance",
            alerts24h: JSON.parse(snap).alerts_last_24h?.length ?? null, headlines: JSON.parse(snap).headlines?.length ?? null, statements: JSON.parse(snap).official_statements?.length ?? null },
          ai: { model, analogue: raw.analogue, reading: raw.base_rate_reading, probability: raw.probability, stop_distance: raw.stop_distance, target_distance: raw.target_distance, horizon_days: raw.horizon_days, risk_pct: raw.risk_pct },
          baseRate: br, maths: { formula: priced.formula, costR: priced.costR, rr: priced.rr, evNet: priced.evNet, entry: priced.entry, stop: priced.stop, target: priced.target },
          checks: rc.checks,
        },
      };
      desk.ideas.unshift(idea); made.push(idea.id);
      audit("agent", "proposed", `${idea.direction} ${idea.instrument} @ ${idea.entry}, P(win) ${Math.round(idea.probability * 100)}%, EV ${idea.evR}R`, idea.id);
      audit("server", rc.pass ? "risk checks passed" : "BLOCKED by risk checks", rc.pass ? `${rc.checks.length} checks` : rc.blocking.join("; "), idea.id);
    }
    desk.runs.unshift({ id: runId, time: now.toISOString(), reason, model, regime: data.regime, summary: data.summary, noTrade: data.no_trade_reason, ideas: made });
    log("desk", `run ${runId} (${reason}): ${made.length} idea(s) · ${data.regime}`);
    persist();
    return { ok: true };
  } catch (e) {
    desk.error = e.message; log("desk", "error:", e.message); audit("server", "run failed", e.message);
    return { error: e.message };
  } finally {
    desk.running = false; bus.emit("desk", deskView());
  }
}
function pruneRuns() {
  try {
    const files = fs.readdirSync(RUN_DIR).map((f) => ({ f, t: fs.statSync(path.join(RUN_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(60)) fs.unlinkSync(path.join(RUN_DIR, f));
  } catch { /* best effort */ }
}
export function runInput(runId) {
  if (!/^[a-z0-9]+$/.test(runId)) return null;
  try { return fs.readFileSync(path.join(RUN_DIR, `${runId}.json`), "utf8"); } catch { return null; }
}

// ---------------------------------------------------------------- human decisions
/** Approve / reject a proposal, or close an open trade. Returns {ok} or {error}. */
export function decide(id, action, actor) {
  const i = desk.ideas.find((x) => x.id === id);
  if (!i) return { error: "unknown idea" };
  if (action === "reject") {
    if (i.status !== "proposed") return { error: `can't reject a ${i.status} idea` };
    i.status = "rejected"; i.decision = { action, by: actor, at: new Date().toISOString() };
    audit(actor, "rejected", `${i.direction} ${i.instrument}`, id);
  } else if (action === "approve") {
    if (i.status !== "proposed") return { error: `can't approve a ${i.status} idea` };
    const p = live(i.instrument);
    if (p == null) return { error: "no live price" };
    // Re-run the hard checks against the book as it is NOW, and refuse if the price has run away from the proposal
    const priced = priceIdea({ instrument: i.instrument, direction: i.direction, stop_distance: i.unit === "%" ? (i.stopDist / i.refPrice) * 100 : i.stopDist,
      target_distance: i.unit === "%" ? (i.tgtDist / i.refPrice) * 100 : i.tgtDist, probability: i.probability, horizon_days: i.horizon_days, risk_pct: i.riskPct }, p);
    const rc = riskChecks({ raw: { instrument: i.instrument, evidence: i.evidence }, priced, br: i.trace.baseRate, open: openTrades(), limits: desk.limits, halted: desk.halted });
    const drift = Math.abs(p - i.refPrice) / i.stopDist;
    rc.checks.push({ name: `Price within ${desk.limits.maxDriftStops} stop-distances of the proposal`, pass: drift <= desk.limits.maxDriftStops, detail: `moved ${r2(drift)} stop-distances`, hard: true });
    const blocking = rc.checks.filter((c) => c.hard && !c.pass);
    i.trace.approvalChecks = rc.checks;
    if (blocking.length) {
      audit("server", "approval BLOCKED", blocking.map((c) => c.name).join("; "), id);
      bus.emit("desk", deskView()); persist();
      return { error: `Blocked by risk limits: ${blocking.map((c) => c.name).join("; ")}` };
    }
    const now = new Date();
    Object.assign(i, { status: "open", entry: priced.entry, stop: priced.stop, target: priced.target, costAbs: priced.costAbs, opened: now.toISOString(),
      expires: new Date(now.getTime() + i.horizon_days * 86400_000).toISOString(), mark: priced.entry, live: { R: 0, pct: 0, abs: 0 },
      decision: { action, by: actor, at: now.toISOString() } });
    audit(actor, "approved", `${i.direction} ${i.instrument} opened at ${i.entry} (stop ${i.stop}, target ${i.target})`, id);
  } else if (action === "close") {
    if (i.status !== "open") return { error: "not open" };
    const p = live(i.instrument);
    if (p == null) return { error: "no live price" };
    closeTrade(i, "closed", p, actor, "closed by a human");
  } else return { error: "bad action" };
  persist(); bus.emit("desk", deskView());
  return { ok: true };
}
/** Kill switch: halt stops new runs and approvals; `flatten` also closes every open trade at market. */
export function setHalt(halt, flatten, actor) {
  desk.halted = !!halt;
  audit(actor, halt ? "KILL SWITCH ON" : "kill switch off", halt ? (flatten ? "all trading halted; open trades flattened" : "all trading halted") : "trading resumed");
  if (halt) {
    for (const i of desk.ideas) if (i.status === "proposed") { i.status = "lapsed"; audit("server", "lapsed", "kill switch", i.id); }
    if (flatten) for (const i of openTrades()) { const p = live(i.instrument); if (p != null) closeTrade(i, "closed", p, actor, "kill switch flatten"); }
  }
  persist(); bus.emit("desk", deskView());
}

export function startDesk(env) {
  bus.on("prices", () => { try { markAll(); } catch (e) { log("desk", "mark error", e.message); } });
  setInterval(() => { markAll(); persist(); }, 60_000).unref();
  if (!research) log("desk", "public-data/research.json missing: run node scripts/build-research.mjs");
  for (const [k, envKey] of [["maxRiskPerTrade", "DESK_MAX_RISK_PER_TRADE"], ["maxOpenRisk", "DESK_MAX_OPEN_RISK"]]) if (Number(env[envKey]) > 0) desk.limits[k] = Number(env[envKey]);
  if (!analyst.enabled) { desk.error = analyst.error || "Set ANTHROPIC_API_KEY to enable the trade desk"; return; }
  desk.enabled = true;
  if (Number(env.DESK_DAILY_MAX) > 0) runs.max = Number(env.DESK_DAILY_MAX);
  const minutes = Math.max(15, Number(env.DESK_INTERVAL_MIN) || 120);
  const last = desk.runs[0] ? Date.parse(desk.runs[0].time) : 0;
  if (Date.now() - last > minutes * 60_000) setTimeout(() => runDesk("startup"), 120_000);
  setInterval(() => runDesk("scheduled"), minutes * 60_000);
  let lastAlertRun = 0;
  bus.on("alert", (a) => {
    if (a.severity !== "critical" || Date.now() - lastAlertRun < 30 * 60_000) return;
    lastAlertRun = Date.now();
    setTimeout(() => runDesk(`critical alert: ${a.title}`), 60_000);
  });
}
