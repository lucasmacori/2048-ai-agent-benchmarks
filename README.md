# Laya Arcade — 2048

A seeded 2048 game with four play modes: Manual, JEV, LLM, and local Laya. The shared TypeScript engine owns all game rules; provider decisions are restricted to server-recomputed legal moves.

## Run

1. Install Node dependencies: `npm install`.
2. Optionally copy `.env.example` to `.env` and set `OPENROUTER_API_KEY` for JEV and LLM modes. The key remains server-side. Without it, Manual and Laya still work.
3. Run `npm run dev`; open the Vite URL printed in the terminal (usually `http://localhost:5173`). The server listens on port 3000 by default, and Vite proxies `/api` there.

## Modes

- **Manual:** Arrow keys, WASD, or the on-screen controls.
- **JEV:** OpenRouter Decisions API, model selected by `OPENROUTER_MODEL` (defaults to `~typesafe/jev-latest`).
- **LLM:** OpenRouter Chat Completions with strict JSON-schema output. The curated picker groups 18 models across cheap/basic, mid-tier, and frontier tiers. Reasoning is disabled by default when supported; compatible reasoning levels can be selected per model and are saved with each run. Provider attempts record safe diagnostics without persisting raw reasoning. All engines receive the same factual turn context, including legal moves and possible terminal spawn placements. Returned moves are checked against server-recomputed legal moves.
- **Laya:** Local `laya-serve` sidecar. First install the runtime with `npm run setup:laya`, then start it using `npm run laya` in a separate terminal. On first inference, Hugging Face downloads the English checkpoint; later runs use the local cache. CPU is the default. The sidecar listens on `127.0.0.1:8000` and is free to run locally.
- **System 1 / System 2:** Select JEV or Laya as System 1, then an LLM or Human in the loop as System 2. The app delegates automatically when legal move probabilities are close (configured by `SYSTEM2_PROBABILITY_MARGIN`, default `0.15`), confidence is low (`SYSTEM2_CONFIDENCE_THRESHOLD`, default `0.6`), or confidence information is unavailable. A human handoff pauses for exactly one legal move; autoplay resumes afterward if it was active. System 2 LLM choices are checked against server-computed legal moves.

`npm run dev` attempts to start an installed Laya sidecar and continues if it is absent. Laya availability is shown in the UI. To configure a different URL, set `LAYA_BASE_URL`; if the sidecar uses `LAYA_API_KEY`, set the same value in the app's `LAYA_API_KEY`. `LAYA_PORT` changes the sidecar launch port. For GPU inference, set `LAYA_DEVICE` in the environment before launching.

## Run benchmarks

Each run is bound to one engine and model. Changing mode or the LLM model archives the current run and starts a fresh game using the same seed, making results comparable from the same initial board. New Run archives and uses a new seed; Replay archives and reuses the seed.

Run summaries and decision tapes are stored by the server in `data/run-history.json` (gitignored), so they persist across browser sessions on this server. The table can be filtered by mode and sorted by benchmark metrics; selecting a run opens its full move tape with board snapshots. Runs are archived after at least one accepted move. Manual moves have unavailable token/cost metrics. Provider usage omitted from individual decisions remains `N/A`; partial totals are explicitly marked rather than treated as zero. Provider-resolved model IDs are retained per turn alongside the requested model identity.

## Commands

- `npm run dev` — API, Vite, and optional installed Laya sidecar.
- `npm run setup:laya` — create `.venv` and install pinned `laya[serve]` (Python 3.10+ required).
- If you move or rename this project after setup, recreate the virtual environment with `rm -rf .venv` and `npm run setup:laya`; Python entry points contain absolute paths.
- `npm run laya` — require and start the local Laya sidecar.
- `npm test` — run unit tests; focus with `npx vitest run src/agent/controller.test.ts`.
- `npm run typecheck` — check browser and server TypeScript projects.
- `npm run build` — typecheck, build Vite assets, then emit the server.
- `npm start` — serve the production build after `npm run build`.

## Configuration

See `.env.example` for every supported setting and its current default. Besides provider credentials and models, it documents run limits, recent-move context, autoplay delays, structured-output limits, provider instructions, Laya runtime settings, and health-check timing. `.env` and `.venv/` are gitignored. `OPENROUTER_API_KEY` is optional at startup and required only for JEV/LLM modes. The server validates candidate moves for every provider before returning them to the browser.
