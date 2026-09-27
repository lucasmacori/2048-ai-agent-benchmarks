import "dotenv/config";
import { DEFAULT_AGENT_CONFIG } from "../src/agent/runtime-config.js";

function integer(name: string, fallback: number, minimum = 1): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  return value === undefined ? fallback : value.toLowerCase() === "true";
}

function probability(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

const configuredKey = process.env.OPENROUTER_API_KEY;
const apiKey = configuredKey && !configuredKey.startsWith("replace_") && configuredKey !== "your_openrouter_api_key"
  ? configuredKey
  : undefined;

export const config = {
  apiKey,
  model: process.env.OPENROUTER_MODEL || "~typesafe/jev-latest",
  layaBaseUrl: (process.env.LAYA_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, ""),
  layaApiKey: process.env.LAYA_API_KEY,
  layaModel: process.env.LAYA_MODEL || "english",
  maxTurns: integer("MAX_TURNS", DEFAULT_AGENT_CONFIG.maxTurns),
  recentMovesLimit: integer("RECENT_MOVES_LIMIT", DEFAULT_AGENT_CONFIG.recentMovesLimit),
  agentDelayMs: integer("AGENT_DELAY_MS", DEFAULT_AGENT_CONFIG.defaultDelayMs, 0),
  agentDelayFastMs: integer("AGENT_DELAY_FAST_MS", DEFAULT_AGENT_CONFIG.delayOptionsMs[0], 0),
  agentDelaySlowMs: integer("AGENT_DELAY_SLOW_MS", DEFAULT_AGENT_CONFIG.delayOptionsMs[2], 0),
  llmReasonMaxLength: integer("LLM_REASON_MAX_LENGTH", 160),
  llmRequireParameters: boolean("LLM_REQUIRE_PARAMETERS", true),
  system2ProbabilityMargin: probability("SYSTEM2_PROBABILITY_MARGIN", 0.15),
  system2ConfidenceThreshold: probability("SYSTEM2_CONFIDENCE_THRESHOLD", 0.6),
  capabilitiesTimeoutMs: integer("CAPABILITIES_TIMEOUT_MS", 1200),
  jevInstructions: process.env.JEV_INSTRUCTIONS || "Choose the legal move most likely to survive and eventually create 2048. Prefer preserving empty cells and keeping the largest tile in a corner; use immediate score secondarily.",
  llmInstructions: process.env.LLM_INSTRUCTIONS || "Play 2048. Pick the strongest move using the board and simulated move outcomes. Return a concise reason. Only choose one of the legal moves.",
  layaInstructions: process.env.LAYA_INSTRUCTIONS || "Choose the legal 2048 move most likely to preserve open space and create 2048. Keep the largest tile in a corner when possible.",
  port: integer("PORT", 3000),
};
