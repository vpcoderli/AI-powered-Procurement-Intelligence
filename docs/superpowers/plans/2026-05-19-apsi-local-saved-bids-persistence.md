# APSi Local Saved Bids Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist saved bids to a local JSON file and isolate saved bids by anonymous browser user cookie.

**Architecture:** Keep bid records seeded from `frontend/src/lib/mock-data.ts`, but move saved-bid IDs out of process memory into a file-backed store under `frontend/data/`. Route handlers resolve or create an anonymous `apsi_user_id` cookie, pass the user ID to the service layer, and keep the existing API response shapes so front-end pages and client helpers stay stable.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript, Node `fs/promises`, Vitest, existing API/client/server modules.

---

## File Structure

- Modify `frontend/.gitignore`: ignore runtime JSON state in `frontend/data/*.json`.
- Create `frontend/src/server/bids/saved-bids-store.ts`: JSON file persistence for per-user saved-bid IDs.
- Create `frontend/src/server/bids/saved-bids-store.test.ts`: store behavior tests with temporary files.
- Create `frontend/src/server/bids/user.ts`: anonymous cookie parsing and creation helpers.
- Create `frontend/src/server/bids/user.test.ts`: cookie/user helper tests.
- Modify `frontend/src/server/bids/repository.ts`: remove mutable saved-bid process state; keep seeded bid lookup/list responsibilities.
- Modify `frontend/src/server/bids/service.ts`: accept a `userId` for saved-bid operations and delegate saved IDs to the store.
- Modify `frontend/src/server/bids/service.test.ts`: update saved-bid tests for explicit users and isolation.
- Modify `frontend/src/app/api/saved-bids/route.ts`: resolve user cookie, set cookie on new user, call user-scoped service methods.
- Modify `frontend/src/app/api/saved-bids/route.test.ts`: add cookie and persistence tests.
- Modify `frontend/src/app/api/saved-bids/[id]/route.ts`: resolve user cookie, set cookie on new user, call user-scoped remove.
- Modify `frontend/src/app/api/saved-bids/[id]/route.test.ts`: add cookie/user-scoped delete tests.

---

## Task 1: Add File-Backed Saved Bids Store

**Files:**
- Modify: `frontend/.gitignore`
- Create: `frontend/src/server/bids/saved-bids-store.ts`
- Create: `frontend/src/server/bids/saved-bids-store.test.ts`

- [ ] **Step 1: Ignore runtime saved-bids JSON**

Add this section to `frontend/.gitignore`:

```gitignore
# local runtime state
/data/*.json
!/data/.gitkeep
```

Create `frontend/data/.gitkeep` so the runtime directory exists in fresh checkouts.

- [ ] **Step 2: Write failing store tests**

Create `frontend/src/server/bids/saved-bids-store.test.ts`:

```ts
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
```

- [ ] **Step 3: Verify RED**

Run:

```bash
cd frontend
npm test -- src/server/bids/saved-bids-store.test.ts
```

Expected: FAIL because `./saved-bids-store` does not exist.

- [ ] **Step 4: Implement file-backed store**

Create `frontend/src/server/bids/saved-bids-store.ts`:

```ts
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

  async function writeStore(data: SavedBidsStoreData) {
    await mkdir(path.dirname(filePath), { recursive: true });

    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  }

  async function readStore(): Promise<SavedBidsStoreData> {
    let raw: string;

    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
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
        Object.entries(parsed.users).map(([userId, ids]) => [userId, uniqueIds(ids)]),
      ),
    };
  }

  async function updateUserIds(userId: string, update: (ids: string[]) => string[]) {
    const data = await readStore();
    const currentIds = data.users[userId] ?? [];
    const nextIds = uniqueIds(update(currentIds));

    data.users[userId] = nextIds;
    await writeStore(data);

    return nextIds;
  }

  return {
    getSavedBidIds: async (userId: string) => {
      const data = await readStore();

      return [...(data.users[userId] ?? [])];
    },
    saveBidId: async (userId: string, bidId: string) =>
      updateUserIds(userId, (ids) => (ids.includes(bidId) ? ids : [...ids, bidId])),
    removeBidId: async (userId: string, bidId: string) =>
      updateUserIds(userId, (ids) => ids.filter((id) => id !== bidId)),
  };
}

export const savedBidsStore = createSavedBidsStore();
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/bids/saved-bids-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add frontend/.gitignore frontend/data/.gitkeep frontend/src/server/bids/saved-bids-store.ts frontend/src/server/bids/saved-bids-store.test.ts
git commit -m "feat: add local saved bids store"
```

