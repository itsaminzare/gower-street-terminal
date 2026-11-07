// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Pure, side-effect-free core of the trade desk, shared by the live desk (src/desk.js) and the historical
// agent backtest (scripts/agent-backtest.mjs): the prompt, the output schema, the code-computed base rates,
// the trade maths and the risk checks. The AI only supplies judgement; every number below is computed here.

export const INSTRUMENTS = {
  BRENT: { label: "Brent crude (ICE, front month)", unit: "%", research: "BRENT", cost: 0.05 },
  WTI: { label: "WTI crude (NYMEX, front month)", unit: "%", research: "WTI", cost: 0.05 },
  BRENT_WTI: { label: "Brent–WTI spread", unit: "$/bbl", research: "BRENT_WTI", cost: 0.04 },
  CRACK_321: { label: "3-2-1 crack spread (refining margin)", unit: "$/bbl", research: "CRACK", cost: 0.12 },
  ULSD: { label: "ULSD diesel (NYMEX)", unit: "%", research: "ULSD", cost: 0.08 },
  RBOB: { label: "RBOB gasoline (NYMEX)", unit: "%", research: "RBOB", cost: 0.08 },
  TTF: { label: "Dutch TTF gas", unit: "%", research: null, cost: 0.15 },
  HENRY_HUB: { label: "Henry Hub gas", unit: "%", research: null, cost: 0.1 },
  GOLD: { label: "Gold", unit: "%", research: "GOLD", cost: 0.03 },
  FRO: { label: "Frontline (crude tankers, NYSE)", unit: "%", research: "FRO", cost: 0.12 },
  DHT: { label: "DHT Holdings (VLCCs, NYSE)", unit: "%", research: "DHT", cost: 0.15 },
  STNG: { label: "Scorpio Tankers (product tankers, NYSE)", unit: "%", research: "STNG", cost: 0.12 },
};
export const ANALOGUES = ["tanker-attack", "seizure", "shipping-disruption", "supply-attack", "state-strike", "none"];
const FAMILY = { "tanker-attack": "shipping", seizure: "shipping", "shipping-disruption": "shipping", "supply-attack": "escalation", "state-strike": "escalation" };

// Risk limits, enforced in code (env-overridable on the live desk)
export const DEFAULT_LIMITS = {
  maxRiskPerTrade: 1.0,   // % of book lost if the stop is hit
  maxOpenRisk: 3.0,       // % of book at risk across all open trades
  maxIdeasPerRun: 3,
  minEvidence: 1,         // named sources the idea must cite
  minNetEV: 0,            // expected value in R after costs must exceed this
  maxProbOverBase: 0.25,  // AI probability may not exceed the historical hit rate by more than this (when a base rate exists)
  proposalTTLmin: 60,     // a proposal not approved within this window lapses (prices move)
  maxDriftStops: 0.5,     // approval refused if price moved more than this many stop-distances since the proposal
};

export const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- base rates (computed, never written by the AI)
const toTradingDays = (calendarDays) => { const td = calendarDays * 5 / 7; return td <= 2.5 ? 1 : td <= 11 ? 5 : 20; };
export function baseRate(research, { analogue, instrument, direction, horizonDays, asOf }) {
  const key = INSTRUMENTS[instrument]?.research;
  const h = toTradingDays(horizonDays);
  if (!research || !key || !analogue || analogue === "none") return { available: false, h, reason: !key ? "instrument not in the event study" : "the desk named no historical analogue" };
  const fam = FAMILY[analogue];
  // Point-in-time: only events before `asOf` (used by the backtest; the live desk uses all of them)
  const evs = research.events.filter((e) => (!asOf || e.date < asOf));
  const pick = (list) => {
    const v = list.map((e) => e.moves[key]?.[h]).filter((x) => x != null && Math.abs(x) < 100);
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b), n = v.length, med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    const dir = direction === "SHORT" ? -1 : 1;
    return { n, median: r2(med), mean: r2(v.reduce((a, b) => a + b, 0) / n), wins: v.filter((x) => dir * x > 0).length };
  };
  const kind = pick(evs.filter((e) => e.kind === analogue)), family = pick(evs.filter((e) => e.family === fam));
  const b = research.baseline?.[key]?.[h];
  const hitRate = family && family.n >= 3 ? r2(family.wins / family.n) : null;
  return { available: !!family, analogue, family: fam, h, unit: research.units?.[key] || "%", kind, familyStat: family, hitRate,
    baseline: b ? { mean: b.mean, sd: b.sd, upShare: b.up } : null };
}

