// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Gower Street Terminal — local server. Aggregates feeds and pushes them to the browser over SSE.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, ".env")); } catch { /* .env is optional */ }

// Imported after .env is loaded so modules see its values
const { bus, log, DEMO, hashId } = await import("./src/util.js");
const { ZONES } = await import("./src/zones.js");
const sanctions = await import("./src/sanctions.js");
const ais = await import("./src/ais.js");
const { getAlerts } = await import("./src/alerts.js");
const newsMod = await import("./src/news.js");
const social = await import("./src/social.js");
const px = await import("./src/prices.js");
const off = await import("./src/official.js");
const cv = await import("./src/curve.js");
const fl = await import("./src/flows.js");
const nt = await import("./src/notify.js");
const an = await import("./src/analyst.js");
const dk = await import("./src/desk.js");

const env = process.env;
const PORT = Number(env.PORT) || 8787;
// Locally only this PC can connect; hosting platforms set HOST=0.0.0.0 so the public can reach it
const HOST = env.HOST || "127.0.0.1";

sanctions.startSanctions();
if (DEMO) ais.startDemo(); else ais.startAIS(env.AISSTREAM_API_KEY);
newsMod.startNews();
off.startOfficial();
social.startSocial(env);
px.startPrices();
cv.startCurve();
fl.startFlows();
nt.startNotify(env);
an.startAnalyst(env);
dk.startDesk(env);

function status() {
  return { ais: ais.aisStatus, news: newsMod.newsStatus, official: off.officialStatus, social: social.socialStatus, prices: px.priceStatus,
    sanctions: sanctions.sanctionsStatus, flows: fl.flowsStatus, curve: { ok: !!cv.curve.updated, error: cv.curve.error, updated: cv.curve.updated },
    notify: { channels: nt.notifyStatus.channels, sent: nt.notifyStatus.sent, lastError: nt.notifyStatus.lastError, minSeverity: nt.notifyStatus.minSeverity },
    analyst: { enabled: an.analyst.enabled, running: an.analyst.running, error: an.analyst.error, lastRun: an.analyst.lastRun },
    stats: ais.zoneStats(), serverTime: new Date().toISOString() };
}

function snapshot() {
  return {
    zones: ZONES,
    vessels: [...ais.vessels.values()].filter((v) => v.lat != null).map(ais.compact),
    alerts: getAlerts().slice(0, 150),
    news: newsMod.news.slice(0, 150),
    official: off.statements.slice(0, 150),
    social: social.posts.slice(0, 150),
    prices: px.prices,
    curve: cv.curve,
    analyst: an.analyst,
    desk: dk.deskView(),
    status: status(),
  };
}

// ---- SSE fan-out
const clients = new Set();
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const c of clients) send(c, event, data); }
for (const ev of ["vessels", "vessel-removed", "alert", "news", "social", "official", "prices", "analyst", "curve", "desk"]) {
  bus.on(ev, (d) => broadcast(ev, d));
}
bus.on("flows", () => broadcast("flows-updated", { updated: fl.flowsStatus.updated }));
setInterval(() => broadcast("status", status()), 10_000);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok, fail) => {
  let b = ""; req.on("data", (c) => { b += c; if (b.length > 200_000) req.destroy(); });
  req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { fail(e); } });
});

// ---- Keep-awake for free hosting plans that sleep after idle time (e.g. Render free: 15 min).
// A request to our own public URL arrives through the host's proxy, which counts as inbound traffic.
const PUBLIC_URL = env.KEEP_AWAKE_URL || env.RENDER_EXTERNAL_URL;
if (env.KEEP_AWAKE === "1" && PUBLIC_URL) {
  setInterval(() => fetch(`${PUBLIC_URL.replace(/\/$/, "")}/api/health`).catch(() => {}), 10 * 60_000).unref();
  log("server", `keep-awake ping to ${PUBLIC_URL} every 10 min`);
}

