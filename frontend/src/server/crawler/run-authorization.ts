import { timingSafeEqual } from "node:crypto";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";

function isLocalDevelopmentRequest(request: Request): boolean {
  const productionValues = new Set(["production", "prod", "staging"]);
  const environmentKeys = ["NODE_ENV", "APP_ENV", "DEPLOY_ENV", "VERCEL_ENV", "RUNTIME_ENV"];
  if (environmentKeys.some((key) => productionValues.has(process.env[key]?.trim().toLowerCase() ?? ""))) return false;
  if (!["development", "test"].includes(process.env.NODE_ENV ?? "")) return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}

export async function isCrawlerRunAuthorized(database: AppDatabase, request: Request): Promise<boolean> {
  const requiredToken = process.env.CRAWLER_RUN_TOKEN?.trim();
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : request.headers.get("x-crawler-token");
  if (requiredToken && suppliedToken) {
    const expected = Buffer.from(requiredToken);
    const supplied = Buffer.from(suppliedToken);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true;
  }
  const local = isLocalDevelopmentRequest(request);
  if (!requiredToken && local && process.env.CRAWLER_ALLOW_UNAUTHENTICATED_LOCAL_RUN === "true") return true;
  try {
    const principal = await requireAdminAccess(database, request, { roles: ["admin", "operator"] });
    // The admin UI's explicit development bypass must remain local even under staging aliases.
    return principal.kind !== "local-bypass" || local;
  } catch (error) {
    if (error instanceof AdminAuthError) return false;
    throw error;
  }
}
