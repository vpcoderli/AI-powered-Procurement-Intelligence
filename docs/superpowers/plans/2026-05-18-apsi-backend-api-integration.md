# APSi Backend API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thin Next.js API backend for APSi bids and saved bids, then move the front end from direct mock-data reads to API-backed data flow.

**Architecture:** Keep the app as one Next.js deployable. Server-side bid query and saved-bid behavior live in `frontend/src/server/bids`, route handlers expose that behavior under `frontend/src/app/api`, and React pages call typed fetch helpers from `frontend/src/lib/api/bids.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, existing shadcn-style UI components.

---

## File Structure

- Create `frontend/vitest.config.ts`: Vitest configuration with TypeScript path aliases.
- Modify `frontend/package.json`: add `test` script and Vitest dev dependency.
- Modify `frontend/package-lock.json`: lock Vitest dependency changes.
- Create `frontend/src/server/bids/types.ts`: shared API and service types.
- Create `frontend/src/server/bids/repository.ts`: in-memory seeded bid and saved-bid storage.
- Create `frontend/src/server/bids/service.ts`: query, filter, sort, detail lookup, save, and unsave behavior.
- Create `frontend/src/server/bids/service.test.ts`: server behavior tests.
- Create `frontend/src/app/api/bids/route.ts`: `GET /api/bids`.
- Create `frontend/src/app/api/bids/route.test.ts`: list route handler tests.
- Create `frontend/src/app/api/bids/[id]/route.ts`: `GET /api/bids/[id]`.
- Create `frontend/src/app/api/bids/[id]/route.test.ts`: detail route handler tests.
- Create `frontend/src/app/api/saved-bids/route.ts`: `GET /api/saved-bids` and `POST /api/saved-bids`.
- Create `frontend/src/app/api/saved-bids/route.test.ts`: saved list and save route handler tests.
- Create `frontend/src/app/api/saved-bids/[id]/route.ts`: `DELETE /api/saved-bids/[id]`.
- Create `frontend/src/app/api/saved-bids/[id]/route.test.ts`: unsave route handler tests.
- Create `frontend/src/lib/api/bids.ts`: client fetch helpers.
- Create `frontend/src/lib/api/bids.test.ts`: fetch helper tests using a real mocked `fetch`.
- Modify `frontend/src/context/SavedBidsContext.tsx`: hydrate and mutate saved bids through API helpers.
- Modify `frontend/src/app/page.tsx`: fetch bid search results from API.
- Modify `frontend/src/app/bids/[id]/page.tsx`: fetch bid detail from API.
- Modify `frontend/src/app/saved/page.tsx`: render saved bids from context API data.

---

## Task 1: Add Vitest Test Harness

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run:

```bash
cd frontend
npm install -D vitest
```

Expected: `package.json` and `package-lock.json` include Vitest.

- [ ] **Step 2: Add test script**

Update `frontend/package.json` scripts to include:

```json
{
  "test": "vitest run"
}
```

Keep existing `dev`, `build`, `start`, and `lint` scripts.

- [ ] **Step 3: Add Vitest config**

Create `frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

- [ ] **Step 4: Verify empty test harness**

Run:

```bash
cd frontend
npm test
```

