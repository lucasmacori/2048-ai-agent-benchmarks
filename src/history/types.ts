import type { GameMode, HybridSystem1, HybridSystem2, TurnRecord } from "../game/types.js";
import type { DecisionDiagnostic } from "../game/types.js";
import type { ReasoningSetting } from "../agent/reasoning.js";

export type RunFinishReason = "won" | "lost" | "turn-limit" | "manual-reset" | "replay" | "engine-change" | "error" | "in-progress";

export interface RunIdentity {
  id: string;
  mode: GameMode;
  model: string;
  modelName: string;
  seed: number;
  startedAt: string;
  provider?: string;
  tier?: "cheap" | "mid" | "frontier";
  contextVersion?: "turn-facts-v2";
  sessionName?: string;
  reasoning?: ReasoningSetting;
  hybrid?: { system1: HybridSystem1; system2: HybridSystem2; system2Model?: string; probabilityMargin: number; confidenceThreshold: number };
}

export interface RunMetrics {
  score: number;
  highestTile: number;
  turns: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
  totalLatencyMs: number;
  averageLatencyMs: number | null;
  durationMs: number;
  usagePartial: boolean;
}

export interface RunRecord extends RunIdentity {
  finishedAt: string;
  finishReason: RunFinishReason;
  metrics: RunMetrics;
  turns: TurnRecord[];
  terminalError?: string;
  terminalDiagnostics?: DecisionDiagnostic[];
}

export type RunSummary = Omit<RunRecord, "turns">;

export function summarizeRun(identity: RunIdentity, turns: TurnRecord[], finishReason: RunFinishReason, finishedAt = new Date().toISOString(), terminalError?: string, terminalDiagnostics?: DecisionDiagnostic[]): RunRecord {
  const inputKnown = turns.every((turn) => turn.usage?.inputTokens !== undefined);
  const outputKnown = turns.every((turn) => turn.usage?.outputTokens !== undefined);
  const costsKnown = turns.every((turn) => turn.usage?.cost !== undefined);
  const tokensInput = turns.reduce((sum, turn) => sum + (turn.usage?.inputTokens ?? 0), 0);
  const tokensOutput = turns.reduce((sum, turn) => sum + (turn.usage?.outputTokens ?? 0), 0);
  return {
    ...identity,
    finishedAt,
    finishReason,
    ...(terminalError ? { terminalError } : {}),
    ...(terminalDiagnostics?.length ? { terminalDiagnostics: structuredClone(terminalDiagnostics) } : {}),
    turns: structuredClone(turns),
    metrics: {
      score: turns.at(-1)?.score ?? 0,
      highestTile: turns.reduce((highest, turn) => Math.max(highest, ...turn.board.flat()), 0),
      turns: turns.length,
      inputTokens: turns.length === 0 && identity.mode === "manual" ? null : inputKnown ? tokensInput : null,
      outputTokens: turns.length === 0 && identity.mode === "manual" ? null : outputKnown ? tokensOutput : null,
      totalTokens: turns.length === 0 && identity.mode === "manual" ? null : inputKnown && outputKnown ? tokensInput + tokensOutput : null,
      cost: turns.length === 0 && identity.mode === "manual" ? null : costsKnown ? turns.reduce((sum, turn) => sum + (turn.usage?.cost ?? 0), 0) : null,
      totalLatencyMs: turns.reduce((sum, turn) => sum + turn.latencyMs, 0),
      averageLatencyMs: turns.length ? Math.round(turns.reduce((sum, turn) => sum + turn.latencyMs, 0) / turns.length) : null,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(identity.startedAt)),
      usagePartial: turns.length > 0 && (!inputKnown || !outputKnown || !costsKnown),
    },
  };
}
