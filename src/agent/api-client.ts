import type { AgentDecision, GameMode, GameState } from "../game/types.js";
import type { DecisionDiagnostic } from "../game/types.js";
import type { ReasoningSetting } from "./reasoning.js";

export class DecisionRequestError extends Error {
  constructor(message: string, readonly diagnostics: DecisionDiagnostic[] = []) { super(message); }
}

export async function requestDecision(state: GameState, gameId: string, mode: Exclude<GameMode, "manual">, model?: string, signal?: AbortSignal, reasoning?: ReasoningSetting): Promise<AgentDecision> {
  const response = await fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({ mode, model, gameId, board: state.board, score: state.score, turn: state.turn, recentMoves: state.recentMoves, reasoning }),
  });
  const data = await response.json() as AgentDecision | { error?: string; diagnostics?: DecisionDiagnostic[] };
  if (!response.ok) throw new DecisionRequestError("error" in data ? data.error || "Decision request failed" : "Decision request failed", "diagnostics" in data ? data.diagnostics : []);
  return data as AgentDecision;
}
