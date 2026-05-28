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
] as const;

export const UNIMPLEMENTED_PAID_FEATURE_API_COVERAGE = [
  "quote_workflow",
  "knowledge_station",
] as const satisfies readonly FeatureKey[];