---

## Task 2: Add Anonymous Saved-Bids User Helper

**Files:**
- Create: `frontend/src/server/bids/user.ts`
- Create: `frontend/src/server/bids/user.test.ts`

- [ ] **Step 1: Write failing user helper tests**

Create `frontend/src/server/bids/user.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_USER_COOKIE_NAME,
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "./user";

describe("anonymous saved-bids user", () => {
  it("uses a valid existing anonymous user cookie", () => {
    const result = resolveAnonymousUser(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
      }),
    );

    expect(result.userId).toBe("anon_existing");
    expect(result.isNewUser).toBe(false);
  });

  it("creates an anonymous user when no cookie exists", () => {
    const result = resolveAnonymousUser(new Request("http://localhost/api/saved-bids"));

    expect(result.userId).toMatch(/^anon_[a-zA-Z0-9_-]+$/);
    expect(result.isNewUser).toBe(true);
  });

  it("creates an anonymous user when cookie is invalid", () => {
    const result = resolveAnonymousUser(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=bad value` },
      }),
    );

    expect(result.userId).toMatch(/^anon_[a-zA-Z0-9_-]+$/);
    expect(result.isNewUser).toBe(true);
  });

  it("formats the anonymous user cookie", () => {
    expect(createAnonymousUserCookie("anon_abc")).toContain(
      `${ANONYMOUS_USER_COOKIE_NAME}=anon_abc`,
    );
    expect(createAnonymousUserCookie("anon_abc")).toContain("HttpOnly");
    expect(createAnonymousUserCookie("anon_abc")).toContain("SameSite=Lax");
    expect(createAnonymousUserCookie("anon_abc")).toContain("Path=/");
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd frontend
npm test -- src/server/bids/user.test.ts
```

Expected: FAIL because `./user` does not exist.

- [ ] **Step 3: Implement user helper**

Create `frontend/src/server/bids/user.ts`:

```ts
import { randomUUID } from "node:crypto";

export const ANONYMOUS_USER_COOKIE_NAME = "apsi_user_id";

const USER_ID_PATTERN = /^anon_[a-zA-Z0-9_-]+$/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function parseCookies(cookieHeader: string | null) {
  return new Map(
    (cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) return [part, ""];

        return [
          part.slice(0, separatorIndex),
          decodeURIComponent(part.slice(separatorIndex + 1)),
        ];
      }),
  );
}

function createAnonymousUserId() {
  return `anon_${randomUUID().replaceAll("-", "")}`;
}