Expected: Vitest exits with no test files or reports no tests found. If Vitest returns a non-zero exit because no tests exist, continue; Task 2 adds tests before production server code.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts
git commit -m "test: add Vitest harness"
```

---

## Task 2: Add Tested Server Bid Service

**Files:**
- Create: `frontend/src/server/bids/types.ts`
- Create: `frontend/src/server/bids/repository.ts`
- Create: `frontend/src/server/bids/service.ts`
- Create: `frontend/src/server/bids/service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `frontend/src/server/bids/service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetBidRepositoryForTests } from "./repository";
import {
  getBidById,
  getSavedBids,
  queryBids,
  removeSavedBid,
  saveBid,
} from "./service";

describe("bid service", () => {
  beforeEach(() => {
    resetBidRepositoryForTests();
  });

  it("returns all active bids by default", () => {
    const result = queryBids({});

    expect(result.total).toBe(6);
    expect(result.bids.every((bid) => bid.isActive)).toBe(true);
  });

  it("filters bids by keyword across searchable fields", () => {
    const result = queryBids({ q: "cloud" });

    expect(result.bids.map((bid) => bid.title)).toEqual(["Enterprise Cloud Migration Services"]);
  });

  it("filters bids by state or federal source id", () => {
    expect(queryBids({ states: ["sam"] }).bids.map((bid) => bid.id)).toEqual(["1"]);
    expect(queryBids({ states: ["ca"] }).bids.map((bid) => bid.id)).toEqual(["2"]);
  });

  it("filters bids by issuer type", () => {
    const federal = queryBids({ issuerType: "federal" });
    const state = queryBids({ issuerType: "state" });

    expect(federal.bids.map((bid) => bid.id)).toEqual(["1"]);
    expect(state.bids).toHaveLength(5);
  });

  it("filters bids by deadline and published date presets", () => {
    expect(queryBids({ deadline: "next7" }).bids.map((bid) => bid.id)).toEqual(["2"]);
    expect(queryBids({ deadline: "next30" }).bids.map((bid) => bid.id)).toEqual(["1", "2", "3"]);
    expect(queryBids({ published: "last24" }).bids.map((bid) => bid.id)).toEqual(["2"]);
    expect(queryBids({ published: "last7" }).bids.map((bid) => bid.id)).toEqual(["2", "4", "5", "6"]);
  });

  it("sorts by newest published date and soonest deadline", () => {
    expect(queryBids({ sort: "newest" }).bids.map((bid) => bid.id)).toEqual(["2", "6", "5", "4", "3", "1"]);
    expect(queryBids({ sort: "deadline" }).bids.map((bid) => bid.id)).toEqual(["2", "3", "1", "5", "6", "4"]);
  });

  it("returns a bid by id or undefined", () => {
    expect(getBidById("1")?.title).toBe("Enterprise Cloud Migration Services");
    expect(getBidById("missing")).toBeUndefined();
  });

  it("saves an existing bid idempotently", () => {
    const first = saveBid("1");
    const second = saveBid("1");

    expect(first.savedBidIds).toEqual(["2", "1"]);
    expect(second.savedBidIds).toEqual(["2", "1"]);
    expect(second.bids.map((bid) => bid.id)).toEqual(["1", "2"]);
  });

  it("rejects saving an unknown bid", () => {
    expect(() => saveBid("missing")).toThrow("Bid not found");
  });

  it("removes a saved bid idempotently", () => {
    expect(getSavedBids().savedBidIds).toEqual(["2"]);
    expect(removeSavedBid("2").savedBidIds).toEqual([]);
    expect(removeSavedBid("2").savedBidIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd frontend
npm test -- src/server/bids/service.test.ts
```

Expected: FAIL because `./repository` and `./service` do not exist.

- [ ] **Step 3: Create server types**

Create `frontend/src/server/bids/types.ts`:

```ts
import type { Bid, DatePreset, IssuerType, SortOption } from "@/lib/mock-data";

export type ApiIssuerType = "all" | IssuerType;

export interface BidQuery {
  q?: string;
  states?: string[];
  issuerType?: ApiIssuerType;
  deadline?: DatePreset;
  published?: DatePreset;
  sort?: SortOption;
}

export interface NormalizedBidQuery {
  q: string;
  states: string[];
  issuerType: ApiIssuerType;
  deadline: DatePreset;
  published: DatePreset;
  sort: SortOption;
}

export interface BidListResponse {
  bids: Bid[];
  total: number;
  filters: NormalizedBidQuery;
}

export interface BidDetailResponse {
  bid: Bid;
}

export interface SavedBidsResponse {
  savedBidIds: string[];
  bids: Bid[];
}

export interface ApiErrorResponse {
  error: {
    code: "BID_NOT_FOUND" | "INVALID_REQUEST" | "INTERNAL_ERROR";
    message: string;
  };
}

export class BidNotFoundError extends Error {
  constructor() {
    super("Bid not found");
    this.name = "BidNotFoundError";
  }
}
```

- [ ] **Step 4: Create in-memory repository**

