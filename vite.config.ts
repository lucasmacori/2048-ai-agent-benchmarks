import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { proxy: { "/api": "http://localhost:3000" } },
  test: { environment: "node", include: ["src/**/*.test.ts", "server/**/*.test.ts"] },
});
