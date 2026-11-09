# Where we are (9 Nov 2026)

## Live and working
- Site: https://gower-street-terminal-sg.onrender.com, running on **Anthropic Claude** (`ANALYST_MODEL`, Haiku 5.5 on the public site)
- Ship feed (aisstream) connected; prices, news and official statements live
- Trade desk on, with its approval record carried across deploys (`public-data/desk-snapshot.json`)
- GitHub: https://github.com/itsaminzare/gower-street-terminal (README, logo, manual, evidence)
- Hackathon submitted (Agentverse 2026, Finance Track)

## To do
1. **Render:** make sure `ANTHROPIC_API_KEY` is set on the Environment page, and delete `AI_PROVIDER`, `GEMINI_API_KEY` and `GEMINI_MODEL` there (the code no longer reads them).
2. **Security:** delete the old Gemini key at aistudio.google.com, and the `gower-street-gemini` GitHub App's private key (both were pasted in chat). Remove the GitHub repo secrets `GEMINI_API_KEY` and `APP_PRIVATE_KEY`, and uninstall the app if no longer used.
3. **When a phone alert arrives**, approve or reject the trade-desk proposal in the Trade desk tab, to build a track record.

## Rules
- **Don't press Deploy on Render yourself.** Ask Claude, which backs up the trade-desk record first.
