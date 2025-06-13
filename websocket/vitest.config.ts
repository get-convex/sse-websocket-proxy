import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    conditions: ["sse-ws-proxy-development"],
  },
});
