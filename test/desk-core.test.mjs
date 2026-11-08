// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  priceIdea,
  result,
  riskChecks,
  baseRate,
  DEFAULT_LIMITS,
} from "../src/desk-core.js";

describe("priceIdea()", () => {
  it("returns instrument, direction and unit and puts stop and target on correct sides for LONG", () => {
    const raw = {
      instrument: "BRENT",
      direction: "LONG",
      stop_distance: 2,
      target_distance: 4,
      probability: 0.6,
      risk_pct: 0.5,
      horizon_days: 5,
    };
    const entry = 80;
    const priced = priceIdea(raw, entry);

    assert.equal(priced.instrument, "BRENT");
    assert.equal(priced.direction, "LONG");
    assert.equal(priced.unit, "%");
    assert.equal(priced.entry, 80);
    assert.ok(priced.stop < priced.entry, "LONG stop must be below entry");
    assert.ok(priced.target > priced.entry, "LONG target must be above entry");
  });

  it("returns instrument, direction and unit and puts stop and target on correct sides for SHORT", () => {
    const raw = {
      instrument: "BRENT",
      direction: "SHORT",
      stop_distance: 2,
      target_distance: 4,
      probability: 0.6,
      risk_pct: 0.5,
      horizon_days: 5,
    };
    const entry = 80;
    const priced = priceIdea(raw, entry);

    assert.equal(priced.instrument, "BRENT");
    assert.equal(priced.direction, "SHORT");
    assert.equal(priced.unit, "%");
    assert.equal(priced.entry, 80);
    assert.ok(priced.stop > priced.entry, "SHORT stop must be above entry");
    assert.ok(priced.target < priced.entry, "SHORT target must be below entry");
  });
});

describe("result()", () => {
  const longIdea = {
    instrument: "BRENT",
    direction: "LONG",
    unit: "%",
    entry: 80,
    stop: 78.4,
    costAbs: 0.04,
  };

  const shortIdea = {
    instrument: "BRENT",
    direction: "SHORT",
    unit: "%",
    entry: 80,
    stop: 81.6,
    costAbs: 0.04,
  };

  it("gives a positive R for a winning LONG and a negative R for losers, after costs", () => {
    const win = result(longIdea, 83.2);
    assert.ok(win.R > 0, "winning LONG must yield positive R net of costs");

    const loss = result(longIdea, 78.4);
    assert.ok(loss.R < 0, "losing LONG must yield negative R net of costs");
  });

  it("gives a positive R for a winning SHORT and a negative R for losers, after costs", () => {
    const win = result(shortIdea, 76.8);
    assert.ok(win.R > 0, "winning SHORT must yield positive R net of costs");

    const loss = result(shortIdea, 81.6);
    assert.ok(loss.R < 0, "losing SHORT must yield negative R net of costs");
  });
});

