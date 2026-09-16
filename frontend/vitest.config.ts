import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Standalone builds can contain traced test fixtures; only discover source suites.
    include: ["*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: false,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
