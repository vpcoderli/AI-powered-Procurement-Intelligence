import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  getOrCreateResponseWorkspace,
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
      expect(updated.summary.done).toBe(1);
    } finally {
      await testDb.cleanup();
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
