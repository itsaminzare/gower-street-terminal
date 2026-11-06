// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Shared helpers: event bus, HTTP fetch with timeout, tiny RSS/Atom parser, geo math.
import { EventEmitter } from "node:events";

// Demo mode = simulated AIS. Persisted files are kept separate per mode so demo data never mixes with live.
export const DEMO = process.argv.includes("--demo") || process.env.DEMO === "1";
export const MODE = DEMO ? "demo" : "live";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export const UA = "GowerStreetTerminal/0.1 (+local dashboard)";

export async function fetchText(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout ?? 15000);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*", ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJSON(url, opts = {}) {
  return JSON.parse(await fetchText(url, opts));
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decode(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
export function stripTags(s = "") {
  return decode(decode(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}
function attr(block, name, a) {
  const m = block.match(new RegExp(`<${name}\\s[^>]*${a}="([^"]*)"`, "i"));
  return m ? m[1] : "";
}

/** Parse RSS 2.0 or Atom into [{title, link, summary, published, sourceName}] */
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = stripTags(tag(b, "title"));
    let link = stripTags(tag(b, "link")) || attr(b, "link", "href");
    const summary = stripTags(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400);
    const date = stripTags(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const sourceName = stripTags(tag(b, "source")); // Google News puts the outlet here
    const published = date ? new Date(date) : new Date();
    if (title) items.push({ title, link, summary, published: isNaN(published) ? new Date() : published, sourceName });
  }
  return items;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function angleDiff(a, b) {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

export function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function log(mod, ...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [${mod}]`, ...args);
}
