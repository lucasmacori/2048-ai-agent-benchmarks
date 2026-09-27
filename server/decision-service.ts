import { OpenRouter } from "@openrouter/sdk";
import { legalMoves } from "../src/game/engine.js";
import { createTurnFacts } from "../src/game/turn-facts.js";
import type { Direction, GameMode } from "../src/game/types.js";
import type { DecisionDiagnostic } from "../src/game/types.js";
import { getReasoningCapabilities, isAllowedLlmModel } from "./model-catalog.js";
import { config } from "./config.js";
import type { ReasoningSetting } from "../src/agent/reasoning.js";
import { completionBudget } from "../src/agent/reasoning.js";
import { LlmOutputError, parseLlmOutput } from "../src/agent/decision-output.js";

export interface DecisionResponse {
  move: Direction;
  confidence?: number;
  probabilities?: Record<string, number>;
  model: string;
  mode: Exclude<GameMode, "manual">;
  latencyMs: number;
  explanation?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
  diagnostics?: DecisionDiagnostic[];
}

type Input = { gameId: string; board: number[][]; score: number; turn: number; recentMoves: Direction[]; mode: "jev" | "llm" | "laya"; model?: string; reasoning?: ReasoningSetting };

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "LLM request failed";
  return message.replace(/(?:Bearer\s+)[^\s]+|(?:sk-[A-Za-z0-9_-]{12,})/gi, "[redacted]").slice(0, 240);
}

function completionUsageTokens(raw: unknown): { promptTokens?: number; completionTokens?: number; reasoningTokens?: number; cost?: number } {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  const details = value.completion_tokens_details as Record<string, unknown> | undefined;
  return {
    promptTokens: typeof value.prompt_tokens === "number" ? value.prompt_tokens : undefined,
    completionTokens: typeof value.completion_tokens === "number" ? value.completion_tokens : undefined,
    reasoningTokens: typeof details?.reasoning_tokens === "number" ? details.reasoning_tokens : typeof value.reasoning_tokens === "number" ? value.reasoning_tokens : undefined,
    cost: typeof value.cost === "number" ? value.cost : undefined,
  };
}

function diagnosticLog(diagnostic: DecisionDiagnostic, gameId: string, turn: number): void {
  console.info("llm_decision_attempt", JSON.stringify({ runSessionId: gameId, turn, ...diagnostic }));
}

function retryDelayMs(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Math.max(0, Math.min(10_000, milliseconds));
}

function usage(raw: unknown): DecisionResponse["usage"] {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  return {
    inputTokens: typeof row.prompt_tokens === "number" ? row.prompt_tokens : typeof row.input_tokens === "number" ? row.input_tokens : undefined,
    outputTokens: typeof row.completion_tokens === "number" ? row.completion_tokens : typeof row.output_tokens === "number" ? row.output_tokens : undefined,
    cost: typeof row.cost === "number" ? row.cost : undefined,
  };
}

