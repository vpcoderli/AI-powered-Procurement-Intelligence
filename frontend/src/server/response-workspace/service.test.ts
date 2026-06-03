import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { organizationMemberships, organizations, supplierArtifacts, users } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  createResponseWorkspaceComment,
  createResponsePackageExport,
  createResponsePackageSnapshot,
  getResponsePackageExportFile,
  getResponsePackageWorkspace,
  getOrCreateResponseWorkspace,
  listResponseWorkspaceComments,
  ResponseWorkspaceValidationError,
  updateResponseWorkspaceItem,
} from "./service";

describe("response workspace service", () => {
  it("seeds grouped response workspace items for an intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);

      expect(workspace.intentId).toBe(intent.id);
      expect(workspace.bidId).toBe(intent.bid.id);
      expect(workspace.items.length).toBeGreaterThanOrEqual(10);
      expect(workspace.summary.total).toBe(workspace.items.length);
      expect(workspace.summary.tasks).toBeGreaterThan(0);
      expect(workspace.summary.checkpoints).toBeGreaterThan(0);
      expect(workspace.summary.artifacts).toBeGreaterThan(0);
      expect(workspace.summary.outlineSections).toBeGreaterThan(0);
      expect(workspace.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
        "task",
        "checkpoint",
        "artifact",
        "outline_section",
      ]));
    } finally {
      await testDb.cleanup();
    }
  });

  it("updates status and notes for existing workspace items", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "task")!;

      const updated = await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        status: "done",
        notes: "Initial draft finished.",
      });
      const updatedItem = updated.items.find((item) => item.id === target.id);

      expect(updatedItem).toEqual(expect.objectContaining({
        status: "done",
        notes: "Initial draft finished.",
      }));
      expect(updatedItem?.activity).toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: "status_changed",
          actorUserId: "anon_seed",
          fromValue: target.status,
          toValue: "done",
        }),
        expect.objectContaining({
          eventType: "notes_updated",
          actorUserId: "anon_seed",
          fromValue: target.notes,
          toValue: "Initial draft finished.",
        }),
      ]));
      expect(updated.summary.done).toBe(1);
    } finally {
      await testDb.cleanup();
    }
  });

  it("links supplier artifacts that belong to the same response workspace intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "artifact") ?? workspace.items[0];

      testDb.db.insert(supplierArtifacts).values({
        id: "response_artifact_1",
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        title: "Capability statement",
        artifactType: "capability_statement",
        purpose: "response_workspace",
        fileName: "capability.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        storagePath: "data/artifact-vault/capability.pdf",
        checksumSha256: "hash_response_artifact_1",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      const updated = await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        linkedArtifactIds: ["response_artifact_1"],
      });
      const updatedItem = updated.items.find((item) => item.id === target.id);

      expect(updatedItem?.linkedArtifacts).toEqual([
        {
          id: "response_artifact_1",
          title: "Capability statement",
          fileName: "capability.pdf",
          artifactType: "capability_statement",
          purpose: "response_workspace",
          downloadUrl: `/api/intents/${encodeURIComponent(intent.id)}/artifacts/response_artifact_1`,
        },
      ]);
      expect(updatedItem?.activity).toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: "linked_artifacts_updated",
          actorUserId: "anon_seed",
          toValue: "response_artifact_1",
        }),
      ]));
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects linked supplier artifacts outside the same response workspace intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const otherIntent = await createIntentForBid(testDb.db, "anon_seed", "2");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);

      testDb.db.insert(supplierArtifacts).values({
        id: "other_intent_artifact_1",
        intentId: otherIntent.id,
        bidId: otherIntent.bid.id,
        userId: "anon_seed",
        title: "Wrong intent artifact",
        artifactType: "response_asset",
        purpose: "response_workspace",
        fileName: "wrong.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        storagePath: "data/artifact-vault/wrong.pdf",
        checksumSha256: "hash_wrong_artifact_1",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      await expect(updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: workspace.items[0].id,
        linkedArtifactIds: ["other_intent_artifact_1"],
      })).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("assigns response workspace items to active workspace members", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db.insert(users).values({
        id: "response_member_1",
        email: "response-member@example.com",
        displayName: "Response Member",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(organizations).values({
        id: "response_org_1",
        name: "Response Org",
        accountTier: "business",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(organizationMemberships).values([
        {
          organizationId: "response_org_1",
          userId: "anon_seed",
          role: "owner",
          status: "active",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          organizationId: "response_org_1",
          userId: "response_member_1",
          role: "member",
          status: "active",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ]).run();

      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "task")!;

      const updated = await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        assignedUserId: "response_member_1",
      });
      const updatedItem = updated.items.find((item) => item.id === target.id);

      expect(updatedItem).toEqual(expect.objectContaining({
        assignedUserId: "response_member_1",
        assignedUser: expect.objectContaining({
          userId: "response_member_1",
          displayName: "Response Member",
          email: "response-member@example.com",
        }),
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects assignment to users outside the active workspace", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db.insert(users).values({
        id: "external_user_1",
        email: "external@example.com",
        displayName: "External User",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);

      await expect(updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: workspace.items[0].id,
        assignedUserId: "external_user_1",
      })).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("adds and lists comments for a response workspace item", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "task")!;

      const created = await createResponseWorkspaceComment(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        body: "Please confirm technical staffing assumptions.",
      });
      const comments = await listResponseWorkspaceComments(testDb.db, "anon_seed", intent.id, target.id);

      expect(created).toEqual(expect.objectContaining({
        itemId: target.id,
        authorUserId: "anon_seed",
        body: "Please confirm technical staffing assumptions.",
      }));
      expect(comments).toHaveLength(1);
      expect(comments[0]).toEqual(expect.objectContaining({
        id: created.id,
        author: expect.objectContaining({ userId: "anon_seed" }),
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("summarizes response package readiness from outline sections and artifacts", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outline = workspace.items.find((item) => item.kind === "outline_section")!;
      const artifact = workspace.items.find((item) => item.kind === "artifact")!;

      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: outline.id,
        status: "done",
        notes: "Section content drafted.",
      });

      const packageWorkspace = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);

      expect(packageWorkspace.outline.map((section) => section.id)).toContain(outline.id);
      expect(packageWorkspace.readiness.totalOutlineSections).toBeGreaterThan(0);
      expect(packageWorkspace.readiness.completedOutlineSections).toBe(1);
      expect(packageWorkspace.readiness.artifactPlaceholders).toBeGreaterThan(0);
      expect(packageWorkspace.readiness.missingArtifactLinks).toBeGreaterThanOrEqual(1);
      expect(packageWorkspace.readiness.ready).toBe(false);
      expect(packageWorkspace.readiness.openItems).toBe(
        packageWorkspace.workspace.items.filter((item) => item.status !== "done").length,
      );
      expect(packageWorkspace.workspace.items.map((item) => item.id)).toContain(artifact.id);
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates versioned response package snapshots from the current workspace state", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outline = workspace.items.find((item) => item.kind === "outline_section")!;

      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: outline.id,
        status: "done",
        notes: "Snapshot-ready technical section.",
      });

      const created = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 1",
      });
      const refreshed = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);

      expect(created.snapshot).toEqual(expect.objectContaining({
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        createdByUserId: "anon_seed",
        title: "Draft package 1",
      }));
      expect(created.snapshot.outline).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: outline.id,
          title: outline.title,
          notes: "Snapshot-ready technical section.",
          status: "done",
        }),
      ]));
      expect(created.snapshot.readiness.completedOutlineSections).toBe(1);
      expect(refreshed.snapshots[0]).toEqual(expect.objectContaining({
        id: created.snapshot.id,
        title: "Draft package 1",
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("exports a response package snapshot to a downloadable markdown file", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-export-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Exportable package",
      });

      const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshotResult.snapshot.id,
      }, { storageRoot: directory });
      const file = await getResponsePackageExportFile(testDb.db, "anon_seed", intent.id, result.exportRecord.id);
      const markdown = await readFile(file.storagePath, "utf8");

      expect(result.exportRecord).toEqual(expect.objectContaining({
        snapshotId: snapshotResult.snapshot.id,
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        status: "ready",
        contentType: "text/markdown; charset=utf-8",
        downloadUrl: `/api/intents/${encodeURIComponent(intent.id)}/response-workspace/package/exports/${result.exportRecord.id}`,
      }));
      expect(markdown).toContain("# Exportable package");
      expect(markdown).toContain("## Readiness");
      expect(markdown).toContain("## Outline");
      expect(file.fileName.endsWith(".md")).toBe(true);
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects unsupported status values", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);

      await expect(updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: workspace.items[0].id,
        status: "waiting" as never,
      })).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
    } finally {
      await testDb.cleanup();
    }
  });
});
