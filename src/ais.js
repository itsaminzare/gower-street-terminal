// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Live AIS from aisstream.io (WebSocket) + incident detection on vessel behaviour:
// distress status, sudden stops, AIS-dark, course reversals, gate transits, sanctioned vessels,
// ship-to-ship transfers and GPS position jumps. Also keeps 24h of position history for replay.
import { bus, log, haversineKm, angleDiff, MODE, DEMO } from "./util.js";
import { ZONES, zoneOf, shipClass, NAV_STATUS } from "./zones.js";
import { raiseAlert } from "./alerts.js";
import { matchVessel } from "./sanctions.js";
import { load, persist } from "./store.js";

export const vessels = new Map(); // mmsi -> vessel
export const transits = []; // last 24h: {time, zone, mmsi, name, dir, tanker}
export const aisStatus = { mode: "offline", connected: false, messages: 0, lastMessage: null, error: null };

// Daily transit counts by zone, persisted: { "2026-11-06": { HORMUZ: {total, tanker, dirs:{}} } }
export const dailyTransits = load(`transits-${MODE}`, {});
persist(`transits-${MODE}`, () => dailyTransits, 5 * 60_000);

// Position history for replay: frames every 2 min for 24h
const HISTORY_MS = 24 * 3600_000, FRAME_MS = DEMO ? 30_000 : 120_000;
const hist = load(`history-${MODE}`, { frames: [], meta: {} });
hist.frames = hist.frames.filter((f) => Date.now() - f.t < HISTORY_MS);
persist(`history-${MODE}`, () => hist, 10 * 60_000);
export function getHistory() { return hist; }

// Ship identity cache (MMSI -> name, type, IMO...). Position reports arrive every few seconds but the ship's type only
// every ~6 min, and only if a receiver hears it, so identities are cached by MMSI across restarts. Kept 30 days.
const STATIC_TTL = 30 * 86400_000;
const staticCache = Object.fromEntries(Object.entries(load(`static-${MODE}`, {})).filter(([, s]) => Date.now() - (s.t || 0) < STATIC_TTL));
persist(`static-${MODE}`, () => staticCache, 5 * 60_000);
export const staticCacheSize = () => Object.keys(staticCache).length;

const dirty = new Set();
const STALE_MS = 3 * 60 * 60 * 1000;
const DARK_MS = 40 * 60 * 1000;
const STS_MS = DEMO ? 4 * 60_000 : 30 * 60_000;
const EMERGENCY_NAV = new Set([2, 6, 14]);

function getVessel(mmsi) {
  let v = vessels.get(mmsi);
  if (!v) {
    v = { mmsi, name: "", type: null, cls: "Unknown", dest: "", callsign: "", imo: null, flag: "",
          lat: null, lon: null, sog: null, cog: null, hdg: null, nav: 15, zone: null,
          lastSeen: 0, track: [], dark: false, incident: null, sanctioned: null, sts: null, spoof: null };
    // Known ship? Restore its identity straight away instead of waiting for its next static broadcast
    const c = staticCache[mmsi];
    if (c) {
      Object.assign(v, { name: c.name || "", imo: c.imo || null, callsign: c.callsign || "", length: c.length, draught: c.draught });
      if (c.type != null) { v.type = c.type; v.cls = shipClass(c.type); }
    }
    vessels.set(mmsi, v);
    checkSanctions(v);
  }
  return v;
}

function nearAnchorage(zoneId, lat, lon) {
  const z = ZONES[zoneId];
  return z?.anchorages.find((a) => haversineKm(lat, lon, a.lat, a.lon) <= a.km) || null;
}

function nearBoxEdge(zoneId, lat, lon, km = 15) {
  const [[a, b], [c, d]] = ZONES[zoneId].box;
  return (
    haversineKm(lat, lon, a, lon) < km || haversineKm(lat, lon, c, lon) < km ||
    haversineKm(lat, lon, lat, b) < km || haversineKm(lat, lon, lat, d) < km
  );
}

