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
      const m = L.map(`map-${z.id}`, { zoomControl: true, attributionControl: true, worldCopyJump: false, zoomSnap: 0.25, zoomDelta: 0.5 }).setView(z.center, z.zoom);
      // Nautical basemap: Esri Ocean (bathymetry, coastlines) rendered dark by a CSS filter (see .base-ocean),
      // with Esri's light reference labels on top and OpenSeaMap seamarks
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 13, maxNativeZoom: 13, className: "base-ocean", attribution: "Tiles © Esri, GEBCO, NOAA, Garmin, HERE · © OpenStreetMap" }).addTo(m);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, className: "base-labels" }).addTo(m);
      L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom: 14, opacity: 0.5, attribution: "OpenSeaMap" }).addTo(m);
      L.rectangle(z.box, { color: "#8a96a3", weight: 1, opacity: 0.6, dashArray: "4 4", fill: false, interactive: false }).addTo(m);
      // The waterway itself: crisp outline, faint fill, small label
      if (z.focus) {
        L.polygon(z.focus.poly, { color: "#e8c547", weight: 1.75, opacity: 0.95, fillColor: "#e8c547", fillOpacity: 0.06, interactive: false }).addTo(m);
        // The waterway's name sits in a caption in the corner, not on the water where the ships are
        const cap = L.control({ position: "topright" });
        cap.onAdd = () => Object.assign(L.DomUtil.create("div", "map-caption"), { innerHTML: `<i></i>${esc(z.focus.label)}` });
        cap.addTo(m);
        // Open on the waterway, not on the whole watched box, so ships are big enough to read.
        // A map laid out while its panel had no size ends up at zoom 0 (the whole world in a few pixels),
        // so the fit is re-applied whenever the map gets a real size and is still zoomed far out.
        m._fit = () => { const s = m.getSize(); if (s.x > 50 && s.y > 50) { m.fitBounds(L.latLngBounds(z.focus.poly).pad(0.35), { animate: false }); m._fitted = true; } };
        m._fit();
        m.on("resize", () => { if (!m._fitted || m.getZoom() < 4) m._fit(); });
      }
      L.polyline(z.gate, { color: "#e8c547", weight: 1.5, opacity: 0.8, dashArray: "2 4" }).bindTooltip("Transit gate").addTo(m);
      for (const a of z.anchorages) L.circle([a.lat, a.lon], { radius: a.km * 1000, color: "#5f7d99", weight: 1, opacity: 0.6, fillOpacity: 0.03, dashArray: "2 3" }).bindTooltip(a.name).addTo(m);
      maps[z.id] = m;
      layers[z.id] = L.layerGroup().addTo(m);
      // Ship names appear once zoomed in enough to read them
      const nameClass = () => m.getContainer().classList.toggle("show-names", m.getZoom() >= 9.5);
      m.on("zoomend", nameClass); nameClass();
      // Compact key, collapsed to one line until hovered
      const legend = L.control({ position: "bottomleft" });
      const sw = (svg) => `<svg width="14" height="14" viewBox="-7 -7 14 14">${svg}</svg>`;
      legend.onAdd = () => Object.assign(L.DomUtil.create("div", "map-legend"), { innerHTML:
        `<div class="lg-h">Key</div><div class="lg-b">` +
        `<span>${sw(`<path d="M0,-6 L4,5 L0,3 L-4,5 Z" fill="${COLORS.Tanker}" stroke="#0b0d10" stroke-width=".8"/>`)}Tanker</span>` +
        `<span>${sw(`<path d="M0,-5 L3.4,4.5 L0,2.6 L-3.4,4.5 Z" fill="${COLORS.Cargo}" stroke="#0b0d10" stroke-width=".8"/>`)}Cargo</span>` +
        `<span>${sw(`<path d="M0,-5 L3.4,4.5 L0,2.6 L-3.4,4.5 Z" fill="${COLORS.Passenger}" stroke="#0b0d10" stroke-width=".8"/>`)}Passenger</span>` +
        `<span>${sw(`<path d="M0,-5 L3.4,4.5 L0,2.6 L-3.4,4.5 Z" fill="${COLORS.Fishing}" stroke="#0b0d10" stroke-width=".8"/>`)}Fishing</span>` +
        `<span>${sw(`<path d="M0,-5 L3.4,4.5 L0,2.6 L-3.4,4.5 Z" fill="${COLORS.Tug}" stroke="#0b0d10" stroke-width=".8"/>`)}Tug / service</span>` +
        `<span>${sw(`<path d="M0,-5 L3.4,4.5 L0,2.6 L-3.4,4.5 Z" fill="${COLORS.Other}" stroke="#0b0d10" stroke-width=".8"/>`)}Other type</span>` +
        `<span>${sw(`<path d="M0,-5 L3.4,4.5 L0,2.6 L-3.4,4.5 Z" fill="${COLORS.Unknown}" stroke="#0b0d10" stroke-width=".8"/>`)}Type not yet received</span>` +
        `<span>${sw(`<rect x="-3" y="-3" width="6" height="6" transform="rotate(45)" fill="#c9d1d9" stroke="#0b0d10" stroke-width=".8"/>`)}Stationary</span>` +
        `<span>${sw(`<circle r="5.5" fill="none" stroke="${RING.sanctioned}" stroke-width="1.6"/>`)}Sanctioned</span>` +
        `<span>${sw(`<circle r="5.5" fill="none" stroke="${RING.sts}" stroke-width="1.6"/>`)}Ship-to-ship</span>` +
        `<span>${sw(`<circle r="5.5" fill="none" stroke="${RING.spoof}" stroke-width="1.4" stroke-dasharray="2 1.5"/>`)}GPS jump</span>` +
        `<span>${sw(`<rect x="-6" y="-4" width="12" height="8" fill="#e8c547" fill-opacity=".12" stroke="#e8c547" stroke-width="1.2"/>`)}Key waterway</span>` +
        `<span>${sw(`<rect x="-6" y="-4" width="12" height="8" fill="none" stroke="#8a96a3" stroke-dasharray="2 2"/>`)}Watched area</span></div>` });
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
    if (maps[z] && (!maps[z]._fitted || maps[z].getZoom() < 4)) maps[z]._fit?.();
    renderStats();
    panel.dispatchEvent(new CustomEvent("zonechange", { detail: z }));
  }
  // LIVE MAP: VesselFinder's public embed of the active zone. Their receiver + satellite network covers
  // Hormuz and the Red Sea far better than the free feed; our alerts/flags don't apply to their map.
  const VF_ZOOM = { HORMUZ: 8, BAB: 8, SUEZ: 8, CAPE: 7 };
  // Zoom out (from the preferred zoom) until the waterway outline fits inside the visible map,
  // clear of VesselFinder's header bar, scale bar and our credit line.
  function liveZoom(z, W, H) {
    const zone = state.zones[z]; let zoom = VF_ZOOM[z] || 8;
    if (!zone || !zone.focus || !W || !H) return zoom;
    for (; zoom > 4; zoom--) {
      const px = zone.focus.poly.map(([la, lo]) => mercPx(la, lo, zoom));
      const [cx, cy] = mercPx(zone.center[0], zone.center[1], zoom);
      const xs = px.map((p) => p[0] - cx), ys = px.map((p) => p[1] - cy);
      const halfW = W / 2 - 24, halfH = (H - VF_HEADER) / 2 - 34;
      if (Math.max(...xs.map(Math.abs)) <= halfW && Math.max(...ys.map(Math.abs)) <= halfH) break;
    }
    return zoom;
  }
  function vesselFinderUrl(z, h, zoom) {
    const zone = state.zones[z]; if (!zone) return "about:blank";
    const [lat, lon] = zone.center;
    const qs = `zoom=${zoom || VF_ZOOM[z] || 8}&lat=${lat}&lon=${lon}&width=100%25&height=${Math.max(400, Math.round(h))}` +
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
    btn.textContent = on ? "Own map" : "Live map";
    if (!on) {
      box.querySelectorAll(".livemap, .livemap-note, .livemap-overlay, .livemap-label, .livemap-catch, .livemap-recenter").forEach((e) => e.remove());
      const m = maps[panelZone[panel.id]];
      if (m) { m.invalidateSize(); if (!m._fitted || m.getZoom() < 4) m._fit?.(); }
      return;
    }
    if (!frame) {
      frame = Object.assign(document.createElement("iframe"), { className: "livemap", title: "VesselFinder live map" });
      frame.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
      box.append(frame);
      box.insertAdjacentHTML("beforeend",
        `<div class="livemap-note">Live map © <a href="https://www.vesselfinder.com" target="_blank" rel="noopener">VesselFinder</a> · their data, not covered by this terminal's alerts or flags</div>` +
        `<svg class="livemap-overlay"></svg><div class="livemap-catch" title="Click or scroll to explore the live map"></div>` +
        `<div class="livemap-label"></div>` +
        `<button class="livemap-recenter" hidden title="Return to the chokepoint view and show its outline">Re-centre</button>`);
      // Their map can't tell us when it's panned, so the outline hides on the first click/scroll and RE-CENTER restores both
      const catcher = box.querySelector(".livemap-catch");
      const release = () => {
        box.querySelector(".livemap-overlay").style.display = "none"; box.querySelector(".livemap-label").style.display = "none";
        catcher.style.display = "none"; box.querySelector(".livemap-recenter").hidden = false;
      };
      catcher.addEventListener("pointerdown", release);
      catcher.addEventListener("wheel", release, { passive: true });
      box.querySelector(".livemap-recenter").addEventListener("click", () => setLiveMap(panel, true));
    }
    const z = panelZone[panel.id];
    box.dataset.vfZoom = liveZoom(z, box.clientWidth, box.clientHeight);
    frame.src = vesselFinderUrl(z, box.clientHeight, +box.dataset.vfZoom);
    box.querySelector(".livemap-overlay").style.display = "";
    box.querySelector(".livemap-label").style.display = "";
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
    // The SVG starts below VesselFinder's header bar (see CSS), so nothing can be drawn over it
    const W = box.clientWidth, H = box.clientHeight - VF_HEADER, zoom = +box.dataset.vfZoom || VF_ZOOM[z] || 8;
    const [cx, cy] = mercPx(zone.center[0], zone.center[1], zoom);
    const toPx = ([lat, lon]) => { const [x, y] = mercPx(lat, lon, zoom); return [W / 2 + (x - cx), H / 2 + (y - cy)]; };
    const pts = (arr) => arr.map((p) => toPx(p).map((n) => n.toFixed(1)).join(",")).join(" ");
    const [[a, b], [c, d]] = zone.box;
    let html = `<polygon points="${pts([[a, b], [a, d], [c, d], [c, b]])}" fill="none" stroke="#c98a2a" stroke-width="2" stroke-dasharray="7 5"/>`;
    if (zone.focus) html += `<polygon points="${pts(zone.focus.poly)}" fill="#ffd400" fill-opacity=".08" stroke="#ffd400" stroke-width="3"/>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = html;
    // The name sits in a chip at the top of the map instead of on the water, where it could hit map text
    const label = box.querySelector(".livemap-label");
    if (label) label.innerHTML = zone.focus
      ? `<i class="sw"></i>${esc(zone.focus.label)} <i class="sw dash"></i>watched area` : "";
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

  const COLORS = { Tanker: "#f29d38", Cargo: "#5aa9e6", Passenger: "#b48ef0", Military: "#ff5c5c", "Law enf.": "#ff5c5c",
    Fishing: "#4fbf9f", Tug: "#c7a86b", SAR: "#ff8f5c", Other: "#7f8c99", Unknown: "#5d6873" };
  // Rings around the hull mark special status: magenta = OFAC-sanctioned, cyan = ship-to-ship transfer, yellow dashed = GPS jump
  const RING = { sanctioned: "#ff3df2", sts: "#2ee6e6", spoof: "#ffd400" };
  // Marker style by ship class; tankers are drawn larger and above other ships.
  function vesselIcon(v) {
    const tanker = v.cls === "Tanker";
    const color = v.incident ? "#ff4d4d" : COLORS[v.cls] || COLORS.Unknown;
    const rot = Math.round((v.hdg ?? v.cog ?? 0) / 5) * 5; // matches iconKey, so redraws only happen on visible changes
    const moving = (v.sog ?? 0) > 0.8;
    // Every ship is a readable hull arrow (stationary: a diamond); tankers are larger. Dark outline keeps them
    // visible on both sea and land; AIS-dark ships are drawn hollow and dashed.
    const k = tanker ? 1.35 : 1;
    const shape = moving
      ? `<path d="M0,${-9 * k} L${6 * k},${7 * k} L0,${4 * k} L${-6 * k},${7 * k} Z"/>`
      : `<rect x="${-4 * k}" y="${-4 * k}" width="${8 * k}" height="${8 * k}" transform="rotate(45)"/>`;
    const style = v.dark ? `fill-opacity=".15" stroke="${color}" stroke-width="1.6" stroke-dasharray="2.5 2"` : `fill-opacity="1" stroke="#0b0d10" stroke-width="1.1"`;
    const halo = tanker && !v.dark ? `<circle r="${12 * k}" fill="${color}" fill-opacity=".14"/>` : "";
    const rings = [
      v.sanctioned && `<circle r="15" fill="none" stroke="${RING.sanctioned}" stroke-width="2"/>`,
      v.sts && `<circle r="18" fill="none" stroke="${RING.sts}" stroke-width="1.8"/>`,
      v.spoof && `<circle r="16.5" fill="none" stroke="${RING.spoof}" stroke-width="1.6" stroke-dasharray="3 2"/>`,
    ].filter(Boolean).join("");
    const glow = halo;
    const size = tanker || rings ? 40 : 24;
    return L.divIcon({
      className: `vessel${tanker ? " tanker" : ""}${v.incident ? " incident" : ""}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      html: `<svg width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}">${glow}${rings}<g transform="rotate(${rot})" fill="${color}" ${style}>${shape}</g></svg>`,
    });
  }

  function popup(v) {
    const row = (k, val) => (val == null || val === "" ? "" : `<tr><td>${k}</td><td>${esc(val)}</td></tr>`);
    return `<b>${esc(v.name || "MMSI " + v.mmsi)}</b> <span class="muted">${esc(v.cls)}${v.type ? " (" + v.type + ")" : ""}</span>
      ${v.incident ? `<div style="color:#ff6b6b;font-weight:bold">Incident: ${esc(v.incident)}</div>` : ""}
      ${v.dark ? `<div style="color:#ffb000">AIS signal lost — last fix ${ago(v.lastSeen)} ago</div>` : ""}
      ${v.sanctioned ? `<div style="color:${RING.sanctioned};font-weight:bold">⛔ OFAC-sanctioned: listed as "${esc(v.sanctioned.name)}" · programme ${esc(v.sanctioned.program || "?")}${v.sanctioned.owner ? ` · owner ${esc(v.sanctioned.owner)}` : ""}</div>` : ""}
      ${v.sts ? `<div style="color:${RING.sts}">⇄ Possible ship-to-ship transfer with ${esc(state.vessels.get(v.sts)?.name || "MMSI " + v.sts)}</div>` : ""}
      ${v.spoof ? `<div style="color:${RING.spoof}">Position jumped recently: possible GPS spoofing/jamming</div>` : ""}
      <table class="vtable">
      ${row("MMSI", v.mmsi)}${row("IMO", v.imo)}${row("Callsign", v.callsign)}${row("Dest", v.dest)}
      ${row("SOG", v.sog != null ? v.sog.toFixed(1) + " kn" : null)}${row("COG", v.cog != null ? Math.round(v.cog) + "°" : null)}
      ${row("Status", v.navText)}${row("Length", v.length ? v.length + " m" : null)}${row("Draught", v.draught ? v.draught + " m" : null)}
      ${row("Last fix", ago(v.lastSeen) + " ago")}
      </table>
      <div style="margin-top:4px"><a target="_blank" rel="noopener" href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${v.mmsi}">MarineTraffic ↗</a> ·
      <a target="_blank" rel="noopener" href="https://www.vesselfinder.com/vessels/details/${v.mmsi}">VesselFinder ↗</a></div>`;
  }

  // Ship type arrives in separate static messages (~every 6 min). In tankers-only mode every ship not confirmed as a
  // tanker is hidden, including ships whose type has not been received yet.
  function visible(v) { return !state.tankersOnly || v.cls === "Tanker"; }

  function upsertVessel(v) {
    state.vessels.set(v.mmsi, v);
    const z = v.zone;
    let mk = markers.get(v.mmsi);
    if (!z || !layers[z] || !visible(v)) { if (mk) { mk.m.remove(); mk.trail.remove(); markers.delete(v.mmsi); } return; }
    const key = iconKey(v);
    const trailStyle = v.cls === "Tanker" ? { color: COLORS.Tanker, weight: 1.5, opacity: 0.55 } : { color: COLORS[v.cls] || COLORS.Unknown, weight: 1, opacity: 0.3 };
    if (!mk) {
      mk = { key, m: L.marker([v.lat, v.lon], { icon: vesselIcon(v), zIndexOffset: v.cls === "Tanker" ? 1000 : 0 }).bindPopup(() => popup(state.vessels.get(v.mmsi))),
             trail: L.polyline(v.track || [], trailStyle) };
      mk.m.addTo(layers[z]); mk.trail.addTo(layers[z]);
      bindLabel(mk, v);
      markers.set(v.mmsi, mk);
    } else {
      mk.m.setLatLng([v.lat, v.lon]);
      mk.trail.setLatLngs(v.track || []);
      // Rebuild the marker element only when its appearance changes (avoids flicker on frequent position updates)
      if (mk.key !== key) {
        mk.key = key;
        mk.m.setIcon(vesselIcon(v)); mk.m.setZIndexOffset(v.cls === "Tanker" ? 1000 : 0);
        mk.trail.setStyle(trailStyle);
        if (mk.labelFor !== `${v.cls === "Tanker"}${v.name}`) bindLabel(mk, v);
      }
      if (mk.m.isPopupOpen()) mk.m.setPopupContent(popup(v));
    }
  }
  // Tankers carry a name label (shown only when zoomed in, see .show-names); other ships show it on hover
  function bindLabel(mk, v) {
    mk.m.unbindTooltip();
    mk.labelFor = `${v.cls === "Tanker"}${v.name}`;
    if (v.cls === "Tanker") mk.m.bindTooltip(esc(v.name || String(v.mmsi)), { permanent: true, direction: "right", offset: [12, 0], className: "vname", interactive: false });
    else mk.m.bindTooltip(() => { const s = state.vessels.get(v.mmsi) || v; return `${esc(s.name || s.mmsi)} · ${s.sog?.toFixed(1) ?? "?"} kn`; }, { direction: "top", offset: [0, -8] });
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
      // Honest counts: "tankers" are only ships confirmed as tankers by their own type broadcast; ships whose type
      // hasn't arrived yet are counted separately rather than silently treated as non-tankers
      el.innerHTML = `<b>${s.vessels}</b> ships · <b>${s.tankers}</b> confirmed tankers` +
        (s.typePending ? ` · <span class="pending">${s.typePending} type pending</span>` : "") +
        flag(s.dark, "dark", "#ff4d4d") + flag(s.sanctioned, "sanctioned", RING.sanctioned) + flag(s.sts, "STS", RING.sts) + flag(s.spoofed, "GPS jump", RING.spoof) +
        (s.vessels <= 3 && state.status.ais?.mode === "live" ? ` <span class="muted">· free AIS has almost no receivers here (see Live map)</span>` : "");
      el.title = `This terminal's own AIS data for this zone (free terrestrial receivers only):\n` +
        `All ships: ${s.vessels}\nConfirmed tankers: ${s.tankers} (${s.tankersMoving} moving, avg ${s.avgTankerSpeed ?? "–"} kn)\n` +
        `Type pending: ${s.typePending ?? 0} — ships send their type only every ~6 min and only if a receiver hears it, so some of these may be tankers\n` +
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
    // Sources that simply aren't set up (no key / no channels) are neutral grey, not "offline"
    const notSetUp = (e) => /^No |not configured|requires a paid/i.test(e || "");
    for (const [k, v] of Object.entries(s.social || {})) {
      const cls = v.ok ? "ok" : notSetUp(v.error) ? "off" : "bad";
      pills.push(`<span class="pill ${cls}" title="${esc(cls === "off" ? `Not set up: ${v.error}` : v.error || "")}">${k.toUpperCase()}${cls === "off" ? " · not set up" : ""}</span>`);
    }
    pills.push(`<span class="pill ${s.prices?.ok ? "ok" : "bad"}" title="${esc(s.prices?.error || "")}">PRICES</span>`);
    pills.push(`<span class="pill ${s.curve?.ok ? "ok" : "bad"}" title="${esc(s.curve?.error || "Brent/WTI futures curves")}">CURVE</span>`);
    pills.push(`<span class="pill ${s.sanctions?.ok ? "ok" : "bad"}" title="${esc(s.sanctions?.error || `OFAC SDN list: ${s.sanctions?.vessels} vessels`)}">OFAC ${s.sanctions?.vessels || 0}</span>`);
    pills.push(`<span class="pill ${s.flows?.ok ? "ok" : "bad"}" title="${esc(s.flows?.error ? `IMF PortWatch: ${s.flows.error}. Retrying${s.flows.nextTry ? " at " + hhmm(s.flows.nextTry) : ""}.` : "IMF PortWatch transit data")}">IMF FLOWS</span>`);
    pills.push(`<span class="pill ${s.analyst?.enabled ? "ok" : "bad"}" title="${esc(s.analyst?.error || "")}">AI ANALYST</span>`);
    pills.push(`<span class="pill ${s.notify?.channels?.length ? (s.notify.lastError ? "bad" : "ok") : ""}" title="${esc(s.notify?.channels?.length ? `Phone alerts via ${s.notify.channels.join(" + ")} (${s.notify.minSeverity}+)${s.notify.lastError ? " · last error: " + s.notify.lastError : ""}` : "Phone alerts off (see Alerts)")}">PHONE</span>`);
    // Full source list lives in a pop-up; the top bar shows one summary button
    $("#feeds").innerHTML = `<div class="pop-title">Data sources</div><div class="pills">${pills.join("")}</div>` +
      `<div class="pop-note">Green = working · grey = not set up · red = temporarily unavailable. Hover a source for details.</div>`;
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

  const SIDE = { US: "US", IRAN: "IRAN", ISRAEL: "ISRAEL", HOUTHI: "YEMEN/HOUTHI", GULF: "PERSIAN GULF", UK: "UK", UN: "UN" };
  function renderOfficial(freshIds = new Set()) {
    const f = state.filters.official;
    const list = state.official.filter((s) => f === "ALL" || s.side === f);
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
    if (a.running) html += `<div class="muted" style="margin-bottom:6px">Updating…</div>`;
    if (!b) {
      html += a.enabled ? `<div class="empty">First brief will appear shortly after startup.</div>` :
        `<div class="empty">AI analyst is off.<br><br>${esc(a.error || "")}<br><br>Add <code>ANTHROPIC_API_KEY</code>, or <code>GEMINI_API_KEY</code> with <code>AI_PROVIDER=gemini</code>, to <code>.env</code> and restart.</div>`;
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
  let anTab = "brief";
  $("#run-analyst").addEventListener("click", async () => {
    const r = await fetch(anTab === "desk" ? "/api/desk/run" : "/api/analyst/run", { method: "POST" });
    if (!r.ok) {
      const btn = $("#run-analyst"), msg = (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`;
      btn.textContent = r.status === 429 ? "Cooling down" : "Not available"; btn.title = msg;
      setTimeout(() => { btn.textContent = "Run now"; btn.title = ""; }, 4000);
    }
  });

  // ---------------------------------------------------------------- ask the analyst (chat)
  const chat = [];
  $("#an-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $("#an-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    anTab = b.dataset.t;
    const ask = anTab === "ask";
    $("#analyst").hidden = anTab !== "brief"; $("#desk").hidden = anTab !== "desk"; $("#ask").hidden = !ask;
    // Keep the button's space when it isn't needed, so the tabs don't jump sideways when switching to Ask
    $("#run-analyst").style.visibility = ask ? "hidden" : "";
    if (anTab === "desk") window.dispatchEvent(new Event("gst:desk"));
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
      : `<div class="empty">${state.analyst?.enabled ? "Ask anything about the live picture. Each question is answered from the current feeds: AIS, alerts, news, official statements, prices, the futures curve and IMF transit data." : "AI analyst is off. Add an AI key to <code>.env</code> (see Alerts) and restart to use chat."}</div>`;
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
      state.analyst = s.analyst; state.status = s.status; state.curve = s.curve; state.desk = s.desk;
      window.dispatchEvent(new Event("gst:desk"));
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
    es.addEventListener("desk", (e) => { state.desk = JSON.parse(e.data); window.dispatchEvent(new Event("gst:desk")); });
    es.addEventListener("status", (e) => { state.status = JSON.parse(e.data); renderStats(); renderFeeds(); });
    es.onerror = () => { $("#feeds").innerHTML = `<span class="pill bad">SERVER DISCONNECTED — reconnecting…</span>`; };
  }
  // Shared with tools.js / replay.js
  Object.assign(window.GST, { maps, layers, markers, showZone, panelFor, panelZone, COLORS, RING, ZN, renderStats, setLiveMap, vesselIcon });
  connect();
  setInterval(() => { renderStats(); }, 15000);
})();
