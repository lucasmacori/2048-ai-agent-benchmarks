import express from "express";
import path from "node:path";
import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { OpenRouter } from "@openrouter/sdk";
import { config } from "./config.js";
import { createDecisionRouter } from "./decision-route.js";
import { createRunHistoryRouter } from "./run-history-route.js";
import { RunHistoryRepository } from "./run-history-repository.js";

const app = express();
const client = config.apiKey ? new OpenRouter({ apiKey: config.apiKey }) : undefined;
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use("/api", createDecisionRouter(client, config.model, config.layaBaseUrl));
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.basename(path.dirname(serverDirectory)) === "dist-server"
  ? path.resolve(serverDirectory, "../..")
  : path.resolve(serverDirectory, "..");
const historyFile = path.join(root, "data", "run-history.json");
const legacyHistoryFile = path.resolve(root, "..", "data", "run-history.json");
try {
  await access(historyFile);
} catch {
  try {
    await mkdir(path.dirname(historyFile), { recursive: true });
    await copyFile(legacyHistoryFile, historyFile, constants.COPYFILE_EXCL);
    console.info("Migrated run history into the project data directory.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
app.use("/api", createRunHistoryRouter(new RunHistoryRepository(historyFile)));

const dist = path.join(root, "dist");
app.use(express.static(dist));
app.use((_request, response) => response.sendFile(path.join(dist, "index.html")));

app.listen(config.port, () => console.log(`2048 server listening on http://localhost:${config.port}`));
