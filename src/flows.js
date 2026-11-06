// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Chokepoint transit history from IMF PortWatch (daily transit calls by ship type, from satellite AIS).
// Source: UN Global Platform; IMF PortWatch (portwatch.imf.org). The public API is often rate-limited,
// so results are cached to disk and refreshed with backoff.
import { bus, log } from "./util.js";
import { load, save } from "./store.js";
import { raiseAlert } from "./alerts.js";

const API = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
// Map our zones to PortWatch chokepoint names
const MATCH = { HORMUZ: /hormuz/i, BAB: /mandeb/i, SUEZ: /suez/i, CAPE: /good hope/i };

export const flows = load("portwatch", { series: {}, updated: null });
export const flowsStatus = { ok: !!flows.updated, updated: flows.updated, error: null, nextTry: null };

async function fetchPortWatch() {
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const where = `(portname LIKE '%Hormuz%' OR portname LIKE '%Mandeb%' OR portname LIKE '%Suez%' OR portname LIKE '%Good Hope%') AND date >= DATE '${since}'`;
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 2000) {
    const qs = new URLSearchParams({ where, outFields: "date,portname,n_tanker,n_total,capacity_tanker,capacity",
      orderByFields: "date ASC", resultOffset: String(offset), resultRecordCount: "2000", f: "json" });
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
    const j = await fetch(`${API}?${qs}`, { signal: ctrl.signal }).then((r) => r.json()).finally(() => clearTimeout(t));
    if (j.error) throw new Error(`${j.error.code}: ${j.error.message}`);
    rows.push(...(j.features || []).map((f) => f.attributes));
    if (!j.exceededTransferLimit && (j.features || []).length < 2000) break;
  }
  if (!rows.length) throw new Error("no rows returned");
  const series = {};
  for (const r of rows) {
    const zone = Object.keys(MATCH).find((z) => MATCH[z].test(r.portname));
    if (!zone) continue;
    (series[zone] ||= { name: r.portname, days: [] }).days.push({
      date: new Date(r.date).toISOString().slice(0, 10), tanker: r.n_tanker, total: r.n_total,
      tankerMt: r.capacity_tanker, totalMt: r.capacity,
    });
  }
  return series;
}

// Rolling averages + change vs baseline, used by UI, analyst and alerts
export function flowSummary() {
  const out = {};
  for (const [z, s] of Object.entries(flows.series || {})) {
    const d = s.days;
    if (d.length < 30) continue;
    const avg = (arr, k) => arr.reduce((a, b) => a + (b[k] || 0), 0) / Math.max(arr.length, 1);
    const last7 = d.slice(-7), base = d.slice(-97, -7);
    const t7 = avg(last7, "tanker"), t90 = avg(base, "tanker");
    out[z] = { name: s.name, lastDate: d.at(-1).date, tanker7d: +t7.toFixed(1), tanker90d: +t90.toFixed(1),
      tankerChangePct: t90 ? +(((t7 - t90) / t90) * 100).toFixed(1) : null,
      total7d: +avg(last7, "total").toFixed(1), total90d: +avg(base, "total").toFixed(1) };
  }
  return out;
}

let delay = 60_000;
async function refresh() {
  try {
    const series = await fetchPortWatch();
    flows.series = series; flows.updated = new Date().toISOString();
    save("portwatch", flows);
    Object.assign(flowsStatus, { ok: true, updated: flows.updated, error: null, nextTry: null });
    log("flows", `PortWatch loaded: ${Object.entries(series).map(([z, s]) => `${z} ${s.days.length}d`).join(", ")}`);
    bus.emit("flows", { flows, summary: flowSummary() });
    for (const [z, s] of Object.entries(flowSummary())) {
      if (s.tankerChangePct != null && s.tankerChangePct <= -30) {
        raiseAlert({ severity: s.tankerChangePct <= -50 ? "critical" : "warning", zone: z, kind: "flow-drop", key: `flow:${z}:${s.lastDate}`,
          source: "IMF PortWatch", title: `${s.name}: tanker transits ${s.tankerChangePct}% vs 90-day average`,
          detail: `7-day average ${s.tanker7d}/day vs ${s.tanker90d}/day over the prior 90 days (data to ${s.lastDate}).` });
      }
    }
    delay = 60_000;
    setTimeout(refresh, 6 * 3600_000);
  } catch (e) {
    flowsStatus.error = e.message.slice(0, 160);
    flowsStatus.nextTry = new Date(Date.now() + delay).toISOString();
    log("flows", `PortWatch unavailable (${flowsStatus.error}); retry in ${Math.round(delay / 60000)} min`);
    setTimeout(refresh, delay);
    delay = Math.min(delay * 2, 60 * 60_000);
  }
}

export function startFlows() {
  const fresh = flows.updated && Date.now() - Date.parse(flows.updated) < 6 * 3600_000;
  setTimeout(refresh, fresh ? 6 * 3600_000 : 3000);
}
