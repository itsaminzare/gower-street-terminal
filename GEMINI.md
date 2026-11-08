# Notes for Gemini working on this repository

Gower Street Terminal is a Node.js (ESM, no build step) maritime-risk terminal: `server.js` plus `src/` on the server, plain JavaScript in `public/` for the browser.

Rules:

- Keep changes small and focused on the task. Match the existing style: two-space indent, double quotes, ES modules.
- `src/desk-core.js` is shared by the live trade desk and the backtest. Keep its functions pure, and keep all prices, costs, expected values and risk checks computed in code, never by a model.
- Never add or edit secrets, `.env` files, `public-data/` snapshots or anything under `evidence/`.
- Use the name "Persian Gulf" (never "Arabian Gulf" or just "the Gulf") for the body of water.
- Paper trading only: never add code that places real orders.
- Every file starts with the copyright line used in the other files; keep it.
