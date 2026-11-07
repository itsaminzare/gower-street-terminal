# Where we are (7 Nov 2026, 18:45 UTC)

## Live and working
- Site: https://gower-street-terminal-sg.onrender.com, now running on **Google Gemini (gemini-3.8-flash)**
- Ship feed (aisstream) connected; prices, news and official statements live
- Trade desk on, with one closed Brent trade in its record
- GitHub: https://github.com/itsaminzare/gower-street-terminal (README, logo, evidence)
- Deck: `deck/Gower-Street-Terminal-pitch.pptx` (11 slides)

## Plan for the next session (in this order)
1. **Demo video, made automatically:** script a ~90-second 1080p tour of the live site with Playwright and ffmpeg (install both with approval), using `video/1-opening-card.png`, `video/2-closing-card.png` and the captions in `video/SHOT-LIST.md`. Output: `video/gower-street-demo.mp4`.
2. **Finish the Gemini move:** add Gemini support to `scripts/agent-backtest.mjs` and re-run it; update the README, Research window and deck with the Gemini numbers; change the README and deck wording from Claude to Gemini (Claude as alternative); add `AI_PROVIDER=gemini` to `render.yaml`.
3. **Gemini as a GitHub contributor:** you install the Gemini Code Assist app or the Gemini CLI Action; then a pull request with a fix from `docs/gemini-review.md`, made by Gemini's bot and merged into main.

## Still to do before the deadline
1. **Submit** the repo link, live link and deck to the hackathon.
2. **Optional: re-run the AI backtest on Gemini** so the deck and README numbers match the model now in use (ask Claude: "re-run the agent backtest with Gemini and update README and deck"). Until then, those numbers say they came from Claude Haiku.
3. **Mention Gemini** in the README and deck: one line saying the AI runs on Gemini, with Claude as a switchable alternative.
4. **When the phone alert arrives**, approve or reject the trade-desk proposal in the Trade desk tab, to build a track record.
5. **Security:** create a fresh Gemini key at aistudio.google.com and delete the old one (it was pasted in chat). Put the new key in `.env` (line 35) and on Render.
6. **Ask the organisers** whether apps must use Gemini 4 Argon specifically (free-tier keys can't use Argon).

## Rules
- **Don't press Deploy on Render yourself.** Ask Claude, which backs up the trade-desk record first.
- To switch back to Claude: on Render's Environment page set `AI_PROVIDER` to `claude` and save.
