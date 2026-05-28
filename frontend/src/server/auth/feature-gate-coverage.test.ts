import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURE_API_COVERAGE, UNIMPLEMENTED_PAID_FEATURE_API_COVERAGE } from "./feature-gate-routes";
import type { FeatureKey } from "./entitlements";

const PAID_PRODUCT_FEATURE_KEYS: FeatureKey[] = [
  "submission_guidance",
  "compliance_manifest",
  "pursue_no_bid",
  "quote_workflow",
  "knowledge_station",
] as const;

const apiRoot = new URL("../../app/api/", import.meta.url);

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

describe("feature gate coverage", () => {
  it.each(FEATURE_API_COVERAGE)(
    "keeps $sourcePath protected by requireFeature($feature)",
    ({ sourcePath, feature }) => {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");

      expect(source).toContain("requireFeature");
      expect(source).toContain(`"${feature}"`);
      expect(source).toContain("FeatureAccessError");
    },
  );

  it("registers every API route that imports the feature gate helper", () => {
    const registeredPaths = new Set(FEATURE_API_COVERAGE.map((route) => route.sourcePath));
    const gatedRoutePaths = routeFiles(apiRoot)
      .filter((url) => readFileSync(url, "utf8").includes("@/server/auth/feature-gate"))
      .map(relativeRoutePath)
      .map((path) => `../../app/api/${path.replace("src/app/api/", "")}`)
      .sort();

    expect(gatedRoutePaths).toEqual([...registeredPaths].sort());
  });

  it("documents every paid feature as either implemented with protected routes or explicitly not implemented", () => {
    const implemented = new Set(FEATURE_API_COVERAGE.map((route) => route.feature));
    const unimplemented = new Set(UNIMPLEMENTED_PAID_FEATURE_API_COVERAGE);

    expect([...implemented].filter((feature) => unimplemented.has(feature))).toEqual([]);
    expect([...implemented, ...unimplemented].sort()).toEqual([...PAID_PRODUCT_FEATURE_KEYS].sort());
  });

  it("does not expose API routes for explicitly unimplemented paid features", () => {
    const sourceByRoute = routeFiles(apiRoot).map((url) => ({
      routePath: relativeRoutePath(url),
      source: readFileSync(url, "utf8"),
    }));

    for (const feature of UNIMPLEMENTED_PAID_FEATURE_API_COVERAGE) {
      const leakedRoutes = sourceByRoute
        .filter(({ source }) => source.includes(`"${feature}"`) || source.includes(`'${feature}'`))
        .map(({ routePath }) => routePath);

      expect(leakedRoutes).toEqual([]);
    }
  });
});
