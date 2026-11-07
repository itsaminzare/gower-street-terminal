// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// AI desk analyst: Claude reads the live picture (AIS stats, alerts, credited headlines,
// social chatter, prices) and writes a structured desk brief.
import Anthropic from "@anthropic-ai/sdk";
import { geminiStructured, geminiStream } from "./gemini.js";
import { bus, log } from "./util.js";
import { zoneStats, aisStatus, vessels, dailyTransits } from "./ais.js";
import { getAlerts } from "./alerts.js";
import { news } from "./news.js";
import { posts } from "./social.js";
import { prices, chartHistory } from "./prices.js";
import { statements } from "./official.js";
import { curve } from "./curve.js";
import { flowSummary } from "./flows.js";

export const analyst = { enabled: false, running: false, brief: null, error: null, lastRun: null };

const SYSTEM = `You are the senior commodities analyst on an energy trading desk, covering maritime chokepoint risk for crude, products and LNG: the Strait of Hormuz and the Bab el-Mandeb / southern Red Sea, with the Suez Canal and the Cape of Good Hope watched for rerouting.

You receive a live snapshot gathered by the desk's feeds: AIS vessel statistics and behavioural alerts (including OFAC-sanctioned vessels, suspected ship-to-ship transfers and GPS position jumps), daily chokepoint transit counts from IMF PortWatch, headlines from named news outlets, official statements, social media posts, market prices, and the Brent/WTI futures curves with key spreads (time spreads, Brent–WTI, 3-2-1 crack).

How to write the brief:
- Attribute every factual claim to its source by name, as the input gives it ("Al Jazeera reports...", "per UKMTO via Reuters...", "an X user @handle claims..."). Never present a single outlet's or a social post's claim as established fact.
- Official statements (CENTCOM, White House, IRGC, Iran's foreign ministry, the Houthi military spokesman, Saudi and UAE state agencies, UK government, UN) are each party's stated position, not neutral fact. Name the body and contrast competing claims when the parties disagree. Items marked "relayed" reached the desk through a news outlet; name that outlet too.
- Social media posts are unverified. Say so, and weigh them below outlet reporting and AIS evidence.
- AIS alerts are automated heuristics (sudden stops, AIS gaps, emergency nav status). They can be coverage gaps or spoofing; treat them as signals to corroborate, not confirmed incidents.
- If the snapshot says the AIS feed is in DEMO mode, the vessel data is synthetic: say that and do not draw conclusions from it.
- Be concrete about market implications (Brent/WTI direction, time spreads, tanker freight rates, war-risk insurance, rerouting via the Cape) and say how confident you are.
- If little is happening, say so plainly. Do not invent events that are not in the snapshot.
- Naming: always call the body of water the "Persian Gulf" (never "the Gulf" on its own or "Arabian Gulf"), and the states around it "Persian Gulf states". Exact quotes from a source keep their original wording.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "overall_risk", "chokepoints", "key_developments", "market_view", "watch_next"],
  properties: {
    headline: { type: "string", description: "One-line desk headline" },
    overall_risk: { type: "string", enum: ["LOW", "ELEVATED", "HIGH", "SEVERE"] },
    chokepoints: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["zone", "risk", "status"],
        properties: {
          zone: { type: "string", enum: ["HORMUZ", "BAB", "SUEZ", "CAPE"] },
          risk: { type: "string", enum: ["LOW", "ELEVATED", "HIGH", "SEVERE"] },
          status: { type: "string", description: "2-3 sentences on traffic and threat picture, with sources named" },
        },
      },
    },
    key_developments: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["text", "sources", "confidence"],
        properties: {
          text: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["confirmed", "likely", "unverified"] },
        },
      },
    },
    market_view: { type: "string", description: "Implications for oil, products, LNG and tanker freight" },
    watch_next: { type: "array", items: { type: "string" } },
  },
};

export function snapshot() {
  const hrs = (t) => ((Date.now() - Date.parse(t)) / 3600000).toFixed(1) + "h ago";
  return JSON.stringify({
    generated_utc: new Date().toISOString(),
    ais_feed_mode: aisStatus.mode,
    chokepoint_traffic: zoneStats(),
    alerts_last_24h: getAlerts().filter((a) => Date.now() - Date.parse(a.time) < 86400000).slice(0, 40)
      .map((a) => ({ when: hrs(a.time), severity: a.severity, zone: a.zone, kind: a.kind, title: a.title, detail: a.detail, source: a.source })),
    headlines: news.slice(0, 60).map((n) => ({ outlet: n.source, when: hrs(n.published), region: n.region, title: n.title, summary: n.summary?.slice(0, 200) })),
    official_statements: statements.slice(0, 40).map((s) => ({ body: s.org, side: s.side, delivery: s.mode, via: s.via, when: hrs(s.published), title: s.title, summary: s.summary?.slice(0, 200) })),
    social_posts: posts.slice(0, 30).map((p) => ({ platform: p.platform, author: p.author, handle: p.handle, when: hrs(p.time), text: p.text.slice(0, 280) })),
    prices: Object.values(prices).map((p) => ({ name: p.label, price: +p.price?.toFixed(2), day_change_pct: +p.pct?.toFixed(2), unit: p.unit })),
    futures_curve: {
      brent: curve.brent.slice(0, 12).map((c) => ({ contract: c.label, price: +c.price.toFixed(2), month_ago: c.monthAgo != null ? +c.monthAgo.toFixed(2) : null })),
      wti: curve.wti.slice(0, 12).map((c) => ({ contract: c.label, price: +c.price.toFixed(2) })),
      spreads: Object.values(curve.spreads).map((s) => ({ name: s.name, value: +s.value.toFixed(2), day_change: s.change != null ? +s.change.toFixed(2) : null, unit: s.unit })),
    },
    imf_portwatch_transits: flowSummary(),
    own_gate_transit_counts_last_7_days: Object.fromEntries(Object.entries(dailyTransits).sort().slice(-7)),
    sanctioned_vessels_in_zones: [...vessels.values()].filter((v) => v.sanctioned && v.zone)
      .map((v) => ({ ais_name: v.name, listed_as: v.sanctioned.name, programme: v.sanctioned.program, zone: v.zone, sog: v.sog })),
  });
}

let client;
// Model is configurable (ANALYST_MODEL). Opus 5.5 by default; Haiku 5.5 is ~40x cheaper for a public deployment.
let MODEL = "claude-opus-5-5";
// Opus/Sonnet get server-side refusal fallbacks (beta); Haiku 5.5 has no server-side fallback, so it uses the plain endpoint.
function streamRequest(params) {
  if (/haiku/.test(MODEL)) return client.messages.stream({ model: MODEL, ...params });
  return client.beta.messages.stream({ model: MODEL, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", ...params });
}
// AI_PROVIDER=gemini routes every call (brief, chat, trade desk) to Google Gemini; prompts, schemas and checks are unchanged
let PROVIDER = "claude", GEMINI = { key: "", model: "gemini-3.8-flash" };
/** One structured (JSON-schema) completion, used by the brief and the trade desk. Returns the parsed object + model id. */
export async function structuredCall({ system, user, schema, maxTokens = 16000 }) {
  if (!analyst.enabled) throw new Error(analyst.error || "AI analyst is not configured");
  if (PROVIDER === "gemini") return geminiStructured({ key: GEMINI.key, model: GEMINI.model, system, user, schema, maxTokens });
  const stream = streamRequest({
    max_tokens: maxTokens,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error(`Model declined (${msg.stop_details?.category ?? "no category"})`);
  if (msg.stop_reason === "max_tokens") throw new Error("Output was cut off (max_tokens)");
  return { data: JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join("")), model: msg.model };
}
// Daily budget for briefs (all triggers combined), so a public deployment's Claude bill stays bounded
const runs = { day: "", count: 0, max: Infinity };
export async function runAnalyst(reason = "scheduled") {
  if (!analyst.enabled || analyst.running) return;
  const day = new Date().toISOString().slice(0, 10);
  if (runs.day !== day) Object.assign(runs, { day, count: 0 });
  if (runs.count >= runs.max) { log("analyst", `daily brief limit (${runs.max}) reached; skipping "${reason}"`); return; }
  runs.count++;
  analyst.running = true; analyst.error = null;
  bus.emit("analyst", analyst);
  try {
    const { data, model } = await structuredCall({ system: SYSTEM, user: `Trigger: ${reason}.\n\nLive desk snapshot:\n${snapshot()}`, schema: SCHEMA });
    analyst.brief = { ...data, reason, model, generated: new Date().toISOString() };
    analyst.lastRun = analyst.brief.generated;
    log("analyst", `brief ready (${reason}): ${analyst.brief.headline}`);
  } catch (e) {
    analyst.error = e.message;
    log("analyst", "error:", e.message);
  } finally {
    analyst.running = false;
    bus.emit("analyst", analyst);
  }
}

// ---------------------------------------------------------------- Ask the analyst (chat)
const ASK_SYSTEM = `${SYSTEM}

