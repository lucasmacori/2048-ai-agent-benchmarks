import type { RunIdentity, RunRecord, RunSummary, RunFinishReason } from "./types.js";
import type { DecisionDiagnostic, TurnRecord } from "../game/types.js";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `History request failed (${response.status})`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export const runHistoryApi = {
  list: () => request<RunSummary[]>("/api/runs"),
  get: (id: string) => request<RunRecord>(`/api/runs/${encodeURIComponent(id)}`),
  create: (identity: RunIdentity) => request<void>("/api/runs", { method: "POST", body: JSON.stringify(identity) }),
  appendTurn: (id: string, turn: TurnRecord) => request<void>(`/api/runs/${encodeURIComponent(id)}/turns`, { method: "POST", body: JSON.stringify(turn) }),
  finish: (id: string, reason: RunFinishReason, error?: string, diagnostics?: DecisionDiagnostic[]) => request<void>(`/api/runs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ reason, error, diagnostics }) }),
  delete: (id: string) => request<void>(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  rename: (id: string, name: string) => request<void>(`/api/runs/${encodeURIComponent(id)}/name`, { method: "PATCH", body: JSON.stringify({ name }) }),
};
