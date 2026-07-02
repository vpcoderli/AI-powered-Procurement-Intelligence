import crypto from "node:crypto";
import path from "node:path";
import {
  createLocalObjectStorage,
  deleteLocalStoredObject,
  readLocalStoredObject,
  statLocalStoredObject,
  type ReadLocalStoredObjectOptions,
  type WritableBytes,
  LocalObjectStorageIntegrityError,
  LocalObjectStoragePathError,
} from "./local-object-storage";
import { resolveMalwareScanner, type MalwareScanner, type MalwareScanResult } from "./malware-scan";

export {
  LocalObjectStorageIntegrityError as ObjectStorageIntegrityError,
  LocalObjectStoragePathError as ObjectStoragePathError,
};
export { resolveMalwareScanner, type MalwareScanner, type MalwareScanResult } from "./malware-scan";

type ObjectStorageEnv = Record<string, string | undefined>;

export type ObjectStorageProviderName = "local" | "s3";

export interface ObjectStoragePutInput {
  key: string[];
  bytes: WritableBytes;
  contentType?: string;
}

export interface StoredObject {
  provider: ObjectStorageProviderName;
  storagePath: string;
  byteSize: number;
  checksumSha256: string;
}

export interface StoredObjectStat {
  storagePath: string;
  byteSize: number;
  updatedAt?: string;
}

export interface ObjectStorageProvider {
  provider: ObjectStorageProviderName;
  putObject(input: ObjectStoragePutInput): Promise<StoredObject>;
  getObject(storagePath: string, options?: ReadLocalStoredObjectOptions): Promise<Buffer>;
  statObject(
    storagePath: string,
    options?: Pick<ReadLocalStoredObjectOptions, "expectedStorageRoot">,
  ): Promise<StoredObjectStat>;
  deleteObject(
    storagePath: string,
    options?: Pick<ReadLocalStoredObjectOptions, "expectedStorageRoot">,
  ): Promise<void>;
}

export interface ObjectStorageProviderOptions {
  env?: ObjectStorageEnv;
  localRoot?: string;
  /**
   * Enables a putObject-level malware scan wrapper around the returned
   * provider. Off by default (existing callers, including
   * `@/server/artifacts/service.ts`, run their own scan upstream of
   * `putObject` today and would otherwise scan the same bytes twice — see
   * `./malware-scan.ts`). Set to `true` to have `createObjectStorageProvider`
   * resolve a scanner itself via `resolveMalwareScanner(env)`, or pass
   * `malwareScanner` to inject a specific implementation (this implies
   * `enableMalwareScan: true`).
   */
  enableMalwareScan?: boolean;
  /**
   * Explicit malware scanner to wrap `putObject` with. Implies
   * `enableMalwareScan: true`. When omitted and `enableMalwareScan` is
   * `true`, falls back to `resolveMalwareScanner(env)`.
   */
  malwareScanner?: MalwareScanner;
}

export class ObjectStorageMalwareScanError extends Error {
  constructor(
    message: string,
    public readonly scanResult: MalwareScanResult,
  ) {
    super(message);
    this.name = "ObjectStorageMalwareScanError";
  }
}

export interface ObjectStoragePreflightResult {
  provider: ObjectStorageProviderName;
  strictMode: boolean;
  localAllowedByOverride: boolean;
  s3?: {
    bucket: "configured";
    region: "configured";
    baseUrl: "configured";
    credentialsRef: "configured";
    publicAccess?: "private";
    signedUrlMode?: "configured";
    cdnUrl?: "configured";
    malwareScanner?: "configured";
    retentionPolicy?: "configured";
    stagingSmokeEvidence?: "configured";
  };
}

export class ObjectStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageConfigurationError";
  }
}

export class ObjectStorageUnavailableError extends Error {
  constructor(message = "S3-compatible object storage operations are not implemented in this release.") {
    super(message);
    this.name = "ObjectStorageUnavailableError";
  }
}

const productionLikeValues = new Set(["production", "prod", "staging"]);
const emptyPayloadHash = crypto.createHash("sha256").update("").digest("hex");

