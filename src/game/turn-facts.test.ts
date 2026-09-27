import { describe, expect, it } from "vitest";
import { createTurnFacts } from "./turn-facts.js";

describe("createTurnFacts", () => {
  it("provides identical factual fields and terminal spawn placement counts", () => {
    const facts = createTurnFacts({ board: [[2, 2, 8, 16], [32, 64, 128, 256], [512, 1024, 2, 4], [8, 16, 32, 64]], score: 123, turn: 9 });
    expect(facts).toMatchObject({ contextVersion: "turn-facts-v2", score: 123, turn: 9, target: 2048, spawnRule: { 2: 0.9, 4: 0.1 } });
    expect(facts.legalMoves).toContain("left");
    for (const move of facts.legalMoves) {
      const outcome = facts.outcomesByMove[move]!;
      expect(outcome.boardAfterMove.flat().filter(Boolean)).toHaveLength(16 - outcome.emptyCellsAfterMove);
      expect(outcome.terminalSpawnPlacements.totalPlacements).toBe(outcome.emptyCellsAfterMove);
      expect(outcome.terminalSpawnPlacements.with2).toBeGreaterThanOrEqual(0);
      expect(outcome.terminalSpawnPlacements.with4).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(facts.outcomesByMove).sort()).toEqual([...facts.legalMoves].sort());
  });

  it("does not add spawn tiles or a recommended move to the facts", () => {
    const board = [[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const facts = createTurnFacts({ board, score: 0, turn: 0 });
    expect(facts).not.toHaveProperty("recommendedMove");
    expect(facts).not.toHaveProperty("survivalProbability");
    expect(Object.values(facts.outcomesByMove)[0]?.boardAfterMove.flat().filter(Boolean)).toHaveLength(1);
  });
});
