import "./styles.css";
import { AgentController } from "./agent/controller.js";
import type { Direction, GameMode } from "./game/types.js";
import { setupHistoryView } from "./history/history-view.js";
import { DEFAULT_AGENT_CONFIG, type AgentRuntimeConfig } from "./agent/runtime-config.js";
import { type ReasoningCapabilities, type ReasoningEffort, type ReasoningSetting } from "./agent/reasoning.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
const controller = new AgentController();
const arrows: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };
let capabilities: { openRouterAvailable: boolean; layaAvailable: boolean; agent?: AgentRuntimeConfig; hybrid?: { probabilityMargin: number; confidenceThreshold: number } } | undefined;

function delayOptions(config: AgentRuntimeConfig): string {
  const labels = ["Fast", "Normal", "Slow"];
  return config.delayOptionsMs.map((value, index) => `<option value="${value}" ${value === config.defaultDelayMs ? "selected" : ""}>${labels[index]} (${value}ms)</option>`).join("");
}

app.innerHTML = `
  <main class="shell">
    <header class="masthead"><a class="brand" href="#"><span class="brand-mark">L</span> LAYA ARCADE</a><span class="broadcast"><i></i> FOUR WAYS TO PLAY / 2048</span></header>
    <section class="intro"><div><p class="eyebrow">A SMALL EXPERIMENT IN MACHINE PLAY</p><h1>Who makes<br><em>the next move?</em></h1></div><p class="intro-copy">Play yourself, or put four different decision engines to work on the same board.</p></section>
    <section class="arena">
      <div class="game-column">
        <div class="game-top"><div><span class="label">CURRENT RUN</span><strong id="game-status" aria-live="polite">READY TO PLAY</strong></div><div class="scorebox"><span>SCORE</span><strong id="score">0</strong></div></div>
        <div class="board-wrap"><div id="board" class="board" role="grid" aria-label="2048 game board"></div><div id="overlay" class="board-overlay hidden"></div></div>
         <div class="mode-row"><span class="label">PLAY MODE</span><div id="modes" class="mode-selector"><button data-mode="manual">Manual</button><button data-mode="jev">JEV</button><button data-mode="llm">LLM</button><button data-mode="laya">Laya</button><button data-mode="hybrid">System 1 / 2</button></div><select id="model" aria-label="LLM model"><option value="openai/gpt-5.6-luna">GPT-5.6 Luna</option></select><label id="reasoning-control" class="reasoning-control hidden">REASONING <select id="reasoning" aria-label="LLM reasoning"></select></label></div>
         <div id="hybrid-controls" class="hybrid-controls hidden"><label>System 1 <select id="system1"><option value="jev">JEV</option><option value="laya">Laya</option></select></label><label>System 2 <select id="system2"><option value="human">Human in the loop</option><option value="llm">LLM</option></select></label><select id="system2-model" aria-label="System 2 LLM model"></select><label id="system2-reasoning-control" class="reasoning-control hidden">REASONING <select id="system2-reasoning"></select></label></div>
         <p id="provider-notice" class="provider-notice hidden" aria-live="polite"></p><p id="human-handoff" class="provider-notice hidden" aria-live="polite">System 1 is unsure. Choose one legal move to complete this turn as System 2.</p>
        <div class="game-actions"><button id="start" class="button-primary agent-only">▶ <span>Start agent</span></button><button id="step" class="button-secondary agent-only">Step once</button><button id="reset" class="button-secondary">New run ↻</button><label class="speed agent-only">DELAY <select id="speed">${delayOptions(DEFAULT_AGENT_CONFIG)}</select></label></div>
        <div id="manual-controls" class="manual-controls" aria-label="Manual move controls"><button data-dir="up" aria-label="Move up">↑</button><div><button data-dir="left" aria-label="Move left">←</button><button data-dir="down" aria-label="Move down">↓</button><button data-dir="right" aria-label="Move right">→</button></div></div>
        <div class="seed-line"><span>RUN SEED <b id="seed"></b></span><button id="replay" class="text-button">REPLAY SAME SEED ↗</button><span>TURN <b id="turn">0</b></span></div>
      </div>
      <aside class="agent-panel">
        <div class="panel-head"><div><span class="label">DECISION ENGINE</span><h2 id="mode-title">JEV <span>×</span> 2048</h2></div><span class="live-pill" id="pill">STANDBY</span></div>
        <div class="move-readout"><span class="label">LAST MOVE</span><div><strong id="last-move">—</strong><span id="confidence">Waiting for first decision</span></div></div>
        <div class="probabilities" id="probabilities"><div class="section-title"><span>MOVE PROBABILITIES</span><span id="prob-total">—</span></div><div id="bars" class="bars"><p class="empty-note">Probabilities appear after a move.</p></div></div>
        <div id="explanation" class="explanation hidden"></div>
        <div class="telemetry"><div><span>RESPONSE</span><strong id="latency">—</strong></div><div><span>MODEL</span><strong id="model-readout">~typesafe/jev-latest</strong></div><div><span>TOKENS</span><strong id="tokens">—</strong></div><div><span>EST. COST</span><strong id="cost">—</strong></div></div>
        <div class="history"><div class="section-title"><span>DECISION TAPE</span><span id="history-count">00</span></div><ol id="history-list"><li class="history-empty">No turns recorded yet.</li></ol></div>
        <p class="footnote">The game engine owns the rules. Decision modes can only choose legal moves.</p>
      </aside>
    </section>
     <section class="run-history-panel"><div class="run-history-heading"><div><span class="label">MODEL BENCHMARKS</span><h2>Run history</h2></div><div class="run-filters"><select id="run-filter" aria-label="Filter by engine"><option value="all">All engines</option><option value="llm">LLM</option><option value="jev">JEV</option><option value="laya">Laya</option><option value="manual">Manual</option><option value="hybrid">System 1 / 2</option></select><select id="model-filter" aria-label="Filter by model"><option value="all">All models</option></select><select id="reasoning-filter" aria-label="Filter by reasoning"><option value="all">All reasoning</option></select></div></div><p id="run-history-status" aria-live="polite">Loading benchmark runs…</p><div class="run-table-scroll"><table id="run-history-table"><thead><tr><th data-sort="startedAt" tabindex="0">Date</th><th data-sort="modelName" tabindex="0">Engine / model</th><th data-sort="seed" tabindex="0">Seed</th><th data-sort="finishReason" tabindex="0">Result</th><th data-sort="score" tabindex="0">Score</th><th data-sort="highestTile" tabindex="0">Max tile</th><th data-sort="turns" tabindex="0">Turns</th><th data-sort="totalTokens" tabindex="0">Input / output / total tokens</th><th data-sort="cost" tabindex="0">Cost</th><th data-sort="averageLatencyMs" tabindex="0">Avg latency</th></tr></thead><tbody id="run-history-body"></tbody></table></div><p class="history-footnote">* Usage is partial when a provider omits token or cost data. N/A means unavailable.</p><div id="run-detail" class="run-detail hidden" role="region" aria-label="Run details"></div></section>
    <footer><span>KEEP THE BIG TILE IN THE CORNER.</span><span>2048 · JEV ARCADE · LOCAL MATCH</span></footer>
  </main>`;

