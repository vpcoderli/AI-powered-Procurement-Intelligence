import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { migrateLegacySavedBids } from "./migrate-saved-bids";

describe("legacy saved bids migration", () => {
  let testDb: TestDatabase;
  let tempDir: string;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
    tempDir = await mkdtemp(path.join(tmpdir(), "apsi-saved-bids-migration-"));
  });

  afterEach(async () => {
    await testDb.cleanup();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("imports legacy saved bid ids into sqlite and skips unknown bids", async () => {
    const legacyPath = path.join(tempDir, "saved-bids.json");
    await writeFile(
      legacyPath,
      JSON.stringify({
        users: {
          anon_a: ["1", "2", "missing"],
          anon_b: ["2", "2"],
        },
      }),
    );

    const result = await migrateLegacySavedBids(testDb.db, legacyPath);

    expect(result).toEqual({
      users: 2,
      savedBids: 3,
      skippedBidIds: 1,
    });
  });
});
