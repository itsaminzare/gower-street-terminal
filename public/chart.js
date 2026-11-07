// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Enlarged instrument chart: click a ticker tile -> candles/line, volume, crosshair readout,
// period statistics, and desk events (alerts, incident news, official statements) as markers.
(() => {
  const $ = (s) => document.querySelector(s);
  const { state, esc, ago } = window.GST;
  const LWC = window.LightweightCharts;
  const UP = "#3ad17a", DOWN = "#ff4d4d", AMBER = "#ffa028";
  const EV_COLOR = { alert: "#ff3b3b", official: "#4fa3ff", news: AMBER };

  let chart, priceSeries, volSeries, current = { sym: null, range: "1d", type: "candle", data: null };

  const fmt = (v, d) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const dp = (p) => (Math.abs(p) < 10 ? 3 : 2);
  const vol = (v) => (v == null ? "–" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(v));
  const utc = (t, withDate = true) => { const d = new Date(t * 1000).toISOString(); return withDate ? d.slice(0, 10) + " " + d.slice(11, 16) + "Z" : d.slice(11, 16) + "Z"; };
  const signed = (v, d) => (v >= 0 ? "+" : "") + fmt(v, d);

  function build() {
    chart = LWC.createChart($("#cm-chart"), {
      autoSize: true,
      layout: { background: { type: "solid", color: "#0a0a0a" }, textColor: "#9a9a9a", fontFamily: "Consolas, Menlo, monospace", fontSize: 11 },
      grid: { vertLines: { color: "#161616" }, horzLines: { color: "#161616" } },
      rightPriceScale: { borderColor: "#262626", scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: "#262626", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: LWC.CrosshairMode.Normal, vertLine: { color: "#555", labelBackgroundColor: "#333" }, horzLine: { color: "#555", labelBackgroundColor: "#333" } },
      localization: { timeFormatter: (t) => utc(t) },
    });
    chart.subscribeCrosshairMove(onCrosshair);
  }

  function setSeries() {
    if (priceSeries) chart.removeSeries(priceSeries);
    if (volSeries) chart.removeSeries(volSeries);
    priceSeries = current.type === "candle"
      ? chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN })
      : chart.addAreaSeries({ lineColor: AMBER, lineWidth: 2, topColor: "rgba(255,160,40,0.25)", bottomColor: "rgba(255,160,40,0.0)" });
    // Volume sits in its own strip under the price pane (own scale, not overlaid on price)
    volSeries = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false });
  }

  function render() {
    const d = current.data;
    const c = d.candles;
    setSeries();
    const decimals = dp(d.meta.price || c.at(-1)?.close || 1);
    priceSeries.applyOptions({ priceFormat: { type: "price", precision: decimals, minMove: 1 / 10 ** decimals } });
    if (current.type === "candle") priceSeries.setData(c.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    else priceSeries.setData(c.map(({ time, close }) => ({ time, value: close })));
    volSeries.setData(c.map((k) => ({ time: k.time, value: k.volume, color: k.close >= k.open ? "rgba(58,209,122,0.35)" : "rgba(255,77,77,0.35)" })));
    if (d.meta.prevClose && current.range === "1d") {
      priceSeries.createPriceLine({ price: d.meta.prevClose, color: "#666", lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: "prev close" });
    }
    const events = collectEvents(c);
    // One marker per bar per event type, labelled with a count when several land on the same bar
    const groups = new Map();
    for (const e of events) { const k = `${e.bar}|${e.kind}`; groups.set(k, { ...e, n: (groups.get(k)?.n || 0) + 1 }); }
    priceSeries.setMarkers($("#cm-events").checked ? [...groups.values()].sort((a, b) => a.bar - b.bar).map((g) => ({
      time: g.bar, position: g.kind === "alert" ? "aboveBar" : "belowBar", color: EV_COLOR[g.kind],
      shape: g.kind === "alert" ? "arrowDown" : "circle", text: g.n > 1 ? String(g.n) : "",
    })) : []);
    chart.timeScale().fitContent();
    $("#cm-msg").textContent = c.length ? "" : "No data for this range.";
    renderStats(d);
    renderEvents(events);
    showReadout(c.at(-1), c.at(-2));
  }

  // Desk events within the chart window, snapped to the bar they fall in
  function collectEvents(c) {
    if (!c.length) return [];
    const start = c[0].time, end = c.at(-1).time + 86400 * 7;
    const ev = [];
    for (const a of state.alerts) if (a.severity !== "info" && a.kind !== "price-move") ev.push({ kind: "alert", t: Date.parse(a.time) / 1000, title: a.title, url: a.url, src: a.source });
    for (const s of state.official || []) if (s.incident) ev.push({ kind: "official", t: Date.parse(s.published) / 1000, title: `${s.org}: ${s.title}`, url: s.url, src: s.via ? `via ${s.via}` : "direct" });
    for (const n of state.news) if (n.incident && n.region !== "GLOBAL") ev.push({ kind: "news", t: Date.parse(n.published) / 1000, title: n.title, url: n.url, src: n.source });
    const out = [];
    for (const e of ev) {
      if (e.t < start || e.t > end) continue;
      let lo = 0, hi = c.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c[mid].time <= e.t) lo = mid; else hi = mid - 1; }
      out.push({ ...e, bar: c[lo].time });
    }
    return out.sort((a, b) => a.bar - b.bar || a.t - b.t);
  }

  function renderStats(d) {
    const c = d.candles, m = d.meta;
    const rows = [];
    const add = (k, v, cls = "") => rows.push(`<tr><td>${k}</td><td class="${cls}">${v}</td></tr>`);
    const p = dp(m.price || 1);
    add("Last", fmt(m.price, p));
    add("Prev close", fmt(m.prevClose, p));
    add("Day change", `${signed(m.price - m.prevClose, p)} (${signed(((m.price - m.prevClose) / m.prevClose) * 100, 2)}%)`, m.price >= m.prevClose ? "up" : "down");
    add("Day range", `${fmt(m.dayLow, p)} – ${fmt(m.dayHigh, p)}`);
    add("52-week range", `${fmt(m.low52, p)} – ${fmt(m.high52, p)}`);
    if (m.high52 && m.low52) add("Position in 52W", `${(((m.price - m.low52) / (m.high52 - m.low52)) * 100).toFixed(0)}%`);
    add("Day volume", vol(m.volume));
    if (c.length) {
      const first = c[0], last = c.at(-1);
      const hiBar = c.reduce((a, b) => (b.high > a.high ? b : a)), loBar = c.reduce((a, b) => (b.low < a.low ? b : a));
      const chg = last.close - first.open;
      rows.push(`<tr><td colspan="2" style="color:var(--amber);padding-top:8px">THIS WINDOW (${current.range.toUpperCase()}, ${d.interval} bars)</td></tr>`);
      add("Change", `${signed(chg, p)} (${signed((chg / first.open) * 100, 2)}%)`, chg >= 0 ? "up" : "down");
      add("High", `${fmt(hiBar.high, p)} <span class="muted">${utc(hiBar.time)}</span>`);
      add("Low", `${fmt(loBar.low, p)} <span class="muted">${utc(loBar.time)}</span>`);
      add("Range", `${(((hiBar.high - loBar.low) / loBar.low) * 100).toFixed(2)}%`);
      const vols = c.map((k) => k.volume).filter(Boolean);
      if (vols.length) add("Avg volume / bar", vol(Math.round(vols.reduce((a, b) => a + b, 0) / vols.length)));
      const rets = c.slice(1).map((k, i) => Math.log(k.close / c[i].close));
      if (rets.length > 5) {
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
        const ann = { "1d": 252, "1wk": 52 }[d.interval];
        add(ann ? "Realized vol (ann.)" : "Std dev / bar", ann ? `${(sd * Math.sqrt(ann) * 100).toFixed(1)}%` : `${(sd * 100).toFixed(3)}%`);
      }
      add("Bars", c.length);
    }
    rows.push(`<tr><td colspan="2" class="muted" style="padding-top:8px">${esc(m.exchange || "")} · ${esc(m.currency || "")} · as of ${utc(Date.parse(m.time) / 1000)} · delayed quote via ${esc(d.source || "Yahoo Finance")}</td></tr>`);
    $("#cm-stats").innerHTML = rows.join("");
  }

  function renderEvents(events) {
    $("#cm-events-list").innerHTML = events.length ? [...events].reverse().map((e) => `
      <div class="ev"><span class="tag ${e.kind}">${e.kind.toUpperCase()}</span><span class="when">${utc(e.t)} · ${ago(e.t * 1000)} ago · ${esc(e.src || "")}</span>
      <div>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</div></div>`).join("")
      : `<div class="muted">No desk events in this window. Markers appear here for incident alerts (▼ red), official statements on incidents (● blue) and incident headlines (● amber).</div>`;
  }

  function showReadout(k, prev) {
    if (!k) { $("#cm-readout").textContent = ""; return; }
    const p = dp(k.close);
    const ch = prev ? k.close - prev.close : null;
    $("#cm-readout").innerHTML = `${utc(k.time)} &nbsp; O <b>${fmt(k.open, p)}</b> H <b>${fmt(k.high, p)}</b> L <b>${fmt(k.low, p)}</b> C <b class="${k.close >= k.open ? "up" : "down"}">${fmt(k.close, p)}</b>` +
      (ch != null ? ` <span class="${ch >= 0 ? "up" : "down"}">${signed(ch, p)}</span>` : "") + ` &nbsp; VOL <b>${vol(k.volume)}</b>`;
  }

  function onCrosshair(param) {
    const c = current.data?.candles;
    if (!c?.length) return;
    if (!param.time) return showReadout(c.at(-1), c.at(-2));
    const i = c.findIndex((k) => k.time === param.time);
    if (i >= 0) showReadout(c[i], c[i - 1]);
  }

  async function load() {
    $("#cm-msg").textContent = "Loading…";
    try {
      const r = await fetch(`/api/chart?sym=${encodeURIComponent(current.sym)}&range=${current.range}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.status);
      current.data = d;
      const m = d.meta, p = dp(m.price || 1), ch = m.price - m.prevClose;
      $("#cm-title").textContent = `${d.label} — ${m.name}`;
      $("#cm-sub").textContent = `${d.sym} · ${d.unit} · ${m.exchange || ""} · times in UTC`;
      $("#cm-quote").innerHTML = `${fmt(m.price, p)}<small class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${fmt(Math.abs(ch), p)} (${signed((ch / m.prevClose) * 100, 2)}%)</small>`;
      render();
    } catch (e) {
      $("#cm-msg").textContent = `Could not load chart: ${e.message}`;
    }
  }

  function open(sym) {
    current.sym = sym;
    $("#chart-modal").hidden = false;
    if (!chart) build();
    load();
  }
  function close() { $("#chart-modal").hidden = true; }

  $("#ticker").addEventListener("click", (e) => { const t = e.target.closest(".tick[data-sym]"); if (t) open(t.dataset.sym); });
  $("#cm-close").addEventListener("click", close);
  $("#chart-modal").addEventListener("click", (e) => { if (e.target.id === "chart-modal") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#chart-modal").hidden) close(); });
  $("#cm-range").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $("#cm-range").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    current.range = b.dataset.r; load();
  });
  $("#cm-type").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $("#cm-type").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    current.type = b.dataset.t; if (current.data) render();
  });
  $("#cm-events").addEventListener("change", () => current.data && render());
  // Keep the open chart fresh while the modal is up
  setInterval(() => { if (!$("#chart-modal").hidden && current.range === "1d") load(); }, 60_000);
})();
