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
};

export default nextConfig;
