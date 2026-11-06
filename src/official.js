// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Official statements: governments, militaries and state agencies on both sides.
// "direct"  = published by the body itself (its own site / feed / official agency).
// "relayed" = the body's statement as reported by a news outlet, because its own site
//             blocks automated access (IRGC, Houthi military spokesman, Iran MFA). Credited "via <outlet>".
import { bus, fetchText, parseFeed, hashId, log } from "./util.js";
import { raiseAlert } from "./alerts.js";

const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

// Region/topic filter for bodies that publish on everything (White House, State, UN, ...)
const TOPIC = /hormuz|red sea|bab[\s-]?el[\s-]?mandeb|gulf of (aden|oman)|persian gulf|arabian gulf|iran|houthi|yemen|tanker|shipping|maritime|vessel|navy|naval|strait|irgc|sanction|crude|oil|energy|lng|centcom|middle east|saudi|emirat|uae|israel|missile|drone/i;
const INCIDENT = /\b(attack(ed)?|struck|strike[sd]?|explosion|blast|missile|drone|seiz(ed|ure)|hijack(ed)?|board(ed|ing)|fire|ablaze|sink(ing)?|sank|sunk|mine|intercept(ed)?|shot down|retaliat\w*|warn(s|ed|ing)?|clos(e|ed|ure|ing))\b/i;
const SHIPPING = /tanker|vessel|ship|strait|hormuz|red sea|mandeb|gulf/i;

// state.gov rejects non-browser clients
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
// Outlet names that are the official body's own channel
const OWN_CHANNEL = /ministry of foreign affairs|central command|centcom|\.mil\b|whitehouse|white house|state\.gov|department of state|ukmto|gov\.uk|saudi press agency|وكالة الأنباء السعودية|wam\b|emirates news agency/i;

