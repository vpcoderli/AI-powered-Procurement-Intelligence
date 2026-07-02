/**
 * S3-backed object storage provider built on the official AWS SDK v3
 * (`@aws-sdk/client-s3`).
 *
 * `./object-storage.ts` already ships a hand-rolled SigV4 REST client
 * (`createS3CompatibleProvider`) that talks to any S3-compatible endpoint
 * over plain `fetch` with zero runtime dependencies, and that path has
 * existing test coverage in `./object-storage.test.ts`. This module is an
 * additive alternative that uses the official AWS SDK client instead of
 * hand-rolled request signing, for deployments that specifically want the
 * SDK's retry/credential-provider-chain/checksum handling.
 *
 * Selection is controlled by `OBJECT_STORAGE_S3_CLIENT`:
 *   - unset or `rest` (default): `createObjectStorageProvider` returns the
 *     existing hand-rolled REST provider from `./object-storage.ts` (no
 *     behavior change, no new dependency required at runtime).
 *   - `aws-sdk`: `createObjectStorageProvider` returns the provider built in
 *     this file, which requires the `@aws-sdk/client-s3` package to be
 *     installed (see package.json `dependencies`).
 *
 * This provider conforms exactly to the `ObjectStorageProvider` interface
 * defined in `./object-storage.ts` and reuses the same key-safety,
 * checksum, and storage-path conventions (`s3://<bucket>/<key>`) as the
 * hand-rolled provider so callers (`@/server/artifacts/service.ts`,
 * `@/server/response-workspace/service.ts`) do not need to know which S3
 * client implementation is behind `ObjectStorageProvider`.
 */
import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  LocalObjectStorageIntegrityError,
  LocalObjectStoragePathError,
  type WritableBytes,
} from "./local-object-storage";
import type {
  ObjectStorageProvider,
  ObjectStoragePutInput,
  StoredObject,
  StoredObjectStat,
} from "./object-storage";

export class ObjectStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageConfigurationError";
  }
}

export class ObjectStorageUnavailableError extends Error {
  constructor(message = "S3 object storage request failed.") {
    super(message);
    this.name = "ObjectStorageUnavailableError";
  }
}

type ObjectStorageEnv = Record<string, string | undefined>;

interface ReadS3StoredObjectOptions {
  expectedByteSize?: number;
  expectedChecksumSha256?: string;
}

