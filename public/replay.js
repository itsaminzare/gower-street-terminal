// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// 24-hour replay: scrub or play back vessel positions and incident alerts on either map panel.
(() => {
  const { state, esc, maps, layers, COLORS, RING, panelZone } = window.GST;
  const hhmmss = (t) => new Date(t).toISOString().slice(11, 16) + "Z";

  document.querySelectorAll(".map-panel").forEach((panel) => {
    const btn = panel.querySelector(".replay-btn");
    const bar = panel.querySelector(".replay-bar");
    let rp = null; // active replay state for this panel

    btn.addEventListener("click", () => (rp ? stop() : start()));
    panel.addEventListener("zonechange", () => { if (rp) { stop(); start(); } });

    async function start() {
      // Replay draws on our own map, so leave the live map while it runs (without changing the saved preference)
      if (panel.querySelector(".maps iframe.livemap")) window.GST.setLiveMap(panel, false);
      const zone = panelZone[panel.id];
      const box = state.zones[zone]?.box;
      btn.classList.add("on"); btn.textContent = "■ EXIT REPLAY";
      bar.hidden = false; bar.innerHTML = `<span class="muted">Loading 24h history…</span>`;
      const h = await fetch("/api/history").then((r) => r.json());
      const inBox = (lat, lon) => lat >= box[0][0] && lat <= box[1][0] && lon >= box[0][1] && lon <= box[1][1];
      const frames = h.frames.map((f) => ({ t: f.t, v: f.v.filter((r) => inBox(r[1], r[2])) }));
      const events = h.events.filter((e) => e.zone === zone);
      if (!frames.length) { bar.innerHTML = `<span class="muted">No history recorded yet. The terminal saves a snapshot every ${h.demo ? "30 seconds" : "2 minutes"} and keeps 24 hours.</span> <button class="rp-x">CLOSE</button>`; bar.querySelector(".rp-x").onclick = stop; return; }
      const map = maps[zone];
      map.removeLayer(layers[zone]);
      const lyr = L.layerGroup().addTo(map);
      rp = { zone, frames, events, meta: h.meta, map, lyr, i: frames.length - 1, playing: false, speed: 1, timer: null, markers: new Map() };
      bar.innerHTML = `
        <button class="rp-play" title="Play / pause">▶</button>
        <input class="rp-slider" type="range" min="0" max="${frames.length - 1}" value="${frames.length - 1}">
        <span class="rp-time"></span>
        <span class="filters rp-speed"><button data-s="1" class="on">1×</button><button data-s="4">4×</button><button data-s="16">16×</button></span>
        <span class="rp-ev"></span>
        ${h.demo ? '<span class="warn">SIMULATED</span>' : ""}`;
      bar.querySelector(".rp-play").onclick = () => toggle();
      bar.querySelector(".rp-slider").oninput = (e) => { rp.i = +e.target.value; draw(); };
      bar.querySelector(".rp-speed").onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        bar.querySelectorAll(".rp-speed button").forEach((x) => x.classList.toggle("on", x === b));
        rp.speed = +b.dataset.s;
      };
      draw();
    }

    function toggle() {
      rp.playing = !rp.playing;
      bar.querySelector(".rp-play").textContent = rp.playing ? "❚❚" : "▶";
      if (rp.playing) {
        if (rp.i >= rp.frames.length - 1) rp.i = 0;
        rp.timer = setInterval(() => {
          rp.i = Math.min(rp.frames.length - 1, rp.i + rp.speed);
          bar.querySelector(".rp-slider").value = rp.i;
          draw();
          if (rp.i >= rp.frames.length - 1) toggle();
        }, 250);
      } else clearInterval(rp.timer);
    }

    function icon(cls, flags, rot, sog) {
      const color = flags & 1 ? "#ff3b3b" : COLORS[cls] || "#8a8a8a";
      const shape = sog > 0.8 ? `<path d="M0,-8 L5,6 L0,3 L-5,6 Z"/>` : `<circle r="3.5"/>`;
      const rings = (flags & 4 ? `<circle r="10" fill="none" stroke="${RING.sanctioned}" stroke-width="2"/>` : "") +
        (flags & 8 ? `<circle r="13" fill="none" stroke="${RING.sts}" stroke-width="1.5"/>` : "") +
        (flags & 16 ? `<circle r="11.5" fill="none" stroke="${RING.spoof}" stroke-width="1.5" stroke-dasharray="3 2"/>` : "");
      return L.divIcon({ className: "vessel", iconSize: [30, 30], iconAnchor: [15, 15],
        html: `<svg width="30" height="30" viewBox="-15 -15 30 30">${rings}<g transform="rotate(${rot})" fill="${color}" fill-opacity="${flags & 2 ? 0.35 : 0.95}" stroke="#000" stroke-width=".8">${shape}</g></svg>` });
    }

    function draw() {
      const f = rp.frames[rp.i];
      const seen = new Set();
      for (const [mmsi, lat, lon, rot, sog, flags] of f.v) {
        const [name, cls] = rp.meta[mmsi] || ["", "Unknown"];
        if (state.tankersOnly && cls !== "Tanker" && cls !== "Unknown" && !(flags & (1 | 4 | 8))) continue;
        seen.add(mmsi);
        let m = rp.markers.get(mmsi);
        if (!m) { m = L.marker([lat, lon]).bindTooltip(""); m.addTo(rp.lyr); rp.markers.set(mmsi, m); }
        m.setLatLng([lat, lon]).setIcon(icon(cls, flags, rot, sog));
        m.setTooltipContent(`${esc(name || String(mmsi))} · ${sog} kn`);
      }
      for (const [mmsi, m] of rp.markers) if (!seen.has(mmsi)) { m.remove(); rp.markers.delete(mmsi); }
      // Alerts in the 30 minutes up to this frame pulse on the map
      rp.lyr.eachLayer((l) => l.options?.isEvent && rp.lyr.removeLayer(l));
      const recent = rp.events.filter((e) => e.t <= f.t && e.t > f.t - 30 * 60_000);
      for (const e of recent) {
        L.marker([e.lat, e.lon], { isEvent: true, interactive: false,
          icon: L.divIcon({ className: "", html: '<div class="pulse"></div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(rp.lyr);
      }
      const ago = Math.round((Date.now() - f.t) / 60000);
      bar.querySelector(".rp-time").textContent = `${new Date(f.t).toISOString().slice(0, 10)} ${hhmmss(f.t)} (${ago >= 60 ? Math.floor(ago / 60) + "h " : ""}${ago % 60}m ago) · ${rp.markers.size} shown`;
      const last = recent.at(-1);
      bar.querySelector(".rp-ev").innerHTML = last ? `<span class="sevdot ${last.severity}"></span>${esc(last.title)}` : "";
    }

    function stop() {
      if (rp) {
        clearInterval(rp.timer);
        rp.map.removeLayer(rp.lyr);
        layers[rp.zone].addTo(rp.map);
        rp = null;
      }
      btn.classList.remove("on"); btn.textContent = "⟲ REPLAY";
      bar.hidden = true; bar.innerHTML = "";
    }
  });
})();
