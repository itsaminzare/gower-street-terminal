// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Gower Street Terminal — local server. Aggregates feeds and pushes them to the browser over SSE.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, ".env")); } catch { /* .env is optional */ }

// Imported after .env is loaded so modules see its values
const { bus, log, DEMO } = await import("./src/util.js");
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

const env = process.env;
const PORT = Number(env.PORT) || 8787;

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
    status: status(),
  };
}

// ---- SSE fan-out
const clients = new Set();
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const c of clients) send(c, event, data); }
for (const ev of ["vessels", "vessel-removed", "alert", "news", "social", "official", "prices", "analyst", "curve"]) {
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
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
    an.runAnalyst("manual request from desk");
    return json(res, 202, { enabled: an.analyst.enabled, error: an.analyst.error });
  }
  if (p === "/api/ask" && req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "bad JSON" }); }
    const q = String(body.question || "").trim().slice(0, 2000);
    if (!q) return json(res, 400, { error: "empty question" });
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    try { await an.ask(q, Array.isArray(body.history) ? body.history : [], (t) => res.write(t)); }
    catch (e) { res.write(`\n\n[Error: ${e.message}]`); }
    return res.end();
  }
  if (p === "/api/notify/test" && req.method === "POST") {
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
}).listen(PORT, "127.0.0.1", () => log("server", `Gower Street Terminal on http://localhost:${PORT}${DEMO ? "  (DEMO AIS)" : ""}`));
