// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// News wire: polls outlet RSS feeds + Google News searches, keeps items relevant to the
// two chokepoints, and credits the original outlet on every item.
import { bus, fetchText, parseFeed, hashId, log } from "./util.js";
import { raiseAlert } from "./alerts.js";

const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

// `source` is the credited outlet. Google News feeds credit each item's own <source>.
export const FEEDS = [
  { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "BBC News", url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml" },
  { source: "CNN", url: "http://rss.cnn.com/rss/edition_meast.rss" },
  { source: "The Jerusalem Post", url: "https://www.jpost.com/rss/rssfeedsheadlines.aspx" },
  { source: "The Times of Israel", url: "https://www.timesofisrael.com/feed/" },
  { source: "The Guardian", url: "https://www.theguardian.com/world/middleeast/rss" },
  { source: "Arab News", url: "https://www.arabnews.com/rss.xml" },
  { source: "Tehran Times", url: "https://www.tehrantimes.com/rss" },
  { source: "gCaptain", url: "https://gcaptain.com/feed/" },
  { source: "Splash247", url: "https://splash247.com/feed/" },
  { source: "OilPrice.com", url: "https://oilprice.com/rss/main" },
  { source: null, url: gnews('"Strait of Hormuz" when:2d') },
  { source: null, url: gnews('("Bab el-Mandeb" OR "Red Sea") (tanker OR shipping OR Houthi) when:2d') },
  { source: null, url: gnews("(UKMTO OR \"Ambrey\") incident vessel when:3d") },
  { source: null, url: gnews("tanker (seized OR attacked OR struck OR explosion OR boarded) when:2d") },
];

const RELEVANT = /hormuz|bab[\s-]?el[\s-]?mandeb|red sea|gulf of aden|gulf of oman|persian gulf|arabian gulf|houthi|ukmto|ambrey|tanker|strait|fujairah|bandar abbas|yemen|irgc|shipping lane|maritime|crude|brent|opec|oil price|lng|vessel|freight/i;
const STRONG = /hormuz|bab[\s-]?el[\s-]?mandeb|red sea|gulf of aden|gulf of oman|houthi|ukmto|tanker|fujairah|irgc navy|shipping/i;
const INCIDENT = /\b(attack(ed)?|struck|strike[sd]?|explosion|blast|missile|drone|seiz(ed|ure)|hijack(ed)?|board(ed|ing)|fire on board|ablaze|sinking|sank|mine|projectile|hit by|damaged|distress|abandon(ed)?)\b/i;
const SHIPPING = /tanker|vessel|ship|cargo|carrier|merchant|ukmto|ambrey/i;

export const news = [];
const seen = new Set();
export const newsStatus = { feeds: FEEDS.length, ok: 0, failed: [], lastPoll: null };

function regionOf(text) {
  if (/hormuz|gulf of oman|persian gulf|arabian gulf|fujairah|bandar abbas|irgc|iran/i.test(text)) return "HORMUZ";
  if (/bab[\s-]?el[\s-]?mandeb|red sea|gulf of aden|houthi|yemen|hodeidah|djibouti|eritrea/i.test(text)) return "BAB";
  return "GLOBAL";
}

// Google News titles look like "Headline - Outlet"
function splitGoogleTitle(title) {
  const i = title.lastIndexOf(" - ");
  return i > 20 ? { title: title.slice(0, i), outlet: title.slice(i + 3) } : { title, outlet: null };
}

function normTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").slice(0, 80);
}

async function pollFeed(f) {
  const xml = await fetchText(f.url, { timeout: 15000 });
  const items = parseFeed(xml);
  const fresh = [];
  for (const it of items) {
    let { title } = it;
    let source = f.source;
    if (!source) {
      const g = splitGoogleTitle(title);
      title = g.title;
      source = it.sourceName || g.outlet || "Google News";
    }
    const text = `${title} ${it.summary}`;
    if (!RELEVANT.test(text)) continue;
    // Outlet-wide feeds: require a strong chokepoint/shipping term to cut noise
    if (f.source && !STRONG.test(text)) continue;
    const key = normTitle(title);
    if (seen.has(key)) continue;
    if (Date.now() - it.published.getTime() > 3 * 86400000) continue;
    seen.add(key);
    const item = {
      id: hashId(key), source, title, summary: f.source ? it.summary : "", url: it.link,
      published: it.published.toISOString(), region: regionOf(text),
      incident: INCIDENT.test(text) && SHIPPING.test(text),
    };
    fresh.push(item);
  }
  return fresh;
}

let firstPoll = true;
async function pollAll() {
  const results = await Promise.allSettled(FEEDS.map(pollFeed));
  const fresh = [];
  newsStatus.failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") fresh.push(...r.value);
    else newsStatus.failed.push(FEEDS[i].source || "Google News search");
  });
  newsStatus.ok = FEEDS.length - newsStatus.failed.length;
  newsStatus.lastPoll = new Date().toISOString();
  fresh.sort((a, b) => b.published.localeCompare(a.published));
  if (fresh.length) {
    news.push(...fresh);
    news.sort((a, b) => b.published.localeCompare(a.published));
    news.length = Math.min(news.length, 300);
    bus.emit("news", fresh);
    for (const n of fresh) {
      // Only alert on breaking items (< 3h old), and not the backlog on startup
      const ageH = (Date.now() - Date.parse(n.published)) / 3600000;
      if (n.incident && n.region !== "GLOBAL" && ageH < 3 && !firstPoll) {
        raiseAlert({ severity: "critical", zone: n.region, kind: "news-incident", key: `news:${n.id}`,
          title: `${n.source}: ${n.title}`, source: n.source, url: n.url });
      }
    }
  }
  if (firstPoll) log("news", `loaded ${news.length} relevant items; ${newsStatus.failed.length} feeds failed`);
  firstPoll = false;
}

export function startNews() {
  pollAll().catch((e) => log("news", e.message));
  setInterval(() => pollAll().catch((e) => log("news", e.message)), 90_000);
}
