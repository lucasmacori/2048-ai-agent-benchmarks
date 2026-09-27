import type { RunRecord, RunSummary } from "./types.js";
import { runHistoryApi } from "./api-client.js";
import type { Direction } from "../game/types.js";
import { reasoningLabel } from "../agent/reasoning.js";

const arrows: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };
let runs: RunSummary[] = [];
let sortKey = "startedAt";
let sortDirection = -1;
let selectedId: string | undefined;
let activeRunId: () => string | undefined = () => undefined;
let replaySeed: (seed: number) => void = () => undefined;

const format = (value: number | null, suffix = "") => value === null ? "N/A" : `${value.toLocaleString()}${suffix}`;
const money = (value: number | null) => value === null ? "N/A" : value === 0 ? "$0" : `$${value.toFixed(5)}`;
const reasoningKey = (run: RunSummary) => run.reasoning ? `${run.reasoning.mode}${run.reasoning.effort ? `:${run.reasoning.effort}` : ""}` : "legacy";

export async function loadRunHistory(): Promise<void> {
  try {
    runs = await runHistoryApi.list();
    const filter = document.querySelector<HTMLSelectElement>("#model-filter");
    const selected = filter?.value || "all";
    if (filter) filter.innerHTML = `<option value="all">All models</option>${[...new Map(runs.map((run) => [run.model, run.modelName])).entries()].map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("")}`;
    if (filter && runs.some((run) => run.model === selected)) filter.value = selected;
    const reasoningFilter = document.querySelector<HTMLSelectElement>("#reasoning-filter");
    if (reasoningFilter) {
      const selectedReasoning = reasoningFilter.value || "all";
      const choices = [...new Map(runs.map((run) => [reasoningKey(run), reasoningLabel(run.reasoning)])).entries()];
      reasoningFilter.innerHTML = `<option value="all">All reasoning</option>${choices.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}`;
      if (choices.some(([key]) => key === selectedReasoning)) reasoningFilter.value = selectedReasoning;
    }
    renderRuns();
  }
  catch { document.querySelector("#run-history-status")!.textContent = "Run history could not be loaded."; }
}

function renderRuns(): void {
  const filter = document.querySelector<HTMLSelectElement>("#run-filter")?.value || "all";
  const modelFilter = document.querySelector<HTMLSelectElement>("#model-filter")?.value || "all";
  const reasoningFilter = document.querySelector<HTMLSelectElement>("#reasoning-filter")?.value || "all";
  const filtered = runs.filter((run) => (filter === "all" || run.mode === filter) && (modelFilter === "all" || run.model === modelFilter) && (reasoningFilter === "all" || reasoningKey(run) === reasoningFilter)).sort((a, b) => {
    const left = sortKey in a.metrics ? (a.metrics as unknown as Record<string, unknown>)[sortKey] : (a as unknown as Record<string, unknown>)[sortKey];
    const right = sortKey in b.metrics ? (b.metrics as unknown as Record<string, unknown>)[sortKey] : (b as unknown as Record<string, unknown>)[sortKey];
    return (typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""))) * sortDirection;
  });
  document.querySelector("#run-history-status")!.textContent = filtered.length ? `${filtered.length} benchmark runs` : "No runs recorded yet. Make a move to start a benchmark.";
  document.querySelector("#run-history-body")!.innerHTML = filtered.map((run) => `<tr tabindex="0" data-run-id="${run.id}" class="${run.id === selectedId ? "selected" : ""}"><td>${new Date(run.startedAt).toLocaleString()}</td><td>${escapeHtml(run.sessionName || run.modelName)}<small>${escapeHtml(run.mode.toUpperCase())} · ${escapeHtml(run.model)} · ${escapeHtml(reasoningLabel(run.reasoning))}</small></td><td>${run.seed}</td><td>${run.finishReason}</td><td>${run.metrics.score.toLocaleString()}</td><td>${run.metrics.highestTile.toLocaleString()}</td><td>${run.metrics.turns}</td><td>${format(run.metrics.inputTokens)} / ${format(run.metrics.outputTokens)} / ${format(run.metrics.totalTokens)}${run.metrics.usagePartial ? "*" : ""}</td><td>${money(run.metrics.cost)}</td><td>${format(run.metrics.averageLatencyMs, " ms")}</td></tr>`).join("");
  document.querySelectorAll<HTMLTableCellElement>("#run-history-table th[data-sort]").forEach((header) => header.classList.toggle("sorted", header.dataset.sort === sortKey));
  document.querySelectorAll<HTMLTableRowElement>("#run-history-body tr").forEach((row) => {
    row.addEventListener("click", () => void showRun(row.dataset.runId!));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void showRun(row.dataset.runId!); } });
  });
}

