import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MYSQL_MARKERS = [
  "@/server/db/mysql",
  "isMysqlDatabaseUrlConfigured",
  "resolveMysqlPool",
  "Mysql",
  "mysql",
];

const SERVICE_LEVEL_MYSQL_ROUTES = new Map<string, string>([
  ["account/deadline-reminders/route.ts", "deadline reminder service selects MySQL repositories at runtime"],
  ["admin/notifications/deliver/route.ts", "notification delivery service selects MySQL outbox repositories at runtime"],
  ["auth/password-reset/confirm/route.ts", "password reset service selects MySQL token repositories at runtime"],
  ["auth/password-reset/request/route.ts", "password reset service selects MySQL token repositories at runtime"],
  ["bids/[id]/attachments/[attachmentId]/route.ts", "attachment service selects MySQL attachment repositories at runtime"],
  ["bids/[id]/match/route.ts", "bid lookup service selects MySQL bid repositories at runtime"],
  ["company/profile/route.ts", "profile service selects MySQL profile repositories at runtime"],
  ["dashboard/intelligence/route.ts", "procurement intelligence service selects MySQL repositories at runtime"],
  ["dashboard/summary/route.ts", "dashboard summary service selects MySQL bid and risk adapters at runtime"],
  ["intents/route.ts", "intent service selects MySQL repositories at runtime"],
  ["intents/[id]/route.ts", "intent service selects MySQL repositories at runtime"],
  ["intents/[id]/artifacts/route.ts", "artifact vault service selects MySQL repositories at runtime"],
  ["intents/[id]/artifacts/[artifactId]/route.ts", "artifact vault service selects MySQL repositories at runtime"],
  ["intents/[id]/award/route.ts", "award outcome service selects MySQL repositories at runtime"],
  ["intents/[id]/citations/route.ts", "citation service selects MySQL repositories at runtime"],
  ["intents/[id]/compliance/route.ts", "compliance service selects MySQL repositories at runtime"],
  ["intents/[id]/deadlines/route.ts", "deadline service selects MySQL repositories at runtime"],
  ["intents/[id]/decision/route.ts", "pursuit decision service selects MySQL repositories at runtime"],
  ["intents/[id]/qa/route.ts", "Q&A service selects MySQL repositories at runtime"],
  ["intents/[id]/qualification/freshness/route.ts", "qualification service selects MySQL repositories at runtime"],
  ["intents/[id]/quotes/route.ts", "quotes service selects MySQL repositories at runtime"],
  ["intents/[id]/response-workspace/route.ts", "response workspace service selects MySQL repositories at runtime"],
  ["intents/[id]/response-workspace/comments/route.ts", "response workspace service selects MySQL repositories at runtime"],
  ["intents/[id]/response-workspace/package/route.ts", "response package service selects MySQL repositories at runtime"],
  ["intents/[id]/response-workspace/package/exports/route.ts", "response package export service selects MySQL repositories at runtime"],
  ["intents/[id]/response-workspace/package/exports/[exportId]/route.ts", "response package export service selects MySQL repositories at runtime"],
  ["intents/[id]/submission/route.ts", "submission service selects MySQL repositories at runtime"],
  ["intents/[id]/submission/confirm/route.ts", "submission service selects MySQL repositories at runtime"],
  ["knowledge/route.ts", "knowledge service selects MySQL repositories at runtime"],
  ["saved-bids/[id]/route.ts", "saved bid service selects MySQL repositories at runtime"],
  ["search-alerts/[id]/route.ts", "search alert service selects MySQL repositories at runtime"],
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function apiRouteRelativePath(filePath: string) {
  return path.relative(path.join(process.cwd(), "src", "app", "api"), filePath);
}

describe("MySQL API route coverage", () => {
  it("requires direct db route imports to be MySQL-aware or documented service boundaries", () => {
    const apiRoot = path.join(process.cwd(), "src", "app", "api");
    const routeFiles = walk(apiRoot).filter((filePath) => filePath.endsWith("route.ts"));
    const directDbRoutes = routeFiles
      .map((filePath) => ({
        filePath,
        relativePath: apiRouteRelativePath(filePath),
        source: readFileSync(filePath, "utf8"),
      }))
      .filter((route) => route.source.includes("@/server/db/client"));
    const undocumentedRoutes = directDbRoutes
      .filter((route) => !MYSQL_MARKERS.some((marker) => route.source.includes(marker)))
      .filter((route) => !SERVICE_LEVEL_MYSQL_ROUTES.has(route.relativePath))
      .map((route) => route.relativePath);

    expect(undocumentedRoutes).toEqual([]);

    for (const [relativePath, reason] of SERVICE_LEVEL_MYSQL_ROUTES) {
      const route = directDbRoutes.find((entry) => entry.relativePath === relativePath);
      expect(route, `${relativePath}: ${reason}`).toBeDefined();
    }
  });
});
