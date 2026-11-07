# Gower Street Terminal

### 🛰 Live terminal: **[gower-street-terminal-sg.onrender.com](https://gower-street-terminal-sg.onrender.com)**

*Free hosting: if nobody has visited for a while, the first load can take up to a minute while the server wakes.*

© 2026 Mohammadamin Zare, University College London. All rights reserved. No part of this software may be copied, modified or distributed without written permission; see [LICENSE](LICENSE). Third-party libraries, maps and data remain their owners' property; see [NOTICE.md](NOTICE.md).

## Agentverse 2026 · Finance Track: summary for the judges

**Who it is for:** a **crude oil trader** at an energy trading firm who must react to Gulf and Red Sea shipping news within minutes, using half the picture.

**The decision they get wrong:** **buying the spike on a headline**, often an unverified one: a "tanker attacked" post, a ship going dark on AIS (which can be jamming or spoofing), or one side's official claim. Our own data says that on average this loses money.

**What the agent does:**
- **It reads the live picture:** ships in four chokepoints with automated incident detection, IMF transit counts, credited news, official statements from every side, social chatter, prices and the futures curve.
- **It proposes 0–3 specific paper trades.** Each has an entry, stop, target, horizon, probability and size.
- **Code checks every number. The AI never does arithmetic that matters.**
- **A human approves or rejects every trade.**

**Where to look in the live app:**
- the **Trade desk** tab, for proposals, approvals, the decision trace, the kill switch and the audit log;
- **📊 Research**, for the evidence;
- **▶ Red Sea 2024**, for the 90-second demo.

### How each judging criterion is met

| Criterion | What we built | Where |
|---|---|---|
| **Traceable reasoning** | Every trade has a **decision trace**: the raw data (with a link to the exact JSON input the agent saw), then the base rate (**looked up by code** from the event study), then the AI's judgement, then the maths (**code**: levels, costs, expected-value formula shown), then the risk checks (**code**), then the human decision, then the outcome. | Trade desk → "Decision trace"; `src/desk-core.js` |
| **Testing on unseen data** | (1) An **event study** of 20 incidents since 2019 against every day since 2019. (2) A **walk-forward test**: each call may only use earlier events. It includes **costs**, a **buy-and-hold benchmark**, **bootstrap 90% CIs** and **binomial p-values**. (3) The **AI desk itself backtested** on the 20 incidents with point-in-time inputs, entering at the next close, against cash, buy-and-hold and a naive "buy the headline" rule. | 📊 Research; `scripts/build-research.mjs`, `scripts/agent-backtest.mjs` |
| **Risk controls and oversight** | **Limits enforced in code:** ≤1% of book per trade, ≤3% open, one position per instrument, positive EV after costs, and the AI's probability may not exceed the historical hit rate by more than 25 points. Proposals **lapse after 60 min**, and approval **re-runs every check at the live price** and refuses if the price has run. **Human approval** is required for every trade. A **kill switch** (halt, or halt and flatten) is available. **Every action** (agent, server, human) goes in the **audit log**. | Trade desk; `src/desk.js` |
| **Relevance and impact** | A specific user and failure (above). On screen, the desk refuses to sell next-day headline direction as an edge, flags simulated or unverified inputs, and blocks over-confident trades. | Trade desk |
| **Ambition and technical quality** | A live multi-source maritime picture (AIS, IMF, OFAC, news, official statements, prices, curve) plus an agent that turns it into checked, explainable, human-approved trades. No build step; one Node server. | whole repo |

### Key results (all after costs; small samples, stated honestly)

| Test | Result |
|---|---|
| Next-day Brent direction after a headline (walk-forward) | **5/14** right (p = 0.91): **no edge** |
| Fade escalation over 20 trading days (walk-forward) | **9/14** right (p = 0.21). **+1.32%** per event vs **−2.63%** buy-and-hold. Edge **+3.95%**, 90% CI **+0.5% to +7.5%**: **weak edge** |
| Tanker stocks 5 days after shipping attacks | In-sample median **+4.1%**, but **no edge** out of sample |
| **The AI desk itself on the 20 incidents** | **8 trades, 2 won, −1.73% of book in total**, against **0%** cash and **−0.79%** for a naive "buy the headline" rule. **It missed its benchmark.** It kept buying crude after the news, which is the very failure this tool targets. Its losses stayed small because of the risk limits. |

The backtest showed the agent repeating the user's mistake, which is why the live desk is built around **human approval and hard limits**, not autonomy. Caveat: the model may know how these historical events turned out from its training data. The live paper record is the only truly unseen test, and the desk keeps it with a hit rate, P&L in R and a Brier score.

### ▶ Red Sea 2024 replay

A day-by-day replay of the 2023-24 Red Sea crisis:
- IMF PortWatch transits fall at Bab el-Mandeb (**−39%** by January) and rise around the Cape (**+42%**), with Brent and Frontline alongside;
- each incident appears with **what the playbook knew at the time** (earlier events only), followed by what happened.

