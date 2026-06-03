import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  intentToBid,
  responsePackageExports,
  responsePackageSnapshots,
  responseWorkspaceItems,
  users,
} from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { listDashboardPipelineInsights } from "./pipeline";

describe("dashboard pipeline insights", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("summarizes response workspace readiness from existing package and workspace rows", () => {
    testDb.db
      .insert(users)
      .values({
        id: "other_seed",
        email: "other@example.com",
        passwordHash: "hash",
        displayName: "Other User",
        role: "user",
        accountTier: "free",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      })
      .run();
    testDb.db
      .insert(intentToBid)
      .values([
        {
          id: "intent_pipeline_ready",
          userId: "anon_seed",
          bidId: "1",
          status: "pursuit_decision_needed",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "intent_pipeline_blocked",
          userId: "anon_seed",
          bidId: "2",
          status: "questions_needed",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "intent_pipeline_other_user",
          userId: "other_seed",
          bidId: "3",
          status: "pursuit_decision_needed",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ])
      .run();
    testDb.db
      .insert(responseWorkspaceItems)
      .values([
        {
          id: "item_done",
          intentId: "intent_pipeline_ready",
          bidId: "1",
          userId: "anon_seed",
          kind: "outline_section",
          title: "Technical approach",
          status: "done",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "item_blocked",
          intentId: "intent_pipeline_blocked",
          bidId: "2",
          userId: "anon_seed",
          kind: "artifact",
          title: "Past performance",
          status: "blocked",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "item_other_user",
          intentId: "intent_pipeline_other_user",
          bidId: "3",
          userId: "other_seed",
          kind: "outline_section",
          title: "Other user",
          status: "blocked",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ])
      .run();
    testDb.db
      .insert(responsePackageSnapshots)
      .values([
        {
          id: "snapshot_ready",
          intentId: "intent_pipeline_ready",
          bidId: "1",
          userId: "anon_seed",
          createdByUserId: "anon_seed",
          title: "Ready package",
          outlineJson: "[]",
          readinessJson: JSON.stringify({
            ready: true,
            blockedItems: 0,
            missingArtifactLinks: 0,
            openItems: 0,
          }),
          createdAt: "2026-06-01T00:01:00.000Z",
        },
        {
          id: "snapshot_blocked",
          intentId: "intent_pipeline_blocked",
          bidId: "2",
          userId: "anon_seed",
          createdByUserId: "anon_seed",
          title: "Blocked package",
          outlineJson: "[]",
          readinessJson: JSON.stringify({
            ready: false,
            blockedItems: 2,
            missingArtifactLinks: 3,
            openItems: 4,
          }),
          createdAt: "2026-06-01T00:02:00.000Z",
        },
        {
          id: "snapshot_other_user",
          intentId: "intent_pipeline_other_user",
          bidId: "3",
          userId: "other_seed",
          createdByUserId: "other_seed",
          title: "Other user package",
          outlineJson: "[]",
          readinessJson: JSON.stringify({
            ready: true,
            blockedItems: 0,
            missingArtifactLinks: 0,
            openItems: 0,
          }),
          createdAt: "2026-06-01T00:03:00.000Z",
        },
      ])
      .run();
    testDb.db
      .insert(responsePackageExports)
      .values({
        id: "export_ready",
        snapshotId: "snapshot_ready",
        intentId: "intent_pipeline_ready",
        bidId: "1",
        userId: "anon_seed",
        requestedByUserId: "anon_seed",
        status: "ready",
        fileName: "response-package.md",
        contentType: "text/markdown; charset=utf-8",
        byteSize: 128,
        storagePath: "data/response-package-exports/response-package.md",
        checksumSha256: "hash_export_ready",
        readinessJson: "{}",
        createdAt: "2026-06-01T00:04:00.000Z",
        updatedAt: "2026-06-01T00:04:00.000Z",
      })
      .run();

    expect(listDashboardPipelineInsights(testDb.db, "anon_seed")).toEqual({
      workspaceItems: 2,
      blockedItems: 3,
      openItems: 4,
      missingArtifactLinks: 3,
      readyPackages: 1,
      exportedPackages: 1,
    });
  });
});
