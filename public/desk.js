// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// TRADE DESK tab: paper trade ideas with live P&L in R, a scorecard and calibration.
(() => {
  const $ = (s) => document.querySelector(s);
  const { state, esc, ago, hhmm } = window.GST;
  const sgn = (x, d = 2) => (x == null ? "–" : (x > 0 ? "+" : "") + x.toFixed(d));
  const fmtPx = (i, v) => (v == null ? "–" : i.unit === "%" ? (v >= 1000 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3)) : v.toFixed(2));
  const cls = (x) => (x == null ? "" : x > 0 ? "up" : x < 0 ? "down" : "");

  // Where the price sits between stop and target: stop |----entry----now----| target
  function rail(i) {
    const lo = Math.min(i.stop, i.target), hi = Math.max(i.stop, i.target);
    const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const stopLeft = i.stop < i.target;
    const now = i.status === "open" ? i.mark : i.exit;
    return `<div class="rail" title="Stop ${fmtPx(i, i.stop)} · entry ${fmtPx(i, i.entry)} · ${i.status === "open" ? "now" : "exit"} ${fmtPx(i, now)} · target ${fmtPx(i, i.target)}">
      <span class="end ${stopLeft ? "stop" : "tgt"}">${stopLeft ? "STOP" : "TARGET"} ${fmtPx(i, lo)}</span>
      <div class="track"><i class="entry" style="left:${pos(i.entry)}%"></i><i class="now ${cls(i.status === "open" ? i.live?.R : i.result?.R)}" style="left:${pos(now)}%"></i></div>
      <span class="end ${stopLeft ? "tgt" : "stop"}">${fmtPx(i, hi)} ${stopLeft ? "TARGET" : "STOP"}</span></div>`;
  }

  function card(i) {
    const r = i.status === "open" ? i.live : i.result;
    const left = Math.max(0, Date.parse(i.expires) - Date.now());
    const leftTxt = left > 86400_000 ? `${Math.round(left / 86400_000)}d left` : `${Math.round(left / 3600_000)}h left`;
    return `<div class="idea ${i.status}">
      <div class="ih"><span class="dir ${i.direction}">${i.direction}</span><b title="${esc(i.label)}">${esc(i.instrument.replace("_", " "))}</b>
        <span class="muted">${i.horizon_days}d · ${i.status === "open" ? leftTxt : esc(i.status.toUpperCase())}</span>
        <span class="pnl ${cls(r?.R)}" title="Profit/loss in R: multiples of the risk taken (entry to stop = 1R)">${sgn(r?.R)}R${r?.pct != null ? ` <small>${sgn(r.pct)}%</small>` : r?.abs != null ? ` <small>${sgn(r.abs)} $/bbl</small>` : ""}</span></div>
      <div class="nums"><span title="Entry is the live price when the desk opened the idea">Entry <b>${fmtPx(i, i.entry)}</b></span>
        <span>${i.status === "open" ? "Now" : "Exit"} <b>${fmtPx(i, i.status === "open" ? i.mark : i.exit)}</b></span>
        <span title="Desk's probability that the trade is profitable at exit">P(win) <b>${Math.round(i.probability * 100)}%</b></span>
        <span title="Reward-to-risk: target distance / stop distance">R:R <b>${i.rr.toFixed(1)}</b></span>
        <span title="Rough expected value in R: P(win)×R:R − P(loss)" class="${cls(i.evR)}">EV <b>${sgn(i.evR)}R</b></span>
        <span title="Paper risk as % of book if the stop is hit">Risk <b>${i.risk_pct}%</b></span></div>
      ${rail(i)}
      <div class="thesis">${esc(i.thesis)}</div>
      <div class="base" title="Historical analogue from the event study">📊 ${esc(i.base_rate)}</div>
      <details><summary>Evidence & invalidation</summary><ul>${i.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        <div><b>Wrong if:</b> ${esc(i.invalidation)}</div>${i.closeReason ? `<div><b>Closed early:</b> ${esc(i.closeReason)}</div>` : ""}
        <div class="muted">Opened ${hhmm(i.opened)} (${ago(i.opened)} ago) · ${esc(i.model || "")} · ${esc(i.reason || "")}</div></details>
    </div>`;
  }

  function render() {
    const el = $("#desk"); if (!el || el.hidden) return;
    const d = state.desk;
    if (!d) { el.innerHTML = `<div class="empty">Loading…</div>`; return; }
    const s = d.score || {};
    const open = d.ideas.filter((i) => i.status === "open"), closed = d.ideas.filter((i) => i.status !== "open");
    const run = d.lastRun;
    const tile = (v, label, tip, c = "") => `<div class="tile" title="${esc(tip)}"><b class="${c}">${v}</b><span>${label}</span></div>`;
    el.innerHTML = `
      <div class="tiles">
        ${tile(`${s.open ?? 0}`, "open", "Open paper ideas")}
        ${tile(`${sgn(s.openR)}R`, "open P&L", "Unrealised P&L of open ideas, in R", cls(s.openR))}
        ${tile(s.closed ? `${s.wins}/${s.closed}` : "–", "won", "Closed ideas that made money")}
        ${tile(s.closed ? `${sgn(s.avgR)}R` : "–", "avg / trade", "Average realised result per closed idea, in R", cls(s.avgR))}
        ${tile(s.brier != null ? s.brier.toFixed(2) : "–", "Brier", "Calibration of the desk's P(win): 0 = perfect, 0.25 = coin flip. Lower is better.")}
      </div>
      ${d.running ? `<div class="muted run">▶ Desk is reviewing the live picture and the event study…</div>` : ""}
      ${run ? `<div class="regime"><b>${esc(run.regime || "")}</b><div>${esc(run.summary || "")}</div>${run.noTrade ? `<div class="muted">No (more) trades: ${esc(run.noTrade)}</div>` : ""}
        ${run.rejected?.length ? `<div class="muted" title="The server rejects ideas whose own probability and reward:risk imply a negative expected value">Risk check rejected: ${run.rejected.map(esc).join(", ")}</div>` : ""}
        <div class="muted foot">Last run ${hhmm(run.time)} (${ago(run.time)} ago) · ${esc(run.reason)}</div></div>`
        : d.enabled ? `<div class="empty">The desk runs automatically a couple of minutes after startup, every 2 hours, and after critical alerts. Press <b>Run now</b> to ask it immediately.</div>`
        : `<div class="empty">Trade desk is off: ${esc(d.error || "AI analyst not configured")}</div>`}
      ${d.error && d.enabled ? `<div style="color:#ff6b6b">Last run failed: ${esc(d.error)}</div>` : ""}
      ${open.length ? `<div class="sec">OPEN IDEAS</div>${open.map(card).join("")}` : ""}
      ${closed.length ? `<div class="sec">CLOSED</div><table class="closed-tbl"><tbody>${closed.slice(0, 25).map((i) => `<tr title="${esc(i.thesis)}">
        <td><span class="dir ${i.direction}">${i.direction[0]}</span> ${esc(i.instrument.replace("_", " "))}</td><td class="muted">${esc(i.status)}</td>
        <td class="muted">${Math.round(i.probability * 100)}%</td><td class="${cls(i.result?.R)}"><b>${sgn(i.result?.R)}R</b></td><td class="muted">${i.closed ? hhmm(i.closed) + " " + i.closed.slice(5, 10) : ""}</td></tr>`).join("")}</tbody></table>` : ""}
      <div class="foot">Paper trades for research, not investment advice. Entries are the live (delayed) price when the idea was opened; the server, not the AI, sets the levels and closes ideas on stop, target or expiry.
        Ideas are grounded in the <a href="#" data-open-tool="research">historical event study</a> · see the <a href="#" data-open-tool="crisis">Red Sea 2024 replay</a>.</div>`;
  }
  window.addEventListener("gst:desk", render);
  // Re-render "time left" labels now and then
  setInterval(render, 60_000);
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-open-tool]"); if (!a) return;
    e.preventDefault(); window.GST.openTool(a.dataset.openTool);
  });
})();
