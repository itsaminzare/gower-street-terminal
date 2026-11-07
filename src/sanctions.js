// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// US Treasury OFAC SDN list: sanctioned vessels, matched against live AIS by IMO and MMSI.
//
// Sources, in order: the two official Treasury addresses, then a copy in this project's GitHub repo
// (refreshed daily by .github/workflows/ofac.yml, for hosts the Treasury blocks), then the copy
// bundled with the code (public-data/ofac-vessels.json).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText, fetchJSON, log } from "./util.js";
import { load, save } from "./store.js";

export const sanctionsStatus = { ok: false, vessels: 0, updated: null, error: null, source: null };
let byImo = new Map(), byMmsi = new Map();

const TREASURY = [
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV",
  "https://www.treasury.gov/ofac/downloads/sdn.csv",
];
const GITHUB_COPY = "https://raw.githubusercontent.com/itsaminzare/gower-street-terminal/main/public-data/ofac-vessels.json";
export const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public-data", "ofac-vessels.json");

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

/** Extract sanctioned vessels from the SDN CSV. */
export function parseSdn(csv) {
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
  return list;
}

/** Fresh list straight from the Treasury (tries both official addresses). */
export async function downloadFromTreasury() {
  let lastErr;
  for (const url of TREASURY) {
    try { return parseSdn(await fetchText(url, { timeout: 90000 })); }
    catch (e) { lastErr = new Error(`${new URL(url).host}: ${e.cause?.code || e.message}`); }
  }
  throw lastErr;
}

function index(list) {
  byImo = new Map(); byMmsi = new Map();
  for (const v of list) { if (v.imo) byImo.set(v.imo, v); if (v.mmsi) byMmsi.set(v.mmsi, v); }
  sanctionsStatus.ok = list.length > 0;
  sanctionsStatus.vessels = list.length;
}

function use(list, updated, source) {
  index(list);
  Object.assign(sanctionsStatus, { updated, source, error: null });
  save("ofac-vessels", { updated, list, source });
  log("sanctions", `OFAC list loaded from ${source}: ${list.length} vessels (as of ${updated.slice(0, 10)})`);
}

let retryTimer = null;
async function refresh() {
  const errors = [];
  try { return use(await downloadFromTreasury(), new Date().toISOString(), "US Treasury"); }
  catch (e) { errors.push(e.message); }
  try {
    const j = await fetchJSON(GITHUB_COPY, { timeout: 30000 });
    if (j?.list?.length > 100) return use(j.list, j.updated, "GitHub copy of Treasury list");
    errors.push("GitHub copy empty");
  } catch (e) { errors.push(`GitHub copy: ${e.message}`); }
  sanctionsStatus.error = `${errors.join("; ")} (retrying in 30 min)`;
  log("sanctions", "refresh failed:", sanctionsStatus.error);
  if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; refresh(); }, 30 * 60_000);
}

/** Returns the OFAC entry for a vessel, or null. */
export function matchVessel({ imo, mmsi }) {
  return (imo && byImo.get(String(imo))) || (mmsi && byMmsi.get(String(mmsi))) || null;
}

export function startSanctions() {
  // Start from the newest local copy (runtime cache, else the bundled file) so flags work immediately
  const cached = load("ofac-vessels", null);
  let bundled = null;
  try { bundled = JSON.parse(fs.readFileSync(BUNDLED, "utf8")); } catch { /* not bundled */ }
  const best = [cached, bundled].filter((x) => x?.list?.length).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0];
  if (best) { index(best.list); Object.assign(sanctionsStatus, { updated: best.updated, source: best === cached ? (cached.source || "cache") : "bundled copy" }); }
  const age = best ? Date.now() - Date.parse(best.updated) : Infinity;
  if (age > 12 * 3600_000) refresh();
  setInterval(refresh, 24 * 3600_000).unref();
}
