import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentController } from "./controller.js";
import * as engine from "../game/engine.js";

afterEach(() => vi.unstubAllGlobals());

describe("AgentController manual mode", () => {
  it("accepts legal moves and ignores illegal moves", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const controller = new AgentController(77);
    controller.setMode("manual");
    const before = controller.state;
    const illegal = (["up", "down", "left", "right"] as const).find((direction) => !engine.moveBoard(before.board, direction).changed);
    if (illegal) {
      controller.move(illegal);
      expect(controller.state).toBe(before);
      expect(controller.history).toHaveLength(0);
    }
    const legal = engine.legalMoves(before.board)[0];
    controller.move(legal);
    expect(controller.state.turn).toBe(1);
    expect(controller.history[0].mode).toBe("manual");
    expect(controller.history[0].move).toBe(legal);
  });

  it("resets to the same seed and invalidates pending work when changing mode", async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const controller = new AgentController(99);
    const originalSeed = controller.state.seed;
    const pending = controller.step();
    controller.setMode("manual");
    expect(controller.state.seed).toBe(originalSeed);
    expect(controller.state.turn).toBe(0);
    release(new Response(JSON.stringify({ move: "left", latencyMs: 12, model: "test" }), { status: 200 }));
    await pending;
    expect(controller.state.turn).toBe(0);
    expect(controller.mode).toBe("manual");
  });

  it("resets the board when the selected model changes", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const controller = new AgentController(121);
    const seed = controller.state.seed;
    controller.setMode("manual");
    controller.move(engine.legalMoves(controller.state.board)[0]);
    controller.setModel("~google/gemini-flash-latest");
    expect(controller.state.seed).toBe(seed);
    expect(controller.state.turn).toBe(0);
    expect(controller.mode).toBe("manual");
    expect(controller.model).toBe("~google/gemini-flash-latest");
  });

  it("loads a saved seed without changing the selected mode or model", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const controller = new AgentController(6);
    controller.setMode("llm");
    controller.setModel("google/gemini-flash");
    controller.replaySeed(4321);
    expect(controller.state.seed).toBe(4321);
    expect(controller.state.turn).toBe(0);
    expect(controller.mode).toBe("llm");
    expect(controller.model).toBe("google/gemini-flash");
    expect(controller.status).toBe("idle");
  });

  it("archives and resets on the same seed when reasoning changes", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const controller = new AgentController(55);
    controller.setMode("llm");
    controller.setModelLabels({}, undefined, {
      model: { provider: "Anthropic", tier: "mid", reasoning: { supported: true, mandatory: false, supportedEfforts: ["low", "high"] } },
    });
    controller.setModel("model");
    controller.setReasoning({ mode: "effort", effort: "high" });
    expect(controller.state.seed).toBe(55);
    expect(controller.state.turn).toBe(0);
    expect(controller.status).toBe("idle");
    expect(controller.runSummary?.reasoning).toMatchObject({ mode: "effort", effort: "high", maxCompletionTokens: 4096 });
    controller.setReasoning({ mode: "effort", effort: "max" });
    expect(controller.reasoning).toMatchObject({ mode: "effort", effort: "high" });
  });
});
