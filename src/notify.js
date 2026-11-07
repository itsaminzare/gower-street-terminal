// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Push alerts to your phone: Telegram bot and/or ntfy.sh. Both are off unless configured in .env.
import { bus, log, DEMO } from "./util.js";

const RANK = { info: 0, warning: 1, critical: 2 };
export const notifyStatus = { channels: [], sent: 0, lastError: null, minSeverity: "critical" };

export function startNotify(env) {
  const tg = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? { token: env.TELEGRAM_BOT_TOKEN, chat: env.TELEGRAM_CHAT_ID } : null;
  const ntfy = env.NTFY_TOPIC ? { server: (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, ""), topic: env.NTFY_TOPIC } : null;
  notifyStatus.minSeverity = RANK[env.NOTIFY_MIN_SEVERITY] != null ? env.NOTIFY_MIN_SEVERITY : "critical";
  notifyStatus.channels = [tg && "Telegram", ntfy && "ntfy"].filter(Boolean);
  if (!notifyStatus.channels.length) return;

  // Batch alerts arriving close together into one message (max one push per 30 s)
  let queue = [], timer = null;
  const flush = async () => {
    timer = null;
    const items = queue.splice(0);
    if (!items.length) return;
    const head = items.length === 1 ? items[0].title : `${items.length} new alerts`;
    const body = items.slice(0, 8).map((a) => `• [${a.severity.toUpperCase()}] ${a.title}${a.detail ? ` — ${a.detail}` : ""}${a.url ? `\n  ${a.url}` : ""}`).join("\n");
    await send(`${DEMO ? "[DEMO DATA] " : ""}Gower Street Terminal: ${head}`, body, items.some((a) => a.severity === "critical"));
  };
  async function send(title, body, urgent) {
    const jobs = [];
    if (tg) jobs.push(fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tg.chat, text: `${title}\n\n${body}`, disable_web_page_preview: true }),
    }).then((r) => { if (!r.ok) throw new Error(`Telegram HTTP ${r.status}`); }));
    if (ntfy) jobs.push(fetch(`${ntfy.server}/${encodeURIComponent(ntfy.topic)}`, {
      method: "POST", body,
      headers: { Title: title.replace(/[^\x20-\x7E]/g, ""), Priority: urgent ? "urgent" : "default", Tags: urgent ? "rotating_light" : "ship" },
    }).then((r) => { if (!r.ok) throw new Error(`ntfy HTTP ${r.status}`); }));
    const res = await Promise.allSettled(jobs);
    const err = res.find((r) => r.status === "rejected");
    if (err) { notifyStatus.lastError = err.reason.message; log("notify", err.reason.message); }
    else notifyStatus.sent++;
  }
  notifyStatus.test = () => send("Gower Street Terminal: test notification", "If you can read this, phone alerts are working.", false);

  bus.on("alert", (a) => {
    if (RANK[a.severity] < RANK[notifyStatus.minSeverity]) return;
    queue.push(a);
    if (!timer) timer = setTimeout(flush, 30_000);
  });
  // Trade desk: a proposal waits for a human and lapses after an hour, so tell the owner straight away
  const site = (env.KEEP_AWAKE_URL || env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
  bus.on("desk-proposal", (i) => {
    send(`${DEMO ? "[DEMO DATA] " : ""}Trade desk: ${i.direction} ${i.instrument} awaiting your approval`,
      `${i.thesis}\nP(win) ${Math.round(i.probability * 100)}% · EV ${i.evR}R · risk ${i.riskPct}% · ${i.horizon_days}d\nApprove or reject within an hour${site ? `: ${site}` : " in the Trade desk tab"}.`, true);
  });
  log("notify", `phone alerts via ${notifyStatus.channels.join(" + ")} (min severity: ${notifyStatus.minSeverity})`);
}
