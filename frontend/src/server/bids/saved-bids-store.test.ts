import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSavedBidsStore,
  SavedBidsStoreCorruptError,
} from "./saved-bids-store";

describe("saved bids store", () => {
  let directory: string;
  let storePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "apsi-saved-bids-"));
    storePath = path.join(directory, "saved-bids.json");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("creates an empty store when the file is missing", async () => {
    const store = createSavedBidsStore({ filePath: storePath });

    expect(await store.getSavedBidIds("anon_a")).toEqual([]);
    expect(JSON.parse(await readFile(storePath, "utf8"))).toEqual({ users: {} });
  });

  it("saves bid ids idempotently for one user", async () => {
    const store = createSavedBidsStore({ filePath: storePath });

    expect(await store.saveBidId("anon_a", "1")).toEqual(["1"]);
    expect(await store.saveBidId("anon_a", "1")).toEqual(["1"]);
    expect(await store.saveBidId("anon_a", "2")).toEqual(["1", "2"]);
  });

  it("preserves concurrent saves for one user", async () => {
    const store = createSavedBidsStore({ filePath: storePath });

    await Promise.all([
      store.saveBidId("anon_a", "1"),
      store.saveBidId("anon_a", "2"),
    ]);

    expect(await store.getSavedBidIds("anon_a")).toEqual(["1", "2"]);
  });

  it("removes bid ids idempotently for one user", async () => {
    const store = createSavedBidsStore({ filePath: storePath });
    await store.saveBidId("anon_a", "1");

    expect(await store.removeBidId("anon_a", "1")).toEqual([]);
    expect(await store.removeBidId("anon_a", "1")).toEqual([]);
  });

  it("isolates saved ids between users", async () => {
    const store = createSavedBidsStore({ filePath: storePath });

    await store.saveBidId("anon_a", "1");
    await store.saveBidId("anon_b", "2");

    expect(await store.getSavedBidIds("anon_a")).toEqual(["1"]);
    expect(await store.getSavedBidIds("anon_b")).toEqual(["2"]);
  });

  it("preserves concurrent saves for different users", async () => {
    const store = createSavedBidsStore({ filePath: storePath });

    await Promise.all([
      store.saveBidId("anon_a", "1"),
      store.saveBidId("anon_b", "2"),
    ]);

    expect(await store.getSavedBidIds("anon_a")).toEqual(["1"]);
    expect(await store.getSavedBidIds("anon_b")).toEqual(["2"]);
  });

  it("rejects corrupt JSON without overwriting it", async () => {
    await writeFile(storePath, "{", "utf8");
    const store = createSavedBidsStore({ filePath: storePath });

    await expect(store.getSavedBidIds("anon_a")).rejects.toBeInstanceOf(
      SavedBidsStoreCorruptError,
    );
    expect(await readFile(storePath, "utf8")).toBe("{");
  });

  it("rejects an invalid root shape without overwriting it", async () => {
    await writeFile(storePath, JSON.stringify({ users: [] }), "utf8");
    const store = createSavedBidsStore({ filePath: storePath });

    await expect(store.getSavedBidIds("anon_a")).rejects.toBeInstanceOf(
      SavedBidsStoreCorruptError,
    );
    expect(JSON.parse(await readFile(storePath, "utf8"))).toEqual({ users: [] });
  });
});
