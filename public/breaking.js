// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Breaking-news strip: a news-channel style crawl of only the important items, every one with its source.
// Critical/warning alerts, official statements and headlines about incidents, incident-related social posts
// (tagged UNVERIFIED), and the oil price. Items older than 6 hours drop off. Hover pauses, click opens.
(() => {
  const $ = (s) => document.querySelector(s);
  const { state, esc, hhmm } = window.GST;
  const MAX_AGE = 6 * 3600_000, MAX_ITEMS = 30, SPEED = 70; // px per second
  const INCIDENT = /\b(attack(ed|s)?|struck|strike[sd]?|explosion|blast|missile|drone|seiz(ed|ure)|hijack(ed)?|board(ed|ing)|ablaze|on fire|sink(ing)?|sank|mine[sd]?|killed|intercept(ed)?|shot down|closure|closed)\b/i;
  // Social posts must be about ships or the sea lanes; statements must be about the conflict's parties or shipping
  const RELEVANT = /hormuz|red sea|mandeb|gulf of (aden|oman)|persian gulf|tanker|vessel|\bships?\b|shipping|ukmto|suez/i;
  const OFFICIAL_TOPIC = /hormuz|red sea|mandeb|gulf|tanker|vessel|\bships?\b|shipping|strait|iran|houthi|yemen|irgc|navy|naval|missile|drone|attack|oil/i;
  const IMPORTANT_WARNINGS = new Set(["ais-dark", "sts-transfer", "flow-drop", "spread-move", "price-move", "sudden-stop"]);
  const KEY_BODIES = new Set(["CENTCOM", "UKMTO", "IRGC", "Iran Foreign Ministry", "Houthi military (Saree)", "Houthi leadership"]);
  const seen = new Set();
  let lastSig = "";

  function collect() {
    const now = Date.now(), items = [];
    const fresh = (t) => now - Date.parse(t) < MAX_AGE;
    const fresh12 = (t) => now - Date.parse(t) < 2 * MAX_AGE; // statements and headlines publish less often
    for (const a of state.alerts || []) {
      // All critical alerts; only the warnings that matter (routine course reversals and single GPS jumps stay off the strip)
      if (!fresh(a.time) || !(a.severity === "critical" || IMPORTANT_WARNINGS.has(a.kind))) continue;
      const market = a.kind === "price-move" || a.kind === "spread-move";
      items.push({ id: `a:${a.id}`, t: a.time, tag: market ? "MARKET" : a.severity === "critical" ? "BREAKING" : "ALERT",
        cls: market ? "market" : a.severity, src: a.source || "Desk", text: a.title, url: a.url, alert: a });
    }
    for (const s of state.official || []) {
      // Incident statements from anyone, plus everything from the main parties to the conflict
      if (!fresh12(s.published) || !(s.incident || KEY_BODIES.has(s.org)) || !OFFICIAL_TOPIC.test(s.title)) continue;
      items.push({ id: `o:${s.id}`, t: s.published, tag: "OFFICIAL", cls: "official",
        src: s.via ? `${s.org} (via ${s.via})` : s.org, text: s.title, url: s.url });
    }
    for (const n of state.news || []) {
      if (!n.incident || n.region === "GLOBAL" || !fresh12(n.published)) continue;
      items.push({ id: `n:${n.id}`, t: n.published, tag: "NEWS", cls: "news", src: n.source, text: n.title, url: n.url });
    }
    for (const p of state.social || []) {
      if (!fresh(p.time) || !INCIDENT.test(p.text) || !RELEVANT.test(p.text)) continue;
      items.push({ id: `s:${p.id}`, t: p.time, tag: "UNVERIFIED", cls: "social", src: `${p.platform} ${p.handle || p.author}`,
        text: p.text.replace(/\s+/g, " ").slice(0, 160), url: p.url });
    }
    // Same story from several feeds: keep the first (alerts and official statements come first above)
    const byText = new Set();
    const unique = items.filter((i) => { const k = i.text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60); if (byText.has(k)) return false; byText.add(k); return true; });
    unique.sort((a, b) => b.t.localeCompare(a.t));
    const out = unique.slice(0, MAX_ITEMS);
    // The oil price always leads the crawl
    const b = state.prices?.["BZ=F"], w = state.prices?.["CL=F"];
    if (b) out.unshift({ id: "px", t: new Date().toISOString(), tag: "MARKET", cls: b.change >= 0 ? "up" : "down", src: "Brent / WTI",
      text: `Brent ${b.price.toFixed(2)} (${b.pct >= 0 ? "+" : ""}${b.pct.toFixed(2)}%)${w ? ` · WTI ${w.price.toFixed(2)} (${w.pct >= 0 ? "+" : ""}${w.pct.toFixed(2)}%)` : ""}` });
    return out;
  }

  function itemHTML(i) {
    const isNew = !seen.has(i.id) && i.id !== "px" && lastSig !== "";
    return `<span class="bk-item${isNew ? " bk-new" : ""}" data-id="${esc(i.id)}"${i.url ? ` data-url="${esc(i.url)}"` : ""}>` +
      `<span class="bk-tag ${i.cls}">${i.tag}</span><span class="bk-time">${i.id === "px" ? "" : hhmm(i.t)}</span>` +
      `<span class="bk-src">${esc(i.src)}:</span> ${esc(i.text)}</span><span class="bk-sep">◆</span>`;
  }

  function render() {
    const items = collect();
    const track = $(".bk-track");
    // Rebuild only when the set of stories changes; the price item updates in place so the crawl doesn't jump
    const sig = items.map((i) => i.id).join("|");
    if (sig === lastSig) {
      const px = items.find((i) => i.id === "px");
      if (px) track.querySelectorAll('.bk-item[data-id="px"]').forEach((el) => {
        el.lastChild.textContent = ` ${px.text}`;
        el.querySelector(".bk-tag").className = `bk-tag ${px.cls}`;
      });
      return;
    }
    if (!items.length) { track.innerHTML = `<span class="bk-item"><span class="bk-src">No breaking items in the last 6 hours.</span></span>`; track.style.animation = "none"; lastSig = sig; return; }
    const html = items.map(itemHTML).join("");
    items.forEach((i) => seen.add(i.id));
    lastSig = sig;
    // Two copies side by side make the crawl loop seamlessly
    track.innerHTML = html + html;
    const width = track.scrollWidth / 2;
    track.style.setProperty("--bk-dist", `-${width}px`);
    track.style.animation = "none"; void track.offsetWidth;
    track.style.animation = `bk-crawl ${Math.max(30, width / SPEED)}s linear infinite`;
  }

  $(".bk-track").addEventListener("click", (e) => {
    const el = e.target.closest(".bk-item"); if (!el) return;
    if (el.dataset.url) return window.open(el.dataset.url, "_blank", "noopener");
    // Alerts without a link: show where it happened on the map
    const a = (state.alerts || []).find((x) => `a:${x.id}` === el.dataset.id);
    if (a?.lat != null && window.GST.maps[a.zone]) {
      const panel = window.GST.panelFor(a.zone);
      if (panel && window.GST.panelZone[panel.id] !== a.zone) window.GST.showZone(panel, a.zone);
      window.GST.maps[a.zone].flyTo([a.lat, a.lon], 11);
    }
  });

  setInterval(render, 5000);
  setTimeout(render, 1500);
})();
