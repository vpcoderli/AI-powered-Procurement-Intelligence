import crypto from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Streams `filePath` through SHA-256 rather than reading it fully into
 * memory, so backup verification stays cheap even for larger database
 * snapshots or `mysqldump` output files.
 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
