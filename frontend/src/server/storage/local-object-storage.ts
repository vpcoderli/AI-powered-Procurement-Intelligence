import crypto from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export class LocalObjectStoragePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalObjectStoragePathError";
  }
}

export class LocalObjectStorageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalObjectStorageIntegrityError";
  }
}

interface LocalObjectStorageOptions {
  root: string;
}

export interface ReadLocalStoredObjectOptions {
  expectedByteSize?: number;
  expectedChecksumSha256?: string;
  expectedStorageRoot?: string;
}

export type WritableBytes = Buffer | Uint8Array | ArrayBuffer | string;

function assertSafeSegment(segment: string) {
  if (!segment || segment === "." || segment === "..") {
    throw new LocalObjectStoragePathError("Storage object key contains an unsafe segment.");
  }

  if (segment.includes("\0") || segment.includes("/") || segment.includes("\\") || path.isAbsolute(segment)) {
    throw new LocalObjectStoragePathError("Storage object key contains an unsafe segment.");
  }
}

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRoot(root: string) {
  if (typeof root !== "string" || !root.trim()) {
    throw new LocalObjectStoragePathError("Storage root is required.");
  }

  return path.resolve(root);
}

function normalizeStoragePath(storagePath: string, expectedStorageRoot?: string) {
  if (typeof storagePath !== "string" || !storagePath.trim()) {
    throw new LocalObjectStoragePathError("Storage path is required.");
  }

  const absolutePath = path.resolve(storagePath);
  if (expectedStorageRoot) {
    const root = normalizeRoot(expectedStorageRoot);
    if (!isInsideRoot(root, absolutePath)) {
      throw new LocalObjectStoragePathError("Storage path resolves outside the storage root.");
    }
  }

  return absolutePath;
}

function toBuffer(bytes: WritableBytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  return Buffer.from(bytes);
}

export function createLocalObjectStorage(options: LocalObjectStorageOptions) {
  const root = normalizeRoot(options.root);

  function resolveObjectPath(segments: string[]) {
    for (const segment of segments) {
      assertSafeSegment(segment);
    }

    const storagePath = path.resolve(root, ...segments);
    if (!isInsideRoot(root, storagePath)) {
      throw new LocalObjectStoragePathError("Storage object key resolves outside the storage root.");
    }

    return storagePath;
  }

  return {
    root,
    resolveObjectPath,
    async writeObject(segments: string[], bytes: WritableBytes) {
      const body = toBuffer(bytes);
      const storagePath = resolveObjectPath(segments);

      await mkdir(path.dirname(storagePath), { recursive: true });
      await writeFile(storagePath, body);

      return {
        storagePath,
        byteSize: body.byteLength,
        checksumSha256: crypto.createHash("sha256").update(body).digest("hex"),
      };
    },
    async readObject(storagePath: string, options: ReadLocalStoredObjectOptions = {}) {
      return readLocalStoredObject(storagePath, options);
    },
    async statObject(storagePath: string, options: Pick<ReadLocalStoredObjectOptions, "expectedStorageRoot"> = {}) {
      return statLocalStoredObject(storagePath, options);
    },
    async deleteObject(storagePath: string, options: Pick<ReadLocalStoredObjectOptions, "expectedStorageRoot"> = {}) {
      return deleteLocalStoredObject(storagePath, options);
    },
  };
}

export async function readLocalStoredObject(storagePath: string, options: ReadLocalStoredObjectOptions = {}) {
  const absolutePath = normalizeStoragePath(storagePath, options.expectedStorageRoot);
  const bytes = await readFile(/*turbopackIgnore: true*/ absolutePath);

  if (options.expectedByteSize !== undefined && bytes.byteLength !== options.expectedByteSize) {
    throw new LocalObjectStorageIntegrityError("Stored object byte size does not match the manifest.");
  }

  if (options.expectedChecksumSha256) {
    const actualChecksum = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualChecksum !== options.expectedChecksumSha256) {
      throw new LocalObjectStorageIntegrityError("Stored object checksum does not match the manifest.");
    }
  }

  return bytes;
}

export async function statLocalStoredObject(
  storagePath: string,
  options: Pick<ReadLocalStoredObjectOptions, "expectedStorageRoot"> = {},
) {
  const absolutePath = normalizeStoragePath(storagePath, options.expectedStorageRoot);
  const metadata = await stat(/*turbopackIgnore: true*/ absolutePath);

  return {
    storagePath: absolutePath,
    byteSize: metadata.size,
    updatedAt: metadata.mtime.toISOString(),
  };
}

export async function deleteLocalStoredObject(
  storagePath: string,
  options: Pick<ReadLocalStoredObjectOptions, "expectedStorageRoot"> = {},
) {
  const absolutePath = normalizeStoragePath(storagePath, options.expectedStorageRoot);
  await unlink(/*turbopackIgnore: true*/ absolutePath);
}