// ---------------------------------------------------------------- trade maths
/** Turn the AI's judgement into a priced trade. Distances: % for outrights, $/bbl for spreads. */
export function priceIdea(raw, entry) {
  const inst = INSTRUMENTS[raw.instrument];
  const pct = inst.unit === "%";
  const dir = raw.direction === "LONG" ? 1 : -1;
  const sd = Math.abs(+raw.stop_distance) || (pct ? 2 : 1), td = Math.abs(+raw.target_distance) || sd * 1.5;
  const stopDist = pct ? (entry * clamp(sd, 0.3, 25)) / 100 : clamp(sd, 0.05, 15);
  const tgtDist = pct ? (entry * clamp(td, 0.3, 50)) / 100 : clamp(td, 0.05, 30);
  const costAbs = pct ? (entry * inst.cost) / 100 : inst.cost;
  const p = clamp(+raw.probability || 0.5, 0.05, 0.95);
  const rr = tgtDist / stopDist, costR = costAbs / stopDist;
  // Binary approximation between target and stop, with the round-trip cost charged either way
  const evNet = p * (rr - costR) - (1 - p) * (1 + costR);
  return { entry: r2(entry), stop: r2(entry - dir * stopDist), target: r2(entry + dir * tgtDist), stopDist, tgtDist, costAbs,
    rr: r2(rr), costR: Math.round(costR * 1000) / 1000, evNet: r2(evNet), probability: r2(p),
    horizonDays: clamp(Math.round(+raw.horizon_days || 5), 1, 30), riskPct: r2(clamp(+raw.risk_pct || 0.5, 0.05, 5)),
    formula: `EV = p×(R:R − cost) − (1−p)×(1 + cost) = ${p.toFixed(2)}×(${rr.toFixed(2)} − ${costR.toFixed(3)}) − ${(1 - p).toFixed(2)}×(1 + ${costR.toFixed(3)}) = ${evNet.toFixed(2)}R` };
}
/** Result of a trade closed at `exit`, in R net of costs, plus % (outrights) or $/bbl (spreads). */
export function result(idea, exit) {
  const dir = idea.direction === "LONG" ? 1 : -1;
  const move = dir * (exit - idea.entry);
  const risk = Math.abs(idea.entry - idea.stop);
  return { R: r2((move - idea.costAbs) / risk), grossR: r2(move / risk),
    pct: idea.unit === "%" ? r2(((move - idea.costAbs) / idea.entry) * 100) : null, abs: r2(move - idea.costAbs) };
}

// ---------------------------------------------------------------- risk checks
/** Every check, pass or fail, so the decision trace can show all of them. */
export function riskChecks({ raw, priced, br, open, limits = DEFAULT_LIMITS, halted = false, demo = false }) {
  const checks = [];
  const add = (name, pass, detail, hard = true) => checks.push({ name, pass, detail, hard });
  add("Desk not halted", !halted, halted ? "kill switch is ON" : "trading allowed");
  add("Instrument allowed", !!INSTRUMENTS[raw.instrument], raw.instrument);
  add("One position per instrument", !open.some((i) => i.instrument === raw.instrument), open.some((i) => i.instrument === raw.instrument) ? "already open" : "none open");
  add(`Risk per trade ≤ ${limits.maxRiskPerTrade}% of book`, priced.riskPct <= limits.maxRiskPerTrade, `${priced.riskPct}%`);
  const openRisk = open.reduce((s, i) => s + (i.riskPct || 0), 0);
  add(`Open risk ≤ ${limits.maxOpenRisk}% of book`, openRisk + priced.riskPct <= limits.maxOpenRisk, `${r2(openRisk)}% open + ${priced.riskPct}% = ${r2(openRisk + priced.riskPct)}%`);
  add(`Expected value after costs > ${limits.minNetEV}R`, priced.evNet > limits.minNetEV, priced.formula);
  const nEv = (raw.evidence || []).filter((e) => String(e).trim().length > 8).length;
  add(`Cites ≥ ${limits.minEvidence} source`, nEv >= limits.minEvidence, `${nEv} cited`);
  if (br?.hitRate != null) {
    const gap = priced.probability - br.hitRate;
    add(`Probability within ${limits.maxProbOverBase * 100} pts of the base rate`, gap <= limits.maxProbOverBase,
      `AI ${Math.round(priced.probability * 100)}% vs history ${Math.round(br.hitRate * 100)}% (${br.familyStat.wins}/${br.familyStat.n} ${br.family} events)`);
  } else add("Base rate available", false, br?.reason || "no analogue", false);
  if (demo) add("Live AIS data", false, "AIS feed is SIMULATED (demo mode): vessel signals carry no information", false);
  const blocking = checks.filter((c) => c.hard && !c.pass);
  return { checks, pass: blocking.length === 0, blocking: blocking.map((c) => c.name) };
}

