# Gower Street Terminal

### 🛰 Live terminal: **[gower-street-terminal-sg.onrender.com](https://gower-street-terminal-sg.onrender.com)**

*Free hosting: if nobody has visited for a while, the first load can take up to a minute while the server wakes.*

© 2026 Mohammadamin Zare, University College London. All rights reserved. No part of this software may be copied, modified or distributed without written permission; see [LICENSE](LICENSE). Third-party libraries, maps and data remain their owners' property; see [NOTICE.md](NOTICE.md).

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
| `MANUAL_RUN_MIN_INTERVAL_MIN` | 15 | Cooldown on the RUN NOW button |

Render asks for `AISSTREAM_API_KEY`, `ANTHROPIC_API_KEY` and `NTFY_TOPIC` when you create the service. Every push to `main` redeploys automatically. Saved history and alerts reset when the service restarts (no persistent disk). Test notifications can only be sent from the machine running the server.

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