// ---- Limits for a public deployment (all unlimited unless set in the environment)
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const LIMITS = {
  askDaily: num(env.ASK_DAILY_LIMIT, Infinity),        // chat questions per day, all visitors combined
  askPerVisitor: num(env.ASK_PER_VISITOR_LIMIT, Infinity), // per visitor (IP) per day
  askConcurrent: num(env.ASK_CONCURRENT_LIMIT, 2),
  manualRunMin: num(env.MANUAL_RUN_MIN_INTERVAL_MIN, 0), // minimum minutes between RUN NOW presses
};
const quota = { day: "", used: 0, perIp: new Map(), active: 0, lastManualRun: 0, lastDeskRun: 0, decisions: new Map() };
function resetQuotaIfNewDay() {
  const day = new Date().toISOString().slice(0, 10);
  if (quota.day !== day) Object.assign(quota, { day, used: 0, perIp: new Map(), decisions: new Map() });
}
// Behind a hosting proxy the visitor's address is the first X-Forwarded-For entry
const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
const isLocal = (req) => !req.headers["x-forwarded-for"] && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
function askStatus(ip) {
  resetQuotaIfNewDay();
  const fin = (n) => (Number.isFinite(n) ? n : null);
  return { dailyLimit: fin(LIMITS.askDaily), usedToday: quota.used, perVisitorLimit: fin(LIMITS.askPerVisitor),
    usedByYou: ip ? quota.perIp.get(ip) || 0 : null };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (p === "/api/health") return json(res, 200, { ok: true, ais: ais.aisStatus.mode, uptime: Math.round(process.uptime()) });
  if (p === "/api/ask/limits") return json(res, 200, askStatus(clientIp(req)));
  if (p === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    send(res, "snapshot", snapshot());
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  if (p === "/api/snapshot") return json(res, 200, snapshot());
  if (p === "/api/chart") {
    return px.chartHistory(url.searchParams.get("sym"), url.searchParams.get("range") || "1d")
      .then((d) => json(res, 200, d)).catch((e) => json(res, 502, { error: e.message }));
  }
  if (p === "/api/curve") return json(res, 200, cv.curve);
  if (p === "/api/flows") {
    return json(res, 200, { imf: fl.flows, summary: fl.flowSummary(), status: fl.flowsStatus, own: ais.dailyTransits, last24h: ais.zoneStats(), zones: ZONES, demo: DEMO });
  }
  if (p === "/api/history") {
    const h = ais.getHistory();
    const since = Date.now() - 24 * 3600_000;
    return json(res, 200, { frames: h.frames, meta: h.meta, demo: DEMO,
      events: getAlerts().filter((a) => Date.parse(a.time) >= since && a.lat != null)
        .map((a) => ({ t: Date.parse(a.time), zone: a.zone, lat: a.lat, lon: a.lon, severity: a.severity, title: a.title })) });
  }
  if (p === "/api/analyst/run" && req.method === "POST") {
    const waitMin = LIMITS.manualRunMin - (Date.now() - quota.lastManualRun) / 60_000;
    if (waitMin > 0) return json(res, 429, { error: `A brief was requested recently. Try again in ${Math.ceil(waitMin)} min.` });
    quota.lastManualRun = Date.now();
    an.runAnalyst("manual request from desk");
    return json(res, 202, { enabled: an.analyst.enabled, error: an.analyst.error });
  }
  if (p === "/api/desk") return json(res, 200, dk.deskView());
  if (p === "/api/desk/run" && req.method === "POST") {
    if (!dk.desk.enabled) return json(res, 400, { error: dk.desk.error || "Trade desk is not configured" });
    const waitMin = LIMITS.manualRunMin - (Date.now() - quota.lastDeskRun) / 60_000;
    if (waitMin > 0) return json(res, 429, { error: `The desk ran recently. Try again in ${Math.ceil(waitMin)} min.` });
    if (dk.desk.running) return json(res, 409, { error: "The desk is already working on it." });
    if (dk.desk.halted) return json(res, 423, { error: "The desk is halted (kill switch). Resume it first." });
    quota.lastDeskRun = Date.now();
    dk.runDesk("manual request from desk").then((r) => r?.error && log("desk", r.error));
    return json(res, 202, { started: true });
  }
  // Human-in-the-loop: approve / reject proposals, close trades, kill switch. Every call is audit-logged with who made it.
  if ((p === "/api/desk/decide" || p === "/api/desk/halt") && req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "bad JSON" }); }
    const ip = clientIp(req);
    resetQuotaIfNewDay();
    const used = quota.decisions.get(ip) || 0;
    if (used >= 120) return json(res, 429, { error: "Too many desk actions from you today." });
    quota.decisions.set(ip, used + 1);
    const actor = isLocal(req) ? "human (owner)" : `human (visitor ${hashId(ip).slice(0, 5)})`;
    if (p === "/api/desk/halt") { dk.setHalt(!!body.halt, !!body.flatten, actor); return json(res, 200, { ok: true, halted: dk.desk.halted }); }
    const r = dk.decide(String(body.id || ""), String(body.action || ""), actor);
    return json(res, r.error ? 409 : 200, r);
  }
  if (p.startsWith("/api/desk/input/")) {
    const raw = dk.runInput(p.slice("/api/desk/input/".length));
    if (!raw) return json(res, 404, { error: "run input not found (inputs are kept for the last 60 runs and reset on redeploy)" });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(raw);
  }
  if (p === "/api/research") {
    if (!dk.research) return json(res, 404, { error: "research data missing" });
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" });
    return res.end(JSON.stringify({ ...dk.research, agentBacktest: dk.agentBacktest }));
  }
  if (p === "/api/ask" && req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "bad JSON" }); }
    const q = String(body.question || "").trim().slice(0, 1000);
    if (!q) return json(res, 400, { error: "empty question" });
    const ip = clientIp(req);
    resetQuotaIfNewDay();
    if (quota.used >= LIMITS.askDaily) return json(res, 429, { error: `Today's chat limit (${LIMITS.askDaily} questions for all visitors) has been reached. It resets at 00:00 UTC.` });
    if ((quota.perIp.get(ip) || 0) >= LIMITS.askPerVisitor) return json(res, 429, { error: `You've used your ${LIMITS.askPerVisitor} questions for today. The limit resets at 00:00 UTC.` });
    if (quota.active >= LIMITS.askConcurrent) return json(res, 429, { error: "The analyst is answering other questions right now. Try again in a minute." });
    quota.used++; quota.perIp.set(ip, (quota.perIp.get(ip) || 0) + 1); quota.active++;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    try { await an.ask(q, Array.isArray(body.history) ? body.history.slice(-6) : [], (t) => res.write(t)); }
    catch (e) { res.write(`\n\n[Error: ${e.message}]`); }
    finally { quota.active--; }
    return res.end();
  }
  if (p === "/api/notify/test" && req.method === "POST") {
    // Only from the machine itself, so visitors can't spam the owner's phone
    if (!isLocal(req)) return json(res, 403, { error: "Test notifications can only be sent from the computer running the terminal." });
    if (!nt.notifyStatus.test) return json(res, 400, { error: "No phone alert channel configured. Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID or NTFY_TOPIC in .env." });
    await nt.notifyStatus.test();
    return json(res, 200, { sent: true, error: nt.notifyStatus.lastError });
  }
  const file = path.normalize(path.join(here, "public", p === "/" ? "index.html" : p));
  if (!file.startsWith(path.join(here, "public"))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(PORT, HOST, () => log("server", `Gower Street Terminal on http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}${DEMO ? "  (DEMO AIS)" : ""}` +
  (Number.isFinite(LIMITS.askDaily) ? ` · chat limit ${LIMITS.askDaily}/day, ${LIMITS.askPerVisitor}/visitor` : "")));
