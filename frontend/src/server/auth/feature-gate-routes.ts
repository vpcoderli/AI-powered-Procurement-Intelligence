import type { FeatureKey } from "./entitlements";

export interface FeatureApiCoverageEntry {
  sourcePath: `../../app/api/${string}/route.ts`;
  feature: FeatureKey;
  methods: readonly string[];
}

export const FEATURE_API_COVERAGE: readonly FeatureApiCoverageEntry[] = [
  {
    sourcePath: "../../app/api/intents/[id]/submission/route.ts",
    feature: "submission_guidance",
    methods: ["GET", "PATCH"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/submission/confirm/route.ts",
    feature: "submission_guidance",
    methods: ["POST"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/compliance/route.ts",
    feature: "compliance_manifest",
    methods: ["GET", "PATCH"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/decision/route.ts",
    feature: "pursue_no_bid",
    methods: ["GET", "PATCH"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/qa/route.ts",
    feature: "bid.brief.full.generate",
    methods: ["POST"],
  },
  {
    sourcePath: "../../app/api/knowledge/route.ts",
    feature: "knowledge_station",
    methods: ["GET", "POST"],
  },
] as const;

export const UNIMPLEMENTED_PAID_FEATURE_API_COVERAGE = [
  "quote_workflow",
  "compliance.manifest.generate",
  "readiness.review.run",
  "response.workspace.create",
  "artifact.vault.upload",
  "response.section.draft",
  "package.review.run",
  "amendment.delta.run",
  "award.tabulation.analyze",
  "price.to.win.run",
  "team.member.invite",
] as const satisfies readonly FeatureKey[];
