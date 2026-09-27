import type { ReasoningCapabilities, ReasoningEffort } from "../src/agent/reasoning.js";

export const LLM_MODELS = [
  { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "OpenAI", tier: "cheap" },
  { id: "~anthropic/claude-haiku-latest", name: "Claude Haiku Latest", provider: "Anthropic", tier: "cheap" },
  { id: "mistralai/mistral-small-2603", name: "Mistral Small 4", provider: "Mistral", tier: "cheap" },
  { id: "~deepseek/deepseek-flash-latest", name: "DeepSeek Flash Latest", provider: "DeepSeek", tier: "cheap" },
  { id: "qwen/qwen3.8-flash", name: "Qwen 3.8 Flash", provider: "Qwen", tier: "cheap" },
  { id: "~z-ai/glm-flash-latest", name: "GLM Flash Latest", provider: "Z.ai", tier: "cheap" },
  { id: "openai/gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "OpenAI", tier: "mid" },
  { id: "~anthropic/claude-sonnet-latest", name: "Claude Sonnet Latest", provider: "Anthropic", tier: "mid" },
  { id: "~google/gemini-flash-latest", name: "Gemini Flash Latest", provider: "Google", tier: "mid" },
  { id: "mistralai/mistral-medium-3-5", name: "Mistral Medium 3.5", provider: "Mistral", tier: "mid" },
  { id: "~deepseek/deepseek-pro-latest", name: "DeepSeek Pro Latest", provider: "DeepSeek", tier: "mid" },
  { id: "minimax/minimax-m3", name: "MiniMax M3", provider: "MiniMax", tier: "mid" },
  { id: "~moonshotai/kimi-latest", name: "Kimi Latest", provider: "Moonshot", tier: "mid" },
  { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "OpenAI", tier: "frontier" },
  { id: "~anthropic/claude-opus-latest", name: "Claude Opus Latest", provider: "Anthropic", tier: "frontier" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3", provider: "Moonshot", tier: "frontier" },
  { id: "qwen/qwen3.8-max-prime", name: "Qwen 3.8 Max Prime", provider: "Qwen", tier: "frontier" },
  { id: "mistralai/mistral-large-2512", name: "Mistral Large 3", provider: "Mistral", tier: "frontier" },
] as const;

const efforts: Record<string, ReasoningEffort[]> = {
  "openai/gpt-5.6-luna": ["minimal", "low", "medium", "high", "xhigh", "max"],
  "~anthropic/claude-haiku-latest": [],
  "mistralai/mistral-small-2603": ["high"],
  "~deepseek/deepseek-flash-latest": ["low", "high", "max"],
  "qwen/qwen3.8-flash": [],
  "~z-ai/glm-flash-latest": ["low", "high", "max"],
  "openai/gpt-5.6-terra": ["minimal", "low", "medium", "high", "xhigh", "max"],
  "~anthropic/claude-sonnet-latest": ["low", "medium", "high", "xhigh", "max"],
  "~google/gemini-flash-latest": ["low", "medium", "high"],
  "mistralai/mistral-medium-3-5": ["high"],
  "~deepseek/deepseek-pro-latest": ["low", "high", "max"],
  "minimax/minimax-m3": [],
  "~moonshotai/kimi-latest": ["low", "high", "max"],
  "openai/gpt-5.6-sol": ["minimal", "low", "medium", "high", "xhigh", "max"],
  "~anthropic/claude-opus-latest": ["low", "medium", "high", "xhigh", "max"],
  "moonshotai/kimi-k3": ["low", "high", "max"],
  "qwen/qwen3.8-max-prime": ["minimal", "low", "medium", "high", "xhigh"],
  "mistralai/mistral-large-2512": [],
};

const mandatory = new Set(["~z-ai/glm-flash-latest", "~google/gemini-flash-latest", "~anthropic/claude-opus-latest", "qwen/qwen3.8-max-prime"]);
const reasoningCapabilities = new Map<string, ReasoningCapabilities>(LLM_MODELS.map((model) => {
  const modelEfforts = efforts[model.id] || [];
  const required = mandatory.has(model.id);
  const supported = model.id !== "mistralai/mistral-large-2512";
  return [model.id, { supported, mandatory: required, defaultEnabled: required, supportedEfforts: modelEfforts }];
}));

let cachedModels: Array<(typeof LLM_MODELS)[number] & { reasoning: ReasoningCapabilities }> | undefined;
let cacheExpiresAt = 0;
let cachedReasoningCapabilities = new Map<string, ReasoningCapabilities>();

export async function getLlmModels(): Promise<Array<(typeof LLM_MODELS)[number] & { reasoning: ReasoningCapabilities }>> {
  if (cachedModels && Date.now() < cacheExpiresAt) return cachedModels;
  const fallback = LLM_MODELS.map((model) => ({ ...model, reasoning: reasoningCapabilities.get(model.id)! }));
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      const data = await response.json() as { data?: Array<{ id: string; reasoning?: { mandatory?: boolean; default_enabled?: boolean; supported_efforts?: ReasoningEffort[] } }> };
      const remote = new Map((data.data || []).map((model) => [model.id, model]));
      cachedReasoningCapabilities = new Map();
      cachedModels = fallback.map((model) => {
        const live = remote.get(model.id)?.reasoning;
        if (!live) return model;
        const reasoning = { supported: true, mandatory: live.mandatory ?? false, defaultEnabled: live.default_enabled, supportedEfforts: live.supported_efforts || [] };
        cachedReasoningCapabilities.set(model.id, reasoning);
        return { ...model, reasoning };
      });
    } else { cachedModels = fallback; cachedReasoningCapabilities = new Map(); }
  } catch { cachedModels = fallback; cachedReasoningCapabilities = new Map(); }
  cacheExpiresAt = Date.now() + 5 * 60_000;
  return cachedModels;
}

export function getReasoningCapabilities(model: string): ReasoningCapabilities | undefined {
  return (Date.now() < cacheExpiresAt ? cachedReasoningCapabilities.get(model) : undefined) || reasoningCapabilities.get(model);
}

export function isAllowedLlmModel(model: string): boolean {
  return LLM_MODELS.some((candidate) => candidate.id === model);
}