Create `frontend/src/server/bids/repository.ts`:

```ts
import { MOCK_BIDS, type Bid } from "@/lib/mock-data";

let bids: Bid[] = MOCK_BIDS.map((bid) => ({ ...bid, attachments: bid.attachments.map((attachment) => ({ ...attachment })) }));
let savedBidIds: string[] = bids.filter((bid) => bid.saved).map((bid) => bid.id);

export function listBids() {
  return bids;
}

export function getSavedBidIds() {
  return savedBidIds;
}

export function replaceSavedBidIds(ids: string[]) {
  savedBidIds = ids;
}

export function resetBidRepositoryForTests() {
  bids = MOCK_BIDS.map((bid) => ({ ...bid, attachments: bid.attachments.map((attachment) => ({ ...attachment })) }));
  savedBidIds = bids.filter((bid) => bid.saved).map((bid) => bid.id);
}
```

- [ ] **Step 5: Create service implementation**

Create `frontend/src/server/bids/service.ts` with:

```ts
import { STATE_FILTERS, type Bid, type DatePreset, type SortOption } from "@/lib/mock-data";
import { getSavedBidIds, listBids, replaceSavedBidIds } from "./repository";
import { BidNotFoundError, type ApiIssuerType, type BidListResponse, type BidQuery, type NormalizedBidQuery, type SavedBidsResponse } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysFromToday(dateString: string) {
  const today = startOfDay(new Date("2026-05-18T00:00:00"));
  const target = startOfDay(new Date(dateString));
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

function daysAgo(dateString: string) {
  const today = startOfDay(new Date("2026-05-18T00:00:00"));
  const target = startOfDay(new Date(dateString));
  return Math.round((today.getTime() - target.getTime()) / MS_PER_DAY);
}

function normalizeQuery(query: BidQuery): NormalizedBidQuery {
  return {
    q: query.q?.trim() ?? "",
    states: query.states ?? [],
    issuerType: query.issuerType ?? "all",
    deadline: query.deadline ?? "any",
    published: query.published ?? "any",
    sort: query.sort ?? "relevance",
  };
}

function matchesDeadlinePreset(dateString: string, preset: DatePreset) {
  if (preset === "any") return true;
  const days = daysFromToday(dateString);
  if (preset === "next7") return days >= 0 && days <= 7;
  if (preset === "next30") return days >= 0 && days <= 30;
  return true;
}

function matchesPublishedPreset(dateString: string, preset: DatePreset) {
  if (preset === "any") return true;
  const days = daysAgo(dateString);
  if (preset === "last24") return days >= 0 && days <= 1;
  if (preset === "last7") return days >= 0 && days <= 7;
  return true;
}

function matchesStateFilters(bid: Bid, stateIds: string[]) {
  if (stateIds.length === 0) return true;
  const selectedFilters = STATE_FILTERS.filter((state) => stateIds.includes(state.id));

  return selectedFilters.some(
    (filter) =>
      filter.stateCode === bid.stateCode ||
      filter.label === bid.source ||
      bid.source.includes(filter.stateCode) ||
      bid.source.includes(filter.label.split(" ")[0])
  );
}

function sortBids(bids: Bid[], sort: SortOption) {
  return [...bids].sort((a, b) => {
    if (sort === "deadline") {
      return new Date(a.deadlineDate).getTime() - new Date(b.deadlineDate).getTime();
    }
    if (sort === "newest") {
      return new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime();
    }
    return 0;
  });
}

export function queryBids(query: BidQuery): BidListResponse {
  const filters = normalizeQuery(query);
  const normalizedQuery = filters.q.toLowerCase();

  const bids = sortBids(
    listBids().filter((bid) => {
      const searchableText = [
        bid.title,
        bid.description,
        bid.issuerName,
        bid.originalCategory,
        ...bid.tags,
      ].join(" ").toLowerCase();

      return (
        bid.isActive &&
        (normalizedQuery === "" || searchableText.includes(normalizedQuery)) &&
        matchesStateFilters(bid, filters.states) &&
        (filters.issuerType === "all" || bid.issuerType === filters.issuerType) &&
        matchesDeadlinePreset(bid.deadlineDate, filters.deadline) &&
        matchesPublishedPreset(bid.publishedDate, filters.published)
      );
    }),
    filters.sort
  );

  return { bids, total: bids.length, filters };
}

export function getBidById(id: string) {
  return listBids().find((bid) => bid.id === id);
}

export function getSavedBids(): SavedBidsResponse {
  const ids = getSavedBidIds();
  const savedSet = new Set(ids);
  const bids = listBids().filter((bid) => savedSet.has(bid.id));
  return { savedBidIds: ids, bids };
}

export function saveBid(id: string): SavedBidsResponse {
  if (!getBidById(id)) {
    throw new BidNotFoundError();
  }

  const ids = getSavedBidIds();
  if (!ids.includes(id)) {
    replaceSavedBidIds([...ids, id]);
  }

  return getSavedBids();
}

export function removeSavedBid(id: string): SavedBidsResponse {
  replaceSavedBidIds(getSavedBidIds().filter((savedId) => savedId !== id));
  return getSavedBids();
}
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/bids/service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/server/bids frontend/package.json frontend/package-lock.json frontend/vitest.config.ts
git commit -m "feat: add tested bid service"
```

