import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createObjectStorageProvider,
  ObjectStorageConfigurationError,
  ObjectStorageMalwareScanError,
  validateObjectStoragePreflight,
} from "./object-storage";

describe("object storage provider abstraction", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "object-storage-provider-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps local provider file behavior behind the provider interface", async () => {
    const storage = createObjectStorageProvider({
      env: { OBJECT_STORAGE_PROVIDER: "local" },
      localRoot: root,
    });
    const body = Buffer.from("trusted provider content");
    const checksumSha256 = crypto.createHash("sha256").update(body).digest("hex");

    const stored = await storage.putObject({
      key: ["user_1", "artifact.txt"],
      bytes: body,
    });

    expect(storage.provider).toBe("local");
    expect(stored).toMatchObject({
      provider: "local",
      byteSize: body.byteLength,
      checksumSha256,
    });
    expect(stored.storagePath).toContain(root);

    await expect(storage.getObject(stored.storagePath, {
      expectedByteSize: body.byteLength,
      expectedChecksumSha256: checksumSha256,
    })).resolves.toEqual(body);
    await expect(storage.statObject(stored.storagePath)).resolves.toMatchObject({
      byteSize: body.byteLength,
    });

    await storage.deleteObject(stored.storagePath);
    await expect(storage.statObject(stored.storagePath)).rejects.toThrow();
  });

  it("fails S3-compatible preflight when required configuration references are missing", () => {
    expect(() =>
      validateObjectStoragePreflight({
        OBJECT_STORAGE_PROVIDER: "s3",
        OBJECT_STORAGE_BUCKET: "",
        OBJECT_STORAGE_REGION: "us-east-1",
        OBJECT_STORAGE_BASE_URL: "",
        OBJECT_STORAGE_CREDENTIALS_REF: "",
      }),
    ).toThrow(/OBJECT_STORAGE_BUCKET is required when OBJECT_STORAGE_PROVIDER=s3; OBJECT_STORAGE_BASE_URL is required when OBJECT_STORAGE_PROVIDER=s3; OBJECT_STORAGE_CREDENTIALS_REF is required when OBJECT_STORAGE_PROVIDER=s3/);
  });

  it("requires production storage posture controls for strict S3 preflight", () => {
    expect(() =>
      validateObjectStoragePreflight({
        OBJECT_STORAGE_PROVIDER: "s3",
        OBJECT_STORAGE_BUCKET: "prod-artifacts",
        OBJECT_STORAGE_REGION: "us-east-1",
        OBJECT_STORAGE_BASE_URL: "https://storage.example.com",
        OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
        OBJECT_STORAGE_PUBLIC_ACCESS: "public",
        OBJECT_STORAGE_SIGNED_URL_MODE: "",
        OBJECT_STORAGE_MALWARE_SCANNER: "local/noop",
        OBJECT_STORAGE_RETENTION_POLICY: "",
        OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL: "",
      }, { strictMode: true }),
    ).toThrow(/OBJECT_STORAGE_PUBLIC_ACCESS must be private when OBJECT_STORAGE_PROVIDER=s3 in production or staging; OBJECT_STORAGE_SIGNED_URL_MODE is required when OBJECT_STORAGE_PROVIDER=s3 in production or staging; OBJECT_STORAGE_MALWARE_SCANNER must reference an external scanner when OBJECT_STORAGE_PROVIDER=s3 in production or staging; OBJECT_STORAGE_RETENTION_POLICY is required when OBJECT_STORAGE_PROVIDER=s3 in production or staging; OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL is required when OBJECT_STORAGE_PROVIDER=s3 in production or staging/);
  });

  it("requires CDN URL when CloudFront signed URL mode is selected", () => {
    expect(() =>
      validateObjectStoragePreflight({
        OBJECT_STORAGE_PROVIDER: "s3",
        OBJECT_STORAGE_BUCKET: "prod-artifacts",
        OBJECT_STORAGE_REGION: "us-east-1",
        OBJECT_STORAGE_BASE_URL: "https://storage.example.com",
        OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
        OBJECT_STORAGE_PUBLIC_ACCESS: "private",
        OBJECT_STORAGE_SIGNED_URL_MODE: "cloudfront-signed",
        OBJECT_STORAGE_CDN_URL: "",
        OBJECT_STORAGE_MALWARE_SCANNER: "external",
        OBJECT_STORAGE_RETENTION_POLICY: "standard_business_record",
        OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL: "https://docs.example.com/storage-smoke",
      }, { strictMode: true }),
    ).toThrow(/OBJECT_STORAGE_CDN_URL is required when OBJECT_STORAGE_SIGNED_URL_MODE=cloudfront-signed/);
  });

  it("uses signed S3-compatible REST operations when runtime credentials are injected", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    const body = Buffer.from("uploaded to s3");
    const checksumSha256 = crypto.createHash("sha256").update(body).digest("hex");

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(body.byteLength),
            "last-modified": "Wed, 10 Jun 2026 10:00:00 GMT",
          },
        });
      }
      if (init?.method === "GET") {
        return new Response(body, { status: 200 });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const storage = createObjectStorageProvider({
      env: {
        OBJECT_STORAGE_PROVIDER: "s3",
        OBJECT_STORAGE_BUCKET: "prod-artifacts",
        OBJECT_STORAGE_REGION: "us-east-1",
        OBJECT_STORAGE_BASE_URL: "https://storage.example.com",
        OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
        OBJECT_STORAGE_PUBLIC_ACCESS: "private",
        OBJECT_STORAGE_SIGNED_URL_MODE: "app-proxy",
        OBJECT_STORAGE_MALWARE_SCANNER: "external",
        OBJECT_STORAGE_RETENTION_POLICY: "standard_business_record",
        OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL: "https://docs.example.com/storage-smoke",
        OBJECT_STORAGE_ACCESS_KEY_ID: "AKIA_TEST_ACCESS_KEY",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
      },
      localRoot: root,
    });

    expect(validateObjectStoragePreflight({
      OBJECT_STORAGE_PROVIDER: "s3",
      OBJECT_STORAGE_BUCKET: "prod-artifacts",
      OBJECT_STORAGE_REGION: "us-east-1",
      OBJECT_STORAGE_BASE_URL: "https://storage.example.com",
      OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
      OBJECT_STORAGE_PUBLIC_ACCESS: "private",
      OBJECT_STORAGE_SIGNED_URL_MODE: "app-proxy",
      OBJECT_STORAGE_MALWARE_SCANNER: "external",
      OBJECT_STORAGE_RETENTION_POLICY: "standard_business_record",
      OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL: "https://docs.example.com/storage-smoke",
    }, { strictMode: true })).toMatchObject({
      provider: "s3",
      s3: {
        bucket: "configured",
        region: "configured",
        baseUrl: "configured",
        credentialsRef: "configured",
        publicAccess: "private",
        signedUrlMode: "configured",
        malwareScanner: "configured",
        retentionPolicy: "configured",
        stagingSmokeEvidence: "configured",
      },
    });

    try {
      const stored = await storage.putObject({
        key: ["user_1", "artifact.txt"],
        bytes: body,
        contentType: "text/plain",
      });

      expect(stored).toEqual({
        provider: "s3",
        storagePath: "s3://prod-artifacts/user_1/artifact.txt",
        byteSize: body.byteLength,
        checksumSha256,
      });

      await expect(storage.getObject(stored.storagePath, {
        expectedByteSize: body.byteLength,
        expectedChecksumSha256: checksumSha256,
      })).resolves.toEqual(body);
      await expect(storage.statObject(stored.storagePath)).resolves.toEqual({
        storagePath: stored.storagePath,
        byteSize: body.byteLength,
        updatedAt: "2026-06-10T10:00:00.000Z",
      });
      await expect(storage.deleteObject(stored.storagePath)).resolves.toBeUndefined();

      expect(calls.map((call) => call.init.method)).toEqual(["PUT", "GET", "HEAD", "DELETE"]);
      expect(calls[0]?.url).toBe("https://storage.example.com/prod-artifacts/user_1/artifact.txt");
      expect(calls[0]?.init.headers).toMatchObject({
        "content-type": "text/plain",
        "x-amz-content-sha256": checksumSha256,
      });
      expect(String((calls[0]?.init.headers as Record<string, string>).authorization)).toContain(
        "AWS4-HMAC-SHA256",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps S3 runtime secret values out of configuration errors", async () => {
    const storage = createObjectStorageProvider({
      env: {
        OBJECT_STORAGE_PROVIDER: "s3",
        OBJECT_STORAGE_BUCKET: "prod-artifacts",
        OBJECT_STORAGE_REGION: "us-east-1",
        OBJECT_STORAGE_BASE_URL: "https://storage.example.com",
        OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
        OBJECT_STORAGE_PUBLIC_ACCESS: "private",
        OBJECT_STORAGE_SIGNED_URL_MODE: "app-proxy",
        OBJECT_STORAGE_MALWARE_SCANNER: "external",
        OBJECT_STORAGE_RETENTION_POLICY: "standard_business_record",
        OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL: "https://docs.example.com/storage-smoke",
        OBJECT_STORAGE_ACCESS_KEY_ID: "AKIA_TEST_ACCESS_KEY",
      },
      localRoot: root,
    });

    await expect(storage.putObject({
      key: ["user_1", "artifact.txt"],
      bytes: "not uploaded",
    })).rejects.toThrow(/OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY are required/);

    await storage.putObject({
      key: ["user_1", "artifact.txt"],
      bytes: "not uploaded",
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("AKIA_TEST_ACCESS_KEY");
    });
  });

  it("rejects invalid providers without echoing secret-like environment values", () => {
    expect(() =>
      validateObjectStoragePreflight({
        OBJECT_STORAGE_PROVIDER: "s3-secret-value",
        OBJECT_STORAGE_CREDENTIALS_REF: "super-secret-reference",
      }),
    ).toThrow(ObjectStorageConfigurationError);

    try {
      validateObjectStoragePreflight({
        OBJECT_STORAGE_PROVIDER: "s3-secret-value",
        OBJECT_STORAGE_CREDENTIALS_REF: "super-secret-reference",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("s3-secret-value");
      expect(message).not.toContain("super-secret-reference");
      return;
    }

    throw new Error("Expected object storage preflight to fail");
  });

  it("does not scan uploads by default, preserving existing provider behavior", async () => {
    const storage = createObjectStorageProvider({
      env: { OBJECT_STORAGE_PROVIDER: "local" },
      localRoot: root,
    });

    // No contentType/allowlisted type at all; would be blocked by the
    // heuristic scanner's content-type allowlist if scanning were on by
    // default. Scanning is opt-in, so this must still succeed.
    await expect(storage.putObject({
      key: ["user_1", "artifact.bin"],
      bytes: Buffer.from("arbitrary bytes"),
    })).resolves.toMatchObject({ provider: "local" });
  });

  it("blocks putObject with ObjectStorageMalwareScanError when malware scanning is enabled and the scan fails", async () => {
    const storage = createObjectStorageProvider({
      env: { OBJECT_STORAGE_PROVIDER: "local" },
      localRoot: root,
      enableMalwareScan: true,
      malwareScanner: {
        engine: "test-stub",
        async scan() {
          return { clean: false, status: "blocked", engine: "test-stub", reason: "test forced block" };
        },
      },
    });

    await expect(storage.putObject({
      key: ["user_1", "artifact.bin"],
      bytes: Buffer.from("arbitrary bytes"),
      contentType: "application/octet-stream",
    })).rejects.toBeInstanceOf(ObjectStorageMalwareScanError);
  });

  it("allows putObject through when malware scanning is enabled and the scan passes", async () => {
    const storage = createObjectStorageProvider({
      env: { OBJECT_STORAGE_PROVIDER: "local" },
      localRoot: root,
      enableMalwareScan: true,
      malwareScanner: {
        engine: "test-stub",
        async scan() {
          return { clean: true, status: "clean", engine: "test-stub" };
        },
      },
    });

    await expect(storage.putObject({
      key: ["user_1", "artifact.bin"],
      bytes: Buffer.from("arbitrary bytes"),
      contentType: "application/octet-stream",
    })).resolves.toMatchObject({ provider: "local" });
  });

  it("resolves the heuristic scanner from OBJECT_STORAGE_MALWARE_SCANNER when enabled without an explicit scanner", async () => {
    const storage = createObjectStorageProvider({
      env: { OBJECT_STORAGE_PROVIDER: "local", OBJECT_STORAGE_MALWARE_SCANNER: "external" },
      localRoot: root,
      enableMalwareScan: true,
    });

    await expect(storage.putObject({
      key: ["user_1", "installer.exe"],
      bytes: Buffer.from("MZ fake pe header"),
      contentType: "application/octet-stream",
    })).rejects.toThrow(/malware scan/i);
  });
});
