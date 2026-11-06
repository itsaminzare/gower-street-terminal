// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Social chatter: X (paid API), Bluesky, Reddit, public Telegram channels.
// Each source is independent; missing credentials just mark that source offline.
import { bus, fetchText, fetchJSON, stripTags, decode, hashId, log } from "./util.js";

const QUERY_WORDS = ["Strait of Hormuz", "Hormuz tanker", "Bab el-Mandeb", "Red Sea tanker", "UKMTO", "Houthi ship"];
// Must mention a chokepoint/actor term; "ship" alone matches too much ("$45 shipped")
const RELEVANT = /hormuz|mandeb|red sea|gulf of aden|gulf of oman|persian gulf|houthi|ukmto|ambrey|\btankers?\b|fujairah|bandar abbas|irgc/i;

export const posts = [];
const seen = new Set();
export const socialStatus = {};

function add(list) {
  const fresh = [];
  for (const p of list) {
    if (seen.has(p.id) || !RELEVANT.test(p.text)) continue;
    if (Date.now() - Date.parse(p.time) > 2 * 86400000) continue;
    seen.add(p.id);
    fresh.push(p);
  }
  if (!fresh.length) return;
  posts.push(...fresh);
  posts.sort((a, b) => b.time.localeCompare(a.time));
  posts.length = Math.min(posts.length, 300);
  bus.emit("social", fresh);
}

async function guard(name, fn) {
  try { const n = await fn(); socialStatus[name] = { ok: true, last: new Date().toISOString(), count: n }; }
  catch (e) { socialStatus[name] = { ok: false, error: e.message.slice(0, 140) }; }
}

// ---- X / Twitter: v2 recent search
async function pollX(token) {
  const q = `(${QUERY_WORDS.map((w) => `"${w}"`).join(" OR ")}) -is:retweet lang:en`;
  const url = `https://api.x.com/2/tweets/search/recent?max_results=50&query=${encodeURIComponent(q)}` +
    `&tweet.fields=created_at,author_id,public_metrics&expansions=author_id&user.fields=username,name,verified`;
  const j = await fetchJSON(url, { headers: { Authorization: `Bearer ${token}` } });
  const users = Object.fromEntries((j.includes?.users || []).map((u) => [u.id, u]));
  const list = (j.data || []).map((t) => {
    const u = users[t.author_id] || {};
    return { id: `x:${t.id}`, platform: "X", author: u.name || "?", handle: u.username ? `@${u.username}` : "",
      verified: !!u.verified, text: t.text, time: t.created_at, url: `https://x.com/${u.username || "i"}/status/${t.id}`,
      engagement: (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0) };
  });
  add(list);
  return list.length;
}

// ---- Bluesky
let bskyJwt = null;
async function pollBluesky(handle, pass) {
  let base = "https://public.api.bsky.app";
  const headers = {};
  if (handle && pass) {
    if (!bskyJwt) {
      const r = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: handle, password: pass }),
      });
      if (!r.ok) throw new Error(`Bluesky login HTTP ${r.status}`);
      bskyJwt = (await r.json()).accessJwt;
      setTimeout(() => (bskyJwt = null), 90 * 60 * 1000);
    }
    base = "https://bsky.social";
    headers.Authorization = `Bearer ${bskyJwt}`;
  }
  let total = 0;
  for (const q of ["hormuz", "\"red sea\" tanker", "mandeb", "UKMTO"]) {
    const j = await fetchJSON(`${base}/xrpc/app.bsky.feed.searchPosts?sort=latest&limit=40&q=${encodeURIComponent(q)}`, { headers });
    const list = (j.posts || []).map((p) => ({
      id: `bsky:${p.uri}`, platform: "Bluesky", author: p.author.displayName || p.author.handle, handle: `@${p.author.handle}`,
      text: p.record?.text || "", time: p.record?.createdAt || p.indexedAt,
      url: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`,
      engagement: (p.likeCount || 0) + (p.repostCount || 0),
    }));
    add(list); total += list.length;
  }
  return total;
}

// ---- Reddit (public Atom search feed; the JSON API blocks unauthenticated clients)
async function pollReddit() {
  const q = 'hormuz OR mandeb OR houthi OR ukmto OR "red sea" OR tanker';
  const xml = await fetchText(`https://www.reddit.com/search.rss?sort=new&t=week&limit=50&q=${encodeURIComponent(q)}`);
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const list = entries.map((e) => {
    const g = (re) => (e.match(re) || [])[1] || "";
    const link = g(/<link href="([^"]+)"/);
    return {
      id: `reddit:${g(/<id>([^<]+)<\/id>/)}`, platform: "Reddit", author: decode(g(/<name>([^<]+)<\/name>/)),
      handle: decode(g(/<category[^>]*label="([^"]+)"/)), text: stripTags(g(/<title>([\s\S]*?)<\/title>/)),
      time: new Date(g(/<updated>([^<]+)<\/updated>/) || g(/<published>([^<]+)<\/published>/)).toISOString(),
      url: decode(link), engagement: 0,
    };
  }).filter((p) => p.url);
  add(list);
  return list.length;
}

// ---- Telegram public channel web preview (t.me/s/<channel>)
async function pollTelegram(channels) {
  let total = 0;
  for (const ch of channels) {
    const html = await fetchText(`https://t.me/s/${encodeURIComponent(ch)}`);
    const title = stripTags((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || ch);
    const blocks = html.split('class="tgme_widget_message_wrap').slice(1);
    const list = [];
    for (const b of blocks) {
      const post = (b.match(/data-post="([^"]+)"/) || [])[1];
      const text = stripTags((b.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
      const time = (b.match(/<time datetime="([^"]+)"/) || [])[1];
      if (post && text && time) list.push({ id: `tg:${post}`, platform: "Telegram", author: title, handle: `t.me/${ch}`,
        text: text.slice(0, 600), time: new Date(time).toISOString(), url: `https://t.me/${post}`, engagement: 0 });
    }
    add(list); total += list.length;
  }
  return total;
}

export function startSocial(env) {
  const tg = (env.TELEGRAM_CHANNELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const run = async () => {
    const jobs = [guard("Reddit", pollReddit), guard("Bluesky", () => pollBluesky(env.BSKY_HANDLE, env.BSKY_APP_PASSWORD))];
    if (env.X_BEARER_TOKEN) jobs.push(guard("X", () => pollX(env.X_BEARER_TOKEN)));
    else socialStatus.X = { ok: false, error: "No X_BEARER_TOKEN (X search requires a paid API plan)" };
    if (tg.length) jobs.push(guard("Telegram", () => pollTelegram(tg)));
    else socialStatus.Telegram = { ok: false, error: "No TELEGRAM_CHANNELS configured" };
    await Promise.all(jobs);
    bus.emit("status");
  };
  run().then(() => log("social", JSON.stringify(Object.fromEntries(Object.entries(socialStatus).map(([k, v]) => [k, v.ok ? v.count : v.error])))));
  setInterval(run, 120_000);
}

export { hashId };
