import { describe, expect, it } from "vitest";
import { assessDelegation } from "./delegation-policy.js";

const thresholds = { probabilityMargin: 0.15, confidenceThreshold: 0.6 };

describe("System 1 / System 2 delegation policy", () => {
  it("does not delegate when only one legal move exists", () => {
    expect(assessDelegation({ move: "left", latencyMs: 1 }, ["left"], "human", thresholds).reason).toBe("single-option");
  });

  it("delegates when top move probabilities are close", () => {
    expect(assessDelegation({ move: "left", probabilities: { left: 0.52, right: 0.48 }, latencyMs: 1 }, ["left", "right"], "llm", thresholds).delegated).toBe(true);
  });

  it("keeps a decisive probability choice with System 1", () => {
    expect(assessDelegation({ move: "left", probabilities: { left: 0.9, right: 0.1 }, latencyMs: 1 }, ["left", "right"], "human", thresholds).finalOwner).toBe("system1");
  });

  it("delegates when the selected move is not the probability leader", () => {
    expect(assessDelegation({ move: "right", probabilities: { left: 0.8, right: 0.2 }, latencyMs: 1 }, ["left", "right"], "human", thresholds).delegated).toBe(true);
  });

  it("uses confidence when probability scores are unavailable", () => {
    expect(assessDelegation({ move: "left", confidence: 0.5, latencyMs: 1 }, ["left", "right"], "human", thresholds).reason).toBe("low-confidence");
  });

  it("delegates when uncertainty is unavailable", () => {
    expect(assessDelegation({ move: "left", latencyMs: 1 }, ["left", "right"], "human", thresholds).reason).toBe("uncertainty-unavailable");
  });
});