export function createAnonymousUserCookie(userId: string) {
  return [
    `${ANONYMOUS_USER_COOKIE_NAME}=${encodeURIComponent(userId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function resolveAnonymousUser(request: Request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  const existingUserId = cookies.get(ANONYMOUS_USER_COOKIE_NAME);

  if (existingUserId && USER_ID_PATTERN.test(existingUserId)) {
    return { userId: existingUserId, isNewUser: false };
  }

  return { userId: createAnonymousUserId(), isNewUser: true };
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/bids/user.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add frontend/src/server/bids/user.ts frontend/src/server/bids/user.test.ts
git commit -m "feat: add anonymous saved bids user"
```

---

## Task 3: Make Saved-Bid Service Operations User-Scoped

**Files:**
- Modify: `frontend/src/server/bids/repository.ts`
- Modify: `frontend/src/server/bids/service.ts`
- Modify: `frontend/src/server/bids/service.test.ts`

- [ ] **Step 1: Write failing service tests for user isolation**

Update the saved-bid tests in `frontend/src/server/bids/service.test.ts` so they call service functions with explicit user IDs:

```ts
  it("returns saved bids for one user", async () => {
    await saveBid("anon_a", "1");

    expect((await getSavedBids("anon_a")).savedBidIds).toEqual(["1"]);
    expect((await getSavedBids("anon_b")).savedBidIds).toEqual([]);
  });

  it("saves an existing bid idempotently for one user", async () => {
    const first = await saveBid("anon_a", "1");
    const second = await saveBid("anon_a", "1");

    expect(first.savedBidIds).toEqual(["1"]);
    expect(second.savedBidIds).toEqual(["1"]);
    expect(second.bids.map((bid) => bid.id)).toEqual(["1"]);
  });

  it("rejects saving an unknown bid", async () => {
    await expect(saveBid("anon_a", "missing")).rejects.toThrow("Bid not found");
  });

  it("removes a saved bid idempotently for one user", async () => {
    await saveBid("anon_a", "2");

    expect((await removeSavedBid("anon_a", "2")).savedBidIds).toEqual([]);
    expect((await removeSavedBid("anon_a", "2")).savedBidIds).toEqual([]);
  });
```

Keep the existing bid query and detail tests synchronous. Only saved-bid service methods become async and user-scoped.

- [ ] **Step 2: Verify RED**

Run:

```bash
cd frontend
npm test -- src/server/bids/service.test.ts
```

Expected: FAIL because `getSavedBids`, `saveBid`, and `removeSavedBid` do not yet accept `userId` or return promises.

- [ ] **Step 3: Remove mutable saved state from repository**

Update `frontend/src/server/bids/repository.ts`:

```ts
import { MOCK_BIDS, type Bid } from "@/lib/mock-data";

let bids = cloneBids(MOCK_BIDS);

function cloneBids(source: Bid[]) {
  return source.map((bid) => ({ ...bid, attachments: [...bid.attachments], tags: [...bid.tags] }));
}

export function listBids(savedBidIds: string[] = []) {
  return bids.map((bid) => ({ ...bid, saved: savedBidIds.includes(bid.id) }));
}

export function getBidByIdFromRepository(id: string) {
  return listBids().find((bid) => bid.id === id);
}

export function resetBidRepositoryForTests() {
  bids = cloneBids(MOCK_BIDS);
}
```

- [ ] **Step 4: Update service to use the store**

Update saved-bid parts of `frontend/src/server/bids/service.ts` to import `savedBidsStore`, pass saved IDs into `listBids`, and make saved operations async:

```ts
import { STATE_FILTERS, type Bid } from "@/lib/mock-data";
import { getBidByIdFromRepository, listBids } from "./repository";
import { savedBidsStore } from "./saved-bids-store";
```

Use these saved-bid functions:

```ts
async function savedBidsResponse(userId: string): Promise<SavedBidsResponse> {
  const savedIds = await savedBidsStore.getSavedBidIds(userId);
  const savedIdSet = new Set(savedIds);

  return {
    savedBidIds: savedIds,
    bids: listBids(savedIds).filter((bid) => savedIdSet.has(bid.id)),
  };
}

export function getBidById(id: string) {
  return getBidByIdFromRepository(id);
}

export async function getSavedBids(userId: string) {
  return savedBidsResponse(userId);
}

export async function saveBid(userId: string, id: string) {
  if (!getBidById(id)) {
    throw new BidNotFoundError();
  }

  await savedBidsStore.saveBidId(userId, id);

  return savedBidsResponse(userId);
}

export async function removeSavedBid(userId: string, id: string) {
  await savedBidsStore.removeBidId(userId, id);

  return savedBidsResponse(userId);
}
```

Keep `queryBids` synchronous and call `listBids()` without user IDs, so the public search page does not leak one user's saved state into general results.

- [ ] **Step 5: Isolate store files in service tests**

Because the service imports the default `savedBidsStore`, mock the store in `frontend/src/server/bids/service.test.ts` before importing service functions:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const savedIdsByUser = new Map<string, string[]>();

vi.mock("./saved-bids-store", () => ({
  savedBidsStore: {
    getSavedBidIds: vi.fn(async (userId: string) => [...(savedIdsByUser.get(userId) ?? [])]),
    saveBidId: vi.fn(async (userId: string, bidId: string) => {
      const ids = savedIdsByUser.get(userId) ?? [];
      const nextIds = ids.includes(bidId) ? ids : [...ids, bidId];
      savedIdsByUser.set(userId, nextIds);
      return [...nextIds];
    }),
    removeBidId: vi.fn(async (userId: string, bidId: string) => {
      const nextIds = (savedIdsByUser.get(userId) ?? []).filter((id) => id !== bidId);
      savedIdsByUser.set(userId, nextIds);
      return [...nextIds];
    }),
  },
}));
```

In `beforeEach`, add:

```ts
savedIdsByUser.clear();
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/bids/service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add frontend/src/server/bids/repository.ts frontend/src/server/bids/service.ts frontend/src/server/bids/service.test.ts
git commit -m "feat: scope saved bid service by user"
```

---

## Task 4: Add Cookie-Aware Saved-Bids API Routes

**Files:**
- Modify: `frontend/src/app/api/saved-bids/route.ts`
- Modify: `frontend/src/app/api/saved-bids/route.test.ts`
- Modify: `frontend/src/app/api/saved-bids/[id]/route.ts`
- Modify: `frontend/src/app/api/saved-bids/[id]/route.test.ts`

- [ ] **Step 1: Write failing route tests for cookies and isolation**

Add tests to `frontend/src/app/api/saved-bids/route.test.ts`:

```ts
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
```

Add these tests under `GET /api/saved-bids`:

```ts
  it("sets an anonymous user cookie when one is missing", async () => {
    const response = await GET(new Request("http://localhost/api/saved-bids"));

    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });

  it("does not reset the cookie when a valid anonymous user exists", async () => {
    const response = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
      }),
    );

    expect(response.headers.get("set-cookie")).toBeNull();
  });
