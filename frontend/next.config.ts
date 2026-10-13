import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output produces a self-contained server bundle (server.js +
  // pruned node_modules) under .next/standalone, which the production
  // Dockerfile copies instead of the full node_modules tree. This keeps the
  // runtime image lean. See frontend/Dockerfile.
  output: "standalone",
  // better-sqlite3 ships a native .node binding and mysql2 relies on dynamic
  // requires; keep both external to the server bundle so standalone output
  // copies their real node_modules files instead of misbundling them.
  serverExternalPackages: ["better-sqlite3", "mysql2"],
  outputFileTracingExcludes: {
    "/api/intents/*/response-workspace/package/exports": ["./next.config.ts"],
  },
  turbopack: {
    ignoreIssue: [
      {
        path: "**/next.config.ts",
        title: "Encountered unexpected file in NFT list",
      },
    ],
  },
  experimental: {
    // Stop-gap. Since Next 16.3 `next build` type-checks with the project-local `tsc` CLI over the
    // whole tsconfig project, test files included; 16.2 used the TypeScript API and dropped the
    // diagnostics of *.test.* files. The pre-existing type errors in test files make the CLI
    // checker fail every build ("Failed to type check"). Keep the 16.2 checker until those errors
    // are fixed (a separate task), then delete this option.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
