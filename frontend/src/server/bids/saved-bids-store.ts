import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

interface SavedBidsStoreData {
  users: Record<string, string[]>;
}

interface SavedBidsStoreOptions {
  filePath?: string;
}

export class SavedBidsStoreCorruptError extends Error {
  constructor(message = "Saved bids store is corrupt") {
    super(message);
    this.name = "SavedBidsStoreCorruptError";
  }
}

// Runtime data lives under the app working directory in local deployments.
const DEFAULT_FILE_PATH = path.join(process.cwd(), "data", "saved-bids.json");
const EMPTY_STORE: SavedBidsStoreData = { users: {} };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSavedBidsStoreData(value: unknown): value is SavedBidsStoreData {
  if (typeof value !== "object" || value === null || !("users" in value)) {
    return false;
  }

  const users = (value as { users: unknown }).users;

  return (
    typeof users === "object" &&
    users !== null &&
    !Array.isArray(users) &&
    Object.values(users).every(isStringArray)
  );
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

export function createSavedBidsStore(options: SavedBidsStoreOptions = {}) {
  const filePath = options.filePath ?? DEFAULT_FILE_PATH;
  let operationQueue: Promise<void> = Promise.resolve();

  function enqueueOperation<T>(operation: () => Promise<T>) {
    const queuedOperation = operationQueue.then(operation, operation);
    operationQueue = queuedOperation.then(
      () => undefined,
      () => undefined,
    );

    return queuedOperation;
  }

  async function writeStore(data: SavedBidsStoreData) {
    await mkdir(path.dirname(filePath), { recursive: true });

    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  }

  async function readStore(): Promise<SavedBidsStoreData> {
    let raw: string;

    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        await writeStore(EMPTY_STORE);
        return { users: {} };
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SavedBidsStoreCorruptError();
    }

    if (!isSavedBidsStoreData(parsed)) {
      throw new SavedBidsStoreCorruptError();
    }

    return {
      users: Object.fromEntries(
        Object.entries(parsed.users).map(([userId, ids]) => [
          userId,
          uniqueIds(ids),
        ]),
      ),
    };
  }

  async function updateUserIds(
    userId: string,
    update: (ids: string[]) => string[],
  ) {
    return enqueueOperation(async () => {
      const data = await readStore();
      const currentIds = data.users[userId] ?? [];
      const nextIds = uniqueIds(update(currentIds));

      data.users[userId] = nextIds;
      await writeStore(data);

      return nextIds;
    });
  }

  return {
    getSavedBidIds: (userId: string) =>
      enqueueOperation(async () => {
        const data = await readStore();

        return [...(data.users[userId] ?? [])];
      }),
    saveBidId: async (userId: string, bidId: string) =>
      updateUserIds(userId, (ids) =>
        ids.includes(bidId) ? ids : [...ids, bidId],
      ),
    removeBidId: async (userId: string, bidId: string) =>
      updateUserIds(userId, (ids) => ids.filter((id) => id !== bidId)),
  };
}

export const savedBidsStore = createSavedBidsStore();
