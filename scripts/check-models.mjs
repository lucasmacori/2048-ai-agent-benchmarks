import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/model-catalog.ts", import.meta.url), "utf8");
const modelIds = [...source.matchAll(/\{ id: "([^"]+)", name:/g)].map((match) => match[1]);

const response = await fetch("https://openrouter.ai/api/v1/models");
if (!response.ok) throw new Error(`OpenRouter catalog request failed: ${response.status}`);
const catalog = await response.json();
const remote = new Map(catalog.data.map((model) => [model.id, model]));
const failures = [];
for (const id of modelIds) {
  const found = remote.get(id);
  if (!found) failures.push(`${id}: missing`);
  else {
    const supported = new Set(found.supported_parameters || []);
    if (!supported.has("structured_outputs")) failures.push(`${id}: structured_outputs unsupported`);
    if (!supported.has("response_format")) failures.push(`${id}: response_format unsupported`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`Verified ${modelIds.length} allowlisted OpenRouter models.`);