function render(): void {
  const { state, status, history, lastDecision, error } = controller;
  const board = document.querySelector<HTMLDivElement>("#board")!;
  board.innerHTML = state.board.flat().map((tile, index) => `<div class="cell tile-${tile}" role="gridcell" aria-label="${tile || "empty"}" style="--index:${index}">${tile || ""}</div>`).join("");
  document.querySelector("#score")!.textContent = state.score.toLocaleString();
  document.querySelector("#turn")!.textContent = String(state.turn).padStart(2, "0");
  document.querySelector("#seed")!.textContent = String(state.seed);
  const modeNames: Record<GameMode, string> = { manual: "MANUAL", jev: "JEV", llm: "LLM", laya: "LAYA", hybrid: "SYSTEM 1 / 2" };
  const modeTitle: Record<GameMode, string> = { manual: "HUMAN <span>×</span> 2048", jev: "JEV <span>×</span> 2048", llm: "LLM <span>×</span> 2048", laya: "LAYA <span>×</span> 2048", hybrid: "SYSTEM 1 <span>×</span> SYSTEM 2" };
  document.querySelector("#mode-title")!.innerHTML = modeTitle[controller.mode];
  document.querySelector("#modes")!.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.classList.toggle("selected", button.dataset.mode === controller.mode));
  document.querySelector<HTMLSelectElement>("#model")!.classList.toggle("hidden", controller.mode !== "llm");
  updateReasoningControl();
  document.querySelector("#hybrid-controls")!.classList.toggle("hidden", controller.mode !== "hybrid");
  document.querySelector<HTMLSelectElement>("#system1")!.value = controller.system1;
  document.querySelector<HTMLSelectElement>("#system2")!.value = controller.system2;
  document.querySelector<HTMLSelectElement>("#system2-model")!.classList.toggle("hidden", controller.mode !== "hybrid" || controller.system2 !== "llm");
  refreshHybridReasoning();
  document.querySelector("#manual-controls")!.classList.toggle("visible", controller.mode === "manual" || controller.status === "awaiting-human");
  document.querySelectorAll<HTMLElement>(".agent-only").forEach((element) => element.classList.toggle("hidden", controller.mode === "manual"));
  document.querySelector("#probabilities")!.classList.toggle("hidden", controller.mode === "llm" || controller.mode === "manual");
  const notice = document.querySelector<HTMLParagraphElement>("#provider-notice")!;
  const unavailableMessage = (controller.mode === "laya" || (controller.mode === "hybrid" && controller.system1 === "laya")) && capabilities && !capabilities.layaAvailable
    ? "Local Laya is not running. Run npm run setup:laya once, then npm run laya in another terminal."
    : (controller.mode === "jev" || controller.mode === "llm" || (controller.mode === "hybrid" && (controller.system1 === "jev" || controller.system2 === "llm"))) && capabilities && !capabilities.openRouterAvailable
      ? "OpenRouter is not configured. Add OPENROUTER_API_KEY to .env; Manual and Laya modes work without it."
      : "";
  notice.textContent = unavailableMessage;
  notice.classList.toggle("hidden", !unavailableMessage);
  document.querySelector("#human-handoff")!.classList.toggle("hidden", status !== "awaiting-human");
  const statusText = error ? "REQUEST FAILED" : state.status === "won" ? "2048 REACHED" : state.status === "lost" ? "NO MOVES LEFT" : status === "awaiting-human" ? "HUMAN DECISION REQUIRED" : status === "waiting" ? `${modeNames[controller.mode]} IS THINKING…` : status === "running" ? "AUTOPLAY ACTIVE" : status === "paused" ? "PAUSED" : controller.mode === "manual" ? "YOUR MOVE" : "READY TO PLAY";
  document.querySelector("#game-status")!.textContent = statusText;
  document.querySelector("#pill")!.textContent = error ? "ERROR" : status === "waiting" ? "THINKING" : status === "running" ? "LIVE" : status === "finished" ? "FINISHED" : status.toUpperCase();
  const start = document.querySelector<HTMLButtonElement>("#start")!;
  start.innerHTML = status === "running" || status === "waiting" ? "Ⅱ <span>Pause agent</span>" : "▶ <span>Start agent</span>";
  start.disabled = status === "awaiting-human";
  document.querySelector<HTMLButtonElement>("#step")!.disabled = status === "waiting" || status === "running" || state.status !== "playing";
  const overlay = document.querySelector<HTMLDivElement>("#overlay")!;
  overlay.classList.toggle("hidden", !error && state.status === "playing");
  overlay.innerHTML = error ? `<strong>${controller.mode === "laya" ? "Couldn’t reach Laya" : controller.mode === "llm" ? "LLM request failed" : "Couldn’t reach JEV"}</strong><span>${escapeHtml(error)}</span><button id="retry" class="button-secondary">Try again</button>` : state.status === "won" ? "2048! A PERFECT RUN." : state.status === "lost" ? "NO LEGAL MOVES. RUN ENDED." : "";
  overlay.querySelector("#retry")?.addEventListener("click", () => controller.step());
  if (lastDecision) {
    document.querySelector("#last-move")!.innerHTML = `${arrows[lastDecision.move]} <span>${lastDecision.move.toUpperCase()}</span>`;
    document.querySelector("#confidence")!.textContent = lastDecision.confidence === undefined ? (lastDecision.explanation || `${modeNames[controller.mode]} selected this direction`) : `${Math.round(lastDecision.confidence * 100)}% confidence`;
    document.querySelector("#latency")!.textContent = `${lastDecision.latencyMs} ms`;
    document.querySelector("#model-readout")!.textContent = lastDecision.model || "~typesafe/jev-latest";
    const tokenTotal = history.reduce((sum, turn) => sum + (turn.usage?.inputTokens || 0) + (turn.usage?.outputTokens || 0), 0);
    const costTotal = history.reduce((sum, turn) => sum + (turn.usage?.cost || 0), 0);
    document.querySelector("#tokens")!.textContent = tokenTotal > 0 ? tokenTotal.toLocaleString() : "—";
    document.querySelector("#cost")!.textContent = costTotal > 0 ? `$${costTotal.toFixed(5)}` : "—";
    const probabilities = lastDecision.probabilities || {};
    document.querySelector("#prob-total")!.textContent = `${Object.keys(probabilities).length} OPTIONS`;
    document.querySelector("#bars")!.innerHTML = Object.entries(probabilities).sort((a, b) => b[1] - a[1]).map(([direction, value]) => `<div class="prob-row"><span>${arrows[direction as Direction]} ${direction.toUpperCase()}</span><div class="bar-track"><i style="width:${Math.max(2, value * 100)}%"></i></div><b>${(value * 100).toFixed(0)}%</b></div>`).join("") || '<p class="empty-note">JEV did not return probability scores.</p>';
    document.querySelector("#explanation")!.textContent = lastDecision.explanation ? `“${lastDecision.explanation}”` : "";
    document.querySelector("#explanation")!.classList.toggle("hidden", !lastDecision.explanation);
  }
  if (controller.system1Decision && controller.pendingDelegation) {
    document.querySelector("#confidence")!.textContent = `System 1 recommends ${controller.system1Decision.move.toUpperCase()} · delegated: ${controller.pendingDelegation.reason}`;
    document.querySelector("#model-readout")!.textContent = "Human in the loop";
  }
  if (!lastDecision) document.querySelector("#model-readout")!.textContent = controller.mode === "llm" ? controller.model : controller.mode === "laya" ? "Local Laya" : controller.mode === "manual" ? "Human" : "~typesafe/jev-latest";
  document.querySelector("#tokens")!.textContent = history.reduce((sum, turn) => sum + (turn.usage?.inputTokens || 0) + (turn.usage?.outputTokens || 0), 0).toLocaleString();
  const totalCost = history.reduce((sum, turn) => sum + (turn.usage?.cost || 0), 0);
  document.querySelector("#cost")!.textContent = totalCost > 0 ? `$${totalCost.toFixed(5)}` : "—";
  document.querySelector("#history-count")!.textContent = String(history.length).padStart(2, "0");
  document.querySelector("#history-list")!.innerHTML = history.length ? [...history].reverse().slice(0, 8).map((turn) => `<li><b>${String(turn.turn).padStart(2, "0")}</b><span class="history-direction">${arrows[turn.move]} ${turn.move.toUpperCase()}</span><span>${turn.mode || "—"}</span><span>${turn.latencyMs ? `${turn.latencyMs}ms` : "—"}</span></li>`).join("") : '<li class="history-empty">No turns recorded yet.</li>';
}

