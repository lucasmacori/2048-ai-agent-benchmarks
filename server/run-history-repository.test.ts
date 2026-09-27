import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunHistoryRepository } from "./run-history-repository.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("RunHistoryRepository", () => {
  it("creates, appends idempotently, finalizes, reloads, and lists summaries", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runs-")); dirs.push(dir);
    const file = path.join(dir, "history.json");
    const repository = new RunHistoryRepository(file);
    const identity = { id: "run-1", mode: "llm" as const, model: "model-a", modelName: "Model A", seed: 12, startedAt: "2025-01-01T00:00:00.000Z" };
    const turn = { turn: 1, move: "left" as const, scoreGain: 4, score: 4, board: [[2, 4]], latencyMs: 20, usage: { inputTokens: 5, outputTokens: 2, cost: 0.01 }, mode: "llm" as const, model: "model-a" };
    await repository.create(identity);
    await Promise.all([repository.appendTurn(identity.id, turn), repository.appendTurn(identity.id, turn)]);
    expect((await repository.list())[0].finishReason).toBe("in-progress");
    await repository.finish(identity.id, "engine-change");
    expect((await repository.get(identity.id))?.metrics).toMatchObject({ turns: 1, inputTokens: 5, outputTokens: 2, cost: 0.01 });
    expect((await repository.list())).toHaveLength(1);
    expect(JSON.parse(await readFile(file, "utf8"))).toHaveLength(1);
  });

  it("rejects turns that mutate model identity or sequence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runs-")); dirs.push(dir);
    const repository = new RunHistoryRepository(path.join(dir, "history.json"));
    await repository.create({ id: "run-2", mode: "llm", model: "model-a", modelName: "Model A", seed: 4, startedAt: new Date().toISOString() });
    await expect(repository.appendTurn("run-2", { turn: 2, move: "left", scoreGain: 0, score: 0, board: [], latencyMs: 0, model: "model-b" })).rejects.toThrow();
  });

  it("deletes exactly one archived or pending run and persists the deletion", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runs-")); dirs.push(dir);
    const file = path.join(dir, "history.json");
    const repository = new RunHistoryRepository(file);
    await repository.create({ id: "run-a", mode: "manual", model: "Human", modelName: "Human", seed: 1, startedAt: new Date().toISOString() });
    await repository.create({ id: "run-b", mode: "manual", model: "Human", modelName: "Human", seed: 2, startedAt: new Date().toISOString() });
    expect(await repository.delete("run-a")).toBe(true);
    expect(await repository.delete("unknown")).toBe(false);
    expect(JSON.parse(await readFile(file, "utf8")).map((run: { id: string }) => run.id)).toEqual(["run-b"]);
  });

  it("renames a session without changing its engine identity", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runs-")); dirs.push(dir);
    const repository = new RunHistoryRepository(path.join(dir, "history.json"));
    await repository.create({ id: "run-name", mode: "llm", model: "provider/model", modelName: "Model", seed: 8, startedAt: new Date().toISOString() });
    expect(await repository.rename("run-name", "Friday test" )).toBe(true);
    expect(await repository.get("run-name")).toMatchObject({ sessionName: "Friday test", model: "provider/model", modelName: "Model" });
    expect(await repository.rename("missing", "No run")).toBe(false);
  });

  it("persists safe diagnostics for a failed first decision", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runs-")); dirs.push(dir);
    const repository = new RunHistoryRepository(path.join(dir, "history.json"));
    await repository.create({ id: "run-diagnostics", mode: "llm", model: "claude", modelName: "Claude", seed: 12, startedAt: new Date().toISOString(), reasoning: { mode: "disabled", maxCompletionTokens: 256 } });
    const diagnostics = [{ attempt: 1, requestedModel: "claude", resolvedModel: "anthropic/claude-sonnet-5", latencyMs: 80, maxCompletionTokens: 256, finishReason: "length", reasoningTokenCount: 256, errorCode: "output_budget_exhausted" }];
    await repository.finish("run-diagnostics", "error", "Output token budget exhausted", diagnostics);
    expect(await repository.get("run-diagnostics")).toMatchObject({ reasoning: { mode: "disabled", maxCompletionTokens: 256 }, terminalDiagnostics: diagnostics });
  });
});