---

## Task 3: Add API Route Handlers

**Files:**
- Create: `frontend/src/app/api/bids/route.ts`
- Create: `frontend/src/app/api/bids/route.test.ts`
- Create: `frontend/src/app/api/bids/[id]/route.ts`
- Create: `frontend/src/app/api/bids/[id]/route.test.ts`
- Create: `frontend/src/app/api/saved-bids/route.ts`
- Create: `frontend/src/app/api/saved-bids/route.test.ts`
- Create: `frontend/src/app/api/saved-bids/[id]/route.ts`
- Create: `frontend/src/app/api/saved-bids/[id]/route.test.ts`

- [ ] **Step 1: Write failing route handler tests**

Create `frontend/src/app/api/bids/route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import { GET } from "./route";

describe("GET /api/bids", () => {
  beforeEach(() => resetBidRepositoryForTests());

  it("returns filtered bid results from query parameters", async () => {
    const response = await GET(new Request("http://localhost/api/bids?q=cloud&issuerType=federal"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.bids[0].title).toBe("Enterprise Cloud Migration Services");
    expect(body.filters.q).toBe("cloud");
  });
});
```

Create `frontend/src/app/api/bids/[id]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import { GET } from "./route";

describe("GET /api/bids/[id]", () => {
  beforeEach(() => resetBidRepositoryForTests());

  it("returns bid detail", async () => {
    const response = await GET(new Request("http://localhost/api/bids/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bid.title).toBe("Enterprise Cloud Migration Services");
  });

  it("returns 404 for missing bid", async () => {
    const response = await GET(new Request("http://localhost/api/bids/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("BID_NOT_FOUND");
  });
});
```

Create `frontend/src/app/api/saved-bids/route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import { GET, POST } from "./route";

describe("/api/saved-bids", () => {
  beforeEach(() => resetBidRepositoryForTests());

  it("returns saved bids", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual(["2"]);
    expect(body.bids[0].title).toBe("Statewide Broadband Infrastructure Upgrade");
  });

  it("saves an existing bid", async () => {
    const response = await POST(new Request("http://localhost/api/saved-bids", {
      method: "POST",
      body: JSON.stringify({ bidId: "1" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual(["2", "1"]);
  });

  it("rejects missing bidId", async () => {
    const response = await POST(new Request("http://localhost/api/saved-bids", {
      method: "POST",
      body: JSON.stringify({}),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});
```

Create `frontend/src/app/api/saved-bids/[id]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import { DELETE } from "./route";

describe("DELETE /api/saved-bids/[id]", () => {
  beforeEach(() => resetBidRepositoryForTests());

  it("removes a saved bid", async () => {
    const response = await DELETE(new Request("http://localhost/api/saved-bids/2"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd frontend
npm test -- src/app/api
```

Expected: FAIL because the route modules do not exist.

- [ ] **Step 3: Create shared route helpers inside each route**

