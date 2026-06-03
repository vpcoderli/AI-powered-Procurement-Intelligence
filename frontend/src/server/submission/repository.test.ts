import { describe, expect, it, vi } from "vitest";
import {
  createSubmissionConfirmationRowFromMysql,
  createSubmissionPathRowFromMysql,
  findSubmissionPathByIntentFromMysql,
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
            portalUrl: values[5],
            contactEmail: values[6],
            requiresRegistration: values[7],
            requiresPhysicalDelivery: values[8],
            requiresAddendaAcknowledgement: values[9],
            complexityScore: values[10],
            guidanceText: values[11],
            readinessChecklistJson: values[12],
            riskFlagsJson: values[13],
            createdAt: values[14],
            updatedAt: values[15],
          });
        }

        if (sql.includes("UPDATE submission_paths")) {
          const row = paths.get(values[4] as string);
          if (row) {
            row.method = values[0];
            row.portalUrl = values[1];
            row.updatedAt = values[2];
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

    expect(created).toMatchObject({ id: "path_1", requiresRegistration: 1 });
    await expect(findSubmissionPathByIntentFromMysql(mysql, "user_1", "intent_1")).resolves.toMatchObject({
      portalUrl: "https://example.com/submit",
    });
    await expect(updateSubmissionPathRowFromMysql(mysql, "user_1", "intent_1", {
      method: "email",
      portalUrl: "",
    }, "2026-06-01T00:01:00.000Z")).resolves.toMatchObject({ method: "email", portalUrl: "" });

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
});
