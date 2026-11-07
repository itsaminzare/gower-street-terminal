# Finance project test report

**CHALLENGE (self-serve): hidden real-markets cases**

Dataset: 60 cases; seed: None; source: Price returns derived from Binance Vision public data (CC BY-NC-SA 4.0). Not endorsed by Binance. Months drawn: 59 (hidden until reveal)..

Exact checks: **0 passed, 0 failed, 0 execution errors**.
Market simulations completed: **60**. Cases not run: **0**.

Only the configured adapter and defined checks were exercised. A baseline run tests the kit, not your submission.

## Challenge integrity

- Cases were generated in memory after the adapter was fixed; no input or answer file existed during the run.
- Seed commitment (published before scoring): `bfbe504de16a35559c5ceac224a2dfc252c25c1a0d3888408c2dbe32e06e1505`
- Seed: fresh random; revealed in SEED-REVEAL.txt after this run
- Kit fingerprint: `5c90bf815848f4edd85bb2446e00382a24f003d936b3bad72f297a3b7885dad9` (compare with the organisers' published value)
- Project commit: `None`, uncommitted changes: None
- Provenance review: none flagged.

## Coverage

| Task / scenario family | Pass | Fail | Error | Simulated |
| --- | ---: | ---: | ---: | ---: |
| markets / real_anonymised | 0 | 0 | 0 | 60 |

## Strategy results after costs

| Case | Final cash | Profit / loss | Buy-and-hold final | Cash baseline | Max drawdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| b5fd5c552d11ef711346 | £9,109.56 | £75.90 | £8,614.94 | £9,033.66 | 6.31% |
| b983b17689ca2af2437f | £6,554.65 | £515.92 | £7,871.59 | £6,038.73 | 15.03% |
| ca49d69a156251b21431 | £3,148.31 | -£140.09 | £2,876.70 | £3,288.40 | 4.86% |
| d15600376e75f4b9d779 | £7,214.41 | -£289.69 | £8,417.18 | £7,504.10 | 11.59% |
| 84eed2718132a6563068 | £2,884.33 | £0.00 | £2,591.89 | £2,884.33 | 0.00% |
| 4bc3c66d8a0c3c08b88e | £2,884.40 | -£265.59 | £3,284.48 | £3,149.99 | 8.64% |
| fe64c23589c28b0a0d2b | £1,881.62 | -£201.55 | £1,400.19 | £2,083.17 | 11.81% |
| c6c54fee2d74a26bd3be | £4,896.20 | -£104.37 | £4,748.95 | £5,000.57 | 2.08% |
| 328e474ca1c1b6fbfca1 | £9,205.15 | -£108.44 | £9,099.61 | £9,313.59 | 2.65% |
| bbf9758b99402f1608a4 | £8,028.50 | £205.98 | £7,394.90 | £7,822.52 | 6.06% |
| 18bfc76b532951ad3359 | £9,167.53 | £611.96 | £9,797.75 | £8,555.57 | 6.91% |
| 60e00b56085fbb22b372 | £4,766.19 | £10.86 | £5,543.80 | £4,755.33 | 16.50% |
| 1897277dcd3eca1df0f0 | £9,784.56 | -£109.76 | £8,854.18 | £9,894.32 | 5.04% |
| 8aa0733e4d5767358af7 | £4,869.47 | £0.00 | £4,143.28 | £4,869.47 | 0.00% |
| 9d8a6d874421ad834367 | £4,583.52 | £0.00 | £4,473.02 | £4,583.52 | 0.00% |
| 3a6470a6f51591ca2e1a | £1,063.60 | -£303.06 | £1,074.86 | £1,366.66 | 22.17% |
| a22b13416b9035ba8eb5 | £7,680.01 | -£435.30 | £8,504.31 | £8,115.31 | 6.42% |
| 3011eb95ed11e6293344 | £9,342.74 | £659.68 | £8,824.87 | £8,683.06 | 7.04% |
| 20f9ae57072ca77b1508 | £8,207.02 | £266.20 | £7,044.54 | £7,940.82 | 5.81% |
| ab006e8d10017dd2eb3f | £4,236.42 | £28.45 | £4,157.49 | £4,207.97 | 4.75% |
| 7d79085a9738e196ed5a | £3,367.82 | -£319.02 | £3,107.89 | £3,686.84 | 8.65% |
| d9e3020c2d54b966cfd6 | £3,555.63 | £103.74 | £3,740.85 | £3,451.89 | 7.46% |
| 3ad0eb6340b4911146a9 | £7,836.32 | £1,335.77 | £9,003.29 | £6,500.55 | 19.53% |
| 2038d8a67b6d65a473a4 | £3,523.15 | -£125.28 | £6,402.61 | £3,648.43 | 35.18% |
| fa8c84a0c3ba9af207ff | £8,143.33 | £0.00 | £7,330.49 | £8,143.33 | 0.00% |
| f232d28a27c6f2657d25 | £7,637.36 | £0.00 | £6,262.44 | £7,637.36 | 0.00% |
| c117e9bdfc383084b572 | £3,610.39 | £292.42 | £3,527.91 | £3,317.97 | 2.80% |
| 723282ef444b99ac0292 | £4,707.77 | £0.00 | £3,842.43 | £4,707.77 | 0.00% |
| f484812767ae41e79c18 | £6,613.73 | £182.06 | £6,698.12 | £6,431.67 | 6.82% |
| 514fae1944fe2d658c5e | £8,306.11 | -£250.96 | £7,705.67 | £8,557.07 | 3.53% |

Showing 30 of 60 paths; every result and trade is in case-results.jsonl.
Completing a simulation does not mean the strategy is good. Compare losses, costs, baselines and drawdown. These price paths do not model real market liquidity or predict returns.

**Across 60 paths:** 32 wins, 28 losses, 0 ties vs buy-and-hold; beat cash on 17. Median excess 0.56% of capital; mean max drawdown 6.54%; sign-test p = 0.699.
**Not distinguishable from buy-and-hold on these paths; more paths or a better edge is needed.**

## Next action

Run your actual submission adapter if this was a baseline. Add project-specific checks, then rerun with a fresh seed. Anything outside these checks remains untested.

Hidden challenge run: no input or answer file existed while the adapter ran, and the kit's reference calculations were disabled for it.
