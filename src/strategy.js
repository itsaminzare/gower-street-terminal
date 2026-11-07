// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Price-only risk engine: the deterministic rules the trade desk applies around the AI (volatility-scaled stops,
// enter only when the expected move clears trading costs, step aside when the trend breaks), packaged as a
// long-only strategy so it can be tested on unseen price paths without any news input.
//
// marketStep() is pure: it sees only the observed price history and the current position, and returns
// "buy", "hold" or "sell". Orders fill at the next bar (the evaluator's rule), so nothing here can see the future.

const PARAMS = {
  warmup: 40,        // bars needed before trading
  fast: 10,          // fast moving average (bars)
  slow: 40,          // slow moving average (bars)
  volWindow: 40,     // bars used for volatility
  momWindow: 20,     // bars used for momentum
  entryZ: 0.5,       // momentum must exceed this many standard deviations of the window
  stopVols: 3,       // trailing stop distance in volatility units (scaled to the stop window)
  stopWindow: 20,    // bars for the trailing high
  costMultiple: 3,   // expected move must exceed this multiple of the round-trip cost
};

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

/**
 * @param {{history: {date: string, price_pence: number}[], cash_pence: number, shares: number, fee_pence: number, slippage_bps: number}} input
 * @returns {{action: "buy"|"hold"|"sell", reason: string}}
 */
export function marketStep(input, p = PARAMS) {
  const prices = (input.history || []).map((h) => h.price_pence).filter((x) => Number.isFinite(x) && x > 0);
  const long = (input.shares || 0) > 0;
  if (prices.length < p.warmup) return { action: long ? "hold" : "hold", reason: "warm-up: not enough history" };

  const last = prices.at(-1);
  const logs = prices.map(Math.log);
  const rets = logs.slice(1).map((x, i) => x - logs[i]);
  const vol = sd(rets.slice(-p.volWindow));                       // per-bar volatility of log returns
  const fastMA = mean(prices.slice(-p.fast)), slowMA = mean(prices.slice(-p.slow));
  const mom = logs.at(-1) - logs.at(-1 - p.momWindow);            // momentum over the window (log return)
  const momZ = vol > 0 ? mom / (vol * Math.sqrt(p.momWindow)) : 0;

  if (long) {
    // Volatility-scaled trailing stop from the recent high (the desk's stop logic)
    const high = Math.max(...prices.slice(-p.stopWindow));
    const stop = high * Math.exp(-p.stopVols * vol * Math.sqrt(p.stopWindow / 4));
    if (last < stop) return { action: "sell", reason: `trailing stop hit (${last} < ${Math.round(stop)})` };
    if (fastMA < slowMA) return { action: "sell", reason: "trend broke: fast average below slow" };
    return { action: "hold", reason: "in trend, above stop" };
  }

  // Entry: trend up, momentum significant, and the expected move clears costs by a margin
  const positionPence = Math.max(1, (input.cash_pence || 0) - (input.fee_pence || 0));
  const roundTrip = 2 * (input.fee_pence || 0) / positionPence + 2 * (input.slippage_bps || 0) / 10000;
  const expectedMove = Math.max(0, mom) * 0.5;                     // assume only half the recent momentum persists
  const clearsCosts = expectedMove > p.costMultiple * roundTrip;
  if (fastMA > slowMA && momZ > p.entryZ && clearsCosts) {
    return { action: "buy", reason: `trend up, momentum ${momZ.toFixed(2)} sd, expected move clears costs` };
  }
  return { action: "hold", reason: !clearsCosts ? "expected move does not clear costs" : "no trend signal" };
}

export { PARAMS };