function value(env: ObjectStorageEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function isProductionLikeRuntime(env: ObjectStorageEnv) {
  return [
    value(env, "NODE_ENV"),
    value(env, "APP_ENV"),
    value(env, "DEPLOY_ENV"),
    value(env, "VERCEL_ENV"),
    value(env, "RUNTIME_ENV"),
  ].some((raw) => productionLikeValues.has(raw.toLowerCase()));
}

function resolveProviderName(env: ObjectStorageEnv, errors: string[]): ObjectStorageProviderName {
  const raw = value(env, "OBJECT_STORAGE_PROVIDER").toLowerCase();
  if (!raw) return "local";
  if (raw === "local") return "local";
  if (raw === "s3" || raw === "s3-compatible") return "s3";

  errors.push("OBJECT_STORAGE_PROVIDER must be local or s3");
  return "local";
}

function validateHttpBaseUrl(raw: string, errors: string[]) {
  validateHttpUrl(raw, "OBJECT_STORAGE_BASE_URL", errors);
}

function validateHttpUrl(raw: string, key: string, errors: string[]) {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${key} must be an http or https URL`);
    }
  } catch {
    errors.push(`${key} must be a valid URL`);
  }
}

function validateS3Configuration(env: ObjectStorageEnv, errors: string[]) {
  const requiredKeys = [
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_REGION",
    "OBJECT_STORAGE_BASE_URL",
    "OBJECT_STORAGE_CREDENTIALS_REF",
  ] as const;

  for (const key of requiredKeys) {
    if (!value(env, key)) {
      errors.push(`${key} is required when OBJECT_STORAGE_PROVIDER=s3`);
    }
  }

  if (value(env, "OBJECT_STORAGE_BASE_URL")) {
    validateHttpBaseUrl(value(env, "OBJECT_STORAGE_BASE_URL"), errors);
  }
}

function validateStrictS3ProductionPosture(env: ObjectStorageEnv, errors: string[]) {
  const publicAccess = value(env, "OBJECT_STORAGE_PUBLIC_ACCESS").toLowerCase();
  const signedUrlMode = value(env, "OBJECT_STORAGE_SIGNED_URL_MODE").toLowerCase();
  const malwareScanner = value(env, "OBJECT_STORAGE_MALWARE_SCANNER").toLowerCase();
  const retentionPolicy = value(env, "OBJECT_STORAGE_RETENTION_POLICY");
  const stagingSmokeEvidenceUrl = value(env, "OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL");
  const cdnUrl = value(env, "OBJECT_STORAGE_CDN_URL");
  const allowedSignedUrlModes = new Set(["app-proxy", "s3-presigned", "cloudfront-signed"]);
  const localMalwareScanners = new Set(["", "local", "local/noop", "noop", "none"]);

  if (publicAccess !== "private") {
    errors.push("OBJECT_STORAGE_PUBLIC_ACCESS must be private when OBJECT_STORAGE_PROVIDER=s3 in production or staging");
  }

  if (!signedUrlMode) {
    errors.push("OBJECT_STORAGE_SIGNED_URL_MODE is required when OBJECT_STORAGE_PROVIDER=s3 in production or staging");
  } else if (!allowedSignedUrlModes.has(signedUrlMode)) {
    errors.push("OBJECT_STORAGE_SIGNED_URL_MODE must be app-proxy, s3-presigned, or cloudfront-signed");
  }

  if (signedUrlMode === "cloudfront-signed" && !cdnUrl) {
    errors.push("OBJECT_STORAGE_CDN_URL is required when OBJECT_STORAGE_SIGNED_URL_MODE=cloudfront-signed");
  }

  if (cdnUrl) {
    validateHttpUrl(cdnUrl, "OBJECT_STORAGE_CDN_URL", errors);
  }

  if (localMalwareScanners.has(malwareScanner)) {
    errors.push("OBJECT_STORAGE_MALWARE_SCANNER must reference an external scanner when OBJECT_STORAGE_PROVIDER=s3 in production or staging");
  }

  if (!retentionPolicy) {
    errors.push("OBJECT_STORAGE_RETENTION_POLICY is required when OBJECT_STORAGE_PROVIDER=s3 in production or staging");
  }

  if (!stagingSmokeEvidenceUrl) {
    errors.push("OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL is required when OBJECT_STORAGE_PROVIDER=s3 in production or staging");
  } else {
    validateHttpUrl(stagingSmokeEvidenceUrl, "OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL", errors);
  }
}

export function validateObjectStoragePreflight(
  env: ObjectStorageEnv = process.env,
  options: { strictMode?: boolean } = {},
): ObjectStoragePreflightResult {
  const errors: string[] = [];
  const provider = resolveProviderName(env, errors);
  const strictMode = options.strictMode ?? isProductionLikeRuntime(env);
  const localAllowedByOverride = value(env, "PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE") === "1";

  if (strictMode && provider === "local" && !localAllowedByOverride) {
    errors.push(
      "OBJECT_STORAGE_PROVIDER=local is a local/dev fallback and cannot be used for production or staging launch; set OBJECT_STORAGE_PROVIDER=s3 or PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE=1",
    );
  }

  if (provider === "s3") {
    validateS3Configuration(env, errors);
    if (strictMode) {
      validateStrictS3ProductionPosture(env, errors);
    }
  }

  if (errors.length > 0) {
    throw new ObjectStorageConfigurationError(errors.join("; "));
  }

  return {
    provider,
    strictMode,
    localAllowedByOverride,
    ...(provider === "s3"
      ? {
        s3: {
          bucket: "configured" as const,
          region: "configured" as const,
          baseUrl: "configured" as const,
          credentialsRef: "configured" as const,
          ...(strictMode
            ? {
              publicAccess: "private" as const,
              signedUrlMode: "configured" as const,
              ...(value(env, "OBJECT_STORAGE_CDN_URL") ? { cdnUrl: "configured" as const } : {}),
              malwareScanner: "configured" as const,
              retentionPolicy: "configured" as const,
              stagingSmokeEvidence: "configured" as const,
            }
            : {}),
        },
      }
      : {}),
  };
}

function defaultLocalRoot(env: ObjectStorageEnv) {
  return value(env, "OBJECT_STORAGE_LOCAL_ROOT") || path.join(process.cwd(), "data", "object-storage");
}

function createLocalProvider(root: string): ObjectStorageProvider {
  const storage = createLocalObjectStorage({ root });

  return {
    provider: "local",
    async putObject(input) {
      const stored = await storage.writeObject(input.key, input.bytes);
      return { provider: "local", ...stored };
    },
    async getObject(storagePath, options = {}) {
      return readLocalStoredObject(storagePath, options);
    },
    async statObject(storagePath, options = {}) {
      return statLocalStoredObject(storagePath, options);
    },
    async deleteObject(storagePath, options = {}) {
      await deleteLocalStoredObject(storagePath, options);
    },
  };
}

function toBuffer(bytes: WritableBytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  return Buffer.from(bytes);
}

function hashSha256(bytes: Buffer | string) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function hmacSha256(key: Buffer | string, valueToSign: string) {
  return crypto.createHmac("sha256", key).update(valueToSign).digest();
}

function assertSafeS3Segment(segment: string) {
  if (!segment || segment === "." || segment === "..") {
    throw new LocalObjectStoragePathError("Storage object key contains an unsafe segment.");
  }

  if (segment.includes("\0") || segment.includes("/") || segment.includes("\\") || path.isAbsolute(segment)) {
    throw new LocalObjectStoragePathError("Storage object key contains an unsafe segment.");
  }
}

function encodeS3PathSegment(segment: string) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function normalizeS3Key(segments: string[]) {
  for (const segment of segments) {
    assertSafeS3Segment(segment);
  }

  return segments.join("/");
}

function parseS3StoragePath(storagePath: string, bucket: string) {
  const prefix = `s3://${bucket}/`;
  if (!storagePath.startsWith(prefix)) {
    throw new LocalObjectStoragePathError("S3 storage path does not match the configured bucket.");
  }

  const key = storagePath.slice(prefix.length);
  if (!key) {
    throw new LocalObjectStoragePathError("S3 storage path is missing an object key.");
  }

  for (const segment of key.split("/")) {
    assertSafeS3Segment(segment);
  }

  return key;
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function toDateStamp(amzDate: string) {
  return amzDate.slice(0, 8);
}

function getS3SigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, "s3");
  return hmacSha256(serviceKey, "aws4_request");
}