const STATED = /\b(says?|said|warns?|warned|vows?|vowed|announces?|announced|confirms?|confirmed|claims?|claimed|denies|denied|threatens?|threatened|urges?|urged|calls (on|for)|declares?|declared|statement|orders?|ordered|rejects?|rejected|condemns?|condemned|defends?|insists?|tells|told|accuses?|accused|responds?|pledges?|reports?)\b|: |["“”']/i;

export const OFFICIAL_SOURCES = [
  // United States
  { org: "CENTCOM", side: "US", mode: "direct", url: "https://www.centcom.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=808&max=20" },
  { org: "CENTCOM", side: "US", mode: "direct", url: gnews("site:centcom.mil when:14d") },
  { org: "CENTCOM", side: "US", mode: "relayed", url: gnews("(CENTCOM OR \"Central Command\") (Iran OR Hormuz OR Houthi OR \"Red Sea\" OR tanker) when:7d"), must: /centcom|central command/i },
  { org: "CENTCOM", side: "US", mode: "relayed", url: gnews("CENTCOM statement when:7d"), must: /centcom|central command/i },
  { org: "White House", side: "US", mode: "direct", url: "https://www.whitehouse.gov/news/feed/", topic: true },
  { org: "White House", side: "US", mode: "relayed", url: gnews("(Trump OR \"White House\" OR Leavitt) (Iran OR Hormuz OR Houthi OR \"Red Sea\" OR tanker) when:3d"),
    must: /trump|white house|leavitt|president/i, also: /iran|hormuz|houthi|red sea|tanker|irgc|gulf/i },
  { org: "Dept. of War", side: "US", mode: "direct", url: "https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=20", topic: true },
  { org: "Dept. of War", side: "US", mode: "relayed", url: gnews("(Pentagon OR Hegseth OR \"Department of War\") (Iran OR Hormuz OR Houthi OR \"Red Sea\") when:3d"),
    must: /pentagon|hegseth|department of war|war department|war secretary/i, mustTitle: true, also: /iran|hormuz|houthi|red sea|tanker|irgc|gulf/i },
  { org: "State Dept.", side: "US", mode: "direct", url: "https://www.state.gov/rss-feed/press-releases/feed/", topic: true, browserUA: true },
  { org: "State Dept.", side: "US", mode: "relayed", url: gnews("(Rubio OR \"State Department\") (Iran OR Hormuz OR Houthi OR \"Red Sea\") when:3d"),
    must: /rubio|state department|secretary of state/i, also: /iran|hormuz|houthi|red sea|tanker|irgc|gulf/i },
  // Iran
  { org: "IRNA (Iran state agency)", side: "IRAN", mode: "direct", url: "https://en.irna.ir/rss", topic: true },
  { org: "Mehr (semi-official)", side: "IRAN", mode: "direct", url: "https://en.mehrnews.com/rss", topic: true },
  { org: "IRGC", side: "IRAN", mode: "relayed", url: gnews("(IRGC OR \"Revolutionary Guard\") (statement OR says OR warns OR navy) when:7d"), must: /irgc|revolutionary guard/i },
  { org: "Iran Foreign Ministry", side: "IRAN", mode: "relayed", url: gnews("Iran foreign ministry (spokesman OR Baghaei OR Araghchi) when:7d"), must: /foreign ministry|baghaei|araghchi|foreign minister/i },
  // Yemen / Houthis
  { org: "Houthi military (Saree)", side: "HOUTHI", mode: "relayed", url: gnews("(\"Yahya Saree\" OR \"Houthi military spokesman\") when:7d"),
    must: /saree|houthis? (say|said|claim|announce|warn|threaten)|houthi (military )?spokesman/i },
  { org: "Houthi leadership", side: "HOUTHI", mode: "relayed", url: gnews("(\"Abdul-Malik al-Houthi\" OR \"Ansar Allah\" statement) when:7d"),
    must: /ansar allah (condemn|say|warn|announce|political)|abdul-?malik al-houthi (say|said|warn|vow)|houthi leader (say|said|warn|vow)|political bureau/i },
  // Gulf states
  { org: "Saudi Press Agency", side: "GULF", mode: "direct", url: gnews("site:spa.gov.sa when:7d"), topic: true },
  { org: "WAM (UAE state agency)", side: "GULF", mode: "direct", url: gnews("site:wam.ae when:7d"), topic: true },
  // UK / UN / maritime security
  { org: "UK Foreign Office", side: "UK", mode: "direct", url: "https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=foreign-commonwealth-development-office", topic: true },
  { org: "UK Ministry of Defence", side: "UK", mode: "direct", url: "https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=ministry-of-defence", topic: true },
  { org: "UKMTO", side: "UK", mode: "relayed", url: gnews("UKMTO (advisory OR incident OR warning) when:7d"), must: /ukmto/i },
  { org: "UN News", side: "UN", mode: "direct", url: "https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml", topic: true },
];

export const statements = [];
const seen = new Set();
export const officialStatus = { sources: OFFICIAL_SOURCES.length, ok: 0, failed: [], lastPoll: null };

function splitGoogleTitle(title) {
  const i = title.lastIndexOf(" - ");
  return i > 15 ? { title: title.slice(0, i), outlet: title.slice(i + 3) } : { title, outlet: null };
}
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").slice(0, 80);

async function pollSource(s) {
  const headers = s.browserUA ? { "User-Agent": BROWSER_UA } : {};
  const items = parseFeed(await fetchText(s.url, { timeout: 15000, headers }));
  const out = [];
  for (const it of items) {
    const isGoogle = s.url.includes("news.google.com");
    let title = it.title, via = null;
    if (isGoogle) {
      const g = splitGoogleTitle(title);
      title = g.title;
      via = it.sourceName || g.outlet;
    }
    const text = `${title} ${it.summary}`;
    if (s.topic && !TOPIC.test(text)) continue;
    if (s.must && !s.must.test(s.mustTitle ? title : text)) continue;
    if (s.also && !s.also.test(text)) continue;
    // Relayed items must report something the body said, not commentary about it
    if (s.mode === "relayed" && !STATED.test(title)) continue;
    // A "relayed" hit whose outlet is the body's own channel is really a direct publication
    const mode = s.mode === "relayed" && via && OWN_CHANNEL.test(via) ? "direct" : s.mode;
    if (Date.now() - it.published.getTime() > 14 * 86400000) continue;
    const key = norm(title);
    out.push({
      key,
      id: hashId("off:" + key), org: s.org, side: s.side, mode,
      // For direct items found via a Google site: search, the outlet is the body itself
      via: mode === "relayed" ? via || "news report" : null,
      title, summary: isGoogle ? "" : it.summary.slice(0, 300), url: it.link, published: it.published.toISOString(),
      incident: INCIDENT.test(text) && SHIPPING.test(text),
    });
  }
  return out;
}

let first = true;
async function pollAll() {
  const res = await Promise.allSettled(OFFICIAL_SOURCES.map(pollSource));
  const fresh = [];
  officialStatus.failed = [];
  // Dedupe in list order so the most specific source wins (CENTCOM before a generic Pentagon search)
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") return officialStatus.failed.push(OFFICIAL_SOURCES[i].org);
    for (const { key, ...item } of r.value) if (!seen.has(key)) { seen.add(key); fresh.push(item); }
  });
  officialStatus.ok = OFFICIAL_SOURCES.length - officialStatus.failed.length;
  officialStatus.lastPoll = new Date().toISOString();
  if (fresh.length) {
    statements.push(...fresh);
    statements.sort((a, b) => b.published.localeCompare(a.published));
    statements.length = Math.min(statements.length, 300);
    bus.emit("official", fresh);
    for (const s of fresh) {
      const ageH = (Date.now() - Date.parse(s.published)) / 3600000;
      if (!first && s.incident && ageH < 3) {
        raiseAlert({ severity: "critical", kind: "official-statement", key: `off:${s.id}`,
          zone: /red sea|mandeb|aden|houthi|yemen/i.test(s.title) ? "BAB" : /hormuz|oman|persian gulf|iran|irgc/i.test(s.title) ? "HORMUZ" : undefined,
          title: `${s.org}${s.via ? ` (via ${s.via})` : ""}: ${s.title}`, source: s.org, url: s.url });
      }
    }
  }
  if (first) log("official", `loaded ${statements.length} statements; failed: ${officialStatus.failed.join(", ") || "none"}`);
  first = false;
}

export function startOfficial() {
  pollAll().catch((e) => log("official", e.message));
  setInterval(() => pollAll().catch((e) => log("official", e.message)), 120_000);
}