// sign of point relative to gate line + whether projection falls on the segment
function gateSide(gate, lat, lon) {
  const [[y1, x1], [y2, x2]] = gate;
  const cross = (x2 - x1) * (lat - y1) - (y2 - y1) * (lon - x1);
  const t = ((lon - x1) * (x2 - x1) + (lat - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2);
  return { side: Math.sign(cross), onSeg: t >= -0.15 && t <= 1.15 };
}

function transitDir(zoneId, cog) {
  const [a, b] = ZONES[zoneId].dirs;
  if (cog == null) return "?";
  if (zoneId === "HORMUZ") return cog >= 225 || cog < 45 ? a : b;
  if (zoneId === "CAPE") return cog >= 180 ? a : b;
  return cog >= 270 || cog < 90 ? a : b; // BAB, SUEZ: northbound first
}

function label(v) {
  return `${v.cls === "Tanker" ? "Tanker" : v.cls} ${v.name || "MMSI " + v.mmsi}`;
}

function checkSanctions(v) {
  if (v.sanctioned) return;
  const hit = matchVessel(v);
  if (hit) { v.sanctioned = { name: hit.name, program: hit.program, flag: hit.flag, owner: hit.owner, imo: hit.imo }; dirty.add(v.mmsi); }
}

// ---------------------------------------------------------------- position updates
const jumps = []; // {t, zone, mmsi} for GPS interference clustering

export function updatePosition(mmsi, p, meta = {}) {
  const v = getVessel(mmsi);
  const now = Date.now();
  if (meta.name && !v.name) v.name = meta.name.trim();
  const prev = { lat: v.lat, lon: v.lon, sog: v.sog, cog: v.cog, nav: v.nav, t: v.lastSeen, zone: v.zone };
  Object.assign(v, { lat: p.lat, lon: p.lon, sog: p.sog, cog: p.cog, hdg: p.hdg, lastSeen: now });
  if (p.nav != null) v.nav = p.nav;
  v.zone = zoneOf(p.lat, p.lon) || v.zone;
  v.track.push([+p.lat.toFixed(4), +p.lon.toFixed(4)]);
  if (v.track.length > 40) v.track.shift();

  if (v.dark) {
    v.dark = false;
    const gapMin = Math.round((now - prev.t) / 60000);
    const moved = prev.lat != null ? haversineKm(prev.lat, prev.lon, p.lat, p.lon) : 0;
    raiseAlert({ severity: "info", zone: v.zone, kind: "ais-restored", mmsi, lat: p.lat, lon: p.lon,
      title: `${label(v)} AIS signal restored`,
      detail: `Silent for ${gapMin} min; reappeared ${moved.toFixed(1)} km from last fix.`, source: "AIS" });
  }
  // Sanctioned vessel entering a watched zone
  if (v.sanctioned && v.zone && v.zone !== prev.zone) {
    raiseAlert({ severity: "critical", zone: v.zone, kind: "sanctioned-vessel", key: `sanc:${mmsi}:${v.zone}`, mmsi, lat: v.lat, lon: v.lon,
      source: "OFAC SDN + AIS", title: `OFAC-sanctioned ${label(v)} is in the ${ZONES[v.zone].name}`,
      detail: `Listed as "${v.sanctioned.name}" (programme ${v.sanctioned.program || "?"}${v.sanctioned.imo ? `, IMO ${v.sanctioned.imo}` : ""}). Flag ${v.sanctioned.flag || "?"}.` });
  }
  if (prev.lat != null && v.zone) {
    if (!positionJump(v, prev, now)) detect(v, prev, now);
  }
  dirty.add(mmsi);
}

// GPS spoofing / jamming: physically impossible jumps between consecutive fixes
function positionJump(v, prev, now) {
  const dtH = Math.max((now - prev.t) / 3600_000, 1 / 3600);
  const km = haversineKm(prev.lat, prev.lon, v.lat, v.lon);
  const kn = km / 1.852 / dtH;
  if (km < 3 || kn < 60) return false;
  v.spoof = now;
  jumps.push({ t: now, zone: v.zone, mmsi: v.mmsi });
  while (jumps.length && now - jumps[0].t > 30 * 60_000) jumps.shift();
  raiseAlert({ severity: "warning", zone: v.zone, kind: "gps-jump", mmsi: v.mmsi, lat: v.lat, lon: v.lon, source: "AIS",
    title: `${label(v)} position jumped ${km.toFixed(0)} km`,
    detail: `Implied speed ${Math.round(kn)} kn between fixes, which is physically impossible. Typical of GPS spoofing/jamming or a faulty transponder.` });
  const affected = new Set(jumps.filter((j) => j.zone === v.zone).map((j) => j.mmsi));
  if (affected.size >= 3) {
    raiseAlert({ severity: "critical", zone: v.zone, kind: "gps-interference", key: `gpsi:${v.zone}`, lat: v.lat, lon: v.lon, source: "AIS",
      title: `GPS interference suspected in the ${ZONES[v.zone].name}`,
      detail: `${affected.size} vessels reported impossible position jumps in the last 30 minutes.` });
  }
  return true;
}

function detect(v, prev, now) {
  const dtMin = (now - prev.t) / 60000;
  const base = { zone: v.zone, mmsi: v.mmsi, lat: v.lat, lon: v.lon, source: "AIS" };
  const isTanker = v.cls === "Tanker";

  // 1) Distress / emergency navigational status
  if (EMERGENCY_NAV.has(v.nav) && v.nav !== prev.nav) {
    v.incident = NAV_STATUS[v.nav];
    raiseAlert({ ...base, severity: "critical", kind: "nav-emergency",
      title: `${label(v)} reports "${NAV_STATUS[v.nav]}"`,
      detail: `Navigational status changed from "${NAV_STATUS[prev.nav] ?? "?"}". SOG ${v.sog?.toFixed(1)} kn.` });
  }
  // 2) Sudden stop in the shipping lane
  if (prev.sog != null && prev.sog >= 6 && v.sog != null && v.sog < 1 && dtMin <= 20) {
    if (!nearAnchorage(v.zone, v.lat, v.lon)) {
      v.incident = "Sudden stop";
      raiseAlert({ ...base, severity: isTanker ? "critical" : "warning", kind: "sudden-stop",
        title: `${label(v)} stopped abruptly in the lane`,
        detail: `Speed fell ${prev.sog.toFixed(1)} → ${v.sog.toFixed(1)} kn in ${Math.max(1, Math.round(dtMin))} min, away from any anchorage.` });
    }
  }
  // 3) Abrupt course reversal at speed (evasive manoeuvre / ordered to divert)
  if (prev.cog != null && v.cog != null && prev.sog > 6 && v.sog > 6 && dtMin <= 10 && angleDiff(prev.cog, v.cog) > 120) {
    raiseAlert({ ...base, severity: "warning", kind: "course-reversal",
      title: `${label(v)} made an abrupt course reversal`,
      detail: `COG ${Math.round(prev.cog)}° → ${Math.round(v.cog)}° within ${Math.max(1, Math.round(dtMin))} min at ${v.sog.toFixed(1)} kn.` });
  }
  // 4) Gate transits (rolling 24h + persisted daily counts)
  const gate = ZONES[v.zone]?.gate;
  if (gate) {
    const a = gateSide(gate, prev.lat, prev.lon), b = gateSide(gate, v.lat, v.lon);
    if (a.side && b.side && a.side !== b.side && (a.onSeg || b.onSeg)) {
      const dir = transitDir(v.zone, v.cog);
      transits.push({ time: now, zone: v.zone, mmsi: v.mmsi, name: v.name, dir, tanker: isTanker });
      while (transits.length && now - transits[0].time > 24 * 3600 * 1000) transits.shift();
      const day = new Date(now).toISOString().slice(0, 10);
      const d = ((dailyTransits[day] ||= {})[v.zone] ||= { total: 0, tanker: 0, dirs: {} });
      d.total++; if (isTanker) d.tanker++; d.dirs[dir] = (d.dirs[dir] || 0) + 1;
    }
  }
}

export function updateStatic(mmsi, s) {
  const v = getVessel(mmsi);
  if (s.name) v.name = s.name.trim();
  if (s.type != null) { v.type = s.type; v.cls = shipClass(s.type); }
  if (s.dest) v.dest = s.dest.trim();
  if (s.callsign) v.callsign = s.callsign.trim();
  if (s.imo) { v.imo = s.imo; checkSanctions(v); }
  if (s.length) v.length = s.length;
  if (s.draught) v.draught = s.draught;
  staticCache[mmsi] = { name: v.name, type: v.type, imo: v.imo, callsign: v.callsign, length: v.length, draught: v.draught, t: Date.now() };
  dirty.add(mmsi);
}

// ---------------------------------------------------------------- periodic checks
setInterval(() => {
  const now = Date.now();
  for (const v of vessels.values()) {
    if (now - v.lastSeen > STALE_MS) { vessels.delete(v.mmsi); bus.emit("vessel-removed", v.mmsi); continue; }
    if (v.spoof && now - v.spoof > 30 * 60_000) { v.spoof = null; dirty.add(v.mmsi); }
    if (!v.dark && v.zone && v.lat != null && v.sog > 5 && now - v.lastSeen > DARK_MS && !nearBoxEdge(v.zone, v.lat, v.lon)) {
      v.dark = true;
      dirty.add(v.mmsi);
      if (v.cls === "Tanker" || v.cls === "Unknown") {
        raiseAlert({ severity: "warning", zone: v.zone, kind: "ais-dark", mmsi: v.mmsi, lat: v.lat, lon: v.lon, source: "AIS",
          title: `${label(v)} went AIS-dark mid-transit`,
          detail: `No position for ${Math.round((now - v.lastSeen) / 60000)} min while under way at ${v.sog.toFixed(1)} kn inside the zone. Could be coverage gap, spoofing, or transponder switched off.` });
      }
    }
  }
  detectSTS(now);
}, DEMO ? 20_000 : 60_000);

// Ship-to-ship transfer: two stationary tankers side by side, away from anchorages, for a sustained period
const stsPairs = new Map(); // "a|b" -> first seen
function detectSTS(now) {
  const still = [...vessels.values()].filter((v) => v.zone && v.lat != null && v.sog != null && v.sog < 1 &&
    now - v.lastSeen < 20 * 60_000 && (v.cls === "Tanker" || v.cls === "Unknown") && !nearAnchorage(v.zone, v.lat, v.lon));
  const seen = new Set();
  for (let i = 0; i < still.length; i++) {
    for (let j = i + 1; j < still.length; j++) {
      const a = still[i], b = still[j];
      if (a.zone !== b.zone || haversineKm(a.lat, a.lon, b.lat, b.lon) > 0.5) continue;
      const key = [a.mmsi, b.mmsi].sort().join("|");
      seen.add(key);
      if (!stsPairs.has(key)) stsPairs.set(key, now);
      if (now - stsPairs.get(key) >= STS_MS) {
        a.sts = b.mmsi; b.sts = a.mmsi; dirty.add(a.mmsi); dirty.add(b.mmsi);
        const sanc = a.sanctioned || b.sanctioned;
        raiseAlert({ severity: sanc ? "critical" : "warning", zone: a.zone, kind: "sts-transfer", key: `sts:${key}`, lat: a.lat, lon: a.lon, mmsi: a.mmsi, source: "AIS",
          title: `Possible ship-to-ship transfer: ${a.name || a.mmsi} + ${b.name || b.mmsi}`,
          detail: `Both stationary within ${Math.round(haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000)} m for ${Math.round((now - stsPairs.get(key)) / 60000)}+ min, away from known anchorages.${sanc ? " One vessel is OFAC-sanctioned." : ""}` });
      }
    }
  }
  for (const [k] of stsPairs) if (!seen.has(k)) {
    stsPairs.delete(k);
    for (const m of k.split("|")) { const v = vessels.get(+m); if (v?.sts) { v.sts = null; dirty.add(v.mmsi); } }
  }
}

// History frames for replay
setInterval(() => {
  const t = Date.now();
  const rows = [];
  for (const v of vessels.values()) {
    if (v.lat == null || !v.zone || t - v.lastSeen > 30 * 60_000) continue;
    const flags = (v.incident ? 1 : 0) | (v.dark ? 2 : 0) | (v.sanctioned ? 4 : 0) | (v.sts ? 8 : 0) | (v.spoof ? 16 : 0);
    rows.push([v.mmsi, +v.lat.toFixed(4), +v.lon.toFixed(4), Math.round(v.hdg ?? v.cog ?? 0), +(v.sog ?? 0).toFixed(1), flags]);
    hist.meta[v.mmsi] = [v.name, v.cls];
  }
  hist.frames.push({ t, v: rows });
  while (hist.frames.length && t - hist.frames[0].t > HISTORY_MS) hist.frames.shift();
}, FRAME_MS);

// Batched broadcast of changed vessels
setInterval(() => {
  if (!dirty.size) return;
  const batch = [...dirty].map((m) => vessels.get(m)).filter(Boolean).map(compact);
  dirty.clear();
  bus.emit("vessels", batch);
}, 2000);

export function compact(v) {
  return { mmsi: v.mmsi, name: v.name, cls: v.cls, type: v.type, dest: v.dest, imo: v.imo, callsign: v.callsign,
    lat: v.lat, lon: v.lon, sog: v.sog, cog: v.cog, hdg: v.hdg, nav: v.nav, navText: NAV_STATUS[v.nav] ?? "",
    zone: v.zone, lastSeen: v.lastSeen, dark: v.dark, incident: v.incident, track: v.track, length: v.length, draught: v.draught,
    sanctioned: v.sanctioned, sts: v.sts, spoof: v.spoof };
}

export function zoneStats() {
  const out = {};
  const now = Date.now();
  for (const z of Object.keys(ZONES)) {
    const vs = [...vessels.values()].filter((v) => v.zone === z && v.lat != null);
    const tankers = vs.filter((v) => v.cls === "Tanker");
    const tr = transits.filter((t) => t.zone === z && now - t.time < 24 * 3600 * 1000);
    out[z] = {
      vessels: vs.length,
      tankers: tankers.length,
      typePending: vs.filter((v) => v.cls === "Unknown").length,
      tankersMoving: tankers.filter((v) => v.sog > 3).length,
      avgTankerSpeed: tankers.length ? +(tankers.reduce((s, v) => s + (v.sog || 0), 0) / tankers.length).toFixed(1) : null,
      dark: vs.filter((v) => v.dark).length,
      sanctioned: vs.filter((v) => v.sanctioned).length,
      sts: vs.filter((v) => v.sts).length,
      spoofed: vs.filter((v) => v.spoof).length,
      transits24h: tr.length,
      tankerTransits24h: tr.filter((t) => t.tanker).length,
      byDir: tr.reduce((m, t) => ((m[t.dir] = (m[t.dir] || 0) + 1), m), {}),
    };
  }
  return out;
}

// ---------------------------------------------------------------- aisstream.io
export function startAIS(apiKey) {
  apiKey = (apiKey || "").trim(); // pasted keys often carry a trailing space or newline
  if (apiKey && !/^[0-9a-f]{40}$/i.test(apiKey)) {
    log("ais", `AISSTREAM_API_KEY doesn't look like an aisstream key (expected 40 hex characters, got ${apiKey.length} characters)`);
    aisStatus.error = "AISSTREAM_API_KEY looks wrong: paste only the 40-character key";
  }
  if (!apiKey) { aisStatus.mode = "offline"; aisStatus.error = "No AISSTREAM_API_KEY set"; return; }
  aisStatus.mode = "live";
  // One-off diagnostic: what does the AIS endpoint answer over plain HTTPS from this host? (blocks show up as 403s)
  fetch("https://stream.aisstream.io/v0/stream", { headers: { "User-Agent": "GowerStreetTerminal/0.1" } })
    .then(async (r) => log("ais", `endpoint check: HTTP ${r.status} ${r.headers.get("server") || ""} ${(await r.text()).slice(0, 120).replace(/\s+/g, " ")}`))
    .catch((e) => log("ais", `endpoint check failed: ${e.cause?.code || e.message}`));
  let backoff = 2000;
  const connect = () => {
    log("ais", "connecting to aisstream.io");
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    ws.onopen = () => {
      log("ais", "connected; subscribing to " + Object.keys(ZONES).join(", "));
      // Backoff resets only once data actually flows (see onmessage); a rejected key would otherwise loop every 2 s
      aisStatus.connected = true; aisStatus.error = null;
      bus.emit("status");
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: Object.values(ZONES).map((z) => z.box),
        FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData", "StaticDataReport"],
      }));
    };
    ws.onmessage = async (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : await new Response(ev.data).text();
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.error) { aisStatus.error = m.error; log("ais", "server error:", m.error); return; }
      aisStatus.messages++; aisStatus.lastMessage = Date.now();
      backoff = 2000;
      const md = m.MetaData || {};
      const mmsi = md.MMSI;
      if (!mmsi) return;
      const msg = m.Message || {};
      if (m.MessageType === "PositionReport" || m.MessageType === "StandardClassBPositionReport") {
        const r = msg[m.MessageType];
        if (!r || Math.abs(r.Latitude) > 90) return;
        updatePosition(mmsi, {
          lat: r.Latitude, lon: r.Longitude, sog: r.Sog >= 102.3 ? null : r.Sog,
          cog: r.Cog >= 360 ? null : r.Cog, hdg: r.TrueHeading === 511 ? null : r.TrueHeading,
          nav: r.NavigationalStatus,
        }, { name: md.ShipName });
      } else if (m.MessageType === "ShipStaticData") {
        const s = msg.ShipStaticData;
        updateStatic(mmsi, { name: s.Name, type: s.Type, dest: s.Destination, callsign: s.CallSign, imo: s.ImoNumber,
          length: (s.Dimension?.A || 0) + (s.Dimension?.B || 0) || null, draught: s.MaximumStaticDraught || null });
      } else if (m.MessageType === "StaticDataReport") {
        const s = msg.StaticDataReport;
        updateStatic(mmsi, { name: s.ReportA?.Name, type: s.ReportB?.ShipType || null, callsign: s.ReportB?.CallSign });
      }
    };
    ws.onerror = (e) => { aisStatus.error = e.message || e.error?.message || "socket error"; log("ais", "socket error:", e.message || e.error?.message || e.type); };
    ws.onclose = (e) => {
      aisStatus.connected = false; bus.emit("status");
      if (e.reason) aisStatus.error = `closed: ${e.reason}`;
      log("ais", `disconnected (code ${e.code}${e.reason ? `, "${e.reason}"` : ""}), retrying in ${backoff / 1000}s`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60000);
    };
  };
  connect();
}

