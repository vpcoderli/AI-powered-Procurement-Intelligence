import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalObjectStorage,
  LocalObjectStorageIntegrityError,
  LocalObjectStoragePathError,
  readLocalStoredObject,
} from "./local-object-storage";

describe("local object storage", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "local-object-storage-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("rejects object keys that try to leave the storage root", async () => {
    const storage = createLocalObjectStorage({ root });

    await expect(storage.writeObject(["user_1", "..", "outside.txt"], Buffer.from("secret")))
      .rejects.toBeInstanceOf(LocalObjectStoragePathError);
  });

  it("verifies byte size and checksum when reading a stored object", async () => {
    const storage = createLocalObjectStorage({ root });
    const stored = await storage.writeObject(["user_1", "artifact.txt"], Buffer.from("trusted content"));

    await expect(readLocalStoredObject(stored.storagePath, {
      expectedByteSize: 999,
      expectedChecksumSha256: crypto.createHash("sha256").update("trusted content").digest("hex"),
    })).rejects.toBeInstanceOf(LocalObjectStorageIntegrityError);

    await expect(readLocalStoredObject(stored.storagePath, {
      expectedByteSize: "trusted content".length,
      expectedChecksumSha256: crypto.createHash("sha256").update("tampered content").digest("hex"),
    })).rejects.toBeInstanceOf(LocalObjectStorageIntegrityError);
  });
});