### Data and licences

| Data | Used for | Licence / terms |
|---|---|---|
| Yahoo Finance chart API, CNBC quotes (fallback) | Live (delayed) prices, daily history for the event study | Publisher terms: personal / non-commercial use. Used for a non-commercial research demo, credited on screen |
| IMF PortWatch (IMF & University of Oxford, via ArcGIS) | Daily chokepoint transits, Red Sea replay | Free public data with attribution to IMF PortWatch (see portwatch.imf.org terms) |
| aisstream.io | Live AIS ship positions | Free API under aisstream.io terms |
| VesselFinder embed | LIVE MAP view | Official embeddable widget, VesselFinder's terms. Their data, credited on the map, not used by our alerts or desk |
| US Treasury OFAC SDN list | Sanctioned-vessel matching | US government public data |
| News RSS (named outlets), Google News, Reddit RSS | Headlines and links, credited to each outlet | Headlines and links only; content remains the publishers' |
| Esri World Dark Gray basemap | Map tiles | Esri terms, attributed on the map |
| Anthropic Claude API | Analyst, chat, trade desk agent | Anthropic commercial terms |

**Synthetic data:** `npm run demo` replaces AIS ships with **simulated** vessels. These are labelled "SIMULATED SHIPS" on screen and in every agent input, and the desk's checks flag them. No result in this README uses synthetic data.

**Reproduce:**

```bash
node scripts/build-research.mjs
```

```bash
node scripts/agent-backtest.mjs
```

The first rebuilds the event study and walk-forward test. The second re-runs the AI desk backtest (about 20 Claude calls). *Paper trading and research only. Nothing here can place a real order. Not investment advice.*

---

A Bloomberg-style live desk for the **Strait of Hormuz** and **Bab el-Mandeb / southern Red Sea**:

| Panel | Source | Notes |
|---|---|---|
| Live maps (4 zones) | [aisstream.io](https://aisstream.io) WebSocket (free key) | Hormuz and Suez (top), Bab el-Mandeb and Cape of Good Hope (bottom) behind tabs. Tankers in amber, heading arrows, trails, anchorages and transit gate. Rings: magenta = OFAC-sanctioned, cyan = ship-to-ship transfer, yellow dashed = GPS jump |
| 24h replay | Saved AIS snapshots | ⟲ REPLAY on each map: scrub or play back the last 24 hours with alerts pulsing where they happened |
| Incident alerts | Built-in detectors + news + prices + curve + IMF | Distress status, sudden stop in the lane, AIS-dark, course reversal, sanctioned vessel in a strait, suspected ship-to-ship transfer, GPS jumps / interference clusters, breaking incident headlines, ±2% oil moves, sharp spread moves, IMF tanker transits ≥30% below normal |
| Phone alerts | ntfy and/or Telegram bot | Critical alerts (or warnings too) pushed to your phone, batched; setup and test button under ⚙ ALERTS |
| Sanctions | US Treasury OFAC SDN list (≈1,570 vessels) | Matched by IMO and MMSI, refreshed daily |
| Futures curve & spreads | Yahoo Finance monthly contracts (delayed) | Strip under the ticker: Brent M1–M2, M1–M6, M1–M12, WTI M1–M6, Brent–WTI, 3-2-1 crack. 〰 CURVE shows Brent vs WTI curves today and a month ago |
| Chokepoint flows | IMF PortWatch daily transit calls + own gate counts | ⛴ FLOWS: tanker transits per day for all four chokepoints, 7-day vs 90-day change. IMF's API is heavily rate-limited; the terminal retries with backoff and caches |
| Disruption scenario | Public EIA / IEA estimates, all editable | ⚠ SCENARIO: flow lost, bypass pipelines, stock release, net shortfall, barrels lost, Cape rerouting, LNG at risk, illustrative Brent range |
| News wire | Outlet RSS (Al Jazeera, BBC, CNN, Jerusalem Post, Times of Israel, Guardian, Arab News, Tehran Times, gCaptain, Splash247, OilPrice) + Google News searches | Every item is credited to its outlet. Filter by Hormuz / Red Sea / incidents |
| Official statements | US: CENTCOM, White House, Dept. of War, State Dept. · Iran: IRNA, Mehr, IRGC, Foreign Ministry · Yemen: Houthi military spokesman and leadership · Gulf: Saudi Press Agency, WAM · UK FCDO, UK MoD, UKMTO, UN | **DIRECT** = published by the body itself. **VIA outlet** = the body's statement as reported by a named outlet (used where the body's own site blocks automated access, e.g. IRGC, Houthis, Iran MFA). Filter by side; statements about tankers/attacks raise alerts |
| Social chatter | X (paid API token), Bluesky, Reddit, public Telegram channels | Marked as unverified |
| Price ticker | Yahoo Finance chart API (delayed) | Brent, WTI, Henry Hub, TTF, ULSD, RBOB, gold, tanker equities |
| AI desk analyst | Claude (`claude-opus-5-5`) | BRIEF: structured brief every 15 min and shortly after any critical alert. ASK: chat about the live picture (it gets Brent's intraday prices to line up moves with headlines). Attributes every claim to its source |
| Trade desk | Claude + event study + live prices | TRADE DESK tab: paper trade ideas with entry, stop, target, horizon, P(win), EV and size; live P&L in R; hit rate and Brier score. Runs every 2 h, after critical alerts, or on RUN NOW |
| Research | `public-data/research.json` (Yahoo daily closes, IMF PortWatch) | 📊 RESEARCH: event study and walk-forward test. ▶ RED SEA 2024: animated crisis replay |

## Run

```bash
npm install
```

```bash
npm start
```

Open http://localhost:8787. To try the UI without an AIS key, `npm run demo` runs clearly-labelled **simulated** vessels (news, social and prices stay real).

## Put it online for free (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/itsaminzare/gower-street-terminal)

`render.yaml` defines a web service on Render's **free** plan (no card) in Singapore (aisstream.io limits connections per IP and Render's Frankfurt free IPs were saturated). Free instances sleep after 15 idle minutes, so the server pings its own public URL every 10 minutes (`KEEP_AWAKE=1`); Render's 750 free hours a month cover one service running all month. For guaranteed uptime, change `plan: free` to `plan: starter` (~$7/month).

