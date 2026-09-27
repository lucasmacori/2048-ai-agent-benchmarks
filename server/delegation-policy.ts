import type { AgentDecision, DelegationTrace, Direction, HybridSystem2 } from "../src/game/types.js";

export interface DelegationThresholds {
  probabilityMargin: number;
  confidenceThreshold: number;
}

export function assessDelegation(
  decision: AgentDecision,
  legalMoves: Direction[],
  system2Type: HybridSystem2,
  thresholds: DelegationThresholds,
  system2Model?: string,
): DelegationTrace {
  const base = {
    system1Move: decision.move,
    system1Confidence: decision.confidence,
    system1Probabilities: decision.probabilities,
    system2Type,
    ...(system2Model ? { system2Model } : {}),
  };
  if (legalMoves.length <= 1) return { ...base, delegated: false, reason: "single-option", finalOwner: "system1" };
  const ranked = Object.entries(decision.probabilities || {})
    .filter(([move, probability]) => legalMoves.includes(move as Direction) && Number.isFinite(probability) && probability >= 0)
    .sort((left, right) => right[1] - left[1]);
  if (ranked.length >= 2) {
    const total = ranked.reduce((sum, [, probability]) => sum + probability, 0);
    const top = total > 0 ? ranked[0]![1] / total : ranked[0]![1];
    const second = total > 0 ? ranked[1]![1] / total : ranked[1]![1];
    const margin = top - second;
    if (ranked[0]![0] !== decision.move || margin <= thresholds.probabilityMargin) {
      return { ...base, delegated: true, reason: "probability-margin", probabilityMargin: margin };
    }
    return { ...base, delegated: false, reason: "decisive", probabilityMargin: margin, finalOwner: "system1" };
  }
  if (decision.confidence !== undefined) {
    const delegated = decision.confidence <= thresholds.confidenceThreshold;
    return { ...base, delegated, reason: delegated ? "low-confidence" : "decisive", finalOwner: delegated ? undefined : "system1" };
  }
  return { ...base, delegated: true, reason: "uncertainty-unavailable" };
}