function escapeHtml(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function reasoningValue(setting: ReasoningSetting): string {
  return setting.mode === "effort" ? `effort:${setting.effort}` : setting.mode;
}

function updateReasoningControl(): void {
  const control = document.querySelector<HTMLLabelElement>("#reasoning-control")!;
  const select = document.querySelector<HTMLSelectElement>("#reasoning")!;
  const capabilities = controller.modelMetadata[controller.model]?.reasoning;
  control.classList.toggle("hidden", controller.mode !== "llm");
  if (!capabilities?.supported) {
    select.innerHTML = '<option value="disabled">Unavailable</option>';
    select.disabled = true;
    return;
  }
  const options = [
    ...(!capabilities.mandatory ? ['<option value="disabled">Disabled</option>'] : []),
    '<option value="default">Model default</option>',
    ...(capabilities.supportedEfforts || []).map((effort) => `<option value="effort:${effort}">${effort[0]!.toUpperCase()}${effort.slice(1)}</option>`),
  ];
  select.innerHTML = options.join("");
  select.disabled = false;
  select.value = reasoningValue(controller.reasoning);
  if (!select.value) {
    controller.setReasoning(capabilities.mandatory
      ? { mode: "effort", effort: capabilities.supportedEfforts?.[0] || "low" }
      : { mode: "disabled" });
    select.value = reasoningValue(controller.reasoning);
  }
}

controller.subscribe(render);
void fetch("/api/capabilities").then((response) => response.json()).then((data) => {
  capabilities = data;
  const agentConfig = data.agent as AgentRuntimeConfig || DEFAULT_AGENT_CONFIG;
  controller.configure(agentConfig);
  if (data.hybrid) controller.configureHybridThresholds(data.hybrid);
  document.querySelector<HTMLSelectElement>("#speed")!.innerHTML = delayOptions(agentConfig);
  const models = data.llmModels as Array<{ id: string; name: string; provider: string; tier: "cheap" | "mid" | "frontier"; reasoning: ReasoningCapabilities }>;
  const options = (["cheap", "mid", "frontier"] as const).map((tier) => `<optgroup label="${tier === "cheap" ? "Cheap / basic" : tier === "mid" ? "Mid-tier" : "Frontier"}">${models.filter((model) => model.tier === tier).map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)} · ${escapeHtml(model.provider)}</option>`).join("")}</optgroup>`).join("");
  document.querySelector<HTMLSelectElement>("#model")!.innerHTML = options;
  document.querySelector<HTMLSelectElement>("#system2-model")!.innerHTML = options;
  if (data.llmModels.some((model: { id: string }) => model.id === controller.model)) document.querySelector<HTMLSelectElement>("#model")!.value = controller.model;
  controller.setModelLabels(Object.fromEntries(data.llmModels.map((model: { id: string; name: string }) => [model.id, model.name])), {
    jev: { id: data.jevModel, name: data.jevModel },
    laya: { id: "laya-english", name: data.layaModel },
  }, Object.fromEntries(models.map((model) => [model.id, { provider: model.provider, tier: model.tier, reasoning: model.reasoning }])));
  render();
}).catch(() => { capabilities = { openRouterAvailable: false, layaAvailable: false, agent: DEFAULT_AGENT_CONFIG }; render(); });
document.querySelectorAll<HTMLButtonElement>("#modes button").forEach((button) => button.addEventListener("click", () => controller.setMode(button.dataset.mode as GameMode)));
document.querySelector<HTMLSelectElement>("#model")!.addEventListener("change", (event) => controller.setModel((event.target as HTMLSelectElement).value));
function refreshHybridReasoning(): void {
  const selected = controller.modelMetadata[controller.system2Model]?.reasoning;
  const control = document.querySelector<HTMLLabelElement>("#system2-reasoning-control")!;
  const select = document.querySelector<HTMLSelectElement>("#system2-reasoning")!;
  control.classList.toggle("hidden", controller.mode !== "hybrid" || controller.system2 !== "llm");
  if (selected?.supported) {
    select.innerHTML = [...(!selected.mandatory ? ['<option value="disabled">Disabled</option>'] : []), '<option value="default">Model default</option>', ...(selected.supportedEfforts || []).map((effort) => `<option value="effort:${effort}">${effort}</option>`)].join("");
    select.value = reasoningValue(controller.reasoning);
    select.disabled = false;
  } else { select.innerHTML = '<option value="disabled">Unavailable</option>'; select.disabled = true; }
}

function updateHybridConfiguration(): void {
  controller.configureHybrid(
    document.querySelector<HTMLSelectElement>("#system1")!.value as "jev" | "laya",
    document.querySelector<HTMLSelectElement>("#system2")!.value as "human" | "llm",
    document.querySelector<HTMLSelectElement>("#system2-model")!.value || controller.system2Model,
  );
  refreshHybridReasoning();
}
for (const id of ["system1", "system2", "system2-model"]) document.querySelector<HTMLSelectElement>(`#${id}`)!.addEventListener("change", updateHybridConfiguration);
document.querySelector<HTMLSelectElement>("#system2-reasoning")!.addEventListener("change", (event) => {
  const value = (event.target as HTMLSelectElement).value;
  controller.reasoning = value.startsWith("effort:") ? { mode: "effort", effort: value.slice(7) as ReasoningEffort } : { mode: value as "disabled" | "default" };
});
document.querySelector<HTMLSelectElement>("#reasoning")!.addEventListener("change", (event) => {
  const value = (event.target as HTMLSelectElement).value;
  const setting: ReasoningSetting = value.startsWith("effort:")
    ? { mode: "effort", effort: value.slice(7) as ReasoningEffort }
    : { mode: value as "disabled" | "default" };
  controller.setReasoning(setting);
});
document.querySelectorAll<HTMLButtonElement>("[data-dir]").forEach((button) => button.addEventListener("click", () => controller.move(button.dataset.dir as Direction)));
const keyMoves: Record<string, Direction> = { ArrowUp: "up", w: "up", ArrowDown: "down", s: "down", ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right" };
window.addEventListener("keydown", (event) => {
  const direction = keyMoves[event.key];
  if ((controller.mode !== "manual" && controller.status !== "awaiting-human") || !direction) return;
  event.preventDefault();
  controller.move(direction);
});
document.querySelector("#start")!.addEventListener("click", () => controller.status === "running" || controller.status === "waiting" ? controller.pause() : controller.start());
document.querySelector("#step")!.addEventListener("click", () => void controller.step());
document.querySelector("#reset")!.addEventListener("click", () => controller.reset());
document.querySelector("#replay")!.addEventListener("click", () => controller.reset(controller.state.seed, true, "replay"));
document.querySelector<HTMLSelectElement>("#speed")!.addEventListener("change", (event) => { controller.delay = Number((event.target as HTMLSelectElement).value); });
render();
setupHistoryView(() => controller.currentRunId, (seed) => {
  controller.replaySeed(seed);
  document.querySelector(".arena")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