Use `NextResponse.json(...)` directly in route handlers. Do not create a separate helper file in this task.

Create `frontend/src/app/api/bids/route.ts`:

```ts
import { NextResponse } from "next/server";
import { queryBids } from "@/server/bids/service";
import type { ApiIssuerType, BidQuery } from "@/server/bids/types";
import type { DatePreset, SortOption } from "@/lib/mock-data";

function parseList(value: string | null) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query: BidQuery = {
    q: searchParams.get("q") ?? "",
    states: parseList(searchParams.get("states")),
    issuerType: (searchParams.get("issuerType") as ApiIssuerType | null) ?? "all",
    deadline: (searchParams.get("deadline") as DatePreset | null) ?? "any",
    published: (searchParams.get("published") as DatePreset | null) ?? "any",
    sort: (searchParams.get("sort") as SortOption | null) ?? "relevance",
  };

  return NextResponse.json(queryBids(query));
}
```

Create `frontend/src/app/api/bids/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getBidById } from "@/server/bids/service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bid = getBidById(id);

  if (!bid) {
    return NextResponse.json(
      { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ bid });
}
```

Create `frontend/src/app/api/saved-bids/route.ts`:

```ts
import { NextResponse } from "next/server";
import { BidNotFoundError } from "@/server/bids/types";
import { getSavedBids, saveBid } from "@/server/bids/service";

export async function GET() {
  return NextResponse.json(getSavedBids());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const bidId = typeof body?.bidId === "string" ? body.bidId : "";

  if (!bidId) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "bidId is required" } },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(saveBid(bidId));
  } catch (error) {
    if (error instanceof BidNotFoundError) {
      return NextResponse.json(
        { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Unable to save bid" } },
      { status: 500 }
    );
  }
}
```

Create `frontend/src/app/api/saved-bids/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { removeSavedBid } from "@/server/bids/service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(removeSavedBid(id));
}
```

- [ ] **Step 4: Verify routes compile**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api frontend/src/server/bids
git commit -m "feat: add bid API routes"
```

---

## Task 4: Add Tested Client API Helpers

**Files:**
- Create: `frontend/src/lib/api/bids.ts`
- Create: `frontend/src/lib/api/bids.test.ts`

- [ ] **Step 1: Write failing fetch helper tests**

Create `frontend/src/lib/api/bids.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBid, fetchBids, fetchSavedBids, removeSavedBid, saveBid } from "./bids";

describe("bid API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds bid list query strings", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ bids: [], total: 0, filters: {} }),
    } as Response);

    await fetchBids({ q: "cloud", states: ["sam", "ca"], issuerType: "federal", deadline: "next30", published: "last7", sort: "newest" });

    expect(fetchMock).toHaveBeenCalledWith("/api/bids?q=cloud&states=sam%2Cca&issuerType=federal&deadline=next30&published=last7&sort=newest");
  });

  it("fetches bid detail and saved bids", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ bid: { id: "1" }, savedBidIds: ["1"], bids: [{ id: "1" }] }),
    } as Response);

    await fetchBid("1");
    await fetchSavedBids();

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/bids/1");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/saved-bids");
  });

  it("saves and removes saved bids", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ savedBidIds: ["1"], bids: [{ id: "1" }] }),
    } as Response);

    await saveBid("1");
    await removeSavedBid("1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/saved-bids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId: "1" }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/saved-bids/1", { method: "DELETE" });
  });

  it("throws API errors with status and code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "BID_NOT_FOUND", message: "Bid not found" } }),
    } as Response);

    await expect(fetchBid("missing")).rejects.toMatchObject({
      status: 404,
      code: "BID_NOT_FOUND",
      message: "Bid not found",
    });
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd frontend
npm test -- src/lib/api/bids.test.ts
```

Expected: FAIL because `./bids` does not exist.

- [ ] **Step 3: Create fetch helpers**

Create `frontend/src/lib/api/bids.ts`:

```ts
import type { DatePreset, IssuerType, SortOption } from "@/lib/mock-data";
import type { ApiErrorResponse, BidDetailResponse, BidListResponse, SavedBidsResponse } from "@/server/bids/types";

