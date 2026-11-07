// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// TRADE DESK tab: the agent proposes, code checks, a human approves. Live P&L in R after costs, kill switch,
// decision trace for every idea and the full audit log.
(() => {
  const $ = (s) => document.querySelector(s);
  const { state, esc, ago, hhmm } = window.GST;
  const sgn = (x, d = 2) => (x == null ? "–" : (x > 0 ? "+" : "") + Number(x).toFixed(d));
  const fmtPx = (i, v) => (v == null ? "–" : i.unit === "%" ? (v >= 1000 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3)) : v.toFixed(2));
  const cls = (x) => (x == null ? "" : x > 0 ? "up" : x < 0 ? "down" : "");
  const pct = (x) => `${Math.round(x * 100)}%`;
  let showLog = false;

  function rail(i) {
    const lo = Math.min(i.stop, i.target), hi = Math.max(i.stop, i.target);
    const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const stopLeft = i.stop < i.target;
    const now = i.status === "open" ? i.mark : i.exit ?? i.entry;
    const r = i.status === "open" ? i.live?.R : i.result?.R;
    return `<div class="rail" title="Stop ${fmtPx(i, i.stop)} · entry ${fmtPx(i, i.entry)} · now ${fmtPx(i, now)} · target ${fmtPx(i, i.target)}">
      <span class="end ${stopLeft ? "stop" : "tgt"}">${stopLeft ? "STOP" : "TARGET"} ${fmtPx(i, lo)}</span>
      <div class="track"><i class="entry" style="left:${pos(i.entry)}%"></i><i class="now ${cls(r)}" style="left:${pos(now)}%"></i></div>
      <span class="end ${stopLeft ? "tgt" : "stop"}">${fmtPx(i, hi)} ${stopLeft ? "TARGET" : "STOP"}</span></div>`;
  }

  // Decision trace: raw data → base rate (code) → AI judgement → maths (code) → risk checks (code) → human → outcome
  function trace(i) {
    const t = i.trace || {}, br = t.baseRate || {}, ai = t.ai || {}, m = t.maths || {};
    const brTxt = br.available
      ? `${esc(br.analogue)} → ${esc(br.family)} family, ${br.h}-trading-day horizon: median ${sgn(br.familyStat.median)}${br.unit === "%" ? "%" : " $/bbl"}, ${i.direction === "SHORT" ? "fell" : "rose"} in <b>${br.familyStat.wins}/${br.familyStat.n}</b> events${br.baseline ? ` (all days: mean ${sgn(br.baseline.mean)}, s.d. ${br.baseline.sd})` : ""}`
      : `<span class="muted">No base rate: ${esc(br.reason || "none")}</span>`;
    const checks = (list) => (list || []).map((c) => `<li class="${c.pass ? "ok" : c.hard ? "bad" : "warn"}">${c.pass ? "✓" : c.hard ? "✗" : "!"} ${esc(c.name)} <span class="muted">· ${esc(c.detail)}</span></li>`).join("");
    return `<ol class="trace">
      <li><b>Raw data</b> · ${hhmm(t.inputs?.time)} UTC · AIS ${esc(t.inputs?.aisMode || "?")} · ${t.inputs?.alerts24h ?? "?"} alerts, ${t.inputs?.headlines ?? "?"} headlines, ${t.inputs?.statements ?? "?"} statements · price ${fmtPx(i, t.inputs?.price)} (${esc(t.inputs?.priceSource || "")}) · <a href="/api/desk/input/${esc(t.runId || "")}" target="_blank" rel="noopener">exact input ↗</a></li>
      <li><b>Base rate (computed by code)</b> · ${brTxt}</li>
      <li><b>AI judgement</b> (${esc(ai.model || "")}) · P(win) ${ai.probability}, stop ${ai.stop_distance}, target ${ai.target_distance}${i.unit === "%" ? "%" : " $/bbl"}, ${ai.horizon_days}d, risk ${ai.risk_pct}% · <i>${esc(ai.reading || "")}</i></li>
      <li><b>Maths (code)</b> · entry ${fmtPx(i, m.entry)}, stop ${fmtPx(i, m.stop)}, target ${fmtPx(i, m.target)} · cost ${m.costR}R · <code>${esc(m.formula || "")}</code></li>
      <li><b>Risk checks (code)</b><ul class="checks">${checks(t.checks)}</ul></li>
      ${t.approvalChecks ? `<li><b>Re-checked at approval</b><ul class="checks">${checks(t.approvalChecks)}</ul></li>` : ""}
      <li><b>Human</b> · ${i.decision ? `${esc(i.decision.action)} by ${esc(i.decision.by)} at ${hhmm(i.decision.at)}` : i.status === "blocked" ? "not asked: blocked by risk checks" : i.status === "lapsed" ? "no decision in time" : "awaiting decision"}</li>
      ${i.result ? `<li><b>Outcome</b> · ${esc(i.status)} at ${fmtPx(i, i.exit)} → <b class="${cls(i.result.R)}">${sgn(i.result.R)}R</b> after costs (gross ${sgn(i.result.grossR)}R)</li>` : ""}
    </ol>`;
  }

  function card(i) {
    const r = i.status === "open" ? i.live : i.result;
    const left = i.expires ? Math.max(0, Date.parse(i.expires) - Date.now()) : 0;
    const status = { proposed: "AWAITING YOUR DECISION", blocked: "BLOCKED BY RISK LIMITS", open: left > 86400_000 ? `${Math.round(left / 86400_000)}d left` : `${Math.round(left / 3600_000)}h left` }[i.status] || i.status.toUpperCase();
    const failed = (i.trace?.checks || []).filter((c) => c.hard && !c.pass);
    return `<div class="idea ${i.status}" data-id="${esc(i.id)}">
      <div class="ih"><span class="dir ${i.direction}">${i.direction}</span><b title="${esc(i.label)}">${esc(i.instrument.replace("_", " "))}</b>
        <span class="st st-${i.status}">${status}</span>
        ${r ? `<span class="pnl ${cls(r.R)}" title="P&L in R after costs (entry→stop = 1R)">${sgn(r.R)}R${r.pct != null ? ` <small>${sgn(r.pct)}%</small>` : ""}</span>` : ""}</div>
      <div class="nums"><span>${i.status === "proposed" || i.status === "blocked" ? "Ref" : "Entry"} <b>${fmtPx(i, i.entry)}</b></span>
        ${i.status === "open" ? `<span>Now <b>${fmtPx(i, i.mark)}</b></span>` : ""}
        <span title="Agent's probability the trade is profitable after costs">P(win) <b>${pct(i.probability)}</b></span>
        <span title="Target distance / stop distance">R:R <b>${i.rr.toFixed(1)}</b></span>
        <span class="${cls(i.evR)}" title="Expected value after costs, computed by code">EV <b>${sgn(i.evR)}R</b></span>
        <span title="Paper risk as % of book if the stop is hit">Risk <b>${i.riskPct}%</b></span><span>${i.horizon_days}d</span></div>
      ${rail(i)}
      <div class="thesis">${esc(i.thesis)}</div>
      ${i.trace?.baseRate?.available ? `<div class="base">History: ${i.direction === "SHORT" ? "fell" : "rose"} in ${i.trace.baseRate.familyStat.wins}/${i.trace.baseRate.familyStat.n} ${esc(i.trace.baseRate.family)} incidents over ${i.trace.baseRate.h} trading day${i.trace.baseRate.h > 1 ? "s" : ""}</div>` : ""}
      ${failed.length ? `<div class="blocked">✗ ${failed.map((c) => `${esc(c.name)} <span class="muted">(${esc(c.detail)})</span>`).join("<br>✗ ")}</div>` : ""}
      ${i.closeAdvice && i.status === "open" ? `<div class="advice">Agent recommends closing: ${esc(i.closeAdvice.reason)}</div>` : ""}
      ${i.status === "proposed" ? `<div class="act"><button class="approve" data-act="approve">Approve</button><button class="reject" data-act="reject">Reject</button><span class="muted">Approval re-runs the risk checks at the live price.</span></div>` : ""}
      ${i.status === "open" ? `<div class="act"><button class="reject" data-act="close">Close at market</button></div>` : ""}
      <details><summary>Decision trace · evidence · invalidation</summary>
        <ul class="ev">${i.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        <div class="inv"><b>Wrong if:</b> ${esc(i.invalidation)}</div>${trace(i)}</details>
    </div>`;
  }

  function render() {
    const el = $("#desk"); if (!el || el.hidden) return;
    // Keep open "decision trace" panels and the scroll position across live re-renders
    const openIds = new Set([...el.querySelectorAll(".idea details[open]")].map((x) => x.closest(".idea").dataset.id));
    const scroll = el.scrollTop;
    queueMicrotask(() => { el.querySelectorAll(".idea").forEach((x) => { if (openIds.has(x.dataset.id)) x.querySelector("details").open = true; }); el.scrollTop = scroll; });
    const d = state.desk;
    if (!d) { el.innerHTML = `<div class="empty">Loading…</div>`; return; }
    const s = d.score || {}, L = d.limits || {};
    const by = (st) => d.ideas.filter((i) => st.includes(i.status));
    const run = d.lastRun;
    const tile = (v, label, tip, c = "") => `<div class="tile" title="${esc(tip)}"><b class="${c}">${v}</b><span>${label}</span></div>`;
    const closed = by(["stopped", "target", "expired", "closed"]), other = by(["rejected", "lapsed", "blocked"]).slice(0, 12);
    el.innerHTML = `
      <div class="who"><b>User</b> crude oil trader · <b>Guards against</b> buying the spike on an unverified headline · <b>Flow</b> agent proposes, code enforces limits, you approve</div>
      <div class="killbar ${d.halted ? "on" : ""}">
        ${d.halted ? `<b>DESK HALTED</b> · no new proposals or approvals <button data-halt="0">Resume</button>`
          : `<span title="Limits enforced in code">Limits: ≤${L.maxRiskPerTrade}% per trade · ≤${L.maxOpenRisk}% open · 1 per instrument · EV&gt;0 after costs · P(win) ≤ history + ${Math.round((L.maxProbOverBase || 0) * 100)}pts</span>
             <button data-halt="1" class="kill" title="Halt the desk: no new proposals or approvals">Kill switch</button><button data-halt="2" class="kill" title="Halt and close every open paper trade at market">Halt + flatten</button>`}
      </div>
      <div class="tiles">
        ${tile(`${s.proposed ?? 0}`, "to decide", "Proposals waiting for a human decision")}
        ${tile(`${s.open ?? 0} · ${sgn(s.openRisk, 1)}%`, "open · risk", "Open paper trades and % of book at risk")}
        ${tile(s.closed ? `${sgn(s.totalR)}R` : "–", `realised · ${s.wins ?? 0}/${s.closed ?? 0} won`, "Realised P&L after costs, in R", cls(s.totalR))}
        ${tile(s.brier != null ? s.brier.toFixed(2) : "–", "Brier", "Calibration of P(win): 0 perfect, 0.25 coin flip")}
        ${tile(`${s.rejectedByRisk ?? 0} · ${s.rejectedByHuman ?? 0}`, "blocked · rejected", "Ideas blocked by risk limits · rejected by a human")}
      </div>
      ${d.running ? `<div class="muted run">Updating…</div>` : ""}
      ${run ? `<div class="regime"><b>${esc(run.regime || "")}</b><div>${esc(run.summary || "")}</div>${run.noTrade ? `<div class="muted">No (more) trades: ${esc(run.noTrade)}</div>` : ""}
        <div class="muted foot">Agent run ${hhmm(run.time)} (${ago(run.time)} ago) · ${esc(run.reason)} · <a href="/api/desk/input/${esc(run.id || "")}" target="_blank" rel="noopener">exact input ↗</a></div></div>`
        : d.enabled ? `<div class="empty">The agent runs a couple of minutes after startup, every 2 hours and after critical alerts. Press <b>Run now</b> to ask it immediately.</div>`
        : `<div class="empty">Trade desk is off: ${esc(d.error || "AI analyst not configured")}</div>`}
      ${d.error && d.enabled ? `<div style="color:#ff6b6b">Last run failed: ${esc(d.error)}</div>` : ""}
      ${by(["proposed"]).length ? `<div class="sec">AWAITING YOUR DECISION</div>${by(["proposed"]).map(card).join("")}` : ""}
      ${by(["open"]).length ? `<div class="sec">OPEN PAPER TRADES</div>${by(["open"]).map(card).join("")}` : ""}
      ${by(["blocked"]).slice(0, 3).length ? `<div class="sec">BLOCKED BY RISK LIMITS</div>${by(["blocked"]).slice(0, 3).map(card).join("")}` : ""}
      ${closed.length || other.length ? `<div class="sec">HISTORY</div><table class="closed-tbl"><tbody>${[...closed, ...other].slice(0, 25).map((i) => `<tr title="${esc(i.thesis)}">
        <td><span class="dir ${i.direction}">${i.direction[0]}</span> ${esc(i.instrument.replace("_", " "))}</td><td class="muted">${esc(i.status)}</td>
        <td class="muted">${pct(i.probability)}</td><td class="${cls(i.result?.R)}"><b>${i.result ? sgn(i.result.R) + "R" : "–"}</b></td><td class="muted">${hhmm(i.closed || i.proposed)} ${(i.closed || i.proposed).slice(5, 10)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${d.backtest ? `<div class="sec">SAME AGENT ON 20 PAST INCIDENTS</div><div class="bt">Point-in-time inputs, entry at the next close, costs charged: <b>${d.backtest.trades}</b> trades, <b>${d.backtest.wins}</b> won, <b class="${cls(d.backtest.bookPctTotal)}">${sgn(d.backtest.bookPctTotal)}%</b> of book in total vs cash 0% and "buy the headline" ${sgn(d.backtest.benchmarks.naiveBuyHeadlineBookPctTotal)}%. It missed its benchmark. <a href="#" data-open-tool="research">Details ↗</a></div>` : ""}
      <div class="sec">AUDIT LOG <a href="#" id="log-toggle">${showLog ? "hide" : `show (${d.log.length})`}</a></div>
      ${showLog ? `<table class="log-tbl"><tbody>${d.log.map((l) => `<tr><td class="muted">${hhmm(l.t)} ${l.t.slice(5, 10)}</td><td class="actor a-${esc(l.actor.split(" ")[0])}">${esc(l.actor)}</td><td><b>${esc(l.action)}</b> ${esc(l.detail || "")}</td></tr>`).join("")}</tbody></table>` : ""}
      <div class="foot">Paper trading for research. Nothing here can place a real order. Entries use the live (delayed) price at approval; the server, not the AI, sets the levels, applies costs and closes trades. Not investment advice.</div>`;
  }
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) flash(j.error || `HTTP ${r.status}`);
  }
  function flash(msg) {
    const el = document.createElement("div"); el.className = "desk-toast"; el.textContent = msg;
    document.body.append(el); setTimeout(() => el.remove(), 6000);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-open-tool]");
    if (a) { e.preventDefault(); window.GST.openTool(a.dataset.openTool); return; }
    if (!e.target.closest("#desk")) return;
    if (e.target.id === "log-toggle") { e.preventDefault(); showLog = !showLog; render(); return; }
    const act = e.target.closest("[data-act]");
    if (act) { const id = act.closest(".idea").dataset.id; act.disabled = true; post("/api/desk/decide", { id, action: act.dataset.act }); return; }
    const h = e.target.closest("[data-halt]");
    if (h) {
      const v = h.dataset.halt;
      if (v === "2" && !confirm("Halt the desk and close every open paper trade at market?")) return;
      post("/api/desk/halt", { halt: v !== "0", flatten: v === "2" });
    }
  });
  window.addEventListener("gst:desk", render);
  setInterval(render, 60_000);
})();