async function showRun(id: string): Promise<void> {
  selectedId = id;
  renderRuns();
  try { renderDetails(await runHistoryApi.get(id)); }
  catch { document.querySelector("#run-detail")!.innerHTML = "<p>Run details could not be loaded.</p>"; }
}

function renderDetails(run: RunRecord): void {
  const panel = document.querySelector<HTMLDivElement>("#run-detail")!;
  const resolvedModels = [...new Set(run.turns.map((turn) => turn.model).filter((model): model is string => Boolean(model)))];
  panel.innerHTML = `<div class="run-detail-head"><div><span class="label">${escapeHtml(run.mode.toUpperCase())} BENCHMARK</span><h3>${escapeHtml(run.sessionName || run.modelName)}</h3><small>${escapeHtml(run.modelName)} · ${escapeHtml(run.model)}</small></div><div class="run-actions"><button id="rename-run" class="button-secondary">Rename</button><button id="replay-run" class="button-secondary">Replay seed</button><button id="delete-run" class="button-secondary" ${run.id === activeRunId() ? "disabled title=\"Archive or reset the active run first\"" : ""}>Delete run</button><button id="close-run-detail" class="button-secondary">Close</button></div></div><p>Seed ${run.seed} · ${run.finishReason} · ${new Date(run.startedAt).toLocaleString()} · ${(run.metrics.durationMs / 1000).toFixed(1)} sec</p>${run.terminalError ? `<p class="error">${escapeHtml(run.terminalError)}</p>` : ""}<p>Provider ${escapeHtml(run.provider || "N/A")} · Tier ${escapeHtml(run.tier || "N/A")} · Context ${escapeHtml(run.contextVersion || "legacy")}</p><p>Resolved provider model${resolvedModels.length === 1 ? "" : "s"}: ${resolvedModels.length ? resolvedModels.map(escapeHtml).join(", ") : "N/A"}</p><p>Score ${run.metrics.score.toLocaleString()} · Max tile ${run.metrics.highestTile.toLocaleString()} · ${run.metrics.turns} turns · ${format(run.metrics.totalTokens)} tokens · ${money(run.metrics.cost)} · ${run.metrics.totalLatencyMs.toLocaleString()} ms total / ${format(run.metrics.averageLatencyMs, " ms avg")}</p><div class="run-turns">${run.turns.map((turn) => `<article><b>${String(turn.turn).padStart(2, "0")} ${arrows[turn.move]} ${turn.move.toUpperCase()}</b><span>Score +${turn.scoreGain} → ${turn.score.toLocaleString()}</span><span>${turn.latencyMs} ms${turn.confidence === undefined ? "" : ` · ${Math.round(turn.confidence * 100)}% confidence`}</span><span>${turn.model && turn.model !== run.model ? `Provider model: ${escapeHtml(turn.model)}` : ""}</span><span>${turn.usage?.inputTokens ?? "N/A"} in / ${turn.usage?.outputTokens ?? "N/A"} out · ${turn.usage?.cost === undefined ? "N/A" : money(turn.usage.cost)}</span>${turn.explanation ? `<p>${escapeHtml(turn.explanation)}</p>` : ""}<div class="mini-board">${turn.board.flat().map((tile) => `<i class="tile-${tile}">${tile || ""}</i>`).join("")}</div></article>`).join("")}</div>`;
  panel.classList.remove("hidden");
  const reasoning = document.createElement("p");
  reasoning.textContent = `Reasoning: ${reasoningLabel(run.reasoning)}${run.reasoning?.maxCompletionTokens ? ` · ${run.reasoning.maxCompletionTokens} max completion tokens` : ""}`;
  panel.insertBefore(reasoning, panel.querySelector(".run-turns"));
  const diagnostics = [
    ...(run.terminalDiagnostics || []).map((diagnostic) => ({ turn: "terminal", diagnostic })),
    ...run.turns.flatMap((turn) => (turn.diagnostics || []).map((diagnostic) => ({ turn: String(turn.turn), diagnostic }))),
  ];
  if (diagnostics.length) {
    const details = document.createElement("details");
    details.className = "decision-diagnostics";
    const summary = document.createElement("summary");
    summary.textContent = `Provider diagnostics · ${diagnostics.length} attempt${diagnostics.length === 1 ? "" : "s"}`;
    details.append(summary);
    for (const { turn, diagnostic } of diagnostics) {
      const row = document.createElement("p");
      row.textContent = [
        `Turn ${turn}`,
        `attempt ${diagnostic.attempt}`,
        diagnostic.resolvedModel || diagnostic.requestedModel,
        diagnostic.provider,
        diagnostic.httpStatus === undefined ? undefined : `HTTP ${diagnostic.httpStatus}`,
        diagnostic.finishReason ? `finish ${diagnostic.finishReason}` : undefined,
        `${diagnostic.latencyMs} ms`,
        diagnostic.reasoningTokenCount === undefined ? undefined : `${diagnostic.reasoningTokenCount} reasoning tokens`,
        diagnostic.cost === undefined ? undefined : `$${diagnostic.cost.toFixed(5)}`,
        diagnostic.errorCode,
        diagnostic.error,
      ].filter(Boolean).join(" · ");
      details.append(row);
    }
    panel.insertBefore(details, panel.querySelector(".run-turns"));
  }
  panel.querySelector("#close-run-detail")!.addEventListener("click", () => panel.classList.add("hidden"));
  panel.querySelector<HTMLButtonElement>("#delete-run")!.addEventListener("click", () => void deleteRun(run));
  panel.querySelector<HTMLButtonElement>("#rename-run")!.addEventListener("click", () => void renameRun(run));
  panel.querySelector<HTMLButtonElement>("#replay-run")!.addEventListener("click", () => {
    if (window.confirm(`Load seed ${run.seed} into a fresh grid? Your current mode and model will stay selected. The current run will be archived.`)) replaySeed(run.seed);
  });
}

