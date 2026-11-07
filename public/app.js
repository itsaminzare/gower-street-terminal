// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Gower Street Terminal front-end: maps, alerts, news, social, prices, analyst — all fed by SSE.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = (t) => {
    const s = (Date.now() - (typeof t === "number" ? t : Date.parse(t))) / 1000;
    if (s < 60) return `${Math.max(0, Math.round(s))}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  };
  const hhmm = (t) => new Date(t).toISOString().slice(11, 16) + "Z";

  const state = { zones: {}, vessels: new Map(), alerts: [], news: [], social: [], prices: {}, status: {}, analyst: {},
    official: [], filters: { news: "ALL", social: "ALL", official: "ALL" }, tankersOnly: false, sound: false };
  const maps = {}, layers = {}, markers = new Map(), pulses = new Map();
  window.GST = { state, esc, ago, hhmm }; // shared with chart.js

  // ---------------------------------------------------------------- clock
  // World clocks — IANA zones handle DST automatically (Washington, London)
  const CITIES = [
    ["WASHINGTON", "America/New_York"], ["LONDON", "Europe/London"], ["RIYADH", "Asia/Riyadh"],
    ["SANA'A", "Asia/Aden"], ["TEHRAN", "Asia/Tehran"], ["ABU DHABI", "Asia/Dubai"],
  ];
  const fmt = Object.fromEntries(CITIES.map(([c, tz]) => [c, {
    time: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
    day: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }),
    off: new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "shortOffset" }),
  }]));
  function tickClocks() {
    const now = new Date();
    $("#clock").textContent = now.toISOString().slice(11, 19) + " UTC";
    $("#clocks").innerHTML = CITIES.map(([c]) => {
      const f = fmt[c], t = f.time.format(now), h = +t.slice(0, 2);
      const off = (f.off.formatToParts(now).find((p) => p.type === "timeZoneName")?.value || "").replace("GMT", "UTC");
      const day = h >= 6 && h < 18;
      return `<div class="clk" title="${c}: ${f.day.format(now)} ${t} (${off || "UTC"})"><span class="city">${c}</span><span class="time">${t.slice(0, 5)}</span><span class="${day ? "day" : "night"}">${day ? "☀" : "☾"}</span></div>`;
    }).join("");
  }
  tickClocks();
  setInterval(tickClocks, 1000);

  // ---------------------------------------------------------------- maps
  function initMaps(zones) {
    for (const z of Object.values(zones)) {
      if (maps[z.id]) continue;
      const m = L.map(`map-${z.id}`, { zoomControl: true, attributionControl: true, worldCopyJump: false }).setView(z.center, z.zoom);
      const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
      L.tileLayer(esri + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "Tiles © Esri, HERE, Garmin, © OpenStreetMap" }).addTo(m);
      L.tileLayer(esri + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16 }).addTo(m);
      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 14, opacity: 0.6, attribution: "OpenSeaMap" }).addTo(m);
      L.rectangle(z.box, { color: "#c98a2a", weight: 1.5, dashArray: "6 5", fill: false, interactive: false }).addTo(m);
      // The waterway itself: bright outline + light fill + label, so the important area is obvious
      if (z.focus) {
        L.polygon(z.focus.poly, { color: "#ffd400", weight: 2.5, opacity: 0.95, fillColor: "#ffd400", fillOpacity: 0.07, dashArray: null, interactive: false })
          .bindTooltip(z.focus.label, { permanent: true, direction: "center", className: "focus-label", interactive: false }).addTo(m);
      }
      L.polyline(z.gate, { color: "#ffa028", weight: 2, opacity: 0.7 }).bindTooltip("Transit gate").addTo(m);
      for (const a of z.anchorages) L.circle([a.lat, a.lon], { radius: a.km * 1000, color: "#2c5d8a", weight: 1, fillOpacity: 0.04 }).bindTooltip(a.name).addTo(m);
      maps[z.id] = m;
      layers[z.id] = L.layerGroup().addTo(m);
      // Legend
      const legend = L.control({ position: "topright" });
      legend.onAdd = () => Object.assign(L.DomUtil.create("div", "map-legend"), { innerHTML:
        `<div><svg width="16" height="16" viewBox="-8 -8 16 16"><circle r="7.5" fill="#ffb000" fill-opacity=".2"/><path d="M0,-6 L4,5 L0,2.5 L-4,5 Z" fill="#ffb000" stroke="#fff" stroke-width=".8"/></svg> Tanker</div>` +
        `<div><svg width="16" height="16" viewBox="-8 -8 16 16"><path d="M0,-4.5 L3,3.5 L0,2 L-3,3.5 Z" fill="#5d8fc4"/></svg> Other ship</div>` +
        `<div><svg width="16" height="16" viewBox="-8 -8 16 16"><circle r="2.6" fill="#8a8a8a" fill-opacity=".3" stroke="#bbb" stroke-width=".8"/></svg> Type not yet known</div>` +
        `<div><svg width="16" height="16" viewBox="-8 -8 16 16"><circle r="6" fill="none" stroke="${RING.sanctioned}" stroke-width="2"/></svg> Sanctioned</div>` +
        `<div><svg width="16" height="16" viewBox="-8 -8 16 16"><rect x="-7" y="-5" width="14" height="10" fill="#ffd400" fill-opacity=".15" stroke="#ffd400" stroke-width="1.5"/></svg> Key waterway</div>` +
        `<div><svg width="16" height="16" viewBox="-8 -8 16 16"><rect x="-7" y="-5" width="14" height="10" fill="none" stroke="#c98a2a" stroke-dasharray="3 2"/></svg> Watched area</div>` });
      legend.addTo(m);
    }
  }

  // Each map panel holds two zones behind tabs; the active zone drives the header stats
  const panelZone = { "p-hormuz": "HORMUZ", "p-bab": "BAB" };
  document.querySelectorAll(".map-panel").forEach((panel) => {
    panel.querySelector(".zone-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-z]"); if (!b) return;
      showZone(panel, b.dataset.z);
    });
  });
  function showZone(panel, z) {
    panelZone[panel.id] = z;
    panel.querySelectorAll(".zone-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.z === z));
    panel.querySelectorAll(".maps .map").forEach((m) => (m.hidden = m.id !== `map-${z}`));
    maps[z]?.invalidateSize();
    renderStats();
    panel.dispatchEvent(new CustomEvent("zonechange", { detail: z }));
  }
  // LIVE MAP: VesselFinder's public embed of the active zone. Their receiver + satellite network covers
  // Hormuz and the Red Sea far better than the free feed; our alerts/flags don't apply to their map.
  const VF_ZOOM = { HORMUZ: 8, BAB: 8, SUEZ: 8, CAPE: 7 };
  function vesselFinderUrl(z, h) {
    const zone = state.zones[z]; if (!zone) return "about:blank";
    const [lat, lon] = zone.center;
    const qs = `zoom=${VF_ZOOM[z] || 8}&lat=${lat}&lon=${lon}&width=100%25&height=${Math.max(400, Math.round(h))}` +
      "&names=false&track=false&fleet=false&fleet_name=false&fleet_hide_old_positions=false&clicktoact=false&store_pos=false" +
      // VesselFinder's ship-group bitmask (511 = all). Worked out by testing each bit with names shown at Fujairah:
      // 1 = cargo, 2 = tankers, 4 = tugs/special craft, 128 = other/offshore, 256 = pleasure craft. So 2 = tankers only.
      (state.tankersOnly ? "&fil=2" : "") +
      `&ra=${encodeURIComponent(location.href)}`;
    return `https://www.vesselfinder.com/aismap?${qs}`;
  }
  // Default view per zone (the free AIS feed has no receivers in the Hormuz narrows, Bab el-Mandeb or Suez).
  // Choices are remembered per zone; the version suffix resets saved choices when the defaults change.
  const VIEW_KEY = (z) => `gst-view2-${z}`;
  // All four zones open in the same style (the live map); our own map is one click away on each
  const DEFAULT_VIEW = { HORMUZ: "live", BAB: "live", SUEZ: "live", CAPE: "live" };
  function viewPref(z) { try { return localStorage.getItem(VIEW_KEY(z)) || DEFAULT_VIEW[z] || "ours"; } catch { return DEFAULT_VIEW[z] || "ours"; } }
  function setViewPref(z, v) { try { localStorage.setItem(VIEW_KEY(z), v); } catch { /* private mode */ } }
  let viewsApplied = false;
  function applyViewPrefs() {
    if (viewsApplied) return; viewsApplied = true;
    document.querySelectorAll(".map-panel").forEach((p) => { if (viewPref(panelZone[p.id]) === "live") setLiveMap(p, true); });
  }
  function setLiveMap(panel, on) {
    const box = panel.querySelector(".maps");
    let frame = box.querySelector("iframe.livemap");
    const btn = panel.querySelector(".livemap-btn");
    btn.classList.toggle("on", on);
    btn.textContent = on ? "◧ OUR MAP" : "🛰 LIVE MAP";
    if (!on) { box.querySelectorAll(".livemap, .livemap-note, .livemap-overlay, .livemap-catch, .livemap-recenter").forEach((e) => e.remove()); return; }
    if (!frame) {
      frame = Object.assign(document.createElement("iframe"), { className: "livemap", title: "VesselFinder live map" });
      frame.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
      box.append(frame);
      box.insertAdjacentHTML("beforeend",
        `<div class="livemap-note">Live map © <a href="https://www.vesselfinder.com" target="_blank" rel="noopener">VesselFinder</a> · their data, not covered by this terminal's alerts or flags</div>` +
        `<svg class="livemap-overlay"></svg><div class="livemap-catch" title="Click or scroll to explore the live map"></div>` +
        `<button class="livemap-recenter" hidden title="Return to the chokepoint view and show its outline">⌖ RE-CENTER</button>`);
      // Their map can't tell us when it's panned, so the outline hides on the first click/scroll and RE-CENTER restores both
      const catcher = box.querySelector(".livemap-catch");
      const release = () => { box.querySelector(".livemap-overlay").style.display = "none"; catcher.style.display = "none"; box.querySelector(".livemap-recenter").hidden = false; };
      catcher.addEventListener("pointerdown", release);
      catcher.addEventListener("wheel", release, { passive: true });
      box.querySelector(".livemap-recenter").addEventListener("click", () => setLiveMap(panel, true));
    }
    frame.src = vesselFinderUrl(panelZone[panel.id], box.clientHeight);
    box.querySelector(".livemap-overlay").style.display = "";
    box.querySelector(".livemap-catch").style.display = "";
    box.querySelector(".livemap-recenter").hidden = true;
    drawLiveOverlay(panel);
  }

  // Draw the watched area + key waterway over VesselFinder's map at the exact pixels their map uses.
  // Their embed is OpenLayers (Web Mercator, 256-px tiles) under a 20-px header, centred on the URL's lat/lon.
  const VF_HEADER = 20;
  function mercPx(lat, lon, zoom) {
    const world = 256 * 2 ** zoom, s = Math.sin((lat * Math.PI) / 180);
    return [((lon + 180) / 360) * world, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world];
  }
  function drawLiveOverlay(panel) {
    const box = panel.querySelector(".maps"), svg = box.querySelector(".livemap-overlay");
    const z = panelZone[panel.id], zone = state.zones[z];
    if (!svg || !zone) return;
    const W = box.clientWidth, H = box.clientHeight, zoom = VF_ZOOM[z] || 8;
    const [cx, cy] = mercPx(zone.center[0], zone.center[1], zoom);
    const toPx = ([lat, lon]) => { const [x, y] = mercPx(lat, lon, zoom); return [W / 2 + (x - cx), VF_HEADER + (H - VF_HEADER) / 2 + (y - cy)]; };
    const pts = (arr) => arr.map((p) => toPx(p).map((n) => n.toFixed(1)).join(",")).join(" ");
    const [[a, b], [c, d]] = zone.box;
    let html = `<polygon points="${pts([[a, b], [a, d], [c, d], [c, b]])}" fill="none" stroke="#c98a2a" stroke-width="2" stroke-dasharray="7 5"/>`;
    if (zone.focus) {
      const poly = zone.focus.poly.map(toPx);
      const lx = poly.reduce((s, p) => s + p[0], 0) / poly.length, ly = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      html += `<polygon points="${pts(zone.focus.poly)}" fill="#ffd400" fill-opacity=".08" stroke="#ffd400" stroke-width="3"/>` +
        `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" class="lm-label">${esc(zone.focus.label)}</text>`;
    }
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = html;
  }
  // VesselFinder keeps its map's left edge (not its centre) when the frame is resized, so after a real size
  // change the live map is reloaded (debounced) to stay centred under the outline.
  document.querySelectorAll(".map-panel").forEach((panel) => {
    const box = panel.querySelector(".maps");
    let last = null, timer = null;
    new ResizeObserver(() => {
      const size = [box.clientWidth, box.clientHeight];
      if (last && Math.abs(size[0] - last[0]) < 20 && Math.abs(size[1] - last[1]) < 20) return;
      last = size;
      if (!box.querySelector("iframe.livemap") || box.querySelector(".livemap-recenter:not([hidden])")) return;
      clearTimeout(timer);
      timer = setTimeout(() => setLiveMap(panel, true), 400);
    }).observe(box);
  });
  document.querySelectorAll(".map-panel").forEach((panel) => {
    panel.querySelector(".livemap-btn").addEventListener("click", () => {
      const on = !panel.querySelector(".maps iframe.livemap");
      setViewPref(panelZone[panel.id], on ? "live" : "ours");
      setLiveMap(panel, on);
    });
    // Each zone opens in its own preferred view
    panel.addEventListener("zonechange", () => setLiveMap(panel, viewPref(panelZone[panel.id]) === "live"));
  });

  function panelFor(zone) { return [...document.querySelectorAll(".map-panel")].find((p) => p.dataset.zones.split(",").includes(zone)); }

  const COLORS = { Tanker: "#ffa028", Cargo: "#5d8fc4", Passenger: "#b07cd8", Military: "#ff4d4d", "Law enf.": "#ff4d4d", Unknown: "#8a8a8a" };
  // Rings around the hull mark special status: magenta = OFAC-sanctioned, cyan = ship-to-ship transfer, yellow dashed = GPS jump
  const RING = { sanctioned: "#ff3df2", sts: "#2ee6e6", spoof: "#ffd400" };
  // Tankers: large bright arrow with a glow and white outline, drawn above everything else.
  // Other ships: small muted markers. Unidentified ships (type not received yet): faint grey outlines.
  function vesselIcon(v) {
    const tanker = v.cls === "Tanker", unknown = v.cls === "Unknown";
    const color = v.incident ? "#ff3b3b" : tanker ? "#ffb000" : COLORS[v.cls] || "#8a8a8a";
    const rot = Math.round((v.hdg ?? v.cog ?? 0) / 5) * 5; // matches iconKey, so redraws only happen on visible changes
    const moving = (v.sog ?? 0) > 0.8;
    let shape, style;
    if (tanker) {
      shape = moving ? `<path d="M0,-13 L8,10 L0,5 L-8,10 Z"/>` : `<rect x="-6" y="-9" width="12" height="18" rx="5"/>`;
      style = v.dark ? `fill-opacity=".45" stroke="#ff3b3b" stroke-width="2" stroke-dasharray="3 2"` : `fill-opacity="1" stroke="#fff" stroke-width="1.6"`;
    } else {
      shape = moving ? `<path d="M0,-6 L4,5 L0,2.5 L-4,5 Z"/>` : `<circle r="2.6"/>`;
      style = unknown ? `fill-opacity=".25" stroke="#bbb" stroke-width=".8"` : `fill-opacity="${v.dark ? 0.3 : 0.75}" stroke="#000" stroke-width=".6"`;
    }
    const glow = tanker && !v.dark ? `<circle r="15" fill="${color}" fill-opacity=".18"/><circle r="15" fill="none" stroke="${color}" stroke-opacity=".55" stroke-width="1"/>` : "";
    const rings = [
      v.sanctioned && `<circle r="17" fill="none" stroke="${RING.sanctioned}" stroke-width="2.5"/>`,
      v.sts && `<circle r="20" fill="none" stroke="${RING.sts}" stroke-width="2"/>`,
      v.spoof && `<circle r="18.5" fill="none" stroke="${RING.spoof}" stroke-width="1.8" stroke-dasharray="3 2"/>`,
    ].filter(Boolean).join("");
    const size = tanker || rings ? 44 : 16;
    return L.divIcon({
      className: `vessel${tanker ? " tanker" : ""}${v.incident ? " incident" : ""}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      html: `<svg width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}">${glow}${rings}<g transform="rotate(${rot})" fill="${color}" ${style}>${shape}</g></svg>`,
    });
  }

  function popup(v) {
    const row = (k, val) => (val == null || val === "" ? "" : `<tr><td>${k}</td><td>${esc(val)}</td></tr>`);
    return `<b>${esc(v.name || "MMSI " + v.mmsi)}</b> <span class="muted">${esc(v.cls)}${v.type ? " (" + v.type + ")" : ""}</span>
      ${v.incident ? `<div style="color:#ff6b6b;font-weight:bold">⚠ ${esc(v.incident)}</div>` : ""}
      ${v.dark ? `<div style="color:#ffb000">AIS signal lost — last fix ${ago(v.lastSeen)} ago</div>` : ""}
      ${v.sanctioned ? `<div style="color:${RING.sanctioned};font-weight:bold">⛔ OFAC-sanctioned: listed as "${esc(v.sanctioned.name)}" · programme ${esc(v.sanctioned.program || "?")}${v.sanctioned.owner ? ` · owner ${esc(v.sanctioned.owner)}` : ""}</div>` : ""}
      ${v.sts ? `<div style="color:${RING.sts}">⇄ Possible ship-to-ship transfer with ${esc(state.vessels.get(v.sts)?.name || "MMSI " + v.sts)}</div>` : ""}
      ${v.spoof ? `<div style="color:${RING.spoof}">⌖ Position jumped recently: possible GPS spoofing/jamming</div>` : ""}
      <table class="vtable">
      ${row("MMSI", v.mmsi)}${row("IMO", v.imo)}${row("Callsign", v.callsign)}${row("Dest", v.dest)}
      ${row("SOG", v.sog != null ? v.sog.toFixed(1) + " kn" : null)}${row("COG", v.cog != null ? Math.round(v.cog) + "°" : null)}
      ${row("Status", v.navText)}${row("Length", v.length ? v.length + " m" : null)}${row("Draught", v.draught ? v.draught + " m" : null)}
      ${row("Last fix", ago(v.lastSeen) + " ago")}
      </table>
      <div style="margin-top:4px"><a target="_blank" rel="noopener" href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${v.mmsi}">MarineTraffic ↗</a> ·
      <a target="_blank" rel="noopener" href="https://www.vesselfinder.com/vessels/details/${v.mmsi}">VesselFinder ↗</a></div>`;
  }

  // Ship type arrives in separate static messages (~every 6 min), so untyped vessels are hidden in tankers-only mode until classified
  // Ships whose type hasn't arrived yet ("Unknown") stay visible as faint grey markers: many ships send their type rarely,
  // and hiding them left the chokepoint maps looking empty.
  // TANKERS ONLY means exactly that: every non-tanker (including ships whose type isn't known yet) is hidden
  function visible(v) { return !state.tankersOnly || v.cls === "Tanker"; }

  function upsertVessel(v) {
    state.vessels.set(v.mmsi, v);
    const z = v.zone;
    let mk = markers.get(v.mmsi);
    if (!z || !layers[z] || !visible(v)) { if (mk) { mk.m.remove(); mk.trail.remove(); markers.delete(v.mmsi); } return; }
    const key = iconKey(v);
    const trailStyle = v.cls === "Tanker" ? { color: "#ffb000", weight: 2, opacity: 0.6 } : { color: COLORS[v.cls] || "#888", weight: 1, opacity: 0.25 };
    if (!mk) {
      mk = { key, m: L.marker([v.lat, v.lon], { icon: vesselIcon(v), zIndexOffset: v.cls === "Tanker" ? 1000 : 0 }).bindPopup(() => popup(state.vessels.get(v.mmsi))),
             trail: L.polyline(v.track || [], trailStyle) };
      mk.m.addTo(layers[z]); mk.trail.addTo(layers[z]);
      mk.m.bindTooltip(() => { const s = state.vessels.get(v.mmsi) || v; return `${esc(s.name || s.mmsi)} · ${s.sog?.toFixed(1) ?? "?"} kn`; }, { direction: "top", offset: [0, -6] });
      markers.set(v.mmsi, mk);
    } else {
      mk.m.setLatLng([v.lat, v.lon]);
      mk.trail.setLatLngs(v.track || []);
      // Rebuilding a marker's element every 2 s made ships blink, especially while panning; only rebuild when its look changes
      if (mk.key !== key) {
        mk.key = key;
        mk.m.setIcon(vesselIcon(v)); mk.m.setZIndexOffset(v.cls === "Tanker" ? 1000 : 0);
        mk.trail.setStyle(trailStyle);
      }
      if (mk.m.isPopupOpen()) mk.m.setPopupContent(popup(v));
    }
  }
  // Everything that changes a marker's appearance (heading rounded to 5°)
  function iconKey(v) {
    const rot = Math.round((v.hdg ?? v.cog ?? 0) / 5) * 5;
    return [v.cls, rot, (v.sog ?? 0) > 0.8, !!v.incident, !!v.dark, !!v.sanctioned, !!v.sts, !!v.spoof].join("|");
  }
  function removeVessel(mmsi) { const mk = markers.get(mmsi); if (mk) { mk.m.remove(); mk.trail.remove(); markers.delete(mmsi); } state.vessels.delete(mmsi); }
  function redrawAllVessels() { for (const [m, mk] of markers) { mk.m.remove(); mk.trail.remove(); } markers.clear(); for (const v of state.vessels.values()) upsertVessel(v); }

  function pulseAt(a) {
    if (a.lat == null || !layers[a.zone]) return;
    const p = L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "", html: '<div class="pulse"></div>', iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false }).addTo(layers[a.zone]);
    pulses.set(a.id, p);
    setTimeout(() => { p.remove(); pulses.delete(a.id); }, 10 * 60 * 1000);
  }

  // ---------------------------------------------------------------- stats & status
  function renderStats() {
    const st = state.status.stats || {};
    for (const [pid, z] of Object.entries(panelZone)) {
      const s = st[z]; if (!s) continue;
      // Short summary in the header; flags only appear when non-zero; full detail on hover
      const el = document.querySelector(`#${pid} .stats`);
      const flag = (n, label, c) => (n ? `<span class="flag" style="--c:${c}">${n} ${label}</span>` : "");
      el.innerHTML = `<b>${s.tankers}</b> tankers · <b>${s.vessels}</b> ships` +
        flag(s.dark, "dark", "#ff4d4d") + flag(s.sanctioned, "sanctioned", RING.sanctioned) + flag(s.sts, "STS", RING.sts) + flag(s.spoofed, "GPS jump", RING.spoof) +
        (s.vessels === 0 && state.status.ais?.mode === "live" ? ` <span class="muted">· few free receivers here</span>` : "");
      el.title = `This terminal's own AIS data for this zone:\n` +
        `Tankers: ${s.tankers} (${s.tankersMoving} moving, avg ${s.avgTankerSpeed ?? "–"} kn)\nAll ships: ${s.vessels}\n` +
        `AIS-dark: ${s.dark} · Sanctioned: ${s.sanctioned} · Ship-to-ship: ${s.sts} · GPS jumps: ${s.spoofed}\n` +
        `Gate transits, last 24 h: ${s.transits24h} (tankers ${s.tankerTransits24h})`;
    }
    // Ship counts on every zone tab, so it's obvious where the ships are
    document.querySelectorAll(".zone-tabs button[data-z]").forEach((b) => {
      b.dataset.label ||= b.textContent;
      const n = st[b.dataset.z]?.vessels;
      b.textContent = n == null ? b.dataset.label : `${b.dataset.label} (${n})`;
    });
  }
  function renderFeeds() {
    const s = state.status; if (!s.ais) return;
    const pills = [];
    const ais = s.ais;
    pills.push(ais.mode === "demo" ? `<span class="pill demo">AIS DEMO</span>` :
      `<span class="pill ${ais.connected ? "ok" : "bad"}" title="${esc(ais.error || "")}">AIS ${ais.connected ? "LIVE " + (ais.messages || 0).toLocaleString() + " msgs" : "OFFLINE"}</span>`);
    pills.push(`<span class="pill ${s.news?.ok ? "ok" : "bad"}" title="Failed: ${esc((s.news?.failed || []).join(", "))}">NEWS ${s.news?.ok ?? 0}/${s.news?.feeds ?? 0}</span>`);
    pills.push(`<span class="pill ${s.official?.ok ? "ok" : "bad"}" title="Failed: ${esc((s.official?.failed || []).join(", "))}">OFFICIAL ${s.official?.ok ?? 0}/${s.official?.sources ?? 0}</span>`);
    for (const [k, v] of Object.entries(s.social || {})) pills.push(`<span class="pill ${v.ok ? "ok" : "bad"}" title="${esc(v.error || "")}">${k.toUpperCase()}</span>`);
    pills.push(`<span class="pill ${s.prices?.ok ? "ok" : "bad"}" title="${esc(s.prices?.error || "")}">PRICES</span>`);
    pills.push(`<span class="pill ${s.curve?.ok ? "ok" : "bad"}" title="${esc(s.curve?.error || "Brent/WTI futures curves")}">CURVE</span>`);
    pills.push(`<span class="pill ${s.sanctions?.ok ? "ok" : "bad"}" title="${esc(s.sanctions?.error || `OFAC SDN list: ${s.sanctions?.vessels} vessels`)}">OFAC ${s.sanctions?.vessels || 0}</span>`);
    pills.push(`<span class="pill ${s.flows?.ok ? "ok" : "bad"}" title="${esc(s.flows?.error ? `IMF PortWatch: ${s.flows.error}. Retrying${s.flows.nextTry ? " at " + hhmm(s.flows.nextTry) : ""}.` : "IMF PortWatch transit data")}">IMF FLOWS</span>`);
    pills.push(`<span class="pill ${s.analyst?.enabled ? "ok" : "bad"}" title="${esc(s.analyst?.error || "")}">AI ANALYST</span>`);
    pills.push(`<span class="pill ${s.notify?.channels?.length ? (s.notify.lastError ? "bad" : "ok") : ""}" title="${esc(s.notify?.channels?.length ? `Phone alerts via ${s.notify.channels.join(" + ")} (${s.notify.minSeverity}+)${s.notify.lastError ? " · last error: " + s.notify.lastError : ""}` : "Phone alerts off (see ⚙ ALERTS)")}">PHONE</span>`);
    // Full source list lives in a pop-up; the top bar shows one summary button
    $("#feeds").innerHTML = `<div class="pop-title">Data sources</div><div class="pills">${pills.join("")}</div>` +
      `<div class="pop-note">Green = working · red = unavailable or not configured. Hover a source for details.</div>`;
    const bad = (pills.join("").match(/class="pill bad"/g) || []).length;
    const btn = $("#status-btn");
    btn.textContent = ais.mode === "demo" ? "● Demo data" : bad ? `● ${bad} source${bad > 1 ? "s" : ""} offline` : "● All data live";
    btn.className = ais.mode === "demo" ? "warn" : bad > 3 ? "bad" : "ok";
    $("#demo-banner").hidden = ais.mode !== "demo";
  }
  $("#status-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#feeds").hidden = !$("#feeds").hidden; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".status-wrap")) $("#feeds").hidden = true; });

  // Feed panel: News / Official / Social tabs
  document.querySelectorAll(".feed-tabs button").forEach((b) => b.addEventListener("click", () => {
    const f = b.dataset.feed;
    document.querySelectorAll(".feed-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll(".feed-sub").forEach((x) => (x.hidden = x.dataset.for !== f));
    document.querySelectorAll(".feed-list").forEach((x) => (x.hidden = x.id !== f));
  }));
  function feedCounts() {
    const recent = (arr, k) => arr.filter((x) => Date.now() - Date.parse(x[k]) < 6 * 3600_000).length;
    $("#n-news").textContent = recent(state.news, "published") || "";
    $("#n-official").textContent = recent(state.official, "published") || "";
    $("#n-social").textContent = recent(state.social, "time") || "";
  }
  setInterval(feedCounts, 30_000);

  // ---------------------------------------------------------------- prices
  const lastPx = {};
  function spark(arr) {
    if (!arr || arr.length < 2) return "";
    // Drawn in a 100x30 box and stretched to the tile width (non-scaling stroke keeps the line crisp)
    const w = 100, h = 30, mn = Math.min(...arr), mx = Math.max(...arr), r = mx - mn || 1;
    const pts = arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(2)},${(h - 2 - ((v - mn) / r) * (h - 4)).toFixed(2)}`).join(" ");
    const col = arr.at(-1) >= arr[0] ? "#3ad17a" : "#ff4d4d";
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polygon points="0,${h} ${pts} ${w},${h}" fill="${col}" fill-opacity="0.12"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function renderPrices() {
    const list = Object.values(state.prices);
    if (!list.length) { $("#ticker").innerHTML = `<div class="empty">Waiting for prices…</div>`; return; }
    const order = ["BZ=F", "CL=F", "NG=F", "TTF=F", "HO=F", "RB=F", "GC=F", "FRO", "DHT", "STNG", "BDRY"];
    list.sort((a, b) => order.indexOf(a.sym) - order.indexOf(b.sym));
    $("#ticker").innerHTML = list.map((p) => {
      const cls = p.change >= 0 ? "up" : "down";
      const flash = lastPx[p.sym] != null && lastPx[p.sym] !== p.price ? (p.price > lastPx[p.sym] ? "flash-up" : "flash-down") : "";
      lastPx[p.sym] = p.price;
      return `<div class="tick ${flash}" data-sym="${esc(p.sym)}" title="${esc(p.sym)} · as of ${hhmm(p.time)} (delayed) — click for detailed chart">
        <div><span class="l">${esc(p.label)}</span><span class="u">${esc(p.unit)}</span></div>
        <div class="p">${p.price?.toFixed(p.price < 10 ? 3 : 2)}</div>
        <div class="c ${cls}">${p.change >= 0 ? "▲" : "▼"} ${Math.abs(p.change).toFixed(2)} (${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(2)}%)</div>
        ${spark(p.spark)}</div>`;
    }).join("");
  }

  // Spread strip under the ticker: the curve signals traders watch for supply stress
  function renderSpreads() {
    const sp = state.curve?.spreads || {};
    const order = ["brentM1M2", "brentM1M6", "brentM1M12", "wtiM1M6", "brentWti", "crack321"];
    const items = order.filter((k) => sp[k]).map((k) => {
      const s = sp[k];
      const ch = s.change;
      return `<span class="spr" title="${esc(s.note)}"><span class="n">${esc(s.name)}</span> <b>${s.value >= 0 ? "+" : ""}${s.value.toFixed(2)}</b>` +
        (ch != null ? ` <span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"}${Math.abs(ch).toFixed(2)}</span>` : "") + `</span>`;
    });
    $("#spreads").innerHTML = items.length
      ? `<span class="spr-h">Curve ▸</span>${items.join("")}`
      : `<span class="spr-h">CURVE ▸</span><span class="muted">${esc(state.curve?.error || "loading futures curve…")}</span>`;
  }

  // ---------------------------------------------------------------- alerts
  const ZN = { HORMUZ: "HORMUZ", BAB: "BAB EL-MANDEB", SUEZ: "SUEZ", CAPE: "CAPE" };
  function alertHTML(a, fresh) {
    return `<div class="alert ${a.severity}${fresh ? " fresh" : ""}" data-id="${a.id}">
      ${a.lat != null ? `<button class="locate" data-lat="${a.lat}" data-lon="${a.lon}" data-zone="${a.zone}">LOCATE</button>` : ""}
      <div class="meta"><span class="sev">${a.severity.toUpperCase()}</span> <span>${hhmm(a.time)}</span> <span class="reg">${ZN[a.zone] || "MARKETS"}</span> <span>${esc(a.source || "")}</span></div>
      <div class="title">${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>` : esc(a.title)}</div>
      ${a.detail ? `<div class="detail">${esc(a.detail)}</div>` : ""}</div>`;
  }
  function renderAlerts() {
    $("#alerts").innerHTML = state.alerts.length ? state.alerts.map((a) => alertHTML(a)).join("") :
      `<div class="empty">No incidents detected. Watching AIS behaviour (sudden stops, AIS-dark, distress status, course reversals), breaking news and price moves.</div>`;
    $("#alert-count").textContent = `${state.alerts.filter((a) => Date.now() - Date.parse(a.time) < 86400000).length} / 24h`;
  }
  function newAlert(a) {
    state.alerts.unshift(a);
    const el = document.createElement("div");
    el.innerHTML = alertHTML(a, true);
    const list = $("#alerts");
    if (list.querySelector(".empty")) list.innerHTML = "";
    list.prepend(el.firstElementChild);
    $("#alert-count").textContent = `${state.alerts.filter((x) => Date.now() - Date.parse(x.time) < 86400000).length} / 24h`;
    pulseAt(a);
    if (a.severity === "critical") {
      $("#flash").classList.add("on"); setTimeout(() => $("#flash").classList.remove("on"), 900);
      beep(880); setTimeout(() => beep(660), 180);
      if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("Gower Street Terminal", { body: a.title });
    } else if (a.severity === "warning") beep(520);
  }
  $("#alerts").addEventListener("click", (e) => {
    const b = e.target.closest(".locate"); if (!b) return;
    const z = b.dataset.zone, m = maps[z]; if (!m) return;
    const panel = panelFor(z); if (panel && panelZone[panel.id] !== z) showZone(panel, z);
    m.flyTo([+b.dataset.lat, +b.dataset.lon], 11);
  });

  let actx;
  function beep(freq) {
    if (!state.sound) return;
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; o.type = "square"; g.gain.value = 0.05;
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.15);
  }

  // ---------------------------------------------------------------- news & social
  const RN = { HORMUZ: "HORMUZ", BAB: "RED SEA", GLOBAL: "" };
  function renderNews(freshIds = new Set()) {
    const f = state.filters.news;
    const list = state.news.filter((n) => f === "ALL" || (f === "INCIDENT" ? n.incident : n.region === f));
    $("#news").innerHTML = list.length ? list.slice(0, 150).map((n) => `
      <div class="item${n.incident ? " incident" : ""}${freshIds.has(n.id) ? " fresh" : ""}">
        <div class="meta"><span class="src">${esc(n.source)}</span><span>${hhmm(n.published)} · ${ago(n.published)} ago</span><span class="reg">${RN[n.region]}</span></div>
        <div class="title"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></div>
        ${n.summary ? `<div class="sum">${esc(n.summary)}</div>` : ""}
      </div>`).join("") : `<div class="empty">No matching headlines yet.</div>`;
  }
  function renderSocial(freshIds = new Set()) {
    const f = state.filters.social;
    const list = state.social.filter((p) => f === "ALL" || p.platform === f);
    const off = Object.entries(state.status.social || {}).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.error}`);
    $("#social").innerHTML = list.length ? list.slice(0, 150).map((p) => `
      <div class="item${freshIds.has(p.id) ? " fresh" : ""}">
        <div class="meta"><span class="src ${esc(p.platform)}">${esc(p.platform)}</span><span>${esc(p.author)} ${esc(p.handle)}</span><span>${ago(p.time)} ago</span></div>
        <div class="title"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.text)}</a></div>
      </div>`).join("") : `<div class="empty">No posts yet.${off.length ? "<br><br>" + off.map(esc).join("<br>") : ""}</div>`;
  }
  document.querySelectorAll(".filters[data-target]").forEach((g) => g.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    state.filters[g.dataset.target] = b.dataset.f;
    ({ news: renderNews, social: renderSocial, official: renderOfficial })[g.dataset.target]();
  }));

  const SIDE = { US: "US", IRAN: "IRAN", HOUTHI: "YEMEN/HOUTHI", GULF: "GULF", UK: "UK", UN: "UN" };
  function renderOfficial(freshIds = new Set()) {
    const f = state.filters.official;
    const list = state.official.filter((s) => f === "ALL" || s.side === f || (f === "UK" && s.side === "UN"));
    $("#official").innerHTML = list.length ? list.slice(0, 150).map((s) => `
      <div class="item${s.incident ? " incident" : ""}${freshIds.has(s.id) ? " fresh" : ""}">
        <div class="meta"><span class="side ${s.side}">${SIDE[s.side]}</span><span class="org">${esc(s.org)}</span>
          <span class="mode ${s.mode}" title="${s.mode === "direct" ? "Published by the body itself" : "Statement as reported by a news outlet"}">${s.mode === "direct" ? "DIRECT" : "VIA " + esc(s.via).toUpperCase()}</span>
          <span>${hhmm(s.published)} · ${ago(s.published)} ago</span></div>
        <div class="title"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></div>
        ${s.summary ? `<div class="sum">${esc(s.summary)}</div>` : ""}
      </div>`).join("") : `<div class="empty">No matching statements yet.</div>`;
  }

  // ---------------------------------------------------------------- analyst
  function renderAnalyst() {
    const a = state.analyst || {};
    const el = $("#analyst");
    const b = a.brief;
    let html = "";
    if (a.running) html += `<div class="muted" style="margin-bottom:6px">▶ Analyst is reviewing the latest picture…</div>`;
    if (!b) {
      html += a.enabled ? `<div class="empty">First brief will appear shortly after startup.</div>` :
        `<div class="empty">AI analyst is off.<br><br>${esc(a.error || "")}<br><br>Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart.</div>`;
      if (a.error && a.enabled) html += `<div style="color:#ff6b6b">${esc(a.error)}</div>`;
      el.innerHTML = html; return;
    }
    const zn = ZN;
    html += `<h3><span class="risk ${b.overall_risk}">${b.overall_risk}</span>${esc(b.headline)}</h3>
      ${b.chokepoints.map((c) => `<div class="sec"><span class="risk ${c.risk}">${c.risk}</span>${zn[c.zone]}</div><div>${esc(c.status)}</div>`).join("")}
      <div class="sec">KEY DEVELOPMENTS</div><ul>${b.key_developments.map((d) => `<li>${esc(d.text)} <span class="conf ${d.confidence}">[${d.confidence.toUpperCase()} · ${d.sources.map(esc).join(", ")}]</span></li>`).join("")}</ul>
      <div class="sec">MARKET VIEW</div><div>${esc(b.market_view)}</div>
      <div class="sec">WATCH NEXT</div><ul>${b.watch_next.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
      <div class="foot">${esc(b.model)} · ${hhmm(b.generated)} (${ago(b.generated)} ago) · trigger: ${esc(b.reason)}. AI-generated from the feeds on this screen; verify before trading.</div>
      ${a.error ? `<div style="color:#ff6b6b">Last run failed: ${esc(a.error)}</div>` : ""}`;
    el.innerHTML = html;
  }
  $("#run-analyst").addEventListener("click", async () => {
    const r = await fetch("/api/analyst/run", { method: "POST" });
    if (r.status === 429) {
      const btn = $("#run-analyst"), msg = (await r.json()).error;
      btn.textContent = "COOLING DOWN"; btn.title = msg;
      setTimeout(() => { btn.textContent = "RUN NOW"; btn.title = ""; }, 4000);
    }
  });

  // ---------------------------------------------------------------- ask the analyst (chat)
  const chat = [];
  $("#an-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $("#an-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    const ask = b.dataset.t === "ask";
    $("#analyst").hidden = ask; $("#ask").hidden = !ask; $("#run-analyst").hidden = ask;
    if (ask) { renderChat(); refreshQuota(); $("#ask-input").focus(); }
  });
  // Shared deployments cap chat use; show what's left
  async function refreshQuota() {
    try {
      const q = await fetch("/api/ask/limits").then((r) => r.json());
      const parts = [];
      if (q.perVisitorLimit != null) parts.push(`${Math.max(0, q.perVisitorLimit - q.usedByYou)} of ${q.perVisitorLimit} questions left for you today`);
      if (q.dailyLimit != null) parts.push(`${Math.max(0, q.dailyLimit - q.usedToday)} left for all visitors`);
      $("#ask-quota").textContent = parts.length ? parts.join(" · ") + " · resets 00:00 UTC" : "";
    } catch { /* limits are informational only */ }
  }
  function renderChat() {
    const log = $("#ask-log");
    log.innerHTML = chat.length ? chat.map((m) => `<div class="msg ${m.role}"><div class="who">${m.role === "user" ? "YOU" : "ANALYST"}</div><div class="txt">${esc(m.content)}${m.pending ? '<span class="cursor">▍</span>' : ""}</div></div>`).join("")
      : `<div class="empty">${state.analyst?.enabled ? "Ask anything about the live picture. Each question is answered from the current feeds: AIS, alerts, news, official statements, prices, the futures curve and IMF transit data." : "AI analyst is off. Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart to use chat."}</div>`;
    log.scrollTop = log.scrollHeight;
  }
  $("#ask-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#ask-input").value.trim();
    if (!q || chat.at(-1)?.pending) return;
    $("#ask-input").value = "";
    const history = chat.filter((m) => !m.pending).map(({ role, content }) => ({ role, content }));
    chat.push({ role: "user", content: q });
    const ans = { role: "assistant", content: "", pending: true };
    chat.push(ans); renderChat();
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const reader = r.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        ans.content += dec.decode(value, { stream: true });
        renderChat();
      }
    } catch (err) { ans.content += `[${err.message}]`; }
    ans.pending = false; renderChat(); refreshQuota();
  });

  // ---------------------------------------------------------------- toggles
  $("#tankers-only").addEventListener("change", (e) => {
    state.tankersOnly = e.target.checked;
    redrawAllVessels();
    // Reload any live maps with (or without) VesselFinder's tanker filter
    document.querySelectorAll(".map-panel").forEach((p) => { if (p.querySelector(".maps iframe.livemap")) setLiveMap(p, true); });
  });
  $("#sound").addEventListener("change", (e) => {
    state.sound = e.target.checked;
    if (state.sound) { beep(700); if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); }
  });

  // ---------------------------------------------------------------- stream
  function connect() {
    const es = new EventSource("/api/stream");
    es.addEventListener("snapshot", (e) => {
      const s = JSON.parse(e.data);
      state.zones = s.zones; initMaps(s.zones); applyViewPrefs();
      state.vessels.clear(); for (const [m, mk] of markers) { mk.m.remove(); mk.trail.remove(); } markers.clear();
      s.vessels.forEach(upsertVessel);
      state.official = s.official || []; renderOfficial();
      state.alerts = s.alerts; state.news = s.news; state.social = s.social; state.prices = s.prices;
      state.analyst = s.analyst; state.status = s.status; state.curve = s.curve;
      renderAlerts(); renderNews(); renderSocial(); renderPrices(); renderAnalyst(); renderStats(); renderFeeds(); renderSpreads(); feedCounts();
    });
    es.addEventListener("curve", (e) => { state.curve = JSON.parse(e.data); renderSpreads(); });
    es.addEventListener("vessels", (e) => JSON.parse(e.data).forEach(upsertVessel));
    es.addEventListener("vessel-removed", (e) => removeVessel(JSON.parse(e.data)));
    es.addEventListener("alert", (e) => newAlert(JSON.parse(e.data)));
    es.addEventListener("news", (e) => {
      const fresh = JSON.parse(e.data);
      state.news = [...fresh, ...state.news].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 300);
      renderNews(new Set(fresh.map((n) => n.id)));
    });
    es.addEventListener("social", (e) => {
      const fresh = JSON.parse(e.data);
      state.social = [...fresh, ...state.social].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 300);
      renderSocial(new Set(fresh.map((p) => p.id)));
    });
    es.addEventListener("official", (e) => {
      const fresh = JSON.parse(e.data);
      state.official = [...fresh, ...state.official].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 300);
      renderOfficial(new Set(fresh.map((s) => s.id)));
    });
    es.addEventListener("prices", (e) => { state.prices = JSON.parse(e.data); renderPrices(); });
    es.addEventListener("analyst", (e) => { state.analyst = JSON.parse(e.data); renderAnalyst(); });
    es.addEventListener("status", (e) => { state.status = JSON.parse(e.data); renderStats(); renderFeeds(); });
    es.onerror = () => { $("#feeds").innerHTML = `<span class="pill bad">SERVER DISCONNECTED — reconnecting…</span>`; };
  }
  // Shared with tools.js / replay.js
  Object.assign(window.GST, { maps, layers, markers, showZone, panelFor, panelZone, COLORS, RING, ZN, renderStats, setLiveMap, vesselIcon });
  connect();
  setInterval(() => { renderStats(); }, 15000);
})();
