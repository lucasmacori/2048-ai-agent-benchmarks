import { describe, expect, it } from "vitest";
import { summarizeRun } from "./types.js";

describe("summarizeRun", () => {
  it("aggregates benchmark metrics and keeps unavailable usage distinct", () => {
    const result = summarizeRun({ id: "r1", mode: "llm", model: "model-a", modelName: "Model A", seed: 7, startedAt: "2025-01-01T00:00:00.000Z" }, [
      { turn: 1, move: "left", scoreGain: 4, score: 4, board: [[2, 4]], latencyMs: 100, usage: { inputTokens: 10, outputTokens: 3, cost: 0.01 } },
      { turn: 2, move: "down", scoreGain: 8, score: 12, board: [[8, 0]], latencyMs: 200 },
    ], "engine-change", "2025-01-01T00:00:02.000Z");
    expect(result.metrics).toMatchObject({ score: 12, highestTile: 8, turns: 2, inputTokens: null, outputTokens: null, totalTokens: null, cost: null, totalLatencyMs: 300, averageLatencyMs: 150, durationMs: 2000, usagePartial: true });
  });

  it("treats an empty manual run as unavailable token usage", () => {
    const result = summarizeRun({ id: "r2", mode: "manual", model: "Human", modelName: "Human", seed: 7, startedAt: "2025-01-01T00:00:00.000Z" }, [], "manual-reset", "2025-01-01T00:00:01.000Z");
    expect(result.metrics).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null, cost: null, turns: 0 });
  });
});
