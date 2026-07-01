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
    sourcePath: "../../app/api/intents/[id]/response-workspace/route.ts",
    feature: "response.workspace.create",
    methods: ["GET", "PATCH"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/response-workspace/comments/route.ts",
    feature: "response.workspace.create",
    methods: ["GET", "POST"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/response-workspace/package/route.ts",
    feature: "response.workspace.create",
    methods: ["GET", "POST"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/response-workspace/package/exports/route.ts",
    feature: "response.workspace.create",
    methods: ["POST"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.ts",
    feature: "response.workspace.create",
    methods: ["GET"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/artifacts/route.ts",
    feature: "artifact.vault.upload",
    methods: ["GET", "POST"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/artifacts/[artifactId]/route.ts",
    feature: "artifact.vault.upload",
    methods: ["GET"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/quotes/route.ts",
    feature: "quote_workflow",
    methods: ["GET", "POST", "PATCH"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/deadlines/route.ts",
    feature: "deadline_notifications",
    methods: ["GET", "PATCH"],
  },
  {
    sourcePath: "../../app/api/intents/[id]/award/route.ts",
    feature: "award.tabulation.analyze",
    methods: ["GET", "PATCH"],
  },
  {
    sourcePath: "../../app/api/account/deadline-reminders/route.ts",
    feature: "deadline_notifications",
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
  "compliance.manifest.generate",
  "readiness.review.run",
  "response.section.draft",
  "package.review.run",
  "amendment.delta.run",
  "price.to.win.run",
  "team.member.invite",
] as const satisfies readonly FeatureKey[];
