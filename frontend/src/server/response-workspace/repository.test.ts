import { describe, expect, it, vi } from "vitest";
import {
  createResponseWorkspaceActivityRowsFromMysql,
  createResponseWorkspaceCommentRowFromMysql,
  createResponseWorkspaceItemRowsFromMysql,
  createResponsePackageExportRowFromMysql,
  createResponsePackageExportReviewEventRowFromMysql,
  createResponsePackageSnapshotRowFromMysql,
  replaceResponseWorkspaceItemArtifactLinksFromMysql,
  findResponseWorkspaceItemRowFromMysql,
  listResponsePackageArtifactFileRowsFromMysql,
  listResponseWorkspaceActivityRowsFromMysql,
  listResponseWorkspaceLinkedArtifactRowsFromMysql,
  listResponseWorkspaceCommentRowsFromMysql,
  listResponseWorkspaceItemRowsFromMysql,
  listResponsePackageSnapshotRowsFromMysql,
  listResponsePackageExportRowsFromMysql,
  listResponsePackageExportReviewEventRowsFromMysql,
  markResponsePackageExportDownloadedRowFromMysql,
  updateResponsePackageExportReviewRowFromMysql,
  updateResponseWorkspaceItemRowFromMysql,
} from "./repository";

describe("response workspace repository MySQL runtime", () => {
  it("creates, finds, lists, and updates response workspace items", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const comments = new Map<string, Record<string, unknown>>();
    const activity = new Map<string, Record<string, unknown>>();
    const snapshots = new Map<string, Record<string, unknown>>();
    const packageExports = new Map<string, Record<string, unknown>>();
    const packageReviewEvents = new Map<string, Record<string, unknown>>();
    const artifacts = new Map<string, Record<string, unknown>>([
      ["artifact_1", {
        id: "artifact_1",
        intentId: "intent_1",
        userId: "user_1",
        itemId: "workspace_item_1",
        title: "Capability statement",
        artifactType: "capability_statement",
        purpose: "response_workspace",
        fileName: "capability.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        storagePath: "data/artifact-vault/user_1/intent_1/capability.pdf",
        checksumSha256: "hash_artifact_1",
        reviewStatus: "pending_review",
      }],
    ]);
    const links = new Map<string, Record<string, unknown>>();
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []): Promise<[unknown, unknown?]> => {
        if (sql.includes("INSERT INTO response_workspace_items")) {
          rows.set(values[0] as string, {
            id: values[0],
            intentId: values[1],
            bidId: values[2],
            userId: values[3],
            assignedUserId: values[4],
            kind: values[5],
            title: values[6],
            status: values[7],
            notes: values[8],
            dueAt: values[9],
            sortOrder: values[10],
            createdAt: values[11],
            updatedAt: values[12],
          });
        }

        if (sql.includes("INSERT INTO response_workspace_comments")) {
          comments.set(values[0] as string, {
            id: values[0],
            intentId: values[1],
            itemId: values[2],
            authorUserId: values[3],
            body: values[4],
            createdAt: values[5],
            updatedAt: values[6],
            authorDisplayName: "Response Owner",
            authorEmail: "owner@example.com",
          });
        }

        if (sql.includes("INSERT INTO response_workspace_activity")) {
          activity.set(values[0] as string, {
            id: values[0],
            intentId: values[1],
            itemId: values[2],
            actorUserId: values[3],
            eventType: values[4],
            fromValue: values[5],
            toValue: values[6],
            metadataJson: values[7],
            createdAt: values[8],
            actorDisplayName: "Response Owner",
            actorEmail: "owner@example.com",
          });
        }

        if (sql.includes("INSERT INTO response_package_snapshots")) {
          snapshots.set(values[0] as string, {
            id: values[0],
            intentId: values[1],
            bidId: values[2],
            userId: values[3],
            createdByUserId: values[4],
            title: values[5],
            outlineJson: values[6],
            readinessJson: values[7],
            createdAt: values[8],
          });
        }

        if (sql.includes("INSERT INTO response_package_exports")) {
          packageExports.set(values[0] as string, {
            id: values[0],
            snapshotId: values[1],
            intentId: values[2],
            bidId: values[3],
            userId: values[4],
            requestedByUserId: values[5],
            status: values[6],
            format: values[7],
            fileName: values[8],
            contentType: values[9],
            byteSize: values[10],
            storagePath: values[11],
            checksumSha256: values[12],
            readinessJson: values[13],
            createdAt: values[14],
            updatedAt: values[15],
            reviewStatus: values[16],
            reviewedAt: values[17],
            reviewedByUserId: values[18],
            reviewNotes: values[19],
            downloadedAt: null,
          });
        }

        if (sql.includes("INSERT INTO response_package_export_review_events")) {
          packageReviewEvents.set(values[0] as string, {
            id: values[0],
            exportId: values[1],
            snapshotId: values[2],
            intentId: values[3],
            bidId: values[4],
            userId: values[5],
            actorUserId: values[6],
            fromReviewStatus: values[7],
            toReviewStatus: values[8],
            reviewNotes: values[9],
            createdAt: values[10],
          });
        }

        if (sql.includes("DELETE FROM response_workspace_item_artifacts")) {
          for (const [key, row] of links) {
            if (row.itemId === values[0]) links.delete(key);
          }
        }

        if (sql.includes("INSERT INTO response_workspace_item_artifacts")) {
          links.set(`${values[0]}:${values[1]}`, {
            itemId: values[0],
            artifactId: values[1],
            createdAt: values[2],
          });
        }

        if (sql.includes("UPDATE response_workspace_items")) {
          const row = rows.get(values[5] as string);
          if (row) {
            row.status = values[0];
            row.notes = values[1];
            row.updatedAt = values[2];
          }
        }

        if (sql.includes("UPDATE response_package_exports") && sql.includes("SET review_status")) {
          const row = packageExports.get(values[7] as string);
          if (row) {
            row.reviewStatus = values[0];
            row.reviewedAt = values[1];
            row.reviewedByUserId = values[2];
            row.reviewNotes = values[3];
            row.updatedAt = values[4];
          }
        } else if (sql.includes("UPDATE response_package_exports")) {
          const row = packageExports.get(values[4] as string);
          if (row) {
            row.downloadedAt = values[0];
            row.updatedAt = values[1];
          }
        }

        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async (sql: string, values: unknown[] = []): Promise<[unknown[], unknown?]> => {
        if (sql.includes("FROM response_workspace_item_artifacts")) {
          return [
            [...links.values()]
              .filter((row) => values.includes(row.itemId))
              .map((row) => ({
                itemId: row.itemId,
                ...artifacts.get(row.artifactId as string),
              })),
            undefined,
          ];
        }

        if (sql.includes("FROM supplier_artifacts") && sql.includes("storage_path AS storagePath")) {
          return [
            [...artifacts.values()]
              .filter((row) =>
                row.userId === values[0] &&
                row.intentId === values[1] &&
                values.includes(row.id),
              )
              .map((row) => ({
                id: row.id,
                storagePath: row.storagePath,
                byteSize: row.byteSize,
                checksumSha256: row.checksumSha256,
              })),
            undefined,
          ];
        }

        if (sql.includes("FROM response_workspace_comments")) {
          return [
            [...comments.values()]
              .filter((row) => row.intentId === values[0] && row.itemId === values[1])
              .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))),
            undefined,
          ];
        }

        if (sql.includes("FROM response_workspace_activity")) {
          return [
            [...activity.values()]
              .filter((row) => values.includes(row.itemId))
              .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
            undefined,
          ];
        }

        if (sql.includes("FROM response_package_snapshots")) {
          return [
            [...snapshots.values()]
              .filter((row) => row.userId === values[0] && row.intentId === values[1])
              .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
            undefined,
          ];
        }

        if (sql.includes("FROM response_package_exports")) {
          return [
            [...packageExports.values()]
              .filter((row) => row.userId === values[0] && row.intentId === values[1])
              .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
            undefined,
          ];
        }

        if (sql.includes("FROM response_package_export_review_events")) {
          return [
            [...packageReviewEvents.values()]
              .filter((row) => row.userId === values[0] && row.intentId === values[1])
              .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))),
            undefined,
          ];
        }

        if (sql.includes("AND id = ?")) {
          return [
            [[...rows.values()].find((row) =>
              row.userId === values[0] &&
              row.intentId === values[1] &&
              row.id === values[2],
            )].filter(Boolean),
            undefined,
          ];
        }

        return [
          [...rows.values()]
            .filter((row) => row.userId === values[0] && row.intentId === values[1])
            .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder)),
          undefined,
        ];
      }),
    };

    await createResponseWorkspaceItemRowsFromMysql(mysql, {
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      timestamp: "2026-06-01T00:00:00.000Z",
      items: [
        {
          id: "workspace_item_1",
          kind: "task",
          title: "Draft response",
          status: "todo",
          notes: "",
          dueAt: null,
          sortOrder: 0,
        },
      ],
    });

    await expect(listResponseWorkspaceItemRowsFromMysql(mysql, "user_1", "intent_1")).resolves.toHaveLength(1);
    await expect(findResponseWorkspaceItemRowFromMysql(mysql, "user_1", "intent_1", "workspace_item_1")).resolves.toMatchObject({
      title: "Draft response",
    });
    await updateResponseWorkspaceItemRowFromMysql(mysql, "user_1", "intent_1", {
      itemId: "workspace_item_1",
      status: "done",
      notes: "Finished",
    }, "2026-06-01T00:01:00.000Z");
    await expect(findResponseWorkspaceItemRowFromMysql(mysql, "user_1", "intent_1", "workspace_item_1")).resolves.toMatchObject({
      status: "done",
      notes: "Finished",
    });
    await createResponseWorkspaceCommentRowFromMysql(mysql, {
      id: "comment_1",
      intentId: "intent_1",
      itemId: "workspace_item_1",
      authorUserId: "user_1",
      body: "Owner will confirm the pricing sheet.",
      timestamp: "2026-06-01T00:02:00.000Z",
    });
    await expect(listResponseWorkspaceCommentRowsFromMysql(mysql, "intent_1", "workspace_item_1")).resolves.toMatchObject([
      {
        body: "Owner will confirm the pricing sheet.",
        authorDisplayName: "Response Owner",
      },
    ]);
    await createResponseWorkspaceActivityRowsFromMysql(mysql, [{
      id: "activity_1",
      intentId: "intent_1",
      itemId: "workspace_item_1",
      actorUserId: "user_1",
      eventType: "status_changed",
      fromValue: "todo",
      toValue: "done",
      metadataJson: "{}",
      createdAt: "2026-06-01T00:02:30.000Z",
    }]);
    await expect(listResponseWorkspaceActivityRowsFromMysql(mysql, ["workspace_item_1"])).resolves.toMatchObject([
      {
        eventType: "status_changed",
        actorDisplayName: "Response Owner",
        fromValue: "todo",
        toValue: "done",
      },
    ]);
    await replaceResponseWorkspaceItemArtifactLinksFromMysql(mysql, {
      itemId: "workspace_item_1",
      artifactIds: ["artifact_1"],
      timestamp: "2026-06-01T00:03:00.000Z",
    });
    await expect(listResponseWorkspaceLinkedArtifactRowsFromMysql(mysql, ["workspace_item_1"])).resolves.toMatchObject([
      {
        itemId: "workspace_item_1",
        id: "artifact_1",
        title: "Capability statement",
        fileName: "capability.pdf",
        contentType: "application/pdf",
        checksumSha256: "hash_artifact_1",
      },
    ]);
    await expect(listResponsePackageArtifactFileRowsFromMysql(
      mysql,
      "user_1",
      "intent_1",
      ["artifact_1"],
    )).resolves.toEqual([
      {
        id: "artifact_1",
        storagePath: "data/artifact-vault/user_1/intent_1/capability.pdf",
        byteSize: 1024,
        checksumSha256: "hash_artifact_1",
      },
    ]);

    await createResponsePackageSnapshotRowFromMysql(mysql, {
      id: "snapshot_1",
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      createdByUserId: "user_1",
      title: "Draft package",
      outlineJson: JSON.stringify([{ id: "workspace_item_1", title: "Draft response" }]),
      readinessJson: JSON.stringify({ ready: false, missingArtifactLinks: 0 }),
      createdAt: "2026-06-01T00:04:00.000Z",
    });
    await expect(listResponsePackageSnapshotRowsFromMysql(mysql, "user_1", "intent_1")).resolves.toMatchObject([
      {
        id: "snapshot_1",
        title: "Draft package",
        outlineJson: expect.stringContaining("Draft response"),
      },
    ]);
    await createResponsePackageExportRowFromMysql(mysql, {
      id: "export_1",
      snapshotId: "snapshot_1",
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      requestedByUserId: "user_1",
      status: "ready",
      format: "markdown",
      fileName: "response-package.md",
      contentType: "text/markdown; charset=utf-8",
      byteSize: 100,
      storagePath: "data/response-package-exports/response-package.md",
      checksumSha256: "hash_export_1",
      readinessJson: JSON.stringify({ ready: false }),
      createdAt: "2026-06-01T00:05:00.000Z",
      updatedAt: "2026-06-01T00:05:00.000Z",
    });
    await expect(listResponsePackageExportRowsFromMysql(mysql, "user_1", "intent_1")).resolves.toMatchObject([
      {
        id: "export_1",
        snapshotId: "snapshot_1",
        format: "markdown",
        fileName: "response-package.md",
        byteSize: 100,
        reviewStatus: "pending_review",
        reviewedAt: null,
        reviewedByUserId: null,
        reviewNotes: "",
        downloadedAt: null,
      },
    ]);
    await markResponsePackageExportDownloadedRowFromMysql(
      mysql,
      "user_1",
      "intent_1",
      "export_1",
      "2026-06-01T00:06:00.000Z",
    );
    await expect(listResponsePackageExportRowsFromMysql(mysql, "user_1", "intent_1")).resolves.toMatchObject([
      {
        id: "export_1",
        downloadedAt: "2026-06-01T00:06:00.000Z",
      },
    ]);
    await updateResponsePackageExportReviewRowFromMysql(
      mysql,
      "user_1",
      "intent_1",
      "export_1",
      {
        reviewStatus: "needs_changes",
        reviewedAt: "2026-06-01T00:07:00.000Z",
        reviewedByUserId: "user_1",
        reviewNotes: "Add pricing backup.",
      },
    );
    await createResponsePackageExportReviewEventRowFromMysql(mysql, {
      id: "export_review_event_1",
      exportId: "export_1",
      snapshotId: "snapshot_1",
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      actorUserId: "user_1",
      fromReviewStatus: "pending_review",
      toReviewStatus: "needs_changes",
      reviewNotes: "Add pricing backup.",
      createdAt: "2026-06-01T00:07:00.000Z",
    });
    await expect(listResponsePackageExportRowsFromMysql(mysql, "user_1", "intent_1")).resolves.toMatchObject([
      {
        id: "export_1",
        reviewStatus: "needs_changes",
        reviewedAt: "2026-06-01T00:07:00.000Z",
        reviewedByUserId: "user_1",
        reviewNotes: "Add pricing backup.",
      },
    ]);
    await expect(listResponsePackageExportReviewEventRowsFromMysql(mysql, "user_1", "intent_1")).resolves.toMatchObject([
      {
        id: "export_review_event_1",
        exportId: "export_1",
        fromReviewStatus: "pending_review",
        toReviewStatus: "needs_changes",
        reviewNotes: "Add pricing backup.",
      },
    ]);
  });
});
