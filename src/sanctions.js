// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// US Treasury OFAC SDN list: sanctioned vessels, matched against live AIS by IMO and MMSI.
import { fetchText, log } from "./util.js";
import { load, save } from "./store.js";

export const sanctionsStatus = { ok: false, vessels: 0, updated: null, error: null };
let byImo = new Map(), byMmsi = new Map();

// Minimal CSV line parser (quoted fields, OFAC uses -0- for empty)
function parseLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => (s.trim() === "-0-" ? "" : s.trim()));
}

function index(list) {
  byImo = new Map(); byMmsi = new Map();
  for (const v of list) { if (v.imo) byImo.set(v.imo, v); if (v.mmsi) byMmsi.set(v.mmsi, v); }
  sanctionsStatus.ok = list.length > 0;
  sanctionsStatus.vessels = list.length;
}

// Two official addresses for the same SDN file; some hosting networks reach one but not the other
const SOURCES = [
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV",
  "https://www.treasury.gov/ofac/downloads/sdn.csv",
];
async function download() {
  let lastErr;
  for (const url of SOURCES) {
    try { return await fetchText(url, { timeout: 90000 }); }
    catch (e) { lastErr = new Error(`${new URL(url).host}: ${e.cause?.code || e.message}`); }
  }
  throw lastErr;
}

let retryTimer = null;
async function refresh() {
  try {
    const csv = await download();
    const list = [];
    for (const line of csv.split(/\r?\n/)) {
      if (!/,"vessel",/i.test(line)) continue;
      const f = parseLine(line);
      // columns: ent_num, name, type, program, title, call_sign, vess_type, tonnage, grt, flag, owner, remarks
      const remarks = f[11] || "";
      const imo = (remarks.match(/IMO (\d{7})/) || [])[1] || null;
      const mmsi = (remarks.match(/MMSI (\d{9})/) || [])[1] || null;
      list.push({ id: f[0], name: f[1], program: f[3], callsign: f[5], vtype: f[6], flag: f[9], owner: f[10], imo, mmsi });
    }
    if (list.length < 100) throw new Error(`only ${list.length} vessels parsed`);
    index(list);
    sanctionsStatus.updated = new Date().toISOString(); sanctionsStatus.error = null;
    save("ofac-vessels", { updated: sanctionsStatus.updated, list });
    log("sanctions", `OFAC list loaded: ${list.length} vessels`);
  } catch (e) {
    sanctionsStatus.error = `${e.message} (retrying in 30 min)`;
    log("sanctions", "refresh failed:", e.message);
    // Without a list nothing can be flagged, so retry soon rather than waiting a day
    if (!retryTimer && !sanctionsStatus.ok) retryTimer = setTimeout(() => { retryTimer = null; refresh(); }, 30 * 60_000);
  }
}

/** Returns the OFAC entry for a vessel, or null. */
export function matchVessel({ imo, mmsi }) {
  return (imo && byImo.get(String(imo))) || (mmsi && byMmsi.get(String(mmsi))) || null;
}

export function startSanctions() {
  const cached = load("ofac-vessels", null);
  if (cached?.list?.length) { index(cached.list); sanctionsStatus.updated = cached.updated; }
  const age = cached ? Date.now() - Date.parse(cached.updated) : Infinity;
  if (age > 12 * 3600_000) refresh();
  setInterval(refresh, 24 * 3600_000).unref();
}
