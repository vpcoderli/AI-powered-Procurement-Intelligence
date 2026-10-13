import { describe, expect, it } from "vitest";
import { BID_CHILD_REFERENCES } from "@/server/db/bid-child-references";
import { DEMO_PURGE_RELATIONSHIPS } from "./demo-purge";

// Two lists name every column that points at bids(id): the one the data migrations check before they re-key or delete a
// bid (BID_CHILD_REFERENCES), and the one the demo purge deletes through and verifies against (DEMO_PURGE_RELATIONSHIPS,
// whose parent is `bids` for the bid's own children). Each is pinned to the foreign keys SQLite declares by its own test,
// but the foreign keys are not what MySQL runs on: there neither list is enforced by the database. This test is what
// keeps the two from drifting apart, so that a table one of them forgets is found here and not as an orphan in MySQL.
describe("the columns that point at bids(id)", () => {
  it("are the same set for the data migrations and for the demo purge", () => {
    const forMigrations = new Set(BID_CHILD_REFERENCES.map(({ table, column }) => `${table}.${column}`));
    const forPurge = new Set(
      DEMO_PURGE_RELATIONSHIPS.filter((relationship) => relationship.parent === "bids").map(({ child, column }) => `${child}.${column}`),
    );

    expect([...forPurge].sort()).toEqual([...forMigrations].sort());
  });
});