describe("riskChecks()", () => {
  const baseRaw = {
    instrument: "BRENT",
    direction: "LONG",
    stop_distance: 2,
    target_distance: 4,
    probability: 0.6,
    risk_pct: 0.5,
    horizon_days: 5,
    evidence: ["Incident reported in Persian Gulf by maritime security"],
  };
  const basePriced = priceIdea(baseRaw, 80);
  const baseBr = {
    hitRate: 0.5,
    familyStat: { wins: 5, n: 10 },
    family: "shipping",
    baseline: { sd: 2.0 },
  };

  it("passes a well-formed trade", () => {
    const outcome = riskChecks({
      raw: baseRaw,
      priced: basePriced,
      br: baseBr,
      open: [],
      limits: DEFAULT_LIMITS,
      halted: false,
    });
    assert.equal(outcome.pass, true);
    assert.deepEqual(outcome.blocking, []);
  });

  it("blocks a trade above maxRiskPerTrade", () => {
    const pricedOverRisk = { ...basePriced, riskPct: 1.5 };
    const outcome = riskChecks({
      raw: baseRaw,
      priced: pricedOverRisk,
      br: baseBr,
      open: [],
      limits: DEFAULT_LIMITS,
    });
    assert.equal(outcome.pass, false);
    assert.ok(outcome.blocking.some((name) => name.includes("Risk per trade")));
  });

  it("blocks when open risk would exceed maxOpenRisk", () => {
    const openTrades = [{ instrument: "GOLD", riskPct: 2.8 }];
    const outcome = riskChecks({
      raw: baseRaw,
      priced: basePriced, // priced riskPct is 0.5; 2.8 + 0.5 = 3.3 > 3.0
      br: baseBr,
      open: openTrades,
      limits: DEFAULT_LIMITS,
    });
    assert.equal(outcome.pass, false);
    assert.ok(outcome.blocking.some((name) => name.includes("Open risk")));
  });

  it("blocks a second position in the same instrument", () => {
    const openTrades = [{ instrument: "BRENT", riskPct: 0.5 }];
    const outcome = riskChecks({
      raw: baseRaw,
      priced: basePriced,
      br: baseBr,
      open: openTrades,
      limits: DEFAULT_LIMITS,
    });
    assert.equal(outcome.pass, false);
    assert.ok(outcome.blocking.includes("One position per instrument"));
  });

  it("blocks when same-factor risk would exceed maxFactorRisk", () => {
    // Both BRENT and WTI share the crude_products factor. Limit is 2.0%.
    // 1.7% open + 0.5% priced = 2.2% > 2.0%, while total open risk 2.2% <= 3.0%.
    const openTrades = [{ instrument: "WTI", riskPct: 1.7 }];
    const outcome = riskChecks({
      raw: baseRaw,
      priced: basePriced,
      br: baseBr,
      open: openTrades,
      limits: DEFAULT_LIMITS,
    });
    assert.equal(outcome.pass, false);
    assert.ok(outcome.blocking.some((name) => name.includes("Factor risk")));
  });

  it("blocks a stop tighter than minStopSd standard deviations when br.baseline.sd is given", () => {
    // With baseline sd of 5.0 and minStopSd of 0.5, minimum stop is 2.5%.
    // basePriced stopDist is 1.6 on entry 80 = 2.0% < 2.5%.
    const brHighSd = {
      ...baseBr,
      baseline: { sd: 5.0 },
    };
    const outcome = riskChecks({
      raw: baseRaw,
      priced: basePriced,
      br: brHighSd,
      open: [],
      limits: DEFAULT_LIMITS,
    });
    assert.equal(outcome.pass, false);
    assert.ok(outcome.blocking.some((name) => name.includes("Stop distance")));
  });
});

describe("baseRate()", () => {
  const fakeResearch = {
    events: [
      { date: "2023-01-10", kind: "tanker-attack", family: "shipping", moves: { BRENT: { 5: 2.0 } } },
      { date: "2023-06-15", kind: "tanker-attack", family: "shipping", moves: { BRENT: { 5: 4.0 } } },
      { date: "2024-01-01", kind: "tanker-attack", family: "shipping", moves: { BRENT: { 5: 6.0 } } }, // on asOf date
      { date: "2024-05-20", kind: "tanker-attack", family: "shipping", moves: { BRENT: { 5: 8.0 } } }, // after asOf date
    ],
    baseline: {
      BRENT: { 5: { mean: 0.1, sd: 2.5, up: 0.52 } },
    },
    units: { BRENT: "%" },
  };

  it("with asOf ignores events on or after that date", () => {
    const withAsOf = baseRate(fakeResearch, {
      analogue: "tanker-attack",
      instrument: "BRENT",
      direction: "LONG",
      horizonDays: 7,
      asOf: "2024-01-01",
    });

    // Events on 2024-01-01 and 2024-05-20 must be ignored, leaving only 2 events
    assert.equal(withAsOf.familyStat.n, 2);
    assert.equal(withAsOf.kind.n, 2);
    assert.equal(withAsOf.kind.mean, 3.0); // (2.0 + 4.0) / 2

    // Without asOf, all 4 events are included
    const withoutAsOf = baseRate(fakeResearch, {
      analogue: "tanker-attack",
      instrument: "BRENT",
      direction: "LONG",
      horizonDays: 7,
    });

    assert.equal(withoutAsOf.familyStat.n, 4);
    assert.equal(withoutAsOf.kind.n, 4);
    assert.equal(withoutAsOf.kind.mean, 5.0); // (2.0 + 4.0 + 6.0 + 8.0) / 4
  });
});
