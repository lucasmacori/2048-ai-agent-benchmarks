import { z } from "zod";
import { isValidBoard } from "../src/game/engine.js";
import type { Direction } from "../src/game/types.js";
import { config } from "./config.js";
import { REASONING_EFFORTS } from "../src/agent/reasoning.js";

const directions = ["up", "down", "left", "right"] as const;
const boardSchema = z.custom<number[][]>(isValidBoard, "Expected a 4 by 4 board of zeroes and powers of two");

export const decisionRequestSchema = z.object({
  mode: z.enum(["jev", "llm", "laya", "hybrid"]).default("jev"),
  system1: z.enum(["jev", "laya"]).optional(),
  system2: z.enum(["human", "llm"]).optional(),
  system2Model: z.string().max(100).optional(),
  system2Reasoning: z.object({ mode: z.enum(["disabled", "default", "effort"]), effort: z.enum(REASONING_EFFORTS).optional() }).optional(),
  model: z.string().max(100).optional(),
  reasoning: z.object({ mode: z.enum(["disabled", "default", "effort"]), effort: z.enum(REASONING_EFFORTS).optional() }).optional(),
  gameId: z.string().min(1).max(100),
  board: boardSchema,
  score: z.number().int().nonnegative().max(1_000_000_000),
  turn: z.number().int().nonnegative().max(config.maxTurns),
  recentMoves: z.array(z.enum(directions)).max(config.recentMovesLimit),
});

export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
export type { Direction };