You are now answering a trader's questions in a chat on the desk. Each question arrives with a fresh live snapshot, including Brent's intraday 15-minute prices (UTC) so you can line price moves up against timestamped headlines, statements and alerts.
- Answer the question directly first, then the evidence. Keep it tight: a few short paragraphs or bullets.
- Name sources as above. If the snapshot cannot answer the question, say what is missing rather than guessing.
- Plain text with simple dashes for lists; no tables or headings.`;

async function intradayBrent() {
  try {
    const d = await chartHistory("BZ=F", "1d");
    return d.candles.filter((_, i) => i % 3 === 0).map((c) => [new Date(c.time * 1000).toISOString().slice(11, 16) + "Z", +c.close.toFixed(2)]);
  } catch { return null; }
}

/**
 * Stream an answer. `history` is prior [{role, content}] text turns (no snapshots).
 * Calls onText(delta) as text arrives; resolves with the full answer.
 */
export async function ask(question, history, onText) {
  if (!analyst.enabled) throw new Error(analyst.error || "AI analyst is not configured");
  const snap = snapshot();
  const brent = await intradayBrent();
  const msgs = [
    ...history.slice(-10).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 6000) })),
    { role: "user", content: `Live desk snapshot (${new Date().toISOString()}):\n${snap}\n\nBrent front-month intraday, 15-min closes (UTC): ${JSON.stringify(brent)}\n\nQuestion: ${question}` },
  ];
  if (PROVIDER === "gemini") {
    const { text } = await geminiStream({ key: GEMINI.key, model: GEMINI.model, system: ASK_SYSTEM, messages: msgs, maxTokens: 8000, onText });
    return text;
  }
  const stream = streamRequest({
    max_tokens: 8000,
    output_config: { effort: "medium" },
    system: ASK_SYSTEM,
    messages: msgs,
  });
  stream.on("text", (t) => onText(t));
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error(`Model declined (${msg.stop_details?.category ?? "no category"})`);
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

export function startAnalyst(env) {
  PROVIDER = (env.AI_PROVIDER || "claude").trim().toLowerCase() === "gemini" ? "gemini" : "claude";
  if (PROVIDER === "gemini") {
    GEMINI = { key: (env.GEMINI_API_KEY || "").trim(), model: (env.GEMINI_MODEL || "gemini-3.8-flash").trim() };
    if (!GEMINI.key) { analyst.error = "AI_PROVIDER=gemini but GEMINI_API_KEY is not set"; return; }
    MODEL = GEMINI.model;
  } else {
    if (!env.ANTHROPIC_API_KEY) { analyst.error = "Set ANTHROPIC_API_KEY to enable the AI analyst"; return; }
    client = new Anthropic();
    if (env.ANALYST_MODEL) MODEL = env.ANALYST_MODEL.trim();
  }
  analyst.enabled = true;
  analyst.model = MODEL;
  analyst.provider = PROVIDER;
  log("analyst", `using ${PROVIDER === "gemini" ? "Google Gemini" : "Anthropic Claude"}: ${MODEL}`);
  const minutes = Math.max(5, Number(env.ANALYST_INTERVAL_MIN) || 15);
  if (Number(env.ANALYST_DAILY_MAX) > 0) runs.max = Number(env.ANALYST_DAILY_MAX);
  const debounceMs = Math.max(1, Number(env.ANALYST_ALERT_DEBOUNCE_MIN) || 5) * 60_000;
  // First brief once feeds have had time to fill
  setTimeout(() => runAnalyst("startup"), 45_000);
  setInterval(() => runAnalyst("scheduled"), minutes * 60_000);
  // Critical alerts trigger an early re-assessment (debounced)
  let last = 0, pending = null;
  bus.on("alert", (a) => {
    if (a.severity !== "critical" || pending) return;
    const wait = Math.max(20_000, debounceMs - (Date.now() - last));
    pending = setTimeout(() => { pending = null; last = Date.now(); runAnalyst(`critical alert: ${a.title}`); }, wait);
  });
}