export async function decideMove(client: OpenRouter | undefined, jevModel: string, input: Input): Promise<DecisionResponse> {
  const legal = legalMoves(input.board);
  if (legal.length === 0) throw Object.assign(new Error("No legal moves remain"), { status: 409 });
  const facts = createTurnFacts(input);
  const start = performance.now();

  if (input.mode === "jev") {
    if (!client) throw Object.assign(new Error("Set OPENROUTER_API_KEY to use JEV mode"), { status: 503 });
    const criteria = Object.fromEntries(legal.map((direction) => [direction, { description: direction }]));
    const response = await client.alpha.decisions.create({
      decisionsRequest: {
        model: jevModel,
        sessionId: input.gameId,
        state: facts,
        questions: { nextMove: {
          type: "choice",
          instructions: "Choose exactly one legal move that gives the best chance of reaching 2048 before no legal moves remain. Use only the supplied turn facts.",
          criteria,
        } },
      },
    });
    const answer = response.answers.nextMove;
    if (!answer || answer.type !== "choice" || !legal.includes(answer.choice as Direction)) throw Object.assign(new Error("JEV returned an illegal move"), { status: 502 });
    const rawUsage = response.usage as unknown;
    const mappedUsage = usage(rawUsage && typeof rawUsage === "object" ? {
      prompt_tokens: (rawUsage as Record<string, unknown>).inputTokens,
      completion_tokens: (rawUsage as Record<string, unknown>).outputTokens,
      cost: (rawUsage as Record<string, unknown>).cost,
    } : undefined);
    return { mode: "jev", move: answer.choice as Direction, confidence: answer.confidence, probabilities: answer.probabilities, model: response.model || jevModel, latencyMs: Math.round(performance.now() - start), usage: mappedUsage };
  }

  if (input.mode === "llm") {
    if (!config.apiKey) throw Object.assign(new Error("Set OPENROUTER_API_KEY to use LLM mode"), { status: 503 });
    const model = input.model || "";
    if (!isAllowedLlmModel(model)) throw Object.assign(new Error("Choose a supported LLM model"), { status: 400 });
    const reasoning = input.reasoning || { mode: "disabled" as const };
    const capabilities = getReasoningCapabilities(model);
    if (!capabilities) throw Object.assign(new Error("Reasoning metadata is unavailable for this model"), { status: 400 });
    if (reasoning.mode === "disabled" && capabilities.mandatory) throw Object.assign(new Error("This model requires reasoning to be enabled"), { status: 400 });
    if (reasoning.mode !== "disabled" && !capabilities.supported) throw Object.assign(new Error("This model does not support reasoning"), { status: 400 });
    if (reasoning.mode === "effort" && (!reasoning.effort || !capabilities.supportedEfforts?.includes(reasoning.effort))) throw Object.assign(new Error("Unsupported reasoning effort for this model"), { status: 400 });

    const diagnostics: DecisionDiagnostic[] = [];
    let lastError: Error = new Error("LLM request failed");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requestStart = performance.now();
      const baseMaxTokens = completionBudget(reasoning);
      const previousFailure = diagnostics.at(-1)?.errorCode;
      const maxTokens = Math.min(8192, baseMaxTokens * (attempt > 0 && (previousFailure === "output_budget_exhausted" || previousFailure === "reasoning_without_content") ? 2 : 1));
      let diagnostic: DecisionDiagnostic = { attempt: attempt + 1, requestedModel: model, latencyMs: 0, maxCompletionTokens: maxTokens };
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "X-OpenRouter-Metadata": "enabled" },
          body: JSON.stringify({
            model,
            session_id: input.gameId,
            messages: [
              { role: "system", content: "Return only JSON matching the required schema. Choose exactly one legal move that gives the best chance of reaching 2048 before no legal moves remain. Use only the supplied turn facts." },
              { role: "user", content: JSON.stringify(facts) },
            ],
            response_format: { type: "json_schema", json_schema: { name: "move_decision", strict: true, schema: {
              type: "object", properties: { move: { type: "string", enum: legal, description: "One legal move direction." }, reason: { type: "string", maxLength: 160, description: "A brief explanation, at most 160 characters." } }, required: ["move", "reason"], additionalProperties: false,
            } } },
            provider: { require_parameters: config.llmRequireParameters },
            max_tokens: maxTokens,
            reasoning: capabilities.supported
              ? reasoning.mode === "disabled" ? { enabled: false }
                : reasoning.mode === "default" ? { enabled: true, exclude: true }
                  : { effort: reasoning.effort, exclude: true }
              : undefined,
          }),
        });
        const body = await response.json().catch(() => ({})) as {
          id?: string; choices?: Array<{ finish_reason?: string | null; message?: { content?: string | Array<{ type?: string; text?: string }> | null; refusal?: string | null; reasoning?: string | null; reasoning_details?: unknown[] } }>;
          usage?: unknown; model?: string; error?: { code?: string | number; message?: string }; openrouter_metadata?: { endpoints?: { available?: Array<{ provider: string; selected: boolean }> } };
        };
        const choice = body.choices?.[0];
        const message = choice?.message;
        const content = typeof message?.content === "string" ? message.content : Array.isArray(message?.content) ? message.content.filter((part) => part.type === "text").map((part) => part.text || "").join("") : "";
        const usageData = completionUsageTokens(body.usage);
        diagnostic = {
          ...diagnostic,
          responseId: body.id,
          resolvedModel: body.model,
          provider: body.openrouter_metadata?.endpoints?.available?.find((endpoint) => endpoint.selected)?.provider,
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - requestStart),
          finishReason: choice?.finish_reason,
          contentLength: content.length,
          refusalPresent: Boolean(message?.refusal),
          reasoningPresent: Boolean(message?.reasoning || message?.reasoning_details?.length),
          reasoningTokenCount: usageData.reasoningTokens,
          promptTokens: usageData.promptTokens,
          completionTokens: usageData.completionTokens,
          cost: usageData.cost,
        };
        if (!response.ok) {
          diagnostic.errorCode = String(body.error?.code || response.status);
          diagnostic.error = safeError(new Error(body.error?.message || "OpenRouter request failed"));
          diagnostics.push(diagnostic);
          diagnosticLog(diagnostic, input.gameId, input.turn);
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          if (!retryable || attempt === 1) throw Object.assign(new Error(diagnostic.error), { status: response.status >= 500 ? 502 : response.status, diagnostics });
          const retryAfter = retryDelayMs(response.headers.get("retry-after"));
          if (retryAfter > 0) await new Promise((resolve) => setTimeout(resolve, retryAfter));
          continue;
        }
        if (message?.refusal) {
          diagnostic.errorCode = "provider_refusal";
          diagnostic.error = "Provider refused the completion";
          diagnostics.push(diagnostic);
          diagnosticLog(diagnostic, input.gameId, input.turn);
          throw Object.assign(new Error(diagnostic.error), { status: 502, diagnostics });
        }
        if (!content) {
          diagnostic.errorCode = choice?.finish_reason === "length" ? "output_budget_exhausted" : diagnostic.reasoningPresent ? "reasoning_without_content" : "empty_completion";
          diagnostic.error = diagnostic.errorCode === "output_budget_exhausted" ? "LLM exhausted its completion token budget before returning a move" : "LLM returned no visible completion content";
          diagnostics.push(diagnostic);
          diagnosticLog(diagnostic, input.gameId, input.turn);
          lastError = new Error(diagnostic.error);
          if (attempt === 0) continue;
          throw Object.assign(lastError, { status: 502, diagnostics });
        }
        let parsed: ReturnType<typeof parseLlmOutput>;
        try { parsed = parseLlmOutput(content, legal, Math.min(config.llmReasonMaxLength, 160)); }
        catch (error) {
          diagnostic.errorCode = error instanceof LlmOutputError ? error.code : "invalid_move_schema";
          diagnostic.error = safeError(error);
          diagnostics.push(diagnostic);
          diagnosticLog(diagnostic, input.gameId, input.turn);
          lastError = new Error(diagnostic.error);
          if (attempt === 0) continue;
          throw Object.assign(lastError, { status: 502, diagnostics });
        }
        diagnostics.push(diagnostic);
        diagnosticLog(diagnostic, input.gameId, input.turn);
        return { mode: "llm", move: parsed.move, explanation: parsed.explanation, model: body.model || model, latencyMs: Math.round(performance.now() - start), usage: usage(body.usage), diagnostics };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("LLM request failed");
        if ((error as Error & { diagnostics?: DecisionDiagnostic[] }).diagnostics) throw error;
        if (diagnostic.errorCode === undefined) {
          diagnostic.httpStatus ??= undefined;
          diagnostic.latencyMs = Math.round(performance.now() - requestStart);
          diagnostic.errorCode = "transport_error";
          diagnostic.error = safeError(error);
          diagnostics.push(diagnostic);
          diagnosticLog(diagnostic, input.gameId, input.turn);
        }
        if (attempt === 1) throw Object.assign(lastError, { status: 502, diagnostics });
      }
    }
    throw Object.assign(lastError, { status: 502, diagnostics });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.layaApiKey) headers.Authorization = `Bearer ${config.layaApiKey}`;
  let response: Response;
  try {
    response = await fetch(`${config.layaBaseUrl}/v1/systemone`, {
      method: "POST", headers,
      body: JSON.stringify({ model: config.layaModel, state: facts, questions: { nextMove: {
        type: "choice",
        instructions: "Choose exactly one legal move that gives the best chance of reaching 2048 before no legal moves remain. Use only the supplied turn facts.",
        criteria: Object.fromEntries(legal.map((direction) => [direction, direction])),
      } } }),
    });
  } catch { throw Object.assign(new Error("Laya is unavailable. Start the local Laya sidecar."), { status: 503 }); }
  const body = await response.json() as { answers?: Record<string, { type?: string; choice?: string; confidence?: number; probabilities?: Record<string, number> }>; model?: string; usage?: unknown; error?: { message?: string } };
  if (!response.ok) throw Object.assign(new Error(body.error?.message || "Laya request failed"), { status: response.status >= 400 && response.status < 500 ? response.status : 502 });
  const answer = body.answers?.nextMove;
  if (!answer || answer.type !== "choice" || !answer.choice || !legal.includes(answer.choice as Direction)) throw Object.assign(new Error("Laya returned an illegal or invalid move"), { status: 502 });
  const layaUsage = body.usage as Record<string, unknown> | undefined;
  return {
    mode: "laya", move: answer.choice as Direction, confidence: answer.confidence, probabilities: answer.probabilities,
    model: body.model || "Laya English", latencyMs: Math.round(performance.now() - start),
    usage: layaUsage ? { inputTokens: typeof layaUsage.input_tokens === "number" ? layaUsage.input_tokens : undefined, outputTokens: typeof layaUsage.output_tokens === "number" ? layaUsage.output_tokens : undefined } : undefined,
  };
}