// ---------------------------------------------------------------- prompt + schema
export function systemPrompt({ asOf } = {}) {
  // In the backtest (asOf set) the full-sample conclusions would be look-ahead, so the agent only gets the
  // base rates of events BEFORE that date, supplied in the input.
  const study = asOf
    ? `Base rates from incidents BEFORE today are supplied in the input (point-in-time). Small samples: weigh them accordingly.`
    : `What the desk's event study (20 Gulf/Red Sea incidents since 2019, walk-forward tested, net of costs) says:
- Next-day direction of crude after a headline is close to a coin flip out of sample. Do not sell 1-day "headline" direction as an edge.
- After state strikes / escalation, Brent's median path fades over ~20 trading days. Fading that premium is the one rule that held out of sample, beating buy-and-hold by about 4% per event after costs, but on only 14 events (hit rate not statistically significant).
- After attacks on shipping, crude and tanker equities rose in-sample over 5 days, but this did NOT hold out of sample. Treat it as weak.`;
  return `You are the head of the commodities trading desk that owns this terminal. You turn the maritime-risk picture for the Strait of Hormuz, Bab el-Mandeb / Red Sea, Suez and the Cape into a small number of specific, falsifiable PAPER trades for a human trader to approve or reject. You are judged on calibration and risk-adjusted results after costs, not on bold calls.
${asOf ? `\nTODAY IS ${asOf}. You must reason ONLY from the information given to you; do not use any knowledge of what happened after this date.\n` : ""}
${study}

How you work:
- 0 to 3 ideas. "No trade" is a valid, often correct answer: give an empty list and explain in no_trade_reason. Never invent events.
- For each idea pick the closest historical analogue type (analogue). The server looks up the base rate itself from the event study and will check your probability against it; describe in base_rate_reading how you read that history.
- If vessel/AIS data is marked DEMO or SIMULATED, it carries no information: say so and do not use it.
- Only allowed instruments. stop_distance and target_distance are distances from the current price: % for outright instruments, $/bbl for BRENT_WTI and CRACK_321. Size stops to normal volatility over the horizon (Brent's daily s.d. is about 2.7%; a 1-day stop inside 1% is noise).
- probability = your honest probability that the trade is profitable after costs when it closes (stop, target or expiry). Most edges here are small: most probabilities belong between 0.45 and 0.65.
- Expected value after costs must be positive under your own numbers; risk_pct (paper risk as % of book if the stop is hit) between 0.25 and 1.0.
- Evidence: name sources as the input gives them. Social posts are unverified; official statements are each side's position.
- invalidation: the specific news or price action that would prove the idea wrong.
- This is research for a paper-trading tool, not investment advice.`;
}

export const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["regime", "summary", "ideas", "no_trade_reason", "close_ids"],
  properties: {
    regime: { type: "string", description: "One line: the market regime right now" },
    summary: { type: "string", description: "2-4 sentences: what the desk is doing and why" },
    ideas: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["instrument", "direction", "horizon_days", "thesis", "evidence", "analogue", "base_rate_reading", "stop_distance", "target_distance", "probability", "risk_pct", "invalidation"],
      properties: {
        instrument: { type: "string", enum: Object.keys(INSTRUMENTS) },
        direction: { type: "string", enum: ["LONG", "SHORT"] },
        horizon_days: { type: "integer", description: "Calendar days, 1 to 30" },
        thesis: { type: "string", description: "1-2 sentences" },
        evidence: { type: "array", items: { type: "string" }, description: "Evidence with sources named" },
        analogue: { type: "string", enum: ANALOGUES, description: "Closest historical incident type, or none" },
        base_rate_reading: { type: "string", description: "How the history bears on this trade, in a sentence" },
        stop_distance: { type: "number" },
        target_distance: { type: "number" },
        probability: { type: "number" },
        risk_pct: { type: "number" },
        invalidation: { type: "string" },
      } } },
    no_trade_reason: { type: "string", description: "Why no (more) trades; empty string if not applicable" },
    close_ids: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "reason"],
      properties: { id: { type: "string" }, reason: { type: "string" } } } },
  },
};
