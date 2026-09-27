export type Direction = "up" | "down" | "left" | "right";
export type Board = number[][];
export type GameStatus = "playing" | "won" | "lost";
export type GameMode = "manual" | "jev" | "llm" | "laya" | "hybrid";
export type HybridSystem1 = "jev" | "laya";
export type HybridSystem2 = "human" | "llm";
export interface DelegationTrace {
  delegated: boolean;
  reason: "single-option" | "probability-margin" | "low-confidence" | "uncertainty-unavailable" | "decisive";
  probabilityMargin?: number;
  system1Move: Direction;
  system1Confidence?: number;
  system1Probabilities?: Record<string, number>;
  system2Type: HybridSystem2;
  system2Model?: string;
  finalOwner?: "system1" | "system2" | "human";
  system1Usage?: AgentDecision["usage"];
  system2Usage?: AgentDecision["usage"];
  system1LatencyMs?: number;
  system2LatencyMs?: number;
}

export interface DecisionDiagnostic {
  attempt: number;
  requestedModel: string;
  resolvedModel?: string;
  responseId?: string;
  provider?: string;
  httpStatus?: number;
  latencyMs: number;
  maxCompletionTokens?: number;
  finishReason?: string | null;
  contentLength?: number;
  refusalPresent?: boolean;
  reasoningPresent?: boolean;
  reasoningTokenCount?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  errorCode?: string;
  error?: string;
  requestBodyJson?: string;
}

export interface SpawnTrace {
  row: number;
  column: number;
  value: 2 | 4;
}

export interface GameMechanicsTrace {
  boardBeforeMove: Board;
  scoreBefore: number;
  boardAfterMove: Board;
  scoreGain: number;
  scoreAfterMove: number;
  spawn: SpawnTrace | null;
  boardAfterSpawn: Board;
}

export interface GameState {
  board: Board;
  score: number;
  turn: number;
  status: GameStatus;
  seed: number;
  recentMoves: Direction[];
}

export interface MoveResult {
  board: Board;
  changed: boolean;
  scoreGain: number;
  mergedTiles: number;
}

export interface Candidate {
  scoreGain: number;
  mergedTiles: number;
  emptyCells: number;
  highestTile: number;
  highestTileInCorner: boolean;
  smoothness: number;
  boardAfterMove: Board;
}

export interface AgentDecision {
  move: Direction;
  confidence?: number;
  probabilities?: Record<string, number>;
  model?: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
  explanation?: string;
  mode?: Exclude<GameMode, "manual">;
  diagnostics?: DecisionDiagnostic[];
  mechanics?: GameMechanicsTrace;
}

export interface TurnRecord {
  turn: number;
  move: Direction;
  confidence?: number;
  probabilities?: Record<string, number>;
  latencyMs: number;
  scoreGain: number;
  score: number;
  board: Board;
  usage?: AgentDecision["usage"];
  mode?: GameMode;
  model?: string;
  explanation?: string;
  diagnostics?: DecisionDiagnostic[];
  mechanics?: GameMechanicsTrace;
  delegation?: DelegationTrace;
}
