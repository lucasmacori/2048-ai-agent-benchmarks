import type { AgentDecision, DelegationTrace, GameMode, GameState, HybridSystem1, HybridSystem2 } from "../game/types.js";
import type { DecisionDiagnostic } from "../game/types.js";
import type { ReasoningSetting } from "./reasoning.js";

export class DecisionRequestError extends Error {
  constructor(message: string, readonly diagnostics: DecisionDiagnostic[] = []) { super(message); }
}

export type DecisionResult = { outcome?: "move"; decision?: AgentDecision; delegation?: DelegationTrace; move?: AgentDecision["move"] } | { outcome: "human-required"; system1Decision: AgentDecision; delegation: DelegationTrace };

export async function requestDecision(state: GameState, gameId: string, mode: Exclude<GameMode, "manual">, model?: string, signal?: AbortSignal, reasoning?: ReasoningSetting, hybrid?: { system1: HybridSystem1; system2: HybridSystem2; system2Model?: string; system2Reasoning?: ReasoningSetting }): Promise<DecisionResult> {
  const response = await fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({ mode, model, gameId, board: state.board, score: state.score, turn: state.turn, recentMoves: state.recentMoves, reasoning, ...hybrid }),
  });
  const data = await response.json() as AgentDecision | { error?: string; diagnostics?: DecisionDiagnostic[] };
  if (!response.ok) throw new DecisionRequestError("error" in data ? data.error || "Decision request failed" : "Decision request failed", "diagnostics" in data ? data.diagnostics : []);
  return data as DecisionResult;
}