The AI analyst runs on **Claude Haiku 5.5**: about $0.004 per brief and $0.003 per chat question, so a few dollars a month at most with these limits. Set a monthly limit in the Anthropic console as a hard cap.

The `Dockerfile` runs the same setup on any Docker host (port 7860); `deploy/push-to-hf.ps1` publishes to a Hugging Face Space, which needs a paid Hugging Face plan for Docker.

| Setting | Default | Meaning |
|---|---|---|
| `ANALYST_MODEL` | `claude-opus-5-5` (Render/Docker: `claude-haiku-5-5`) | Claude model for briefs and chat |
| `KEEP_AWAKE` | off (Render: 1) | Ping own public URL every 10 min so free plans don't sleep |
| `ANALYST_INTERVAL_MIN` | 60 | Minutes between scheduled AI briefs |
| `ANALYST_DAILY_MAX` | 30 | Max AI briefs per day from all triggers |
| `ANALYST_ALERT_DEBOUNCE_MIN` | 20 | Min gap before a critical alert triggers another brief |
| `ASK_DAILY_LIMIT` | 30 | Chat questions per day, all visitors combined |
| `ASK_PER_VISITOR_LIMIT` | 5 | Chat questions per visitor per day |
| `MANUAL_RUN_MIN_INTERVAL_MIN` | 15 | Cooldown on the RUN NOW button (brief and trade desk each) |
| `DESK_INTERVAL_MIN` | 120 | Minutes between scheduled trade-desk runs |
| `DESK_DAILY_MAX` | 12 | Max trade-desk runs per day |

Render asks for `AISSTREAM_API_KEY`, `ANTHROPIC_API_KEY` and `NTFY_TOPIC` when you create the service. Saved history, alerts and the desk's paper-trade record reset when the service restarts (no persistent disk). Test notifications can only be sent from the machine running the server.

## Keys

Copy `.env.example` to `.env`. Everything is optional; a panel without its key says it's offline rather than showing fake data.

- `AISSTREAM_API_KEY`: free at aisstream.io. Without it the maps are empty.
- `ANTHROPIC_API_KEY`: enables the AI analyst.
- `X_BEARER_TOKEN`: X recent-search needs a paid X API plan.
- `BSKY_HANDLE` / `BSKY_APP_PASSWORD`: Bluesky search may require login.
- `TELEGRAM_CHANNELS`: comma-separated public channel usernames to watch.
- `NTFY_TOPIC`, or `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`: phone alerts. `NOTIFY_MIN_SEVERITY=warning` to include warnings.

History, transit counts, alerts and cached IMF/OFAC data are saved in `data/` (kept separately for demo and live mode).

## Limits worth knowing

- AIS coverage in both straits relies on terrestrial receivers; gaps happen, and vessels deliberately go dark or spoof positions, especially around Iran. An "AIS-dark" alert is a signal to check, not a confirmed event.
- Ship type arrives in separate static messages (~6 min), so in "tankers only" mode vessels appear once they are classified.
- Prices are delayed exchange data, not a trading feed.
- Social posts and the AI brief are unverified. Don't trade on them alone.
- Ship-to-ship and GPS-jump detections are heuristics. Sanctions matching depends on the vessel broadcasting its real IMO/MMSI; sanctioned ships often don't.
- Deferred futures months can carry stale prices; points that break the curve are flagged and kept out of the spreads.
- The scenario calculator is illustrative arithmetic on public estimates, not a forecast.