function value(env: ObjectStorageEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function toBuffer(bytes: WritableBytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  return Buffer.from(bytes);
}

function hashSha256(bytes: Buffer | string) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function assertSafeSegment(segment: string) {
  if (!segment || segment === "." || segment === "..") {
    throw new LocalObjectStoragePathError("Storage object key contains an unsafe segment.");
  }

  if (
    segment.includes("\0") ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.startsWith("/") ||
    segment.startsWith("\\")
  ) {
    throw new LocalObjectStoragePathError("Storage object key contains an unsafe segment.");
  }
}

function normalizeKey(segments: string[]) {
  for (const segment of segments) {
    assertSafeSegment(segment);
  }

  return segments.join("/");
}

function parseStoragePath(storagePath: string, bucket: string) {
  const prefix = `s3://${bucket}/`;
  if (!storagePath.startsWith(prefix)) {
    throw new LocalObjectStoragePathError("S3 storage path does not match the configured bucket.");
  }

  const key = storagePath.slice(prefix.length);
  if (!key) {
    throw new LocalObjectStoragePathError("S3 storage path is missing an object key.");
  }

  for (const segment of key.split("/")) {
    assertSafeSegment(segment);
  }

  return key;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  throw new ObjectStorageUnavailableError("Unrecognized S3 GetObject response body type.");
}

export interface S3ObjectStorageOptions {
  env?: ObjectStorageEnv;
  /** Injectable for tests; defaults to constructing a real `S3Client`. */
  client?: S3Client;
}

function assertRuntimeCredentials(env: ObjectStorageEnv) {
  const accessKeyId = value(env, "OBJECT_STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = value(env, "OBJECT_STORAGE_SECRET_ACCESS_KEY");
  const sessionToken = value(env, "OBJECT_STORAGE_SESSION_TOKEN");

  if (!accessKeyId || !secretAccessKey) {
    throw new ObjectStorageConfigurationError(
      "OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY are required for S3 object storage operations; inject them from runtime secrets and never commit them",
    );
  }

  return { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };
}

function buildClientConfig(env: ObjectStorageEnv): S3ClientConfig {
  const region = value(env, "OBJECT_STORAGE_REGION");
  const baseUrl = value(env, "OBJECT_STORAGE_BASE_URL");
  const { accessKeyId, secretAccessKey, sessionToken } = assertRuntimeCredentials(env);
  const forcePathStyle = value(env, "OBJECT_STORAGE_S3_FORCE_PATH_STYLE") === "1";

  return {
    region,
    endpoint: baseUrl || undefined,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey, sessionToken },
  };
}

/**
 * Creates an `ObjectStorageProvider` backed by `@aws-sdk/client-s3`.
 *
 * Requires `@aws-sdk/client-s3` to be installed (`npm install` after this
 * dependency is added to `package.json`); constructing the client will throw
 * at call time if the package cannot be resolved. Runtime AWS credentials
 * are read the same way as the hand-rolled REST provider
 * (`OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`,
 * optional `OBJECT_STORAGE_SESSION_TOKEN`), so both providers share the same
 * fail-closed credential posture and the same bucket/region/endpoint
 * configuration validated by `validateObjectStoragePreflight`.
 */
export function createS3ObjectStorageProvider(options: S3ObjectStorageOptions = {}): ObjectStorageProvider {
  const env = options.env ?? process.env;
  const bucket = value(env, "OBJECT_STORAGE_BUCKET");

  if (!bucket) {
    throw new ObjectStorageConfigurationError("OBJECT_STORAGE_BUCKET is required to create the S3 object storage provider.");
  }

  let cachedClient: S3Client | undefined = options.client;

  function client(): S3Client {
    if (cachedClient) return cachedClient;
    cachedClient = new S3Client(buildClientConfig(env));
    return cachedClient;
  }

  return {
    provider: "s3",
    async putObject(input: ObjectStoragePutInput): Promise<StoredObject> {
      const key = normalizeKey(input.key);
      const body = toBuffer(input.bytes);
      const checksumSha256 = hashSha256(body);

      try {
        await client().send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: input.contentType,
            ContentLength: body.byteLength,
            ChecksumSHA256: Buffer.from(checksumSha256, "hex").toString("base64"),
          }),
        );
      } catch (error) {
        throw new ObjectStorageUnavailableError(
          `S3 PutObject failed for bucket "${bucket}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return {
        provider: "s3",
        storagePath: `s3://${bucket}/${key}`,
        byteSize: body.byteLength,
        checksumSha256,
      };
    },
    async getObject(storagePath: string, options: ReadS3StoredObjectOptions = {}): Promise<Buffer> {
      const key = parseStoragePath(storagePath, bucket);

      let bytes: Buffer;
      try {
        const response = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        bytes = await streamToBuffer(response.Body);
      } catch (error) {
        throw new ObjectStorageUnavailableError(
          `S3 GetObject failed for bucket "${bucket}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (options.expectedByteSize !== undefined && bytes.byteLength !== options.expectedByteSize) {
        throw new LocalObjectStorageIntegrityError("Stored object byte size does not match the manifest.");
      }

      if (options.expectedChecksumSha256) {
        const actualChecksum = hashSha256(bytes);
        if (actualChecksum !== options.expectedChecksumSha256) {
          throw new LocalObjectStorageIntegrityError("Stored object checksum does not match the manifest.");
        }
      }

      return bytes;
    },
    async statObject(storagePath: string): Promise<StoredObjectStat> {
      const key = parseStoragePath(storagePath, bucket);

      try {
        const response = await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          storagePath,
          byteSize: response.ContentLength ?? 0,
          updatedAt: response.LastModified ? new Date(response.LastModified).toISOString() : undefined,
        };
      } catch (error) {
        throw new ObjectStorageUnavailableError(
          `S3 HeadObject failed for bucket "${bucket}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    async deleteObject(storagePath: string): Promise<void> {
      const key = parseStoragePath(storagePath, bucket);

      try {
        await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        throw new ObjectStorageUnavailableError(
          `S3 DeleteObject failed for bucket "${bucket}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