```

Add this test under `POST /api/saved-bids`:

```ts
  it("persists saved bids for the same anonymous user only", async () => {
    await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_a` },
        body: JSON.stringify({ bidId: "1" }),
      }),
    );

    const sameUserResponse = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_a` },
      }),
    );
    const otherUserResponse = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_b` },
      }),
    );

    expect((await sameUserResponse.json()).savedBidIds).toEqual(["1"]);
    expect((await otherUserResponse.json()).savedBidIds).toEqual([]);
  });
```

Add this test to `frontend/src/app/api/saved-bids/[id]/route.test.ts`:

```ts
  it("removes a saved bid for the current anonymous user only", async () => {
    vi.spyOn(bidService, "removeSavedBid").mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await DELETE(
      new Request("http://localhost/api/saved-bids/1", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_a` },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(200);
    expect(bidService.removeSavedBid).toHaveBeenCalledWith("anon_a", "1");
  });
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd frontend
npm test -- src/app/api/saved-bids
```

Expected: FAIL because routes do not accept requests in GET, do not set cookies, and service calls are not user-scoped yet.

- [ ] **Step 3: Update `GET` and `POST /api/saved-bids` route**

In `frontend/src/app/api/saved-bids/route.ts`, import user helpers:

```ts
import {
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "@/server/bids/user";
```

Add this helper:

```ts
function jsonWithUserCookie(body: unknown, user: ReturnType<typeof resolveAnonymousUser>, init?: ResponseInit) {
  const response = NextResponse.json(body, init);

  if (user.isNewUser) {
    response.headers.set("Set-Cookie", createAnonymousUserCookie(user.userId));
  }

  return response;
}
```

Update route signatures and service calls:

```ts
export async function GET(request: Request) {
  const user = resolveAnonymousUser(request);

  try {
    return jsonWithUserCookie(await bidService.getSavedBids(user.userId), user);
  } catch (error) {
    return internalError(error);
  }
}
```

In `POST`, resolve the user after validating the body and call:

```ts
return jsonWithUserCookie(await bidService.saveBid(user.userId, body.bidId), user);
```

- [ ] **Step 4: Update `DELETE /api/saved-bids/[id]` route**

In `frontend/src/app/api/saved-bids/[id]/route.ts`, import user helpers and call the user-scoped service:

```ts
import {
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "@/server/bids/user";
```

Use the same `jsonWithUserCookie` helper and update `DELETE`:

```ts
export async function DELETE(request: Request, context: RouteContext) {
  const user = resolveAnonymousUser(request);

  try {
    const { id } = await context.params;

    return jsonWithUserCookie(await bidService.removeSavedBid(user.userId, id), user);
  } catch (error) {
    return internalError(error);
  }
}
```

- [ ] **Step 5: Update existing route tests for async service signatures**

Where route tests spy on service methods, update mocks from `mockImplementationOnce(() => { throw ... })` to async rejections:

```ts
vi.spyOn(bidService, "getSavedBids").mockRejectedValueOnce(new Error("saved bids failed"));
vi.spyOn(bidService, "saveBid").mockRejectedValueOnce(new Error("save failed"));
vi.spyOn(bidService, "removeSavedBid").mockRejectedValueOnce(new Error("remove failed"));
```

For existing direct route calls, pass a `Request` to `GET`:

```ts
const response = await GET(new Request("http://localhost/api/saved-bids"));
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
cd frontend
npm test -- src/app/api/saved-bids
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add frontend/src/app/api/saved-bids/route.ts frontend/src/app/api/saved-bids/route.test.ts 'frontend/src/app/api/saved-bids/[id]/route.ts' 'frontend/src/app/api/saved-bids/[id]/route.test.ts'
git commit -m "feat: persist saved bids by anonymous user"
```

---

## Task 5: Full Verification And Browser Acceptance

**Files:**
- No planned source edits unless verification finds a bug.

- [ ] **Step 1: Run automated checks**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected:

- Vitest passes all files.
- ESLint exits 0.
- Next build exits 0.

- [ ] **Step 2: Start dev server**

Run:

```bash
cd frontend
npm run dev
```

Expected: `http://localhost:3000` is ready.

- [ ] **Step 3: Verify saved-bids persistence with curl cookie jar**

Run:

```bash
COOKIE_JAR=$(mktemp)
curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"bidId":"1"}' \
  'http://localhost:3000/api/saved-bids' | rg 'Enterprise Cloud Migration Services'
curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  'http://localhost:3000/api/saved-bids' | rg 'Enterprise Cloud Migration Services'
rm "$COOKIE_JAR"
```

Expected: both commands find `Enterprise Cloud Migration Services`.

- [ ] **Step 4: Verify user isolation with two cookie jars**

Run:

```bash
COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
curl -sS -c "$COOKIE_A" -b "$COOKIE_A" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"bidId":"1"}' \
  'http://localhost:3000/api/saved-bids' >/dev/null
curl -sS -c "$COOKIE_A" -b "$COOKIE_A" \
  'http://localhost:3000/api/saved-bids' | rg 'Enterprise Cloud Migration Services'
if curl -sS -c "$COOKIE_B" -b "$COOKIE_B" \
  'http://localhost:3000/api/saved-bids' | rg 'Enterprise Cloud Migration Services'; then
  echo 'unexpected shared saved bid'
  exit 1
fi
rm "$COOKIE_A" "$COOKIE_B"
```

Expected: user A sees the saved cloud bid; user B does not.

- [ ] **Step 5: Verify browser flow**

In the browser:

- Open `http://localhost:3000`.
- Search `cloud`; confirm only `Enterprise Cloud Migration Services` appears.
- Open detail page.
- Save the bid.
- Navigate to Saved Bids; confirm the saved bid appears.
- Stop and restart the dev server.
- Reload Saved Bids in the same browser; confirm the saved bid still appears.
- Remove the saved bid; confirm saved count updates.
- Switch to Chinese; confirm navigation and workflow labels translate.
- Set a 390px viewport; confirm there is no horizontal overflow.

- [ ] **Step 6: Stop dev server**

Stop the dev server before final reporting.

- [ ] **Step 7: Commit verification fixes if needed**

If verification required source fixes:

```bash
git status --short
git add frontend/.gitignore frontend/data/.gitkeep frontend/src/server/bids frontend/src/app/api/saved-bids
git commit -m "fix: polish local saved bids persistence"
```

If no fixes were needed, do not create an empty commit.

---

## Plan Self-Review

- Spec coverage: covers JSON persistence, anonymous cookie identity, user isolation, stable API response shape, corrupt-file handling, gitignore protection, automated tests, and browser acceptance.
- Placeholder scan: no placeholders or unresolved decisions remain.
- Type consistency: saved-bid service operations consistently use `userId` first, followed by `bidId` where needed; API response shapes remain `SavedBidsResponse`.
