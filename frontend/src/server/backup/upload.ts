import { readFile } from "node:fs/promises";
import path from "node:path";

export interface BackupUploadResult {
  attempted: boolean;
  uploaded: boolean;
  provider?: "s3";
  storagePath?: string;
  reason?: string;
}

type UploadEnv = Record<string, string | undefined>;

/**
 * Best-effort upload of a local backup file to the object storage adapter
 * added for P0-4 (`frontend/src/server/storage/object-storage.ts`), if and
 * only if that module is present and configured for S3 in the current
 * environment.
 *
 * This deliberately does NOT hard-depend on the object storage module at
 * the top level: it is dynamically imported inside `uploadBackupIfConfigured`
 * so that `backup-db.ts` keeps working (local-only) in a checkout where that
 * P0-4 adapter has not landed yet, or where `OBJECT_STORAGE_PROVIDER` is
 * unset/`local` (the default local/dev posture). Any failure to import or
 * upload is reported back as a non-fatal result rather than thrown, because
 * a local backup that already succeeded should not be treated as failed
 * just because the optional off-site copy could not be made.
 */
export async function uploadBackupIfConfigured(
  localFilePath: string,
  options: { keyPrefix: string; env?: UploadEnv } = { keyPrefix: "backups" },
): Promise<BackupUploadResult> {
  const env = options.env ?? process.env;
  const provider = (env.OBJECT_STORAGE_PROVIDER ?? "").trim().toLowerCase();

  if (provider !== "s3") {
    return {
      attempted: false,
      uploaded: false,
      reason: provider
        ? `OBJECT_STORAGE_PROVIDER=${provider} is not s3; skipping remote upload (local backup file is still authoritative).`
        : "OBJECT_STORAGE_PROVIDER is not set to s3; skipping remote upload (local-only backup).",
    };
  }

  let objectStorageModule: typeof import("../storage/object-storage");
  try {
    objectStorageModule = await import("../storage/object-storage");
  } catch (error) {
    return {
      attempted: true,
      uploaded: false,
      reason: `Object storage adapter is not available in this checkout (${error instanceof Error ? error.message : String(error)}); falling back to local-only backup.`,
    };
  }

  try {
    const provider = objectStorageModule.createObjectStorageProvider({ env });
    const bytes = await readFile(localFilePath);
    const fileName = path.basename(localFilePath);
    const stored = await provider.putObject({
      key: [options.keyPrefix, fileName],
      bytes,
      contentType: "application/octet-stream",
    });

    return {
      attempted: true,
      uploaded: true,
      provider: "s3",
      storagePath: stored.storagePath,
    };
  } catch (error) {
    return {
      attempted: true,
      uploaded: false,
      reason: `S3 upload failed, backup remains local-only: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
