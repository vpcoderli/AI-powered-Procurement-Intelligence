import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { LocalObjectStorageIntegrityError, LocalObjectStoragePathError } from "./local-object-storage";
import { ObjectStorageConfigurationError, ObjectStorageUnavailableError, createS3ObjectStorageProvider } from "./s3-object-storage";

type SentCommand = { command: unknown; commandName: string };

function fakeS3Client(handler: (command: unknown) => unknown, sent: SentCommand[] = []): S3Client {
  return {
    send: async (command: unknown) => {
      sent.push({ command, commandName: (command as { constructor: { name: string } }).constructor.name });
      return handler(command);
    },
  } as unknown as S3Client;
}

const baseEnv = {
  OBJECT_STORAGE_PROVIDER: "s3",
  OBJECT_STORAGE_BUCKET: "prod-artifacts",
  OBJECT_STORAGE_REGION: "us-east-1",
  OBJECT_STORAGE_BASE_URL: "https://s3.us-east-1.amazonaws.com",
  OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
  OBJECT_STORAGE_ACCESS_KEY_ID: "AKIA_TEST_ACCESS_KEY",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
};

describe("S3 object storage provider (@aws-sdk/client-s3)", () => {
  it("requires OBJECT_STORAGE_BUCKET to construct the provider", () => {
    expect(() =>
      createS3ObjectStorageProvider({ env: { ...baseEnv, OBJECT_STORAGE_BUCKET: "" } }),
    ).toThrow(ObjectStorageConfigurationError);
  });

  it("requires runtime credentials before sending any request", async () => {
    const sent: SentCommand[] = [];
    const client = fakeS3Client(() => ({}), sent);
    const provider = createS3ObjectStorageProvider({
      env: { ...baseEnv, OBJECT_STORAGE_ACCESS_KEY_ID: "", OBJECT_STORAGE_SECRET_ACCESS_KEY: "" },
      client,
    });

    await expect(provider.putObject({ key: ["user_1", "artifact.txt"], bytes: Buffer.from("hi") }))
      .rejects.toThrow(/OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY are required/);
    expect(sent).toHaveLength(0);
  });

  it("puts an object and returns provider metadata matching the ObjectStorageProvider contract", async () => {
    const sent: SentCommand[] = [];
    const body = Buffer.from("uploaded via aws sdk");
    const checksumSha256 = crypto.createHash("sha256").update(body).digest("hex");
    const client = fakeS3Client(() => ({ ETag: '"abc123"' }), sent);
    const provider = createS3ObjectStorageProvider({ env: baseEnv, client });

    const stored = await provider.putObject({
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
    expect(sent).toHaveLength(1);
    expect(sent[0]?.commandName).toBe(PutObjectCommand.name);
    const input = (sent[0]?.command as PutObjectCommand).input;
    expect(input.Bucket).toBe("prod-artifacts");
    expect(input.Key).toBe("user_1/artifact.txt");
    expect(input.ContentType).toBe("text/plain");
    expect(input.ContentLength).toBe(body.byteLength);
  });

  it("gets an object and verifies checksum/size when a manifest is provided", async () => {
    const body = Buffer.from("round tripped content");
    const checksumSha256 = crypto.createHash("sha256").update(body).digest("hex");
    const client = fakeS3Client((command) => {
      if (command instanceof GetObjectCommand) {
        return { Body: body };
      }
      throw new Error("unexpected command");
    });
    const provider = createS3ObjectStorageProvider({ env: baseEnv, client });

    await expect(
      provider.getObject("s3://prod-artifacts/user_1/artifact.txt", {
        expectedByteSize: body.byteLength,
        expectedChecksumSha256: checksumSha256,
      }),
    ).resolves.toEqual(body);
  });

  it("rejects a get when the checksum does not match the manifest", async () => {
    const body = Buffer.from("tampered content");
    const client = fakeS3Client(() => ({ Body: body }));
    const provider = createS3ObjectStorageProvider({ env: baseEnv, client });

    await expect(
      provider.getObject("s3://prod-artifacts/user_1/artifact.txt", {
        expectedChecksumSha256: crypto.createHash("sha256").update("something else").digest("hex"),
      }),
    ).rejects.toBeInstanceOf(LocalObjectStorageIntegrityError);
  });

  it("stats an object using HeadObject", async () => {
    const lastModified = new Date("2026-06-10T10:00:00.000Z");
    const client = fakeS3Client((command) => {
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: 42, LastModified: lastModified };
      }
      throw new Error("unexpected command");
    });
    const provider = createS3ObjectStorageProvider({ env: baseEnv, client });

    await expect(provider.statObject("s3://prod-artifacts/user_1/artifact.txt")).resolves.toEqual({
      storagePath: "s3://prod-artifacts/user_1/artifact.txt",
      byteSize: 42,
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
  });

  it("deletes an object using DeleteObject", async () => {
    const sent: SentCommand[] = [];
    const client = fakeS3Client(() => ({}), sent);
    const provider = createS3ObjectStorageProvider({ env: baseEnv, client });

    await expect(provider.deleteObject("s3://prod-artifacts/user_1/artifact.txt")).resolves.toBeUndefined();
    expect(sent[0]?.commandName).toBe(DeleteObjectCommand.name);
    expect((sent[0]?.command as DeleteObjectCommand).input).toMatchObject({
      Bucket: "prod-artifacts",
      Key: "user_1/artifact.txt",
    });
  });

  it("rejects storage paths for a different bucket", async () => {
    const client = fakeS3Client(() => ({}));
    const provider = createS3ObjectStorageProvider({ env: baseEnv, client });

    await expect(provider.statObject("s3://some-other-bucket/user_1/artifact.txt"))
      .rejects.toBeInstanceOf(LocalObjectStoragePathError);
  });

  it("rejects object keys that try to escape their segment boundaries", async () => {
    const client = fakeS3Client(() => ({}));
    const provider = createS3ObjectStorageProvider({ env: baseEnv, client });

    await expect(provider.putObject({ key: ["user_1", "..", "escape.txt"], bytes: Buffer.from("x") }))
      .rejects.toBeInstanceOf(LocalObjectStoragePathError);
  });

  it("wraps SDK failures in ObjectStorageUnavailableError without leaking internals as a different error type", async () => {
    const client = fakeS3Client(() => {
      throw new Error("NoSuchBucket: the bucket does not exist");
    });
    const provider = createS3ObjectStorageProvider({ env: baseEnv, client });

    await expect(provider.putObject({ key: ["user_1", "artifact.txt"], bytes: Buffer.from("x") }))
      .rejects.toBeInstanceOf(ObjectStorageUnavailableError);
  });
});