export interface FetchBidsParams {
  q?: string;
  states?: string[];
  issuerType?: "all" | IssuerType;
  deadline?: DatePreset;
  published?: DatePreset;
  sort?: SortOption;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json();

  if (!response.ok) {
    const errorBody = body as ApiErrorResponse;
    throw new ApiError(
      response.status,
      errorBody.error?.code ?? "INTERNAL_ERROR",
      errorBody.error?.message ?? "Request failed"
    );
  }

  return body as T;
}

export async function fetchBids(params: FetchBidsParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.states?.length) searchParams.set("states", params.states.join(","));
  if (params.issuerType) searchParams.set("issuerType", params.issuerType);
  if (params.deadline) searchParams.set("deadline", params.deadline);
  if (params.published) searchParams.set("published", params.published);
  if (params.sort) searchParams.set("sort", params.sort);

  const query = searchParams.toString();
  return parseResponse<BidListResponse>(await fetch(`/api/bids${query ? `?${query}` : ""}`));
}

export async function fetchBid(id: string) {
  return parseResponse<BidDetailResponse>(await fetch(`/api/bids/${id}`));
}

export async function fetchSavedBids() {
  return parseResponse<SavedBidsResponse>(await fetch("/api/saved-bids"));
}

export async function saveBid(bidId: string) {
  return parseResponse<SavedBidsResponse>(
    await fetch("/api/saved-bids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId }),
    })
  );
}

