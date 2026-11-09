// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Overview layer: the chokepoint risk banner, the trade-desk summary tile and the first-visit guide.
// Everything shown is computed from data the terminal already has (IMF PortWatch transits, live AIS
// counts, incident alerts, the desk record); the risk level is a stated rule, not a model output.
(() => {
  const G = window.GST, $ = (s) => document.querySelector(s);
  const ZONES = [["HORMUZ", "Strait of Hormuz"], ["BAB", "Bab el-Mandeb"], ["SUEZ", "Suez Canal"], ["CAPE", "Cape of Good Hope"]];
  const DAY = 864e5;
  let flows = null;

  const bar = document.createElement("section");
  bar.id = "riskbar";
  bar.setAttribute("aria-label", "Chokepoint risk overview");
  $("#infobar").after(bar);

  async function loadFlows() {
    try { const r = await fetch("/api/flows"); if (r.ok) flows = await r.json(); } catch { /* keep the last copy */ }
    render();
  }

  // Rule: transits well below normal and serious incidents raise the level; it is shown with its reasons.
  function assess(z) {
    const s = G.state, why = [];
    let score = 0;
    const f = flows?.summary?.[z];
    if (f && f.tankerChangePct != null) {
      if (f.tankerChangePct <= -40) { score += 2; why.push(`tanker transits ${f.tankerChangePct}% vs the 90-day average`); }
      else if (f.tankerChangePct <= -15) { score += 1; why.push(`tanker transits ${f.tankerChangePct}% vs the 90-day average`); }
    }
    const recent = (s.alerts || []).filter((a) => a.zone === z && a.kind !== "flow-drop" && Date.now() - new Date(a.time) < DAY);
    const crit = recent.filter((a) => a.severity === "critical").length, warn = recent.filter((a) => a.severity === "warning").length;
    if (crit) { score += 2; why.push(`${crit} critical alert${crit > 1 ? "s" : ""} in 24 h`); }
    else if (warn >= 3) { score += 1; why.push(`${warn} warnings in 24 h`); }
    const st = s.status?.stats?.[z] || {};
    if (st.sanctioned > 0) { score += 1; why.push(`${st.sanctioned} sanctioned ship${st.sanctioned > 1 ? "s" : ""} in the area`); }
    const level = score >= 2 ? "high" : score === 1 ? "elevated" : "normal";
    return { level, why, f, st, alerts24: recent.length };
  }

  const sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(0);
  const dateShort = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  function zoneTile([z, name]) {
    const a = assess(z), f = a.f, st = a.st;
    const flowTxt = f && f.tankerChangePct != null
      ? `<b class="${f.tankerChangePct <= -15 ? "down" : f.tankerChangePct >= 15 ? "up" : ""}">${sgn(f.tankerChangePct)}%</b> tanker transits vs 90-day avg`
      : `<span class="muted">IMF transit data unavailable</span>`;
    const live = `${st.vessels ?? 0} ships tracked · ${a.alerts24} alert${a.alerts24 === 1 ? "" : "s"} 24 h`;
    const title = `${name}: ${a.level.toUpperCase()}\n` +
      (a.why.length ? `Why: ${a.why.join("; ")}.` : "No rule triggered: transits near normal and no serious alerts in 24 h.") +
      `\nRule: transits ≥40% below normal or a critical alert = HIGH; a smaller drop, several warnings or a sanctioned ship = ELEVATED.` +
      (f?.lastDate ? `\nTransits: IMF PortWatch, 7-day vs 90-day average, data to ${dateShort(f.lastDate)}.` : "") +
      `\nClick to show it on the map.`;
    return `<button class="rk-tile ${a.level}" data-z="${z}" title="${G.esc(title)}">
      <span class="rk-top"><span class="rk-name">${name}</span><span class="rk-lvl">${a.level === "high" ? "HIGH RISK" : a.level === "elevated" ? "ELEVATED" : "NORMAL"}</span></span>
      <span class="rk-line">${flowTxt}</span>
      <span class="rk-line muted">${live}</span>
    </button>`;
  }

  function deskTile() {
    const d = G.state.desk;
    if (!d) return `<button class="rk-tile rk-desk" data-desk="1"><span class="rk-top"><span class="rk-name">AI trade desk</span></span><span class="rk-line muted">loading…</span></button>`;
    const waiting = (d.ideas || []).filter((i) => i.status === "proposed").length;
    const sc = d.score || {};
    const state = d.halted ? `<span class="rk-lvl halted">HALTED</span>` : d.enabled ? `<span class="rk-lvl ok">ON · HUMAN APPROVAL</span>` : `<span class="rk-lvl">OFF</span>`;
    const rec = sc.closed ? `${sc.closed} closed, ${sc.totalR > 0 ? "+" : ""}${sc.totalR}R` : "no closed trades yet";
    return `<button class="rk-tile rk-desk${waiting ? " waiting" : ""}" data-desk="1" title="Open the AI trade desk: proposals, risk checks, decision traces and the audit log">
      <span class="rk-top"><span class="rk-name">AI trade desk · Claude</span>${state}</span>
      <span class="rk-line">${waiting ? `<b class="warn">${waiting} proposal${waiting > 1 ? "s" : ""} awaiting approval</b>` : "No proposals waiting"} · open risk ${sc.openRisk ?? 0}%</span>
      <span class="rk-line muted">Paper record: ${rec}</span>
    </button>`;
  }

  function render() {
    if (!G.state.status) return;
    bar.innerHTML = ZONES.map(zoneTile).join("") + deskTile();
  }

  bar.addEventListener("click", (e) => {
    const t = e.target.closest(".rk-tile"); if (!t) return;
    if (t.dataset.desk) { openDesk(); $("#p-analyst").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    const z = t.dataset.z, panel = G.panelFor(z);
    panel?.querySelector(`.zone-tabs button[data-z="${z}"]`)?.click();
    panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    panel?.classList.add("rk-flash"); setTimeout(() => panel?.classList.remove("rk-flash"), 1200);
  });

  function openDesk() { $('#an-tabs [data-t="desk"]')?.click(); }

  window.addEventListener("gst:desk", render);
  setInterval(render, 5000);
  loadFlows(); setInterval(loadFlows, 30 * 60_000);
  // The trade desk is the core of the project, so it is the analyst panel's first view
  openDesk();

  // ---------------------------------------------------------------- first-visit guide
  const STEPS = [
    { sel: "#riskbar", title: "Risk at a glance", text: "Each tile rates one oil chokepoint from IMF transit data, live ship tracking and incident alerts. Hover for the reasons; click to jump the map there." },
    { sel: "#p-hormuz", title: "Live ships", text: "Tankers and other ships in the Strait of Hormuz and Bab el-Mandeb, from live AIS. Alerts flag ships going dark, GPS jamming and sanctioned tankers." },
    { sel: "#p-analyst", title: "AI trade desk", text: "Claude proposes paper trades. Code prices each one, checks it against hard risk limits and logs every step. Nothing trades until a human approves." },
    { sel: '#tools [data-open="research"]', title: "The evidence", text: "Research tests the ideas on 20 past incidents, out of sample and after costs, including where they failed. Red Sea 2024 replays the last crisis day by day." },
    { sel: "#manual-btn", title: "The manual", text: "Download the full user manual (PDF) at any time from the Manual button in the top menu." },
  ];
  const KEY = "gst-guide-v1";
  let step = 0, hole = null, card = null;

  function place() {
    const s = STEPS[step], el = $(s.sel); if (!el) return;
    el.scrollIntoView({ block: "center" });
    card.innerHTML = `<div class="gd-step">${step + 1} / ${STEPS.length}</div><div class="gd-title">${s.title}</div><div class="gd-text">${s.text}</div>
      <div class="gd-btns"><button class="gd-skip">Skip</button><span>${step ? `<button class="gd-back">Back</button>` : ""}<button class="gd-next on">${step === STEPS.length - 1 ? "Start exploring" : "Next"}</button></span></div>`;
    position();
    card.querySelector(".gd-next").focus({ preventScroll: true });
  }
  // Keep the spotlight on its target while the page scrolls or resizes (phones scroll the whole page)
  function position() {
    if (!hole) return;
    const el = $(STEPS[step].sel); if (!el) return;
    const r = el.getBoundingClientRect(), pad = 4;
    // Keep the outline inside the window, so a target at the very edge (the top menu) still shows all four sides
    const L = Math.max(2, r.left - pad), T = Math.max(2, r.top - pad);
    const R = Math.min(innerWidth - 2, r.right + pad), B = Math.min(innerHeight - 2, r.bottom + pad);
    Object.assign(hole.style, { left: `${L}px`, top: `${T}px`, width: `${R - L}px`, height: `${B - T}px` });
    const cw = Math.min(340, innerWidth - 24), ch = card.offsetHeight || 150;
    let x = Math.min(Math.max(12, r.left), innerWidth - cw - 12);
    let y = r.bottom + 12;
    if (y + ch > innerHeight - 12) y = r.top - ch - 12;
    if (y < 12) y = Math.max(12, innerHeight - ch - 12);
    Object.assign(card.style, { left: `${x}px`, top: `${y}px`, width: `${cw}px` });
  }
  function close() {
    hole?.remove(); card?.remove(); hole = card = null;
    removeEventListener("resize", position); removeEventListener("scroll", position, true); removeEventListener("keydown", onKey);
    try { localStorage.setItem(KEY, "done"); } catch { /* private mode */ }
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1);
  }
  function go(d) { step += d; if (step >= STEPS.length) return close(); step = Math.max(0, step); place(); }
  function start() {
    if (hole) return;
    step = 0;
    hole = document.createElement("div"); hole.className = "gd-hole";
    card = document.createElement("div"); card.className = "gd-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Guide");
    document.body.append(hole, card);
    card.addEventListener("click", (e) => {
      if (e.target.closest(".gd-next")) go(1); else if (e.target.closest(".gd-back")) go(-1); else if (e.target.closest(".gd-skip")) close();
    });
    addEventListener("resize", position); addEventListener("scroll", position, { capture: true, passive: true }); addEventListener("keydown", onKey);
    place();
  }

  const help = document.createElement("button");
  help.id = "guide-btn"; help.textContent = "Guide"; help.title = "A 30-second tour of the terminal";
  help.addEventListener("click", start);
  $("#tools").append(help);

  // The user manual (PDF), opened in a new tab where it can be read or saved
  const manual = document.createElement("button");
  manual.id = "manual-btn"; manual.textContent = "Manual"; manual.title = "Download the user manual (PDF)";
  manual.addEventListener("click", () => window.open("/manual.pdf", "_blank", "noopener"));
  $("#tools").append(manual);

  let seen = false; try { seen = localStorage.getItem(KEY) === "done"; } catch { /* private mode */ }
  if (!seen && !/[?&]noguide/.test(location.search)) {
    // Wait for the first data so the banner exists and the layout has settled
    const wait = setInterval(() => { if (bar.children.length) { clearInterval(wait); setTimeout(start, 900); } }, 300);
  }
})();
