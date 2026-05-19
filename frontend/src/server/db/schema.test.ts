import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { runMigrations } from "./migrate";
import { bids, users } from "./schema";

describe("database schema", () => {
  let directory: string | undefined;
  let db: ReturnType<typeof createDatabase> | undefined;

  afterEach(async () => {
    db?.$client.close();
    db = undefined;

    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("creates core tables in an empty sqlite database", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "apsi-db-"));
    const databasePath = path.join(directory, "apsi.sqlite");
    db = createDatabase(databasePath);

    runMigrations(db);

    db.insert(users)
      .values({
        id: "anon_test",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      })
      .run();

    db.insert(bids)
      .values({
        id: "1",
        source: "SAM.gov",
        sourceBidId: "mock:1",
        dedupeKey: "mock:1",
        title: "Enterprise Cloud Migration Services",
        description: "Short description",
        amount: "$5M - $10M",
        issuerName: "DEPARTMENT OF DEFENSE",
        issuerType: "federal",
        stateCode: "US",
        sourceUrl: "https://sam.gov/example",
        isActive: 1,
        firstSeenAt: "2026-05-19T00:00:00.000Z",
        lastSeenAt: "2026-05-19T00:00:00.000Z",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      })
      .run();

    expect(db.select().from(users).all()).toHaveLength(1);
    expect(db.select().from(bids).all()).toHaveLength(1);
    expect(
      db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("idx_bids_dedupe_key"),
    ).toEqual({ name: "idx_bids_dedupe_key" });
  });
});
