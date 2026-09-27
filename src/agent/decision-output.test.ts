import { describe, expect, it } from "vitest";
import { LlmOutputError, parseLlmOutput } from "./decision-output.js";

describe("parseLlmOutput", () => {
  it("keeps a legal move when its explanation exceeds the display limit", () => {
    const result = parseLlmOutput(JSON.stringify({ move: "left", reason: "x".repeat(900) }), ["left", "right"]);
    expect(result.move).toBe("left");
    expect(result.explanation).toHaveLength(160);
  });

  it("rejects invalid JSON and moves not in the server-provided legal list", () => {
    expect(() => parseLlmOutput("{", ["left"])).toThrowError(LlmOutputError);
    expect(() => parseLlmOutput(JSON.stringify({ move: "down" }), ["left"])).toThrowError(LlmOutputError);
  });
});