export async function removeSavedBid(id: string) {
  return parseResponse<SavedBidsResponse>(await fetch(`/api/saved-bids/${id}`, { method: "DELETE" }));
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd frontend
npm test -- src/lib/api/bids.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api
git commit -m "feat: add bid API client"
```

---

## Task 5: Connect Saved Bid Context To API

**Files:**
- Modify: `frontend/src/context/SavedBidsContext.tsx`

- [ ] **Step 1: Add API-backed context behavior**

Replace direct `MOCK_BIDS` initialization in `frontend/src/context/SavedBidsContext.tsx` with API hydration.

The context should expose:

```ts
interface SavedBidsContextType {
  savedBidIds: string[];
  savedBids: Bid[];
  isLoading: boolean;
  error: string | null;
  toggleSaveBid: (id: string) => Promise<void>;
  isSaved: (id: string) => boolean;
}
```

Use:

```ts
import { fetchSavedBids, removeSavedBid, saveBid } from "@/lib/api/bids";
import type { Bid } from "@/lib/mock-data";
```

Implementation requirements:

- Hydrate once in `useEffect` with `fetchSavedBids()`.
- Store both `savedBidIds` and `savedBids` from the API response.
- `toggleSaveBid(id)` calls `removeSavedBid(id)` when saved, otherwise `saveBid(id)`.
- Update local state from the API response.
- Keep error text in `error` if hydration or mutation fails.

- [ ] **Step 2: Run verification**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/context/SavedBidsContext.tsx
git commit -m "feat: connect saved bids context to API"
```

---

## Task 6: Connect Search Workspace To API

**Files:**
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1: Remove local filtering logic**

In `frontend/src/app/page.tsx`, remove:

- `useMemo`
- `MOCK_BIDS` import
- local `MS_PER_DAY`, `startOfDay`, `daysFromToday`, `daysAgo`
- local `matchesDeadlinePreset`
- local `matchesPublishedPreset`
- `filteredBids` derived from `MOCK_BIDS`

Keep:

- filter state
- `STATE_FILTERS`
- `DatePreset`, `IssuerType`, `SortOption`
- visual layout

- [ ] **Step 2: Add API data state**

Add:

```ts
import { useEffect, useState } from "react";
import { fetchBids } from "@/lib/api/bids";
import type { Bid } from "@/lib/mock-data";
```

Add state:

```ts
const [bids, setBids] = useState<Bid[]>([]);
const [total, setTotal] = useState(0);
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
```

Add effect:

```ts
useEffect(() => {
  let cancelled = false;
  setIsLoading(true);
  setError(null);

  fetchBids({
    q: searchQuery,
    states: selectedStates,
    issuerType,
    deadline: deadlinePreset,
    published: publishedPreset,
    sort: sortBy,
  })
    .then((response) => {
      if (cancelled) return;
      setBids(response.bids);
      setTotal(response.total);
    })
    .catch(() => {
      if (cancelled) return;
      setError(t("dashboard.errorTitle"));
      setBids([]);
      setTotal(0);
    })
    .finally(() => {
      if (!cancelled) setIsLoading(false);
    });

  return () => {
    cancelled = true;
  };
}, [deadlinePreset, issuerType, publishedPreset, searchQuery, selectedStates, sortBy, t]);
```

If `t` is unstable and causes repeated requests, use literal English fallback in the catch and display translated copy at render time.

- [ ] **Step 3: Render loading, error, and API result states**

Render:

- Loading skeleton cards while `isLoading`.
- Error block with retry action when `error` is set.
- Existing empty state when `!isLoading && !error && bids.length === 0`.
- Bid cards from `bids`.
- Result count from `total`.

Use existing `Skeleton` from `frontend/src/components/ui/skeleton.tsx`.

- [ ] **Step 4: Run verification**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat: load bid search results from API"
```

---

## Task 7: Connect Detail And Saved Pages To API

**Files:**
- Modify: `frontend/src/app/bids/[id]/page.tsx`
- Modify: `frontend/src/app/saved/page.tsx`

- [ ] **Step 1: Update detail page data loading**

In `frontend/src/app/bids/[id]/page.tsx`:

- Remove `MOCK_BIDS` import.
- Import `useEffect`, `useState`, `fetchBid`, and type `Bid`.
- Add `bid`, `isLoading`, and `error` state.
- Fetch `fetchBid(bidId)` when `bidId` changes.
- Show existing not-found UI for `ApiError` code `BID_NOT_FOUND`.
- Show a compact error state for other failures.
- Keep existing metadata, contact, source link, attachments, and save button layout.

- [ ] **Step 2: Update saved page data source**

In `frontend/src/app/saved/page.tsx`:

- Remove `MOCK_BIDS` and `useMemo`.
- Read `savedBids`, `isLoading`, and `error` from `useSavedBids()`.
- Show loading skeleton cards while saved bids hydrate.
- Show error block if hydration fails.
- Render `savedBids` otherwise.
- Keep existing empty state and card grid.

- [ ] **Step 3: Run verification**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add 'frontend/src/app/bids/[id]/page.tsx' frontend/src/app/saved/page.tsx
git commit -m "feat: load detail and saved pages from API"
```

---

## Task 8: Final Verification And Browser Acceptance

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

Expected: all pass.

- [ ] **Step 2: Start dev server**

Run:

```bash
cd frontend
npm run dev
```

Expected: local server starts on `http://localhost:3000`.

- [ ] **Step 3: Verify API endpoints manually**

Run:

```bash
curl -sS 'http://localhost:3000/api/bids?q=cloud' | rg 'Enterprise Cloud Migration Services'
curl -sS 'http://localhost:3000/api/bids/1' | rg 'Department of Defense'
curl -sS 'http://localhost:3000/api/saved-bids' | rg 'Statewide Broadband Infrastructure Upgrade'
```

Expected: each command finds the expected text.

- [ ] **Step 4: Verify browser flow**

In the browser:

- Open `http://localhost:3000`.
- Confirm English is default.
- Search `cloud`; confirm only `Enterprise Cloud Migration Services` appears.
- Open the detail page; confirm metadata, contact, source link, and attachments appear.
- Save the bid.
- Navigate to Saved Bids; confirm the newly saved bid appears.
- Remove the saved bid; confirm the saved count updates.
- Switch to Chinese; confirm navigation and workflow labels translate.
- Set a 390px viewport; confirm there is no horizontal overflow.

- [ ] **Step 5: Stop dev server**

Stop the dev server before final reporting.

- [ ] **Step 6: Commit any verification fixes**

If verification required code fixes:

```bash
git add <changed-files>
git commit -m "fix: polish API-backed bid flow"
```

If no fixes were needed, do not create an empty commit.
