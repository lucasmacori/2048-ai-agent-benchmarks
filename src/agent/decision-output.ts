import type { Direction } from "../game/types.js";

export class LlmOutputError extends Error {
  constructor(message: string, readonly code: "invalid_json" | "invalid_move_schema") { super(message); }
}

export function parseLlmOutput(content: string, legalMoves: Direction[], maxReasonLength = 160): { move: Direction; explanation?: string } {
  let output: unknown;
  try { output = JSON.parse(content); }
  catch { throw new LlmOutputError("LLM response was not valid JSON", "invalid_json"); }
  if (!output || typeof output !== "object" || !("move" in output) || typeof output.move !== "string" || !legalMoves.includes(output.move as Direction)) {
    throw new LlmOutputError("LLM response did not contain a legal move", "invalid_move_schema");
  }
  const reason = "reason" in output && typeof output.reason === "string" ? output.reason.slice(0, maxReasonLength) : undefined;
  return { move: output.move as Direction, ...(reason ? { explanation: reason } : {}) };
}
