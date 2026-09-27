export const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export interface ReasoningSetting {
  mode: "disabled" | "default" | "effort";
  effort?: ReasoningEffort;
  maxCompletionTokens?: number;
}

export interface ReasoningCapabilities {
  supported: boolean;
  mandatory: boolean;
  defaultEnabled?: boolean;
  supportedEfforts?: ReasoningEffort[];
}

export function reasoningLabel(setting?: ReasoningSetting): string {
  if (!setting) return "Provider default (legacy)";
  if (setting.mode === "disabled") return "Disabled";
  if (setting.mode === "default") return "Model default";
  return setting.effort ? setting.effort[0]!.toUpperCase() + setting.effort.slice(1) : "Model default";
}

export const DEFAULT_REASONING: ReasoningSetting = { mode: "disabled" };

export function completionBudget(setting: ReasoningSetting): number {
  return setting.mode === "disabled" ? 256 : setting.mode === "effort" && ["max", "xhigh"].includes(setting.effort || "") ? 8192 : 4096;
}
