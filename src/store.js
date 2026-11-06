// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Tiny JSON persistence in ./data so history, counts and alerts survive restarts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./util.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
fs.mkdirSync(DIR, { recursive: true });

export function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), "utf8")); }
  catch { return fallback; }
}

export function save(name, obj) {
  const file = path.join(DIR, `${name}.json`);
  try {
    fs.writeFileSync(file + ".tmp", JSON.stringify(obj));
    fs.renameSync(file + ".tmp", file);
  } catch (e) { log("store", `save ${name} failed: ${e.message}`); }
}

const savers = [];
/** Save `getter()` under `name` every `everyMs`, and once more on shutdown. */
export function persist(name, getter, everyMs = 5 * 60_000) {
  savers.push([name, getter]);
  setInterval(() => save(name, getter()), everyMs).unref();
}
function flush() { for (const [n, g] of savers) save(n, g()); }
process.on("SIGINT", () => { flush(); process.exit(0); });
process.on("SIGTERM", () => { flush(); process.exit(0); });
