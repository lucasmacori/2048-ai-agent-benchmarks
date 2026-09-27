import { Router } from "express";
import type { OpenRouter } from "@openrouter/sdk";
import { decideHybrid, decideMove } from "./decision-service.js";
import { decisionRequestSchema } from "./validation.js";
import { getLlmModels } from "./model-catalog.js";
import { config } from "./config.js";

export function createDecisionRouter(client: OpenRouter | undefined, model: string, layaBaseUrl: string): Router {
  const router = Router();
  router.get("/capabilities", async (_request, response) => {
    let layaAvailable = false;
    try { layaAvailable = (await fetch(`${layaBaseUrl}/health`, { signal: AbortSignal.timeout(config.capabilitiesTimeoutMs) })).ok; } catch { /* sidecar is optional */ }
    response.json({
      openRouterAvailable: Boolean(client), layaAvailable, jevModel: model, layaModel: config.layaModel, llmModels: await getLlmModels(),
      agent: { maxTurns: config.maxTurns, recentMovesLimit: config.recentMovesLimit, defaultDelayMs: config.agentDelayMs, delayOptionsMs: [config.agentDelayFastMs, config.agentDelayMs, config.agentDelaySlowMs] },
      hybrid: { probabilityMargin: config.system2ProbabilityMargin, confidenceThreshold: config.system2ConfidenceThreshold },
    });
  });
  router.post("/decide", async (request, response) => {
    const parsed = decisionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid game state", details: parsed.error.issues.map((issue) => issue.message) });
      return;
    }
    try {
      const input = parsed.data;
      if (input.mode === "hybrid") {
        if (!input.system1 || !input.system2 || (input.system2 === "llm" && !input.system2Model)) {
          response.status(400).json({ error: "Choose System 1 and System 2 configuration" });
          return;
        }
        const { mode: _mode, system1, system2, system2Model, system2Reasoning, ...gameInput } = input;
        response.json(await decideHybrid(client, model, { ...gameInput, system1: system1!, system2: system2!, system2Model, system2Reasoning }));
        return;
      }
      response.json(await decideMove(client, model, { ...input, mode: input.mode as "jev" | "llm" | "laya" }));
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 502;
      console.error("Decision request failed:", error instanceof Error ? error.message : "Unknown error");
      const diagnostics = typeof error === "object" && error !== null && "diagnostics" in error ? error.diagnostics : undefined;
      response.status(status >= 400 && status < 600 ? status : 502).json({ error: error instanceof Error ? error.message : "Decision failed. Please retry.", ...(Array.isArray(diagnostics) ? { diagnostics } : {}) });
    }
  });
  return router;
}