async function renameRun(run: RunRecord): Promise<void> {
  const name = window.prompt("Session name", run.sessionName || run.modelName)?.trim();
  if (!name || name === (run.sessionName || run.modelName)) return;
  try {
    await runHistoryApi.rename(run.id, name);
    await loadRunHistory();
    await showRun(run.id);
  } catch { document.querySelector<HTMLElement>("#run-history-status")!.textContent = "Session name could not be saved."; }
}

async function deleteRun(run: RunRecord): Promise<void> {
  if (run.id === activeRunId()) return;
  if (!window.confirm(`Delete ${run.modelName} from ${new Date(run.startedAt).toLocaleString()} (seed ${run.seed}, score ${run.metrics.score})? This cannot be undone.`)) return;
  const status = document.querySelector<HTMLElement>("#run-history-status")!;
  try {
    await runHistoryApi.delete(run.id);
    if (selectedId === run.id) { selectedId = undefined; document.querySelector("#run-detail")!.classList.add("hidden"); }
    await loadRunHistory();
  } catch { status.textContent = "Run could not be deleted. Please try again."; }
}

function escapeHtml(value: string): string { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }

export function setupHistoryView(getActiveRunId: () => string | undefined = () => undefined, onReplaySeed: (seed: number) => void = () => undefined): void {
  activeRunId = getActiveRunId;
  replaySeed = onReplaySeed;
  window.addEventListener("run-history-updated", () => void loadRunHistory());
  document.querySelector<HTMLSelectElement>("#run-filter")!.addEventListener("change", renderRuns);
  document.querySelector<HTMLSelectElement>("#model-filter")!.addEventListener("change", renderRuns);
  document.querySelector<HTMLSelectElement>("#reasoning-filter")!.addEventListener("change", renderRuns);
  document.querySelectorAll<HTMLTableCellElement>("#run-history-table th[data-sort]").forEach((header) => {
    const sort = () => { if (sortKey === header.dataset.sort) sortDirection *= -1; else { sortKey = header.dataset.sort!; sortDirection = -1; } renderRuns(); };
    header.addEventListener("click", sort);
    header.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sort(); } });
  });
  void loadRunHistory();
}
