// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// RESEARCH (historical event study + out-of-sample test) and the RED SEA 2023-24 crisis replay.
(() => {
  const $ = (s) => document.querySelector(s);
  const G = window.GST;
  const { esc } = G;
  const AMBER = "#ffa028", BLUE = "#4fa3ff", GREEN = "#3fcf8e", MUTED = "#7a7a7a";
  let R = null;
  const getResearch = async () => (R ||= await fetch("/api/research").then((r) => { if (!r.ok) throw new Error("research data missing"); return r.json(); }));
  const sgn = (x, d = 2) => (x == null ? "–" : (x > 0 ? "+" : "") + Number(x).toFixed(d));
  const cls = (x) => (x == null ? "" : x > 0 ? "up" : x < 0 ? "down" : "");
  const NAME = { BRENT: "Brent", WTI: "WTI", BRENT_WTI: "Brent–WTI", CRACK: "3-2-1 crack", FRO: "Frontline", STNG: "Scorpio Tk", DHT: "DHT", GOLD: "Gold", ULSD: "ULSD", RBOB: "RBOB" };
  const FAM = { shipping: "Attacks on / seizures of ships, route suspensions", escalation: "State strikes, escalation, oil-infrastructure attacks" };
  const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

  // ---------------------------------------------------------------- RESEARCH
  async function openResearch() {
    G.toolHead("EVENT STUDY & BACKTEST", "How prices moved after 20 Gulf / Red Sea incidents since 2019 · out-of-sample rule test · the AI desk on the same incidents · all after costs");
    let r;
    try { r = await getResearch(); } catch (e) { $("#tm-body").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const S = r.stats, B = r.baseline, u = (k) => r.units[k];
    const cell = (s, k) => (s ? `<td class="${cls(s.median)}" title="mean ${sgn(s.mean)} · sd ${s.sd ?? "–"} · t vs all days ${s.t ?? "–"}"><b>${sgn(s.median)}</b><small>${s.up} of ${s.n} up</small></td>` : "<td>–</td>");
    const COLS = [["BRENT", 1], ["BRENT", 5], ["BRENT", 20], ["CRACK", 5], ["BRENT_WTI", 5], ["FRO", 5], ["STNG", 5], ["GOLD", 5]];
    const row = (label, g, extra = "") => `<tr><td class="z">${label}${extra}</td>${COLS.map(([k, h]) => cell(g[k]?.[h], k)).join("")}</tr>`;
    const baseRow = `<tr class="base"><td class="z">Every day since 2019 <small>(baseline)</small></td>${COLS.map(([k, h]) => `<td title="sd ${B[k][h].sd}"><b>${sgn(B[k][h].mean)}</b><small>mean · ${Math.round(B[k][h].up * 100)}% of days up</small></td>`).join("")}</tr>`;
    const fam = Object.entries(S.family).map(([f, g]) => row(`<b>${f === "shipping" ? "Shipping incidents" : "Escalation"}</b>`, g, `<br><small class="muted">${FAM[f]}</small>`)).join("");
    const kinds = Object.entries(S.kind).map(([k, g]) => row(`&nbsp;&nbsp;${esc(r.kindLabel[k])}`, g)).join("");
    const civ = (c) => (c ? `<small>90% CI ${sgn(c[0])} to ${sgn(c[1])}</small>` : "");
    const wf = r.walkForward.map((w) => {
      // "Held up" only if the bootstrap interval of the edge over buy-and-hold excludes zero and the rule made money after costs
      const holds = w.edgeVsLongCI90 && w.edgeVsLongCI90[0] > 0 && w.avgPnl > 0;
      return `<tr><td class="z">${NAME[w.inst]} over ${w.h} trading day${w.h > 1 ? "s" : ""}</td><td>${w.hits}/${w.n} <small>p = ${w.pHits}</small></td>
        <td class="${cls(w.avgPnl)}"><b>${sgn(w.avgPnl)}</b> ${w.unit}${civ(w.avgPnlCI90)}</td><td class="${cls(w.alwaysLongAvg)}">${sgn(w.alwaysLongAvg)} ${w.unit}</td>
        <td class="${cls(w.edgeVsLong)}"><b>${sgn(w.edgeVsLong)}</b>${civ(w.edgeVsLongCI90)}</td>
        <td>${holds ? '<span class="pill ok">EDGE (WEAK)</span>' : '<span class="pill bad">NO EDGE</span>'}</td></tr>`;
    }).join("");
    const bt = r.agentBacktest, bs = bt?.summary;
    const btHtml = bt ? `
      <div class="mt">The AI desk itself on the same 20 incidents <span class="muted">· same prompt, maths and risk checks as live · inputs limited to what was known that day · entry at the next close · costs charged</span></div>
      <div class="findings">
        <div class="finding"><b class="${cls(bs.bookPctTotal)}">${sgn(bs.bookPctTotal)}%</b><span>Total P&L as % of book over 20 incidents (${bs.trades} trades on ${bs.eventsTraded} incidents; 90% CI per incident ${bs.bookPctPerEventCI90 ? `${sgn(bs.bookPctPerEventCI90[0])} to ${sgn(bs.bookPctPerEventCI90[1])}%` : "–"}).</span></div>
        <div class="finding"><b>0% · ${sgn(bs.benchmarks.naiveBuyHeadlineBookPctTotal)}%</b><span>Benchmarks: staying in cash, and a naive rule that buys Brent on every headline with the same sizing. <b>The agent missed both.</b></span></div>
        <div class="finding"><b>${bs.wins}/${bs.trades}</b><span>Winning trades (p = ${bs.pHits}); average ${sgn(bs.avgR)}R per trade; Brier ${bs.brier} (0.25 = coin flip): over-confident.</span></div>
        <div class="finding"><b class="${cls(bs.benchmarks.buyHoldBrent20dPctPerEvent)}">${sgn(bs.benchmarks.buyHoldBrent20dPctPerEvent)}%</b><span>What buying Brent at each incident and holding 20 days returned per incident. The limits kept the agent's worst case small.</span></div>
      </div>
      <div class="note"><b>What went wrong:</b> with only early, positive base rates in hand, the agent kept buying crude after the news (the spike it was told not to chase), entered a day late, and was stopped out or bled as the premium faded. The live desk's prompt now carries the full study, and every live trade needs human approval. <b>Caveat:</b> ${esc(bs.caveat)}</div>
      <table class="tbl rs ev"><thead><tr><th>Incident</th><th>Trade</th><th>P(win)</th><th>Entry → exit</th><th>How</th><th>Result</th></tr></thead><tbody>
      ${bt.rows.flatMap((row) => (row.trades.length ? row.trades : [null]).map((t, j) => `<tr>${j === 0 ? `<td rowspan="${Math.max(1, row.trades.length)}">${row.date} <span class="muted">${esc(row.title || row.event)}</span></td>` : ""}
        ${t ? `<td><span class="dir ${t.direction}">${t.direction}</span> ${esc(t.instrument)} ${t.horizonDays}d</td><td>${Math.round(t.probability * 100)}%</td><td>${t.entry} → ${t.exit ?? "–"}</td><td class="muted">${esc(t.how || (t.blockedBy ? "blocked" : ""))}</td><td class="${cls(t.R)}"><b>${t.R != null ? sgn(t.R) + "R" : "–"}</b></td>`
          : `<td colspan="5" class="muted">No trade: ${esc((row.noTrade || "").slice(0, 140))}</td>`}</tr>`)).join("")}</tbody></table>` : "";
    const b20 = r.walkForward.find((w) => w.inst === "BRENT" && w.h === 20), b1 = r.walkForward.find((w) => w.inst === "BRENT" && w.h === 1);
    const esc20 = S.family.escalation.BRENT[20], ship5 = S.family.shipping.FRO[5];
    $("#tm-body").innerHTML = `
      <div class="findings">
        <div class="finding"><b class="down">${sgn(esc20.median)}%</b><span>Brent's median move <b>20 trading days</b> after a state strike or escalation (${esc20.n - esc20.up}/${esc20.n} fell), vs <b>${sgn(B.BRENT[20].mean)}%</b> on an average 20-day window. The war premium usually fades.</span></div>
        <div class="finding"><b>${b20.hits}/${b20.n}</b><span>Out-of-sample hits for "trade the 20-day history of earlier, similar events" in Brent: <b>${sgn(b20.avgPnl)}%</b> per event after costs vs <b>${sgn(b20.alwaysLongAvg)}%</b> buy-and-hold (edge 90% CI ${b20.edgeVsLongCI90 ? `${sgn(b20.edgeVsLongCI90[0])} to ${sgn(b20.edgeVsLongCI90[1])}` : "–"}%; hits p = ${b20.pHits}). Suggestive, not proof.</span></div>
        <div class="finding"><b class="muted">${b1.hits}/${b1.n}</b><span>Out-of-sample hits for the same rule on the <b>next day</b>. Next-day oil direction after a headline is a coin flip, so the desk does not sell it as an edge.</span></div>
        <div class="finding"><b class="up">${sgn(ship5.median)}%</b><span>Frontline's median 5-day move after shipping incidents (${ship5.up}/${ship5.n} rose), vs ${sgn(B.FRO[5].mean)}% normally. Strong in-sample, but it did not survive the out-of-sample test.</span></div>
      </div>
      <div class="mt">Brent 20 trading days after each incident <span class="muted">· each dot is one event; grey band = middle two-thirds of all 20-day windows since 2019 · hover for details</span></div>
      <div id="strip" class="strip"></div>
      <div class="mt">Median move after incidents <span class="muted">· % for outrights, $/bbl for spreads · small figures: how many of the events rose</span></div>
      <table class="tbl rs"><thead><tr><th></th>${COLS.map(([k, h]) => `<th>${NAME[k]} ${h}d</th>`).join("")}</tr></thead><tbody>${fam}${kinds}${baseRow}</tbody></table>
      <div class="mt">Out-of-sample (walk-forward) test <span class="muted">· at each event, call the direction from the median move of EARLIER events of the same family only (needs ≥3), then score it</span></div>
      <table class="tbl rs"><thead><tr><th>Rule applied to</th><th>Hits <small>(one-sided binomial p)</small></th><th>Avg P&L per event, after costs</th><th>Buy-and-hold, after costs</th><th>Edge vs buy-and-hold</th><th>Verdict</th></tr></thead><tbody>${wf}</tbody></table>
      <div class="note">Costs per round trip: ${Object.entries(r.costs || {}).map(([k, v]) => `${NAME[k] || k} ${v}${r.units[k] === "%" ? "%" : " $/bbl"}`).join(" · ")}. Confidence intervals: 5,000-sample bootstrap. "Edge (weak)" = the interval for the edge over buy-and-hold excludes zero; with 14 events, none of this is strong evidence.</div>
      ${btHtml}
      <div class="mt">The 20 incidents</div>
      <table class="tbl rs ev"><thead><tr><th>Date</th><th>Incident</th><th>Type</th><th>Brent 1d</th><th>5d</th><th>20d</th><th>Crack 5d</th><th>FRO 5d</th></tr></thead><tbody>
      ${r.events.map((e) => `<tr><td>${e.date}</td><td class="z">${esc(e.title)}</td><td class="muted">${esc(r.kindLabel[e.kind])}</td>
        ${[e.moves.BRENT[1], e.moves.BRENT[5], e.moves.BRENT[20]].map((v) => `<td class="${cls(v)}">${sgn(v)}%</td>`).join("")}
        <td class="${cls(e.moves.CRACK[5])}">${sgn(e.moves.CRACK[5])}</td><td class="${cls(e.moves.FRO[5])}">${sgn(e.moves.FRO[5])}%</td></tr>`).join("")}</tbody></table>
      <div class="note">Method: moves are measured from the last daily close before the news reached the market (weekend and overnight events use the prior close) to 1, 5 and 20 trading days later. Front-month continuous futures from Yahoo Finance (roll effects included), NYSE closes for tanker stocks; 3-2-1 crack = (2×RBOB + 1×ULSD)×42 − 3×WTI, ÷3. Overlapping windows (e.g. the two January 2020 events) are not independent, and n is small, so treat every number as a base rate, not a forecast. Built ${esc(r.built.slice(0, 10))}.</div>`;
    drawStrip(r);
  }

  // Dot strip: Brent 20d move per event, one row per family, against the all-days distribution
  function drawStrip(r) {
    const el = $("#strip"), W = el.clientWidth || 900, rowH = 46, pad = { l: 150, r: 20, t: 8, b: 26 }, H = pad.t + rowH * 2 + pad.b;
    const vals = r.events.map((e) => e.moves.BRENT[20]).filter((v) => v != null);
    const lo = Math.floor(Math.min(...vals, -15) / 5) * 5, hi = Math.ceil(Math.max(...vals, 15) / 5) * 5;
    const x = (v) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
    const b = r.baseline.BRENT[20], band = [b.mean - b.sd * 0.97, b.mean + b.sd * 0.97];
    const fams = ["shipping", "escalation"];
    let svg = `<rect x="${x(band[0])}" y="${pad.t}" width="${x(band[1]) - x(band[0])}" height="${rowH * 2}" fill="#2a2a2a" opacity=".55"/>`;
    for (let t = lo; t <= hi; t += 5) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${pad.t}" y2="${pad.t + rowH * 2}" stroke="${t === 0 ? "#666" : "#1c1c1c"}"/><text x="${x(t)}" y="${H - 8}" fill="${MUTED}" font-size="10" text-anchor="middle">${t > 0 ? "+" : ""}${t}%</text>`;
    fams.forEach((f, fi) => {
      const y = pad.t + rowH * fi + rowH / 2;
      const evs = r.events.filter((e) => e.family === f && e.moves.BRENT[20] != null);
      const med = median(evs.map((e) => e.moves.BRENT[20]));
      svg += `<text x="8" y="${y + 4}" fill="#ddd" font-size="11">${f === "shipping" ? "Shipping incidents" : "Escalation"} <tspan fill="${MUTED}">(n=${evs.length})</tspan></text>`;
      svg += `<line x1="${x(med)}" x2="${x(med)}" y1="${y - 16}" y2="${y + 16}" stroke="${AMBER}" stroke-width="2"/><text x="${x(med)}" y="${y - 19}" fill="${AMBER}" font-size="10" text-anchor="middle">median ${sgn(med, 1)}%</text>`;
      evs.forEach((e, i) => {
        const v = e.moves.BRENT[20], jitter = ((i % 3) - 1) * 7;
        svg += `<circle cx="${x(v)}" cy="${y + jitter}" r="5" fill="${v >= 0 ? GREEN : "#ff6b6b"}" stroke="#0a0a0a" stroke-width="2"><title>${esc(e.date)} · ${esc(e.title)}: Brent ${sgn(v)}% after 20 trading days</title></circle>`;
      });
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${svg}</svg>`;
  }

  // ---------------------------------------------------------------- RED SEA 2023-24 REPLAY
  let timer = null;
  async function openCrisis() {
    G.toolHead("CASE STUDY · RED SEA CRISIS 2023-24", "Replay: ship transits (IMF PortWatch), prices, and what the desk's playbook knew at each moment");
    let r;
    try { r = await getResearch(); } catch (e) { $("#tm-body").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const C = r.crisis, T = C.transits;
    if (!T.BAB?.length) { $("#tm-body").innerHTML = `<div class="empty">Transit data missing from the research file.</div>`; return; }
    const days = T.BAB.map((d) => d[0]);
    const ma = (z) => { const s = T[z] || []; return s.map((d, i) => ({ time: d[0], value: +(s.slice(Math.max(0, i - 6), i + 1).reduce((a, b) => a + b[2], 0) / Math.min(i + 1, 7)).toFixed(1) })); };
    const series = { BAB: ma("BAB"), SUEZ: ma("SUEZ"), CAPE: ma("CAPE") };
    const pre = (z) => { const s = (T[z] || []).filter((d) => d[0] >= "2023-09-01" && d[0] <= "2023-11-15"); return s.reduce((a, b) => a + b[2], 0) / s.length; };
    const baseB = pre("BAB"), baseC = pre("CAPE");
    const idx = (k) => { const s = C.prices[k]; const b0 = s[0][1]; return s.map(([d, v]) => ({ time: d, value: +((v / b0) * 100).toFixed(2), raw: v })); };
    const px = { BRENT: idx("BRENT"), FRO: idx("FRO") };
    const evs = r.events.filter((e) => C.events.includes(e.id));
    $("#tm-body").innerHTML = `
      <div class="cr-controls"><button id="cr-play" class="hl">❚❚ Pause</button>
        <select id="cr-speed" title="Playback speed"><option value="250">Slow</option><option value="110" selected>Normal</option><option value="45">Fast</option></select>
        <input type="range" id="cr-slider" min="0" max="${days.length - 1}" value="0">
        <span id="cr-date" class="cr-date"></span></div>
      <div class="cr-tiles" id="cr-tiles"></div>
      <div class="cr-body">
        <div class="cr-charts">
          <div class="mt">Ships per day through each route <span class="muted">· all vessel types, 7-day average · IMF PortWatch</span>
            <span class="legend"><span><i style="background:${AMBER}"></i>Bab el-Mandeb</span><span><i style="background:${BLUE}"></i>Suez Canal</span><span><i style="background:${GREEN}"></i>Cape of Good Hope</span></span></div>
          <div class="mc" id="cr-t"></div>
          <div class="mt">Prices, indexed to 100 on 1 Sep 2023 <span class="legend"><span><i style="background:${AMBER}"></i>Brent</span><span><i style="background:#c78bff"></i>Frontline (tankers)</span></span></div>
          <div class="mc" id="cr-p"></div>
        </div>
        <aside class="cr-feed" id="cr-feed"></aside>
      </div>
      <div class="note">The "playbook at the time" only uses incidents that happened BEFORE each event (walk-forward), so it is what the desk could actually have known then. Outcomes appear once enough days have played out. Sources: IMF PortWatch (UN Global Platform), Yahoo Finance daily closes.</div>`;
    const ct = G.baseChart($("#cr-t")), cp = G.baseChart($("#cr-p"));
    G.trackChart(ct); G.trackChart(cp);
    const opt = (color) => ({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const sB = ct.addLineSeries(opt(AMBER)), sS = ct.addLineSeries(opt(BLUE)), sC = ct.addLineSeries(opt(GREEN));
    const pB = cp.addLineSeries(opt(AMBER)), pF = cp.addLineSeries(opt("#c78bff"));
    // Pad with whitespace so the time axis spans the whole window from the start
    const upto = (arr, d) => { const real = arr.filter((p) => p.time <= d).map(({ time, value }) => ({ time, value })); return [...real, ...days.filter((x) => x > (real.at(-1)?.time || "")).map((time) => ({ time }))]; };
    const markers = (d) => evs.filter((e) => e.date <= d).map((e) => ({ time: days.find((x) => x >= e.date) || e.date, position: "aboveBar", color: "#ff6b6b", shape: "arrowDown", text: e.id.split("-")[0] }));
    let i = 0;
    function prior(e) {
      const p = r.events.filter((x) => x.date < e.date && x.family === e.family);
      const m = (k, h) => median(p.map((x) => x.moves[k][h]).filter((v) => v != null));
      return { n: p.length, b5: m("BRENT", 5), b20: m("BRENT", 20), f5: m("FRO", 5) };
    }
    const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400_000;
    let feedKey = null;
    function feed(d) {
      const shown = evs.filter((e) => e.date <= d).reverse();
      // Only rebuild when something visible changes (an event appears or an outcome is revealed)
      const key = shown.map((e) => `${e.id}${daysBetween(e.date, d) >= 7 ? 1 : 0}${daysBetween(e.date, d) >= 28 ? 1 : 0}`).join();
      if (key === feedKey) return;
      feedKey = key;
      $("#cr-feed").innerHTML = shown.length ? shown.map((e) => {
        const p = prior(e), el = daysBetween(e.date, d);
        const call = p.n >= 2 ? `Brent 5d median <b class="${cls(p.b5)}">${sgn(p.b5)}%</b>, 20d <b class="${cls(p.b20)}">${sgn(p.b20)}%</b>; Frontline 5d <b class="${cls(p.f5)}">${sgn(p.f5)}%</b> <span class="muted">(from ${p.n} earlier ${e.family} events)</span>`
          : `<span class="muted">Too few earlier ${e.family} events (${p.n}) for a base rate.</span>`;
        const out5 = el >= 7 ? `5d: Brent <b class="${cls(e.moves.BRENT[5])}">${sgn(e.moves.BRENT[5])}%</b>, Frontline <b class="${cls(e.moves.FRO[5])}">${sgn(e.moves.FRO[5])}%</b>` : "";
        const out20 = el >= 28 ? ` · 20d: Brent <b class="${cls(e.moves.BRENT[20])}">${sgn(e.moves.BRENT[20])}%</b>` : "";
        return `<div class="cr-ev"><div class="muted">${e.date} · ${esc(r.kindLabel[e.kind])}</div><b>${esc(e.title)}</b>
          <div class="pb">📊 Playbook at the time: ${call}</div>${out5 ? `<div class="out">Outcome → ${out5}${out20}</div>` : `<div class="muted">Outcome pending…</div>`}</div>`;
      }).join("") : `<div class="empty">Calm before the storm: Red Sea traffic is normal. Incidents will appear here as the replay reaches them.</div>`;
    }
    function draw() {
      const d = days[i];
      sB.setData(upto(series.BAB, d)); sS.setData(upto(series.SUEZ, d)); sC.setData(upto(series.CAPE, d));
      pB.setData(upto(px.BRENT, d)); pF.setData(upto(px.FRO, d));
      pB.setMarkers(markers(d));
      const last = (arr) => [...arr].reverse().find((p) => p.time <= d);
      const b = last(series.BAB), c = last(series.CAPE), br = last(px.BRENT), fr = last(px.FRO);
      $("#cr-date").textContent = new Date(d + "T00:00:00Z").toUTCString().slice(5, 16);
      $("#cr-slider").value = i;
      const t = (v, l, c2 = "") => `<div class="tile"><b class="${c2}">${v}</b><span>${l}</span></div>`;
      const pb = b ? ((b.value - baseB) / baseB) * 100 : null, pc = c ? ((c.value - baseC) / baseC) * 100 : null;
      $("#cr-tiles").innerHTML = t(b ? b.value.toFixed(0) : "–", "Bab el-Mandeb ships/day") + t(`${sgn(pb, 0)}%`, "vs pre-crisis", cls(pb)) +
        t(c ? c.value.toFixed(0) : "–", "Cape ships/day") + t(`${sgn(pc, 0)}%`, "vs pre-crisis", cls(pc)) +
        t(br ? `$${br.raw.toFixed(2)}` : "–", "Brent") + t(fr ? `${sgn(fr.value - 100, 0)}%` : "–", "Frontline since 1 Sep", cls(fr && fr.value - 100));
      feed(d);
    }
    const play = () => {
      clearInterval(timer);
      $("#cr-play").textContent = "❚❚ Pause";
      timer = setInterval(() => { if (!$("#cr-t")) return clearInterval(timer); if (i >= days.length - 1) { clearInterval(timer); timer = null; $("#cr-play").textContent = "↺ Replay"; return; } i++; draw(); }, +$("#cr-speed").value);
    };
    const pause = () => { clearInterval(timer); timer = null; $("#cr-play").textContent = "▶ Play"; };
    $("#cr-play").addEventListener("click", () => { if (timer) pause(); else { if (i >= days.length - 1) i = 0; play(); } });
    $("#cr-speed").addEventListener("change", () => { if (timer) play(); });
    $("#cr-slider").addEventListener("input", (e) => { pause(); i = +e.target.value; draw(); });
    ct.timeScale().fitContent(); cp.timeScale().fitContent();
    draw(); ct.timeScale().fitContent(); cp.timeScale().fitContent();
    play();
  }
  // Stop the replay timer when the window closes
  $("#tm-close").addEventListener("click", () => { clearInterval(timer); timer = null; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { clearInterval(timer); timer = null; } });
  $("#tool-modal").addEventListener("click", (e) => { if (e.target.id === "tool-modal") { clearInterval(timer); timer = null; } });

  Object.assign(G.extraTools, { research: openResearch, crisis: openCrisis });
})();
