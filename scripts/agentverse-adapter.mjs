// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Adapter for the Agentverse finance kit's test runner (finance/TESTING.md): reads one JSON request per line on
// stdin and writes one JSON response per line on stdout. It calls the terminal's own price-only risk engine
// (src/strategy.js); it does not import any kit code or read any dataset file. Diagnostics go to stderr.
//
//   python bench.py challenge --pack real-markets --cases 60 --project <repo> --output <dir> \
//       --adapter node <repo>/scripts/agentverse-adapter.mjs
import readline from "node:readline";
import { marketStep } from "../src/strategy.js";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  line = line.replace(/^﻿/, ""); // some shells prepend a byte-order mark
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { process.stderr.write("bad JSON line\n"); return; }
  let output;
  try {
    if (req.task === "market_step") {
      const { action } = marketStep(req.input || {});
      output = { action };
    } else {
      // This project is a markets/trading desk; other packs (cashflow, transactions) are out of scope
      output = { error: "unsupported_task" };
    }
  } catch (e) {
    process.stderr.write(`error on ${req.request_id}: ${e.message}\n`);
    output = req.task === "market_step" ? { action: "hold" } : { error: "unsupported_task" };
  }
  process.stdout.write(JSON.stringify({ request_id: req.request_id, output }) + "\n");
});
