export interface AgentRuntimeConfig {
  maxTurns: number;
  recentMovesLimit: number;
  defaultDelayMs: number;
  delayOptionsMs: [number, number, number];
}

export const DEFAULT_AGENT_CONFIG: AgentRuntimeConfig = {
  maxTurns: 2000,
  recentMovesLimit: 5,
  defaultDelayMs: 850,
  delayOptionsMs: [350, 850, 1600],
};
