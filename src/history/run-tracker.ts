import type { DecisionDiagnostic, TurnRecord } from "../game/types.js";
import type { RunFinishReason, RunIdentity, RunRecord, RunSummary } from "./types.js";
import { summarizeRun } from "./types.js";
import { runHistoryApi } from "./api-client.js";

export class RunTracker {
  private identity?: RunIdentity;
  private turns: TurnRecord[] = [];
  private queue: Promise<void> = Promise.resolve();
  private started = false;

  constructor(private readonly onUpdate: (record: RunRecord) => void = () => undefined) {}

  begin(identity: RunIdentity): void {
    this.identity = identity;
    this.turns = [];
    this.started = false;
    this.queue = Promise.resolve();
  }

  append(turn: TurnRecord): void {
    if (!this.identity) return;
    this.turns.push(structuredClone(turn));
    const identity = this.identity;
    const snapshot = structuredClone(this.turns);
    this.queue = this.queue.then(async () => {
      if (!this.started) { await runHistoryApi.create(identity); this.started = true; }
      await runHistoryApi.appendTurn(identity.id, turn);
      this.onUpdate(summarizeRun(identity, snapshot, "in-progress"));
    }).catch((error) => console.error("Could not persist run history:", error));
  }

  async finish(reason: RunFinishReason, terminalError?: string, diagnostics?: DecisionDiagnostic[]): Promise<void> {
    if (!this.identity) return;
    if (this.turns.length === 0 && reason !== "error") { this.identity = undefined; return; }
    const identity = this.identity;
    const turns = structuredClone(this.turns);
    this.identity = undefined;
    this.turns = [];
    this.queue = this.queue.then(async () => {
      if (!this.started) { await runHistoryApi.create(identity); this.started = true; for (const turn of turns) await runHistoryApi.appendTurn(identity.id, turn); }
      await runHistoryApi.finish(identity.id, reason, terminalError, diagnostics);
      this.onUpdate(summarizeRun(identity, turns, reason, new Date().toISOString(), terminalError, diagnostics));
    }).catch((error) => console.error("Could not finalize run history:", error));
    await this.queue;
  }

  snapshot(): { identity?: RunIdentity; turns: TurnRecord[] } { return { identity: this.identity, turns: structuredClone(this.turns) }; }
  restore(identity: RunIdentity | undefined, turns: TurnRecord[]): void { this.identity = identity; this.turns = structuredClone(turns); this.started = Boolean(identity && turns.length); }
  currentSummary(): RunSummary | undefined { return this.identity ? (({ turns: _turns, ...summary }) => summary)(summarizeRun(this.identity, this.turns, "engine-change")) : undefined; }
  currentRunId(): string | undefined { return this.identity?.id; }
}
