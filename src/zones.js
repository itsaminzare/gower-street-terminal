// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Watched chokepoints. Boxes are [[latMin, lonMin], [latMax, lonMax]].
export const ZONES = {
  HORMUZ: {
    id: "HORMUZ",
    name: "Strait of Hormuz",
    box: [[24.6, 54.6], [27.4, 58.6]],
    center: [26.3, 56.5],
    zoom: 8,
    // Narrows gate line used to count transits (roughly Musandam -> Larak island)
    gate: [[26.42, 56.42], [26.82, 56.36]],
    // Anchorages / ports where tankers stopping is normal (suppresses "sudden stop" alerts)
    anchorages: [
      { name: "Fujairah anchorage", lat: 25.2, lon: 56.45, km: 30 },
      { name: "Khor Fakkan", lat: 25.35, lon: 56.38, km: 12 },
      { name: "Bandar Abbas", lat: 27.12, lon: 56.2, km: 22 },
      { name: "Qeshm / Hormuz isl.", lat: 26.95, lon: 56.0, km: 18 },
      { name: "Ras al-Khaimah", lat: 25.8, lon: 55.95, km: 15 },
      { name: "Jebel Ali / Dubai", lat: 25.05, lon: 55.05, km: 30 },
      { name: "Sohar", lat: 24.5, lon: 56.65, km: 18 },
      { name: "Jask", lat: 25.65, lon: 57.78, km: 15 },
    ],
  },
  BAB: {
    id: "BAB",
    name: "Bab el-Mandeb / S. Red Sea",
    box: [[11.3, 42.0], [14.8, 45.4]],
    center: [12.8, 43.5],
    zoom: 8,
    gate: [[12.72, 43.28], [12.48, 43.52]],
    anchorages: [
      { name: "Djibouti", lat: 11.6, lon: 43.12, km: 18 },
      { name: "Aden", lat: 12.78, lon: 44.95, km: 18 },
      { name: "Mokha", lat: 13.32, lon: 43.24, km: 10 },
      { name: "Assab", lat: 13.0, lon: 42.75, km: 15 },
      { name: "Hodeidah (approach)", lat: 14.8, lon: 42.9, km: 25 },
    ],
  },
  SUEZ: {
    id: "SUEZ",
    name: "Suez Canal / Gulf of Suez",
    box: [[27.6, 32.1], [31.6, 34.0]],
    center: [29.9, 32.7],
    zoom: 8,
    // Southern canal entrance (Port Tawfiq)
    gate: [[29.93, 32.52], [29.93, 32.6]],
    dirs: ["Northbound (to Med)", "Southbound (to Red Sea)"],
    anchorages: [
      { name: "Suez Bay anchorage", lat: 29.85, lon: 32.55, km: 12 },
      { name: "Great Bitter Lake", lat: 30.35, lon: 32.38, km: 14 },
      { name: "Port Said anchorage", lat: 31.35, lon: 32.35, km: 18 },
      { name: "Ain Sukhna", lat: 29.6, lon: 32.38, km: 12 },
      { name: "Ras Shukeir / Ras Gharib", lat: 28.2, lon: 33.2, km: 18 },
    ],
  },
  CAPE: {
    id: "CAPE",
    name: "Cape of Good Hope",
    box: [[-36.8, 16.5], [-33.0, 22.0]],
    center: [-34.8, 19.2],
    zoom: 7,
    // Meridian line south of Cape Agulhas: crossing it = rounding the Cape
    gate: [[-34.85, 20.0], [-36.6, 20.0]],
    dirs: ["Westbound (to Atlantic)", "Eastbound (to Indian Ocean)"],
    anchorages: [
      { name: "Cape Town anchorage", lat: -33.88, lon: 18.42, km: 15 },
      { name: "Saldanha Bay", lat: -33.05, lon: 17.95, km: 15 },
      { name: "Mossel Bay", lat: -34.18, lon: 22.15, km: 15 },
      { name: "Algoa Bay (approach)", lat: -33.9, lon: 21.9, km: 12 },
    ],
  },
};
ZONES.HORMUZ.dirs = ["Inbound (to Gulf)", "Outbound"];
ZONES.BAB.dirs = ["Northbound (to Red Sea)", "Southbound"];

export function zoneOf(lat, lon) {
  for (const z of Object.values(ZONES)) {
    const [[a, b], [c, d]] = z.box;
    if (lat >= a && lat <= c && lon >= b && lon <= d) return z.id;
  }
  return null;
}

// AIS ship type codes -> readable class
export function shipClass(type) {
  if (type == null) return "Unknown";
  if (type >= 80 && type <= 89) return "Tanker";
  if (type >= 70 && type <= 79) return "Cargo";
  if (type >= 60 && type <= 69) return "Passenger";
  if (type === 30) return "Fishing";
  if (type === 35) return "Military";
  if (type === 31 || type === 32 || type === 52) return "Tug";
  if (type === 55) return "Law enf.";
  if (type === 51) return "SAR";
  return "Other";
}

export const NAV_STATUS = {
  0: "Under way (engine)", 1: "At anchor", 2: "Not under command", 3: "Restricted manoeuvrability",
  4: "Constrained by draught", 5: "Moored", 6: "Aground", 7: "Fishing", 8: "Under way (sailing)",
  14: "AIS-SART / emergency", 15: "Undefined",
};