// ---------------------------------------------------------------- demo simulator
// Clearly-labelled synthetic traffic so the UI can be exercised without a key.
const LANES = {
  HORMUZ: [[24.9, 57.9], [25.6, 57.0], [26.1, 56.75], [26.55, 56.55], [26.65, 56.15], [26.4, 55.5], [26.1, 54.8]],
  BAB: [[11.9, 45.2], [12.3, 44.3], [12.55, 43.6], [12.65, 43.35], [13.2, 42.95], [14.0, 42.55], [14.7, 42.1]],
  SUEZ: [[27.8, 33.75], [28.6, 33.1], [29.4, 32.75], [29.8, 32.57], [29.96, 32.56], [30.3, 32.4], [30.9, 32.32], [31.5, 32.33]],
  CAPE: [[-34.0, 16.7], [-34.6, 17.8], [-35.0, 18.8], [-35.2, 20.0], [-35.0, 21.2], [-34.6, 21.9]],
};
const NAMES = ["AEGEAN STAR", "GULF PIONEER", "PACIFIC ARROW", "NORDIC SPIRIT", "SEA HAWK", "CRIMSON TIDE", "OCEAN GRACE",
  "DESERT ROSE", "FALCON TRADER", "MINERVA", "ORIENT JADE", "ARCTIC SUN", "BLUE MARLIN", "STAR ALTAIR", "JADE WAVE",
  "GOLDEN EAGLE", "SILVER LAKE", "CORAL BAY", "AMBER LIGHT", "ZENITH", "VEGA", "HELIOS", "OSPREY", "PERSEUS"];

