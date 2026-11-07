// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Refresh public-data/ofac-vessels.json from the US Treasury SDN list.
// Run daily by .github/workflows/ofac.yml so hosts that can't reach the Treasury still get a fresh list.
import fs from "node:fs";
import path from "node:path";
import { downloadFromTreasury, BUNDLED } from "../src/sanctions.js";

const list = await downloadFromTreasury();
list.sort((a, b) => Number(a.id) - Number(b.id));
const prev = fs.existsSync(BUNDLED) ? JSON.parse(fs.readFileSync(BUNDLED, "utf8")) : null;
if (prev && JSON.stringify(prev.list) === JSON.stringify(list)) {
  console.log(`OFAC list unchanged (${list.length} vessels)`);
} else {
  fs.mkdirSync(path.dirname(BUNDLED), { recursive: true });
  fs.writeFileSync(BUNDLED, JSON.stringify({ updated: new Date().toISOString(), source: "US Treasury OFAC SDN list", list }) + "\n");
  console.log(`OFAC list written: ${list.length} vessels`);
}
