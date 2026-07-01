import { describe, expect, it, vi } from "vitest";
import {
  createSubmissionConfirmationRowFromMysql,
  createSubmissionPathRowFromMysql,
  findSubmissionEvidenceAwardOutcomeRowFromMysql,
  findSubmissionPathByIntentFromMysql,
  listSubmissionEvidenceLinkedSupplierArtifactRowsFromMysql,
  listSubmissionEvidenceResponsePackageExportRowsFromMysql,
  listSubmissionConfirmationRowsFromMysql,
  updateSubmissionPathRowFromMysql,
} from "./repository";

describe("submission repository MySQL runtime", () => {
  it("creates, updates, and lists submission guidance and confirmations", async () => {
    const paths = new Map<string, Record<string, unknown>>();
    const confirmations = new Map<string, Record<string, unknown>>();
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT IGNORE INTO submission_paths")) {
          paths.set(values[1] as string, {
            id: values[0],
            intentId: values[1],
            bidId: values[2],
            userId: values[3],
            method: values[4],
            status: values[5],
            portalUrl: values[6],
            contactEmail: values[7],
            requiresRegistration: values[8],
            requiresPhysicalDelivery: values[9],
            requiresAddendaAcknowledgement: values[10],
            complexityScore: values[11],
            guidanceText: values[12],
            readinessChecklistJson: values[13],
            riskFlagsJson: values[14],
            createdAt: values[15],
            updatedAt: values[16],
          });
        }

        if (sql.includes("UPDATE submission_paths")) {
          const row = paths.get(values.at(-1) as string);
          if (row) {
            for (let index = 0; index < values.length - 2; index += 1) {
              if (sql.includes("method = ?") && index === 0) row.method = values[index];
              if (sql.includes("portal_url = ?") && values[index] === "") row.portalUrl = values[index];
              if (sql.includes("status = ?") && values[index] === "ready") row.status = values[index];
            }
            row.updatedAt = values.at(-3);
          }
        }

        if (sql.includes("INSERT INTO submission_confirmations")) {
          confirmations.set(values[0] as string, {
            id: values[0],
            intentId: values[1],
            userId: values[2],
            submittedAt: values[3],
            method: values[4],
            confirmationReference: values[5],
            confirmationNotes: values[6],
            createdAt: values[7],
            updatedAt: values[8],
          });
        }

        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM submission_confirmations") && sql.includes("WHERE id = ?")) {
          return [[[...confirmations.values()].find((row) => row.id === values[0])].filter(Boolean), undefined];
        }

        if (sql.includes("FROM submission_confirmations")) {
          return [
            [...confirmations.values()].filter((row) => row.userId === values[0] && row.intentId === values[1]),
            undefined,
          ];
        }

        return [
          [[...paths.values()].find((row) => row.userId === values[0] && row.intentId === values[1])].filter(Boolean),
          undefined,
        ];
      }),
    };

    const created = await createSubmissionPathRowFromMysql(mysql, {
      id: "path_1",
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      timestamp: "2026-06-01T00:00:00.000Z",
      guidance: {
        method: "portal",
        portalUrl: "https://example.com/submit",
        contactEmail: "",
        requiresRegistration: true,
        requiresPhysicalDelivery: false,
        requiresAddendaAcknowledgement: true,
        complexityScore: 2,
        guidanceText: "Submit through portal.",
        readinessChecklist: ["Create account"],
        riskFlags: [],
      },
    });

    expect(created).toMatchObject({ id: "path_1", requiresRegistration: 1, status: "draft" });
    await expect(findSubmissionPathByIntentFromMysql(mysql, "user_1", "intent_1")).resolves.toMatchObject({
      portalUrl: "https://example.com/submit",
      status: "draft",
    });
    await expect(updateSubmissionPathRowFromMysql(mysql, "user_1", "intent_1", {
      method: "email",
      portalUrl: "",
      status: "ready",
    }, "2026-06-01T00:01:00.000Z")).resolves.toMatchObject({ method: "email", portalUrl: "", status: "ready" });

    const confirmation = await createSubmissionConfirmationRowFromMysql(mysql, {
      id: "confirmation_1",
      intentId: "intent_1",
      userId: "user_1",
      submittedAt: "2026-06-01T01:00:00.000Z",
      method: "email",
      confirmationReference: "REF-1",
      confirmationNotes: "Accepted",
      timestamp: "2026-06-01T01:01:00.000Z",
    });

    expect(confirmation).toMatchObject({ id: "confirmation_1", confirmationReference: "REF-1" });
    await expect(listSubmissionConfirmationRowsFromMysql(mysql, "user_1", "intent_1")).resolves.toHaveLength(1);
  });

  it("lists MySQL submission evidence read model rows by user and intent", async () => {
    const mysql = {
      execute: vi.fn(),
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM response_package_exports")) {
          expect(values).toEqual(["user_1", "intent_1"]);
          return [[{
            id: "response_package_export_1",
            intentId: "intent_1",
            format: "zip",
          }], undefined];
        }

        if (sql.includes("FROM response_workspace_item_artifacts")) {
          expect(sql).toContain("supplier_artifacts.user_id = ?");
          expect(sql).toContain("supplier_artifacts.intent_id = ?");
          expect(values).toEqual(["user_1", "intent_1", "user_1", "intent_1"]);
          return [[{
            id: "supplier_artifact_1",
            title: "Signed capability statement",
            fileName: "capability.pdf",
          }], undefined];
        }

        if (sql.includes("FROM award_outcomes")) {
          expect(values).toEqual(["user_1", "intent_1"]);
          return [[{
            status: "awarded_to_us",
            awardNoticeUrl: "https://sam.gov/award/notice",
          }], undefined];
        }

        return [[], undefined];
      }),
    };

    await expect(listSubmissionEvidenceResponsePackageExportRowsFromMysql(
      mysql,
      "user_1",
      "intent_1",
    )).resolves.toEqual([{
      id: "response_package_export_1",
      intentId: "intent_1",
      format: "zip",
    }]);
    await expect(listSubmissionEvidenceLinkedSupplierArtifactRowsFromMysql(
      mysql,
      "user_1",
      "intent_1",
    )).resolves.toEqual([{
      id: "supplier_artifact_1",
      title: "Signed capability statement",
      fileName: "capability.pdf",
    }]);
    await expect(findSubmissionEvidenceAwardOutcomeRowFromMysql(
      mysql,
      "user_1",
      "intent_1",
    )).resolves.toEqual({
      status: "awarded_to_us",
      awardNoticeUrl: "https://sam.gov/award/notice",
    });
  });
});