export function startDemo() {
  aisStatus.mode = "demo"; aisStatus.connected = true;
  const sims = [];
  let n = 0;
  for (const [zone, lane] of Object.entries(LANES)) {
    for (let i = 0; i < 14; i++) {
      const mmsi = 990000000 + n++;
      const tanker = Math.random() < 0.6;
      const fwd = Math.random() < 0.5;
      sims.push({ mmsi, zone, lane: fwd ? lane : [...lane].reverse(), seg: Math.floor(Math.random() * (lane.length - 1)),
        t: Math.random(), speed: 9 + Math.random() * 6, stopped: false, offset: (Math.random() - 0.5) * 0.08 });
      updateStatic(mmsi, { name: `[SIM] ${NAMES[(n * 7) % NAMES.length]} ${n}`, type: tanker ? 80 + (n % 5) : 70,
        dest: { HORMUZ: fwd ? "RAS TANURA" : "FUJAIRAH", BAB: fwd ? "SUEZ" : "DJIBOUTI", SUEZ: fwd ? "PORT SAID" : "JEDDAH", CAPE: fwd ? "ROTTERDAM" : "SINGAPORE" }[zone] });
    }
  }
  // One clearly-fake "sanctioned" example so the flagging UI can be seen in demo mode
  const sv = vessels.get(sims[3].mmsi);
  sv.cls = "Tanker"; sv.type = 80;
  sv.sanctioned = { name: "[SIM] EXAMPLE SANCTIONED TANKER", program: "DEMO", flag: "—", owner: "—", imo: null };
  // A stationary pair in the Gulf of Oman to exercise ship-to-ship transfer detection
  for (const [k, off] of [[0, 0], [1, 0.002]]) {
    const mmsi = 990500000 + k;
    updateStatic(mmsi, { name: `[SIM] STS ${k ? "RECEIVER" : "DONOR"}`, type: 80, dest: "FOR ORDERS" });
    sims.push({ mmsi, zone: "HORMUZ", fixed: { lat: 25.62 + off, lon: 57.25 + off }, stopped: true, nav: 0, cog: 120 });
  }
  const step = () => {
    for (const s of sims) {
      if (s.fixed) { updatePosition(s.mmsi, { ...s.fixed, sog: 0.1, cog: s.cog, hdg: s.cog, nav: 0 }); continue; }
      if (s.stopped) { updatePosition(s.mmsi, { ...lastPos(s), sog: 0.2, cog: s.cog, hdg: s.cog, nav: s.nav }); continue; }
      s.t += (s.speed * 0.0004) * (1 + Math.random() * 0.2);
      if (s.t >= 1) { s.t = 0; s.seg++; if (s.seg >= s.lane.length - 1) { s.seg = 0; s.lane = [...s.lane].reverse(); } }
      const [a, b] = [s.lane[s.seg], s.lane[s.seg + 1]];
      let lat = a[0] + (b[0] - a[0]) * s.t + s.offset * 0.5, lon = a[1] + (b[1] - a[1]) * s.t + s.offset;
      if (s.jump) { lat += 0.35; lon -= 0.4; s.jump = false; }
      s.cog = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 360) % 360;
      s.pos = { lat, lon };
      updatePosition(s.mmsi, { lat, lon, sog: s.speed + Math.random() - 0.5, cog: s.cog, hdg: Math.round(s.cog), nav: 0 });
    }
  };
  const lastPos = (s) => s.pos || { lat: s.lane[0][0], lon: s.lane[0][1] };
  step();
  setInterval(step, 5000);
  // Every ~2 min a random vessel suffers a simulated incident, recovering after ~4 min
  setInterval(() => {
    const s = sims[Math.floor(Math.random() * sims.length)];
    if (s.stopped || s.fixed) return;
    s.stopped = true; s.nav = Math.random() < 0.5 ? 2 : 0;
    setTimeout(() => { s.stopped = false; s.nav = 0; const v = vessels.get(s.mmsi); if (v) v.incident = null; }, 240000);
  }, 120000);
  // Every ~3 min a simulated GPS jump on a few Hormuz vessels
  setInterval(() => {
    sims.filter((s) => s.zone === "HORMUZ" && !s.stopped && !s.fixed).slice(0, 3).forEach((s) => (s.jump = true));
  }, 180000);
  log("ais", "DEMO mode: simulated vessels (not real data)");
}
