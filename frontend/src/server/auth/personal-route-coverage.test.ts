import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiRoot = new URL("../../app/api/", import.meta.url);
const personalIntentRoot = new URL("../../app/api/intents/", import.meta.url);
const publicAnonymousRoutes = [
  new URL("../../app/api/bids/route.ts", import.meta.url),
  new URL("../../app/api/bids/[id]/route.ts", import.meta.url),
  new URL("../../app/api/bids/[id]/match/route.ts", import.meta.url),
  new URL("../../app/api/bids/[id]/attachments/[attachmentId]/route.ts", import.meta.url),
];
const personalWorkspaceRoutes = [
  new URL("../../app/api/saved-bids/route.ts", import.meta.url),
  new URL("../../app/api/saved-bids/[id]/route.ts", import.meta.url),
  new URL("../../app/api/intents/route.ts", import.meta.url),
  new URL("../../app/api/intents/[id]/route.ts", import.meta.url),
  new URL("../../app/api/search-alerts/route.ts", import.meta.url),
  new URL("../../app/api/search-alerts/[id]/route.ts", import.meta.url),
];

function routeFiles(url: URL): URL[] {
  return readdirSync(url, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);

    if (entry.isDirectory()) return routeFiles(child);
    return entry.name === "route.ts" ? [child] : [];
  });
}

function relativeRoutePath(url: URL) {
  return decodeURIComponent(url.href.replace(apiRoot.href, "src/app/api/"));
}

describe("personal API route auth coverage", () => {
  it("keeps public anonymous routes free of personal workspace persistence", () => {
    for (const route of publicAnonymousRoutes) {
      const source = readFileSync(route, "utf8");

      expect(source).not.toContain("createSavedBid");
      expect(source).not.toContain("saveBid(");
      expect(source).not.toContain("createIntent");
      expect(source).not.toContain("createSearchAlert");
    }
  });

  it("requires shared auth guards on personal workspace API route entrypoints", () => {
    const unguardedRoutes = personalWorkspaceRoutes
      .filter((url) => {
        const source = readFileSync(url, "utf8");

        return !source.includes("isAuthenticatedPrincipal") || !source.includes("authRequiredResponse");
      })
      .map(relativeRoutePath);

    expect(unguardedRoutes).toEqual([]);
  });

  it("requires an authenticated principal on every intent workspace API route", () => {
    const unguardedRoutes = routeFiles(personalIntentRoot)
      .filter((url) => {
        const source = readFileSync(url, "utf8");

        return !source.includes("isAuthenticatedPrincipal") || !source.includes("authRequiredResponse");
      })
      .map(relativeRoutePath);

    expect(unguardedRoutes).toEqual([]);
  });
});
