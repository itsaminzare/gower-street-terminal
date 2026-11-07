// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Tool windows: transit FLOWS, futures CURVE, disruption SCENARIO calculator, phone ALERTS settings.
(() => {
  const $ = (s) => document.querySelector(s);
  const { state, esc, hhmm } = window.GST;
  const LWC = window.LightweightCharts;
  const AMBER = "#ffa028", BLUE = "#4fa3ff", MUTED = "#7a7a7a";
  let charts = [];

  function open(kind) {
    charts.forEach((c) => c.remove()); charts = [];
    $("#tool-modal").hidden = false;
    $("#tm-body").innerHTML = `<div class="muted" style="padding:20px">Loading…</div>`;
    ({ flows: openFlows, curve: openCurve, scenario: openScenario, settings: openSettings })[kind]();
  }
  function close() { $("#tool-modal").hidden = true; charts.forEach((c) => c.remove()); charts = []; }
  function head(title, sub) { $("#tm-title").textContent = title; $("#tm-sub").textContent = sub || ""; }

  $("#tools").addEventListener("click", (e) => { const b = e.target.closest("button[data-open]"); if (b) open(b.dataset.open); });
  $("#spreads").addEventListener("click", () => open("curve"));
  $("#tm-close").addEventListener("click", close);
  $("#tool-modal").addEventListener("click", (e) => { if (e.target.id === "tool-modal") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#tool-modal").hidden) close(); });

  const baseChart = (el) => LWC.createChart(el, {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0a0a0a" }, textColor: "#9a9a9a", fontFamily: "Consolas, Menlo, monospace", fontSize: 10 },
    grid: { vertLines: { color: "#151515" }, horzLines: { color: "#151515" } },
    rightPriceScale: { borderColor: "#262626" },
    timeScale: { borderColor: "#262626", rightOffset: 0, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: true },
    crosshair: { mode: LWC.CrosshairMode.Magnet },
  });

  // ---------------------------------------------------------------- FLOWS
  const ZNAME = { HORMUZ: "Strait of Hormuz", BAB: "Bab el-Mandeb", SUEZ: "Suez Canal", CAPE: "Cape of Good Hope" };
  async function openFlows() {
    head("CHOKEPOINT FLOWS", "Daily tanker transits · IMF PortWatch (UN Global Platform satellite AIS) + this terminal's own gate counts");
    const d = await fetch("/api/flows").then((r) => r.json());
    const imf = d.imf?.series || {}, sum = d.summary || {};
    const ownDays = Object.keys(d.own || {}).sort();
    const rows = ["HORMUZ", "BAB", "SUEZ", "CAPE"].map((z) => {
      const s = sum[z], l = d.last24h?.[z] || {};
      const pct = s?.tankerChangePct;
      return `<tr><td class="z">${ZNAME[z]}</td>
        <td>${s ? s.tanker7d : "–"}</td><td>${s ? s.tanker90d : "–"}</td>
        <td class="${pct == null ? "" : pct < 0 ? "down" : "up"}">${pct == null ? "–" : (pct > 0 ? "+" : "") + pct + "%"}</td>
        <td>${s ? s.lastDate : "–"}</td><td>${l.tankerTransits24h ?? "–"} / ${l.transits24h ?? "–"}</td>
        <td>${Object.entries(l.byDir || {}).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ") || "–"}</td></tr>`;
    }).join("");
    const imfMsg = d.status?.ok ? `IMF data updated ${hhmm(d.status.updated)} (${d.status.updated.slice(0, 10)}).`
      : `<span class="warn">IMF PortWatch is not available right now (${esc(d.status?.error || "loading")}). Its public API is heavily rate-limited during the crisis; the terminal keeps retrying${d.status?.nextTry ? ` (next try ${hhmm(d.status.nextTry)})` : ""} and caches the data once it arrives. Charts below show this terminal's own counts meanwhile.</span>`;
    $("#tm-body").innerHTML = `
      <table class="tbl"><thead><tr><th>Chokepoint</th><th>IMF tankers/day, last 7d</th><th>IMF prior 90d avg</th><th>Change</th><th>IMF data to</th><th>Own gate count 24h (tankers / all)</th><th>Direction, 24h</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="note">${imfMsg} ${d.demo ? '<span class="warn">Own counts are from SIMULATED demo vessels.</span>' : ""} IMF counts every ship crossing the chokepoint boundary, deduplicated over 48h. This terminal's own counts only cover ships its AIS feed sees crossing the gate line drawn on each map.</div>
      <div class="multi">${["HORMUZ", "BAB", "SUEZ", "CAPE"].map((z) => `<div class="mchart"><div class="mt">${ZNAME[z]} <span class="muted">· tanker transits per day${imf[z] ? " (IMF) with 7-day average" : " (own count)"}</span></div><div class="mc" id="fc-${z}"></div></div>`).join("")}</div>
      <div class="note">Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org). Own counts: aisstream.io AIS.</div>`;
    for (const z of ["HORMUZ", "BAB", "SUEZ", "CAPE"]) {
      const c = baseChart($(`#fc-${z}`)); charts.push(c);
      if (imf[z]?.days?.length) {
        const days = imf[z].days;
        c.addHistogramSeries({ color: "rgba(255,160,40,0.45)", priceLineVisible: false, lastValueVisible: false })
          .setData(days.map((x) => ({ time: x.date, value: x.tanker })));
        const ma = days.map((x, i) => ({ time: x.date, value: +(days.slice(Math.max(0, i - 6), i + 1).reduce((a, b) => a + b.tanker, 0) / Math.min(i + 1, 7)).toFixed(1) }));
        c.addLineSeries({ color: AMBER, lineWidth: 2, priceLineVisible: false }).setData(ma);
      } else {
        const data = ownDays.map((day) => ({ time: day, value: d.own[day]?.[z]?.tanker || 0 }));
        c.addHistogramSeries({ color: "rgba(79,163,255,0.6)", priceLineVisible: false }).setData(data);
        if (!data.length) $(`#fc-${z}`).insertAdjacentHTML("beforeend", `<div class="cm-msg">No data yet</div>`);
      }
      c.timeScale().fitContent();
    }
  }

  // ---------------------------------------------------------------- CURVE
  async function openCurve() {
    head("FUTURES CURVE & SPREADS", "Brent and WTI monthly futures contracts · delayed");
    const cv = await fetch("/api/curve").then((r) => r.json());
    if (!cv.brent?.length) { $("#tm-body").innerHTML = `<div class="empty">Curve not available yet: ${esc(cv.error || "loading")}</div>`; return; }
    const sp = cv.spreads || {};
    $("#tm-body").innerHTML = `
      <div class="curve-wrap"><svg id="curve-svg"></svg><div id="curve-tip" class="ctip" hidden></div></div>
      <div class="legend"><span><i style="background:${AMBER}"></i>Brent today</span><span><i class="dash" style="border-color:${AMBER}"></i>Brent ~1 month ago</span><span><i style="background:${BLUE}"></i>WTI today</span><span><i class="hollow"></i>Stale print (excluded from spreads)</span></div>
      <table class="tbl"><thead><tr><th>Spread</th><th>Now</th><th>Day change</th><th>Legs</th><th>What it tells you</th></tr></thead><tbody>
      ${Object.values(sp).map((s) => `<tr><td class="z">${esc(s.name)}</td><td><b>${s.value >= 0 ? "+" : ""}${s.value.toFixed(2)}</b> ${esc(s.unit)}</td>
        <td class="${(s.change ?? 0) >= 0 ? "up" : "down"}">${s.change == null ? "–" : (s.change >= 0 ? "+" : "") + s.change.toFixed(2)}</td><td class="muted">${s.legs.map(esc).join(" − ")}</td><td>${esc(s.note)}</td></tr>`).join("")}
      </tbody></table>
      <div class="note">Source: ${esc(cv.source || "Yahoo Finance")}, delayed. A downward-sloping curve (front month above later months) is <b>backwardation</b>: buyers pay up for prompt barrels, the classic sign of a supply scare. Updated ${cv.updated ? hhmm(cv.updated) : "–"}.</div>`;
    drawCurve(cv);
  }
  function drawCurve(cv) {
    const svg = $("#curve-svg"), W = svg.clientWidth || 900, H = svg.clientHeight || 300;
    const pad = { l: 50, r: 16, t: 14, b: 34 };
    const n = Math.max(cv.brent.length, cv.wti.length);
    const all = [...cv.brent.flatMap((c) => [c.price, c.monthAgo]), ...cv.wti.map((c) => c.price)].filter((v) => v != null);
    const mn = Math.floor(Math.min(...all) - 1), mx = Math.ceil(Math.max(...all) + 1);
    const x = (i) => pad.l + (i / Math.max(n - 1, 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - mn) / (mx - mn)) * (H - pad.t - pad.b);
    const path = (arr, key) => arr.map((c, i) => (c[key] == null ? null : `${x(i)},${y(c[key])}`)).filter(Boolean).join(" ");
    const ticks = [];
    for (let k = 0; k <= 5; k++) { const v = mn + ((mx - mn) * k) / 5; ticks.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#1a1a1a"/><text x="${pad.l - 6}" y="${y(v) + 3}" text-anchor="end" fill="${MUTED}" font-size="10">${v.toFixed(0)}</text>`); }
    const labels = cv.brent.map((c, i) => (i % 2 === 0 ? `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" fill="${MUTED}" font-size="10">${esc(c.label)}</text>` : "")).join("");
    const dots = (arr, color) => arr.map((c, i) => `<circle cx="${x(i)}" cy="${y(c.price)}" r="${c.suspect ? 4 : 3}" fill="${c.suspect ? "#0a0a0a" : color}" stroke="${color}" stroke-width="1.5"/>`).join("");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `${ticks.join("")}${labels}<text x="12" y="${pad.t + 4}" fill="${MUTED}" font-size="10">$/bbl</text>
      <polyline points="${path(cv.brent, "monthAgo")}" fill="none" stroke="${AMBER}" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="5 4"/>
      <polyline points="${path(cv.wti, "price")}" fill="none" stroke="${BLUE}" stroke-width="2"/>
      <polyline points="${path(cv.brent, "price")}" fill="none" stroke="${AMBER}" stroke-width="2"/>
      ${dots(cv.wti, BLUE)}${dots(cv.brent, AMBER)}
      <line id="cx" y1="${pad.t}" y2="${H - pad.b}" stroke="#555" visibility="hidden"/>
      <rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent" id="chit"/>`;
    const tip = $("#curve-tip");
    svg.querySelector("#chit").addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) * (W / r.width) - pad.l) / ((W - pad.l - pad.r) / Math.max(n - 1, 1)))));
      const b = cv.brent[i], w = cv.wti[i];
      svg.querySelector("#cx").setAttribute("x1", x(i)); svg.querySelector("#cx").setAttribute("x2", x(i)); svg.querySelector("#cx").setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 190)}px`; tip.style.top = `${e.clientY - r.top + 10}px`;
      tip.innerHTML = `<b>${esc(b?.label || w?.label || "")}</b> (M${i + 1})<br>` +
        (b ? `Brent ${b.price.toFixed(2)}${b.monthAgo != null ? ` <span class="muted">(1m ago ${b.monthAgo.toFixed(2)})</span>` : ""}${b.suspect ? ' <span class="warn">stale?</span>' : ""}<br>` : "") +
        (w ? `WTI ${w.price.toFixed(2)}<br>` : "") + (b && w ? `Brent–WTI ${(b.price - w.price).toFixed(2)}` : "");
    });
    svg.querySelector("#chit").addEventListener("mouseleave", () => { tip.hidden = true; svg.querySelector("#cx").setAttribute("visibility", "hidden"); });
  }

  // ---------------------------------------------------------------- SCENARIO
  // Defaults are public estimates (EIA World Oil Transit Chokepoints; IEA). All editable.
  const DEF = {
    hormuzFlow: 20.0,  // mb/d crude + products through Hormuz (EIA, 2024)
    babFlow: 4.0,      // mb/d through Bab el-Mandeb after 2024 diversions (EIA; ~8.7 in 2023)
    saudiBypass: 2.0,  // spare on Saudi East-West pipeline to Yanbu (5 mb/d capacity, convertible to 7)
    uaeBypass: 0.6,    // spare on UAE Habshan–Fujairah pipeline (~1.5–1.8 mb/d capacity)
    iranBypass: 0.3,   // Iran Goreh–Jask (Iranian barrels only)
    stocks: 2.0,       // coordinated IEA/strategic stock release, mb/d
    demand: 104,       // world oil demand, mb/d
    capeDays: 12,      // extra voyage days Gulf→Europe via the Cape vs Suez
  };
  function openScenario() {
    head("DISRUPTION SCENARIO", "What-if calculator · illustrative, built on public EIA/IEA estimates · every input is editable");
    const brent = state.prices["BZ=F"]?.price;
    const num = (id, label, v, step = 0.1, hint = "") => `<label><span>${label}${hint ? ` <i class="muted">${hint}</i>` : ""}</span><input type="number" id="sc-${id}" value="${v}" step="${step}"></label>`;
    $("#tm-body").innerHTML = `<div class="scen">
      <form id="sc-form" class="sc-in">
        <div class="sec">SCENARIO</div>
        <label><span>Chokepoint</span><select id="sc-which"><option value="HORMUZ">Strait of Hormuz</option><option value="BAB">Bab el-Mandeb</option><option value="BOTH">Both</option></select></label>
        <label><span>Flow disrupted <b id="sc-pctv">50%</b></span><input type="range" id="sc-pct" min="0" max="100" value="50"></label>
        ${num("days", "Duration (days)", 30, 1)}
        <div class="sec">FLOWS (mb/d)</div>
        ${num("hormuzFlow", "Hormuz normal flow", DEF.hormuzFlow, 0.5, "EIA ~20")}
        ${num("babFlow", "Bab el-Mandeb flow", DEF.babFlow, 0.5, "EIA ~4 post-2024")}
        <div class="sec">OFFSETS (mb/d)</div>
        ${num("saudiBypass", "Saudi East-West spare", DEF.saudiBypass, 0.1, "to Yanbu")}
        ${num("uaeBypass", "UAE Habshan–Fujairah spare", DEF.uaeBypass)}
        ${num("iranBypass", "Iran Goreh–Jask", DEF.iranBypass)}
        ${num("stocks", "Strategic stock release", DEF.stocks)}
        <div class="sec">MARKET</div>
        ${num("demand", "World demand (mb/d)", DEF.demand, 1)}
        ${num("brent", "Brent now ($/bbl)", brent ? brent.toFixed(2) : 90, 0.5)}
        ${num("capeDays", "Extra days via Cape", DEF.capeDays, 1)}
      </form>
      <div class="sc-out" id="sc-out"></div></div>`;
    const calc = () => {
      const g = (id) => +$(`#sc-${id}`).value || 0;
      const which = $("#sc-which").value, pct = g("pct") / 100, days = g("days");
      $("#sc-pctv").textContent = `${Math.round(pct * 100)}%`;
      const hz = which !== "BAB" ? g("hormuzFlow") * pct : 0;
      const bab = which !== "HORMUZ" ? g("babFlow") * pct : 0;
      // Hormuz barrels are physically stranded; Bab barrels mostly reroute via the Cape (delayed, not lost)
      const bypass = which !== "BAB" ? Math.min(hz, g("saudiBypass") + g("uaeBypass") + g("iranBypass")) : 0;
      const stocks = g("stocks");
      const lost = Math.max(0, hz - bypass);
      const net = Math.max(0, lost - stocks);
      const netPct = (net / g("demand")) * 100;
      const cum = net * days; // million barrels
      const onWater = bab * g("capeDays"); // mb tied up on longer voyages
      // Illustrative price response: shortfall % divided by a short-run elasticity band (0.15 – 0.07)
      const lo = g("brent") * (1 + netPct / 100 / 0.15), hi = g("brent") * (1 + netPct / 100 / 0.07);
      const lng = which !== "BAB" ? 20 * pct : 0;
      const bar = (v, max, col) => `<div class="bar"><i style="width:${Math.min(100, (v / Math.max(max, 0.01)) * 100)}%;background:${col}"></i></div>`;
      const gross = hz + bab;
      $("#sc-out").innerHTML = `
        <div class="kpis">
          <div class="kpi"><div class="k">NET SUPPLY SHORTFALL</div><div class="v ${net > 0 ? "down" : ""}">${net.toFixed(1)} <small>mb/d</small></div><div class="s">${netPct.toFixed(1)}% of world demand</div></div>
          <div class="kpi"><div class="k">BARRELS LOST OVER ${days} DAYS</div><div class="v">${cum.toFixed(0)} <small>mn bbl</small></div><div class="s">after bypass pipelines and stock release</div></div>
          <div class="kpi"><div class="k">ILLUSTRATIVE BRENT</div><div class="v">${net > 0 ? `$${lo.toFixed(0)}–${hi.toFixed(0)}` : `~$${g("brent").toFixed(0)}`}</div><div class="s">${net > 0 ? `from $${g("brent").toFixed(0)}; short-run elasticity 0.15–0.07` : "no net shortfall"}</div></div>
        </div>
        <div class="sec">WATERFALL (mb/d)</div>
        <table class="tbl wf"><colgroup><col style="width:42%"><col style="width:70px"><col></colgroup>
          <tr><td>Flow disrupted</td><td>${gross.toFixed(1)}</td><td>${bar(gross, gross, "#ff7a1a")}</td></tr>
          ${bab ? `<tr><td>&nbsp; of which Bab el-Mandeb, rerouted via the Cape</td><td>−${bab.toFixed(1)}</td><td>${bar(bab, gross, BLUE)}</td></tr>` : ""}
          ${hz ? `<tr><td>&nbsp; Hormuz bypass pipelines</td><td>−${bypass.toFixed(1)}</td><td>${bar(bypass, gross, "#3ad17a")}</td></tr>` : ""}
          <tr><td>&nbsp; Strategic stock release</td><td>−${Math.min(stocks, lost).toFixed(1)}</td><td>${bar(Math.min(stocks, lost), gross, "#3ad17a")}</td></tr>
          <tr class="tot"><td>Net shortfall</td><td>${net.toFixed(1)}</td><td>${bar(net, gross, "#ff3b3b")}</td></tr>
        </table>
        <div class="sec">KNOCK-ON EFFECTS</div>
        <ul>
          ${bab ? `<li><b>${onWater.toFixed(0)} mn bbl</b> extra oil tied up on longer voyages via the Cape (${g("capeDays")} more days). Tanker demand and freight rates rise; European arrivals are delayed about two weeks.</li>` : ""}
          ${lng ? `<li>About <b>${lng.toFixed(0)}% of global LNG trade</b> (Qatar, UAE) is disrupted. Hormuz LNG has no pipeline bypass, so expect a sharp move in TTF and JKM gas prices.</li>` : ""}
          ${hz ? `<li>Bypass pipelines offset only <b>${hz ? ((bypass / hz) * 100).toFixed(0) : 0}%</b> of disrupted Hormuz flow. Iraq, Kuwait, Qatar and Bahrain have no meaningful alternative export route.</li>` : ""}
          <li>Strategic stocks at ${stocks.toFixed(1)} mb/d would last about ${(1200 / Math.max(stocks, 0.1)).toFixed(0)} days against the ~1.2 bn bbl of government-held IEA stocks.</li>
          <li>Watch: Brent M1–M6 backwardation, Brent–Dubai, VLCC freight (TD3C), war-risk premiums, and the Cape traffic counts on the FLOWS screen.</li>
        </ul>
        <div class="note">Illustrative only, not a forecast. Real outcomes depend on duration expectations, OPEC+ spare capacity outside the Gulf, demand destruction and policy. Defaults: EIA <i>World Oil Transit Chokepoints</i>, IEA emergency stock data.</div>`;
    };
    $("#sc-form").addEventListener("input", calc);
    calc();
  }

  // ---------------------------------------------------------------- ALERTS / settings
  async function openSettings() {
    head("PHONE ALERTS & DATA SOURCES", "Configure in .env and restart the terminal");
    const st = state.status || {};
    const n = st.notify || {};
    const pill = (ok, txt) => `<span class="pill ${ok ? "ok" : "bad"}">${txt}</span>`;
    $("#tm-body").innerHTML = `<div class="settings">
      <div class="sec">PHONE ALERTS</div>
      <p>Status: ${n.channels?.length ? pill(!n.lastError, `ON via ${n.channels.join(" + ")}`) + ` · minimum severity <b>${esc(n.minSeverity)}</b> · ${n.sent || 0} sent${n.lastError ? ` · last error: ${esc(n.lastError)}` : ""}` : pill(false, "OFF")}</p>
      <button id="notify-test" ${n.channels?.length ? "" : "disabled"}>SEND TEST NOTIFICATION</button> <span id="notify-res" class="muted"></span>
      <div class="cols">
        <div><b>Option A: ntfy (simplest, no account)</b><ol>
          <li>Install the free <b>ntfy</b> app (iOS / Android).</li>
          <li>Subscribe to a hard-to-guess topic name, e.g. <code>gower-yourname-8431</code>.</li>
          <li>Add <code>NTFY_TOPIC=gower-yourname-8431</code> to <code>.env</code>.</li></ol>
          <p class="muted">Topics on ntfy.sh are public to anyone who knows the name, so pick an unguessable one.</p></div>
        <div><b>Option B: Telegram bot</b><ol>
          <li>In Telegram, message <b>@BotFather</b> → <code>/newbot</code> → copy the token.</li>
          <li>Send your new bot any message, then open <code>api.telegram.org/bot&lt;token&gt;/getUpdates</code> to find your chat id.</li>
          <li>Add <code>TELEGRAM_BOT_TOKEN=…</code> and <code>TELEGRAM_CHAT_ID=…</code> to <code>.env</code>.</li></ol></div>
      </div>
      <p>Optional: <code>NOTIFY_MIN_SEVERITY=warning</code> to also get warnings (default: critical only). Alerts arriving close together are batched into one message.</p>
      <div class="sec">DATA SOURCES</div>
      <table class="tbl">
        <tr><td>AIS ship positions</td><td>${st.ais?.mode === "demo" ? pill(false, "DEMO (simulated)") : pill(st.ais?.connected, st.ais?.connected ? "LIVE" : "OFFLINE")}</td><td>aisstream.io · <code>AISSTREAM_API_KEY</code></td></tr>
        <tr><td>OFAC sanctioned vessels</td><td>${pill(st.sanctions?.ok, `${st.sanctions?.vessels || 0} vessels`)}</td><td>US Treasury SDN list, refreshed daily</td></tr>
        <tr><td>IMF PortWatch transits</td><td>${pill(st.flows?.ok, st.flows?.ok ? "OK" : "WAITING")}</td><td>${esc(st.flows?.error || "")}</td></tr>
        <tr><td>Futures curve</td><td>${pill(st.curve?.ok, st.curve?.ok ? "OK" : "WAITING")}</td><td>${esc(st.prices?.source || "Yahoo Finance")}, delayed</td></tr>
        <tr><td>AI analyst + chat</td><td>${pill(st.analyst?.enabled, st.analyst?.enabled ? "ON" : "OFF")}</td><td><code>ANTHROPIC_API_KEY</code></td></tr>
      </table></div>`;
    $("#notify-test")?.addEventListener("click", async () => {
      $("#notify-res").textContent = "sending…";
      const r = await fetch("/api/notify/test", { method: "POST" }).then((x) => x.json());
      $("#notify-res").textContent = r.error ? `Error: ${r.error}` : "Sent. Check your phone.";
    });
  }
})();