function assertS3RuntimeCredentials(env: ObjectStorageEnv) {
  const accessKeyId = value(env, "OBJECT_STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = value(env, "OBJECT_STORAGE_SECRET_ACCESS_KEY");
  const sessionToken = value(env, "OBJECT_STORAGE_SESSION_TOKEN");

  if (!accessKeyId || !secretAccessKey) {
    throw new ObjectStorageConfigurationError(
      "OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY are required for S3-compatible object storage operations; inject them from runtime secrets and never commit them",
    );
  }

  return { accessKeyId, secretAccessKey, sessionToken };
}

function createS3CompatibleProvider(env: ObjectStorageEnv): ObjectStorageProvider {
  const bucket = value(env, "OBJECT_STORAGE_BUCKET");
  const region = value(env, "OBJECT_STORAGE_REGION");
  const baseUrl = value(env, "OBJECT_STORAGE_BASE_URL").replace(/\/+$/, "");

  function createObjectUrl(key: string) {
    const encodedPath = [bucket, ...key.split("/")].map(encodeS3PathSegment).join("/");
    return new URL(`${baseUrl}/${encodedPath}`);
  }

  async function sendSignedRequest(
    method: "PUT" | "GET" | "HEAD" | "DELETE",
    key: string,
    body?: Buffer,
    extraHeaders: Record<string, string> = {},
  ) {
    const { accessKeyId, secretAccessKey, sessionToken } = assertS3RuntimeCredentials(env);
    const url = createObjectUrl(key);
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = toDateStamp(amzDate);
    const payloadHash = body ? hashSha256(body) : emptyPayloadHash;
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders,
    };

    if (sessionToken) {
      headers["x-amz-security-token"] = sessionToken;
    }

    const canonicalHeaders = Object.entries(headers)
      .map(([name, headerValue]) => [name.toLowerCase(), headerValue.trim()] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      "",
      canonicalHeaders.map(([name, headerValue]) => `${name}:${headerValue}\n`).join(""),
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      hashSha256(canonicalRequest),
    ].join("\n");
    const signature = crypto
      .createHmac("sha256", getS3SigningKey(secretAccessKey, dateStamp, region))
      .update(stringToSign)
      .digest("hex");
    const authorization = [
      "AWS4-HMAC-SHA256",
      `Credential=${accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");
    const fetchHeaders = {
      ...Object.fromEntries(canonicalHeaders.filter(([name]) => name !== "host")),
      authorization,
    };

    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      ...(body ? { body: new Blob([new Uint8Array(body)]) } : {}),
    });

    if (!response.ok) {
      throw new ObjectStorageUnavailableError(
        `S3-compatible object storage request failed with HTTP ${response.status}`,
      );
    }

    return response;
  }

  return {
    provider: "s3",
    async putObject(input) {
      const key = normalizeS3Key(input.key);
      const body = toBuffer(input.bytes);
      const checksumSha256 = hashSha256(body);
      const headers: Record<string, string> = {
        "content-length": String(body.byteLength),
        ...(input.contentType ? { "content-type": input.contentType } : {}),
      };

      await sendSignedRequest("PUT", key, body, headers);

      return {
        provider: "s3",
        storagePath: `s3://${bucket}/${key}`,
        byteSize: body.byteLength,
        checksumSha256,
      };
    },
    async getObject(storagePath, options = {}) {
      const key = parseS3StoragePath(storagePath, bucket);
      const response = await sendSignedRequest("GET", key);
      const bytes = Buffer.from(await response.arrayBuffer());

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
    async statObject(storagePath) {
      const key = parseS3StoragePath(storagePath, bucket);
      const response = await sendSignedRequest("HEAD", key);
      const byteSize = Number(response.headers.get("content-length") ?? "0");
      const lastModified = response.headers.get("last-modified");
      const updatedAt = lastModified ? new Date(lastModified).toISOString() : undefined;

      return { storagePath, byteSize, updatedAt };
    },
    async deleteObject(storagePath) {
      const key = parseS3StoragePath(storagePath, bucket);
      await sendSignedRequest("DELETE", key);
    },
  };
}

