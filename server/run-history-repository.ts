import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunRecord, RunSummary, RunIdentity, RunFinishReason } from "../src/history/types.js";
import { summarizeRun } from "../src/history/types.js";
import type { TurnRecord } from "../src/game/types.js";
import type { DecisionDiagnostic } from "../src/game/types.js";

export class RunHistoryRepository {
  private writeQueue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async list(): Promise<RunSummary[]> {
    return (await this.load()).map(({ turns: _turns, pending, ...summary }) => ({ ...summary, finishReason: pending ? "in-progress" as const : summary.finishReason })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async get(id: string): Promise<RunRecord | undefined> {
    const run = (await this.load()).find((item) => item.id === id);
    return run?.pending ? { ...run, finishReason: "in-progress" } : run;
  }

  async create(identity: RunIdentity): Promise<void> {
    await this.update((runs) => {
      if (runs.some((run) => run.id === identity.id)) return;
      runs.push(summarizeRun(identity, [], "error"));
      (runs.at(-1) as RunRecord & { pending?: boolean }).pending = true;
    });
  }

  async appendTurn(id: string, turn: TurnRecord): Promise<void> {
    await this.update((runs) => {
      const run = this.requirePending(runs, id);
      const existing = run.turns.find((item) => item.turn === turn.turn);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(turn)) throw new Error("Turn conflicts with an existing run record");
        return;
      }
      if (turn.turn !== run.turns.length + 1 || (turn.mode && turn.mode !== run.mode)) throw new Error("Turn sequence or run mode is invalid");
      run.turns.push(structuredClone(turn));
      const updated = summarizeRun(run, run.turns, "error");
      Object.assign(run, updated);
      (run as RunRecord & { pending?: boolean }).pending = true;
    });
  }

  async finish(id: string, reason: RunFinishReason, terminalError?: string, diagnostics?: DecisionDiagnostic[]): Promise<void> {
    await this.update((runs) => {
      const run = this.requirePending(runs, id);
      Object.assign(run, summarizeRun(run, run.turns, reason));
      if (terminalError) run.terminalError = terminalError.slice(0, 240);
      if (diagnostics?.length) run.terminalDiagnostics = structuredClone(diagnostics).map((diagnostic) => ({ ...diagnostic, error: diagnostic.error?.slice(0, 240) }));
      delete run.pending;
    });
  }

  async delete(id: string): Promise<boolean> {
    let removed = false;
    await this.update((runs) => {
      const index = runs.findIndex((run) => run.id === id);
      if (index !== -1) { runs.splice(index, 1); removed = true; }
    });
    return removed;
  }

  async rename(id: string, sessionName: string): Promise<boolean> {
    let renamed = false;
    await this.update((runs) => {
      const run = runs.find((item) => item.id === id);
      if (run) { run.sessionName = sessionName; renamed = true; }
    });
    return renamed;
  }

  private requirePending(runs: RunRecord[], id: string): RunRecord & { pending?: boolean } {
    const run = runs.find((item) => item.id === id) as (RunRecord & { pending?: boolean }) | undefined;
    if (!run || !run.pending) throw new Error("Active run not found");
    return run;
  }

  private async load(): Promise<Array<RunRecord & { pending?: boolean }>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!Array.isArray(parsed) || parsed.some((run) => !this.isStoredRun(run))) throw new Error("Run history file contains an invalid record");
      return parsed as Array<RunRecord & { pending?: boolean }>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private isStoredRun(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const run = value as Record<string, unknown>;
    const metrics = run.metrics;
    return typeof run.id === "string" && typeof run.model === "string" && typeof run.modelName === "string"
      && typeof run.seed === "number" && typeof run.startedAt === "string" && typeof run.finishedAt === "string"
      && ["manual", "jev", "llm", "laya", "hybrid"].includes(String(run.mode)) && Array.isArray(run.turns)
      && Boolean(metrics && typeof metrics === "object" && typeof (metrics as Record<string, unknown>).score === "number")
      && (run.pending === undefined || typeof run.pending === "boolean");
  }

  private async update(change: (runs: Array<RunRecord & { pending?: boolean }>) => void): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const runs = await this.load();
      change(runs);
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(runs, null, 2)}\n`, "utf8");
      await rename(temporary, this.filePath);
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }
}
