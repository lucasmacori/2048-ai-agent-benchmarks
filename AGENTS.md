# Repository notes

- This is a single npm project, not a monorepo. The browser entry is `src/main.ts`; `server/index.ts` starts Express and owns the OpenRouter client. Keep API keys on the server.
- `src/game/engine.ts` is shared by browser and server: the server recomputes legal moves/candidate outcomes before asking JEV, and the browser applies the returned legal move.
- `OPENROUTER_API_KEY` is optional at startup and only needed for JEV/LLM modes. `.env` is gitignored; never put credentials in frontend code. `LAYA_API_KEY` is only for an authenticated local Laya sidecar.
- `npm run dev` starts the Node API, Vite, and an optional installed Laya sidecar; Vite proxies `/api` to `http://localhost:3000`. Set `PORT` in `.env` to change the API port (also update the Vite proxy if it differs from 3000).
- `npm run setup:laya` creates `.venv` and installs pinned `laya[serve]`; `npm run laya` starts its local HTTP service. It may download model weights on first inference. `LAYA_BASE_URL` configures the Node-to-Laya URL.
- `server/decision-service.ts` dispatches JEV typed decisions, OpenRouter structured chat output, or local Laya. Keep the LLM allowlist in `server/model-catalog.ts`; validate all returned directions against recomputed legal moves.
- Run benchmarks are persisted in the gitignored `data/run-history.json` through `server/run-history-repository.ts`; keep run engine/model identity immutable and derive metrics from the recorded turn tape.
- Run `npm test` for tests, or `npx vitest run src/game/engine.test.ts` for the focused engine suite. Vitest discovers `src/**/*.test.ts` and `server/**/*.test.ts`.
- Run `npm run typecheck` for both TypeScript projects. `npm run build` runs typecheck, then the Vite client build, then emits the server to `dist-server`; run `npm start` only after the build.
- Browser TypeScript uses bundler resolution; server TypeScript uses NodeNext. Keep `.js` extensions on relative imports (including imports from shared `src/game` modules) so emitted server ESM resolves correctly.
