import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gatedRoutes = [
  {
    path: "../../app/api/intents/[id]/submission/route.ts",
    feature: "submission_guidance",
  },
  {
    path: "../../app/api/intents/[id]/submission/confirm/route.ts",
    feature: "submission_guidance",
  },
  {
    path: "../../app/api/intents/[id]/compliance/route.ts",
    feature: "compliance_manifest",
  },
  {
    path: "../../app/api/intents/[id]/decision/route.ts",
    feature: "pursue_no_bid",
  },
] as const;

describe("feature gate coverage", () => {
  it.each(gatedRoutes)("keeps $path protected by requireFeature($feature)", ({ path, feature }) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");

    expect(source).toContain("requireFeature");
    expect(source).toContain(`"${feature}"`);
    expect(source).toContain("FeatureAccessError");
  });
});