function resolveS3ClientMode(env: ObjectStorageEnv): "rest" | "aws-sdk" {
  const raw = value(env, "OBJECT_STORAGE_S3_CLIENT").toLowerCase();
  return raw === "aws-sdk" ? "aws-sdk" : "rest";
}

/**
 * Lazily loads the `@aws-sdk/client-s3`-backed provider from
 * `./s3-object-storage.ts`. Loaded dynamically (rather than a static
 * top-level import) so that modules which only ever use the default
 * hand-rolled REST S3 provider (or local storage) do not require
 * `@aws-sdk/client-s3` to be installed at all; the dependency is only
 * required at runtime when `OBJECT_STORAGE_S3_CLIENT=aws-sdk` is set.
 */
async function createAwsSdkS3Provider(env: ObjectStorageEnv): Promise<ObjectStorageProvider> {
  try {
    const { createS3ObjectStorageProvider } = await import("./s3-object-storage");
    return createS3ObjectStorageProvider({ env });
  } catch (error) {
    throw new ObjectStorageConfigurationError(
      `OBJECT_STORAGE_S3_CLIENT=aws-sdk requires the @aws-sdk/client-s3 package to be installed (run npm install in frontend/): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Wraps `putObject` with a malware scan. Only applied when the caller opts
 * in via `ObjectStorageProviderOptions.enableMalwareScan` /
 * `malwareScanner` (see `createObjectStorageProvider`) — most existing
 * callers, notably `@/server/artifacts/service.ts`, already run their own
 * scan upstream of `putObject` and surface the scan status on the
 * artifact/version record, so scanning again here would be redundant (and,
 * for `artifacts/service.ts` specifically, would require every test file
 * fixture to also satisfy the storage-layer content-type allowlist).
 */
function withMalwareScan(
  inner: ObjectStorageProvider,
  scanner: MalwareScanner,
): ObjectStorageProvider {
  return {
    ...inner,
    async putObject(input) {
      const bytes = toBuffer(input.bytes);
      const result = await scanner.scan({
        fileName: input.key[input.key.length - 1] ?? "object",
        contentType: input.contentType ?? "application/octet-stream",
        bytes,
      });

      if (!result.clean) {
        throw new ObjectStorageMalwareScanError(
          `Object storage upload blocked by malware scan (${result.engine}): ${result.reason ?? "no reason provided"}`,
          result,
        );
      }

      return inner.putObject(input);
    },
  };
}

export function createObjectStorageProvider(options: ObjectStorageProviderOptions = {}): ObjectStorageProvider {
  const env = options.env ?? process.env;
  const preflight = validateObjectStoragePreflight(env);
  const scanEnabled = Boolean(options.enableMalwareScan || options.malwareScanner);
  const scanner = options.malwareScanner ?? resolveMalwareScanner(env);

  const provider = preflight.provider === "s3"
    ? (resolveS3ClientMode(env) === "aws-sdk"
      ? createLazyProvider(() => createAwsSdkS3Provider(env))
      : createS3CompatibleProvider(env))
    : createLocalProvider(options.localRoot ?? defaultLocalRoot(env));

  return scanEnabled ? withMalwareScan(provider, scanner) : provider;
}

/**
 * Wraps an async provider factory so `createObjectStorageProvider` stays
 * synchronous even when the underlying provider (the `@aws-sdk/client-s3`
 * path) must be loaded via dynamic `import()`. The factory is invoked once
 * per operation call and cached after the first successful resolution.
 */
function createLazyProvider(factory: () => Promise<ObjectStorageProvider>): ObjectStorageProvider {
  let cached: Promise<ObjectStorageProvider> | undefined;

  function resolve() {
    if (!cached) cached = factory();
    return cached;
  }

  return {
    provider: "s3",
    async putObject(input) {
      return (await resolve()).putObject(input);
    },
    async getObject(storagePath, readOptions) {
      return (await resolve()).getObject(storagePath, readOptions);
    },
    async statObject(storagePath, statOptions) {
      return (await resolve()).statObject(storagePath, statOptions);
    },
    async deleteObject(storagePath, deleteOptions) {
      return (await resolve()).deleteObject(storagePath, deleteOptions);
    },
  };
}
