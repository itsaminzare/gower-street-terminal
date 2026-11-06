// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Central alert store: dedupes, keeps history (persisted per mode), broadcasts on the bus.
import { bus, hashId, MODE } from "./util.js";
import { load, persist } from "./store.js";

const alerts = load(`alerts-${MODE}`, []).filter((a) => Date.now() - Date.parse(a.time) < 7 * 86400000);
const cooldown = new Map(alerts.map((a) => [a.key || `${a.kind}:${a.mmsi ?? a.title}`, Date.parse(a.time)]));
const COOLDOWN_MS = 60 * 60 * 1000;
persist(`alerts-${MODE}`, () => alerts, 60_000);

/**
 * @param {{severity:'critical'|'warning'|'info', zone?:string, kind:string, title:string,
 *          detail?:string, mmsi?:number, lat?:number, lon?:number, source?:string, url?:string, key?:string}} a
 */
export function raiseAlert(a) {
  const key = a.key || `${a.kind}:${a.mmsi ?? a.title}`;
  const now = Date.now();
  if (cooldown.has(key) && now - cooldown.get(key) < COOLDOWN_MS) return null;
  cooldown.set(key, now);
  const alert = { id: hashId(key + now), time: new Date().toISOString(), key, ...a };
  alerts.unshift(alert);
  alerts.length = Math.min(alerts.length, 500);
  bus.emit("alert", alert);
  return alert;
}

export function getAlerts() {
  return alerts;
}
