import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, ".venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "laya-serve.exe" : "laya-serve");
const required = process.argv.includes("--required");

if (!existsSync(executable)) {
  console.log("Laya sidecar not installed. Run `npm run setup:laya`; continuing without local Laya.");
  process.exit(required ? 1 : 0);
}

const child = spawn(executable, [], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    LAYA_HOST: "127.0.0.1",
    LAYA_PORT: process.env.LAYA_PORT || "8000",
    LAYA_DEVICE: process.env.LAYA_DEVICE || "cpu",
    LAYA_PRELOAD: process.env.LAYA_PRELOAD || "1",
    LAYA_MODELS: process.env.LAYA_MODEL || "english",
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
