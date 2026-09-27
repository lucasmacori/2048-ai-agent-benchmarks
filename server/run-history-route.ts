import { Router } from "express";
import { z } from "zod";
import { isValidBoard } from "../src/game/engine.js";
import type { RunFinishReason, RunIdentity } from "../src/history/types.js";
import { RunHistoryRepository } from "./run-history-repository.js";
import { config } from "./config.js";
import { REASONING_EFFORTS } from "../src/agent/reasoning.js";

const reasoningSchema = z.object({ mode: z.enum(["disabled", "default", "effort"]), effort: z.enum(REASONING_EFFORTS).optional(), maxCompletionTokens: z.number().int().positive().max(8192).optional() });
const diagnosticSchema = z.object({ attempt: z.number().int().positive(), requestedModel: z.string().max(150), resolvedModel: z.string().max(150).optional(), responseId: z.string().max(150).optional(), provider: z.string().max(100).optional(), httpStatus: z.number().int().optional(), latencyMs: z.number().nonnegative(), maxCompletionTokens: z.number().int().positive().optional(), finishReason: z.string().max(80).nullable().optional(), contentLength: z.number().int().nonnegative().optional(), refusalPresent: z.boolean().optional(), reasoningPresent: z.boolean().optional(), reasoningTokenCount: z.number().int().nonnegative().optional(), promptTokens: z.number().int().nonnegative().optional(), completionTokens: z.number().int().nonnegative().optional(), cost: z.number().nonnegative().optional(), errorCode: z.string().max(80).optional(), error: z.string().max(240).optional() });
const identitySchema = z.object({ id: z.string().uuid(), mode: z.enum(["manual", "jev", "llm", "laya"]), model: z.string().min(1).max(150), modelName: z.string().min(1).max(150), seed: z.number().int().nonnegative(), startedAt: z.string().datetime(), provider: z.string().max(80).optional(), tier: z.enum(["cheap", "mid", "frontier"]).optional(), contextVersion: z.literal("turn-facts-v2").optional(), reasoning: reasoningSchema.optional() });
const turnSchema = z.object({ turn: z.number().int().positive().max(config.maxTurns), move: z.enum(["up", "down", "left", "right"]), scoreGain: z.number().int().nonnegative(), score: z.number().int().nonnegative(), board: z.custom<number[][]>(isValidBoard), latencyMs: z.number().nonnegative(), confidence: z.number().optional(), probabilities: z.record(z.string(), z.number()).optional(), usage: z.object({ inputTokens: z.number().nonnegative().optional(), outputTokens: z.number().nonnegative().optional(), cost: z.number().nonnegative().optional() }).optional(), mode: z.enum(["manual", "jev", "llm", "laya"]).optional(), model: z.string().optional(), explanation: z.string().max(config.llmReasonMaxLength).optional(), diagnostics: z.array(diagnosticSchema).optional() });
const finishSchema = z.object({ reason: z.enum(["won", "lost", "turn-limit", "manual-reset", "replay", "engine-change", "error"]), error: z.string().max(240).optional(), diagnostics: z.array(diagnosticSchema).max(2).optional() });

export function createRunHistoryRouter(repository: RunHistoryRepository): Router {
  const router = Router();
  router.get("/runs", async (_request, response, next) => { try { response.json(await repository.list()); } catch (error) { next(error); } });
  router.get("/runs/:id", async (request, response, next) => { try { const run = await repository.get(request.params.id); if (!run) { response.status(404).json({ error: "Run not found" }); return; } response.json(run); } catch (error) { next(error); } });
  router.post("/runs", async (request, response, next) => {
    const parsed = identitySchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Invalid run identity" }); return; }
    try { await repository.create(parsed.data as RunIdentity); response.status(201).json({ ok: true }); } catch (error) { next(error); }
  });
  router.post("/runs/:id/turns", async (request, response, next) => {
    const parsed = turnSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Invalid turn record" }); return; }
    try { await repository.appendTurn(request.params.id, parsed.data); response.status(204).end(); } catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "Could not append turn" }); }
  });
  router.patch("/runs/:id", async (request, response, next) => {
    const parsed = finishSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Invalid finish reason" }); return; }
    try { await repository.finish(request.params.id, parsed.data.reason as RunFinishReason, parsed.data.error?.replace(/(?:Bearer\s+)[^\s]+|(?:sk-[A-Za-z0-9_-]{12,})/gi, "[redacted]"), parsed.data.diagnostics); response.status(204).end(); } catch (error) { next(error); }
  });
  router.delete("/runs/:id", async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ error: "Invalid run ID" }); return; }
    try { if (!await repository.delete(request.params.id)) { response.status(404).json({ error: "Run not found" }); return; } response.status(204).end(); } catch (error) { next(error); }
  });
  router.patch("/runs/:id/name", async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) { response.status(400).json({ error: "Invalid run ID" }); return; }
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Session name must be 1–100 characters" }); return; }
    try { if (!await repository.rename(request.params.id, parsed.data.name)) { response.status(404).json({ error: "Run not found" }); return; } response.status(204).end(); } catch (error) { next(error); }
  });
  return router;
}
