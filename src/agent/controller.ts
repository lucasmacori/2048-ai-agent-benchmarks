import { applyMoveWithTrace, createGame, createRandom, legalMoves } from "../game/engine.js";
import type { AgentDecision, Direction, GameMode, GameState, TurnRecord } from "../game/types.js";
import { DecisionRequestError, requestDecision } from "./api-client.js";
import { completionBudget, DEFAULT_REASONING, type ReasoningSetting } from "./reasoning.js";
import type { DecisionDiagnostic } from "../game/types.js";
import { RunTracker } from "../history/run-tracker.js";
import type { RunFinishReason } from "../history/types.js";
import { DEFAULT_AGENT_CONFIG, type AgentRuntimeConfig } from "./runtime-config.js";

export type ControllerStatus = "idle" | "running" | "waiting" | "paused" | "finished" | "error";

export class AgentController {
  state: GameState;
  status: ControllerStatus = "idle";
  history: TurnRecord[] = [];
  lastDecision?: AgentDecision;
  error?: string;
  delay = DEFAULT_AGENT_CONFIG.defaultDelayMs;
  maxTurns = DEFAULT_AGENT_CONFIG.maxTurns;
  recentMovesLimit = DEFAULT_AGENT_CONFIG.recentMovesLimit;
  mode: GameMode = "jev";
  model = "openai/gpt-5.6-luna";
  reasoning: ReasoningSetting = { ...DEFAULT_REASONING };
  modelLabels: Record<string, string> = {};
  modelMetadata: Record<string, { provider: string; tier: "cheap" | "mid" | "frontier"; reasoning: import("./reasoning.js").ReasoningCapabilities }> = {};
  engineModels: Partial<Record<Exclude<GameMode, "llm" | "manual">, { id: string; name: string }>> = {};
  private runTracker = new RunTracker(() => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("run-history-updated"));
  });
  private random: () => number;
  private generation = 0;
  private providerSessionId = crypto.randomUUID();
  private inFlight = false;
  private requestController?: AbortController;
  private listeners = new Set<() => void>();

  constructor(seed = Date.now()) {
    this.state = createGame(seed);
    this.random = createRandom(seed);
    for (let i = 0; i < 4; i += 1) this.random();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void { this.listeners.forEach((listener) => listener()); }

  get runSummary() { return this.runTracker.currentSummary(); }
  get currentRunId() { return this.runTracker.currentRunId(); }

  private currentModel(): string {
    if (this.mode === "manual") return "Human";
    if (this.mode === "llm") return this.model;
    if (this.mode === "jev") return this.engineModels.jev?.id || "~typesafe/jev-latest";
    return this.engineModels.laya?.id || "laya-english";
  }

  private beginRun(seed = this.state.seed): void {
    this.runTracker.begin(this.runIdentity(seed));
  }

  private runIdentity(seed: number) {
    const model = this.currentModel();
    const metadata = this.modelMetadata[model];
    return { id: crypto.randomUUID(), mode: this.mode, model, modelName: this.modelName(), seed, startedAt: new Date().toISOString(), ...(metadata ? { provider: metadata.provider, tier: metadata.tier } : {}), ...(this.mode === "llm" ? { reasoning: { ...this.reasoning, maxCompletionTokens: completionBudget(this.reasoning) } } : {}), contextVersion: "turn-facts-v2" as const };
  }

  private modelName(): string { return this.mode === "manual" ? "Human" : this.modelLabels[this.currentModel()] || (this.mode === "jev" ? "JEV" : this.mode === "laya" ? "Laya English" : this.currentModel()); }

  private async finishRun(reason: RunFinishReason, terminalError?: string, diagnostics?: DecisionDiagnostic[]): Promise<void> { await this.runTracker.finish(reason, terminalError, diagnostics); }

  setMode(mode: GameMode): void {
    if (mode === this.mode) return;
    const seed = this.state.seed;
    this.generation += 1;
    this.requestController?.abort();
    void this.finishRun("engine-change");
    this.mode = mode;
    this.reset(seed, false);
    this.lastDecision = undefined;
    this.error = undefined;
    this.notify();
  }

  setModel(model: string): void {
    if (model === this.model) return;
    const seed = this.state.seed;
    this.generation += 1;
    this.requestController?.abort();
    void this.finishRun("engine-change");
    this.model = model;
    const capabilities = this.modelMetadata[model]?.reasoning;
    if (capabilities?.mandatory && this.reasoning.mode === "disabled") this.reasoning = capabilities.supportedEfforts?.length
      ? { mode: "effort", effort: capabilities.supportedEfforts[0] }
      : { mode: "default" };
    else if (!capabilities?.supported) this.reasoning = { mode: "disabled" };
    else if (this.reasoning.mode === "effort" && !capabilities.supportedEfforts?.includes(this.reasoning.effort!)) this.reasoning = capabilities.mandatory
      ? { mode: "effort", effort: capabilities.supportedEfforts?.[0] || "low" }
      : { mode: "disabled" };
    this.reset(seed, false);
    this.lastDecision = undefined;
    this.notify();
  }

  setReasoning(reasoning: ReasoningSetting): void {
    if (this.mode !== "llm" || JSON.stringify(reasoning) === JSON.stringify(this.reasoning)) return;
    const capabilities = this.modelMetadata[this.model]?.reasoning;
    if (!capabilities?.supported || (reasoning.mode === "disabled" && capabilities.mandatory)) return;
    if (reasoning.mode === "effort" && (!reasoning.effort || !capabilities.supportedEfforts?.includes(reasoning.effort))) return;
    const seed = this.state.seed;
    this.generation += 1;
    this.requestController?.abort();
    void this.finishRun("engine-change");
    this.reasoning = { ...reasoning };
    this.reset(seed, false);
    this.notify();
  }

  replaySeed(seed: number): void {
    this.reset(seed, true, "replay");
  }

  setModelLabels(labels: Record<string, string>, engines?: AgentController["engineModels"], metadata?: AgentController["modelMetadata"]): void { this.modelLabels = labels; this.engineModels = engines || {}; this.modelMetadata = metadata || {}; }

  configure(config: AgentRuntimeConfig): void {
    this.maxTurns = config.maxTurns;
    this.recentMovesLimit = config.recentMovesLimit;
    this.delay = config.defaultDelayMs;
  }

  move(direction: Direction): void {
    if (this.mode !== "manual" || this.status === "running" || this.status === "waiting" || this.state.status !== "playing") return;
    const { state: next, mechanics } = applyMoveWithTrace(this.state, direction, this.random, this.recentMovesLimit);
    if (next === this.state) return;
    const before = this.state;
    if (!this.runTracker.currentRunId()) this.beginRun(before.seed);
    this.state = next;
    if (!this.runTracker.currentSummary()) this.beginRun(before.seed);
    this.lastDecision = { move: direction, model: "Human", latencyMs: 0 };
    const record: TurnRecord = { turn: next.turn, move: direction, scoreGain: next.score - before.score, score: next.score, board: next.board.map((row) => [...row]), latencyMs: 0, mode: "manual", model: "Human", mechanics };
    this.history.push(record);
    this.runTracker.append(record);
    this.status = next.status === "playing" ? "paused" : "finished";
    if (next.status !== "playing") void this.finishRun(next.status);
    this.error = undefined;
    this.notify();
  }

  start(): void {
    if (this.mode === "manual" || this.state.status !== "playing" || this.status === "waiting") return;
    this.status = "running";
    this.error = undefined;
    this.notify();
    void this.loop();
  }

  pause(): void {
    this.generation += 1;
    this.requestController?.abort();
    this.status = "paused";
    this.notify();
  }

  async step(): Promise<void> {
    if (this.mode === "manual" || this.state.status !== "playing" || this.inFlight) return;
    this.status = "waiting";
    this.error = undefined;
    const generation = ++this.generation;
    this.notify();
    await this.takeTurn(generation);
    if (generation === this.generation && this.status === "waiting") {
      this.status = this.state.status === "playing" ? "paused" : "finished";
      this.notify();
    }
  }

  reset(seed = Date.now(), archive = true, reason: RunFinishReason = "manual-reset"): void {
    this.generation += 1;
    this.requestController?.abort();
    if (archive) void this.finishRun(reason);
    this.requestController = undefined;
    this.inFlight = false;
    this.state = createGame(seed);
    this.random = createRandom(seed);
    for (let i = 0; i < 4; i += 1) this.random();
    this.providerSessionId = crypto.randomUUID();
    this.history = [];
    this.lastDecision = undefined;
    this.error = undefined;
    this.status = "idle";
    this.runTracker.begin(this.runIdentity(this.state.seed));
    this.notify();
  }

  private async loop(): Promise<void> {
    const generation = this.generation;
    while (generation === this.generation && this.status === "running" && this.state.status === "playing" && this.state.turn < this.maxTurns) {
      await this.takeTurn(generation);
      if (generation !== this.generation || this.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
    if (generation === this.generation && (this.state.status !== "playing" || this.state.turn >= this.maxTurns)) {
      this.status = "finished";
      this.notify();
    }
  }

  private async takeTurn(generation: number): Promise<void> {
    if (this.inFlight) return;
    if (legalMoves(this.state.board).length === 0) {
      this.status = "finished";
      this.notify();
      return;
    }
    this.inFlight = true;
    const before = this.state;
    if (!this.runTracker.currentRunId()) this.beginRun(before.seed);
    const requestController = new AbortController();
    this.requestController = requestController;
    try {
      const mode = this.mode === "manual" ? "jev" : this.mode;
      const decision = await requestDecision(before, this.providerSessionId, mode, this.model, requestController.signal, this.reasoning);
      if (generation !== this.generation) return;
      if (!legalMoves(this.state.board).includes(decision.move as Direction)) throw new Error("JEV selected an illegal move");
      const { state: next, mechanics } = applyMoveWithTrace(this.state, decision.move, this.random, this.recentMovesLimit);
      this.state = next;
      this.lastDecision = decision;
      this.history.push({
        turn: next.turn,
        move: decision.move,
        confidence: decision.confidence,
        probabilities: decision.probabilities,
        latencyMs: decision.latencyMs,
        scoreGain: next.score - before.score,
        score: next.score,
        board: next.board.map((row) => [...row]),
        usage: decision.usage,
        mode: decision.mode,
        model: decision.model,
        explanation: decision.explanation,
        diagnostics: decision.diagnostics,
        mechanics,
      });
      const turnRecord = this.history[this.history.length - 1];
      this.runTracker.append(turnRecord);
      if (next.status === "won" || next.status === "lost") void this.finishRun(next.status);
      if (next.status !== "playing") this.status = "finished";
      else if (next.turn >= this.maxTurns) { this.status = "finished"; void this.finishRun("turn-limit"); }
    } catch (error) {
      if (generation === this.generation) {
        this.status = "error";
        this.error = error instanceof Error ? error.message : "JEV request failed";
        const safeError = (error instanceof Error ? error.message : "Decision failed").replace(/(?:Bearer\s+)[^\s]+|(?:sk-[A-Za-z0-9_-]{12,})/gi, "[redacted]").slice(0, 240);
        void this.finishRun("error", safeError, error instanceof DecisionRequestError ? error.diagnostics : undefined);
      }
    } finally {
      if (this.requestController === requestController) {
        this.requestController = undefined;
        this.inFlight = false;
      }
      this.notify();
    }
  }
}
