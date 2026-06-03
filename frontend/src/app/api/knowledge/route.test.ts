import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import { applyFeatureOverrides, featuresForUser, type AccountTier } from "@/server/auth/entitlements";
import type { RequestPrincipal } from "@/server/auth/principal";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import type { AppDatabase } from "@/server/db/client";
import { organizationMemberships, organizations } from "@/server/db/schema";
import { createKnowledgeRouteHandlers } from "./route";

const dbMock = vi.hoisted(() => ({ current: null as AppDatabase | null }));

vi.mock("@/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db/client")>();

  return {
    ...actual,
    get db() {
      return dbMock.current;
    },
  };
});

vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);

const enterprisePrincipal: RequestPrincipal = {
  kind: "authenticated",
  userId: "anon_seed",
  role: "user",
  tier: "enterprise",
  features: featuresForUser({ role: "user", tier: "enterprise" }),
  workspace: {
    organizationId: "org_seed",
    organizationName: "Seed Organization",
    role: "owner",
    tier: "enterprise",
  },
};

const anonymousPrincipal: RequestPrincipal = {
  kind: "anonymous",
  userId: "anon_guest",
  role: "user",
  tier: "free",
  features: featuresForUser({ role: "user", tier: "free" }),
  anonymousCookie: "anon=anon_guest; Path=/; HttpOnly",
};

function principalForTier(tier: AccountTier, features = featuresForUser({ role: "user", tier })): RequestPrincipal {
  return {
    kind: "authenticated",
    userId: "anon_seed",
    role: "user",
    tier,
    features,
    workspace: {
      organizationId: "org_seed",
      organizationName: "Seed Organization",
      role: "owner",
      tier,
    },
  };
}

async function createKnowledgeTestDatabase() {
  const testDb = await createTestDatabase({ seed: true });
  const timestamp = "2026-05-29T00:00:00.000Z";

  testDb.db.insert(organizations)
    .values({
      id: "org_seed",
      name: "Seed Organization",
      accountTier: "enterprise",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();

  testDb.db.insert(organizationMemberships)
    .values({
      organizationId: "org_seed",
      userId: "anon_seed",
      role: "owner",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();

  return testDb;
}

describe("/api/knowledge", () => {
  let testDb: TestDatabase;
  let route: ReturnType<typeof createKnowledgeRouteHandlers>;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = await createKnowledgeTestDatabase();
    dbMock.current = testDb.db;
    route = createKnowledgeRouteHandlers(testDb.db);
    resolvePrincipal.mockResolvedValue(enterprisePrincipal);
  });

  afterEach(async () => {
    dbMock.current = null;
    await testDb?.cleanup();
  });

  it.each([
    ["Free", "free"],
    ["Pursuit Starter", "pro"],
    ["Response Builder", "business"],
  ] as const)("rejects %s users without knowledge_station by default", async (_label, tier) => {
    resolvePrincipal.mockResolvedValueOnce(principalForTier(tier));

    const response = await route.GET(new Request("http://localhost/api/knowledge"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({
      code: "FEATURE_NOT_AVAILABLE",
      feature: "knowledge_station",
    });
  });

  it.each([
    ["GET", (route: ReturnType<typeof createKnowledgeRouteHandlers>) =>
      route.GET(new Request("http://localhost/api/knowledge"))],
    ["POST", (route: ReturnType<typeof createKnowledgeRouteHandlers>) =>
      route.POST(new Request("http://localhost/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Anonymous snippet",
          body: "Anonymous users should not create private knowledge.",
          type: "template_snippet",
          tags: [],
          sourceKind: "manual",
        }),
      }))],
  ] as const)("requires authenticated workspace access for anonymous %s requests", async (_method, requestKnowledge) => {
    resolvePrincipal.mockResolvedValueOnce(anonymousPrincipal);

    const response = await requestKnowledge(route);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication is required",
    });
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("allows a lower-tier principal when an active organization override grants knowledge_station", async () => {
    resolvePrincipal.mockResolvedValueOnce(principalForTier(
      "business",
      applyFeatureOverrides(featuresForUser({ role: "user", tier: "business" }), [
        {
          featureKey: "knowledge_station",
          isEnabled: 1,
          expiresAt: "2026-06-03T00:00:00.000Z",
        },
      ], new Date("2026-06-02T00:00:00.000Z")),
    ));

    const response = await route.GET(new Request("http://localhost/api/knowledge"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [] });
  });

  it("creates and lists knowledge items for Enterprise users", async () => {
    const createResponse = await route.POST(new Request("http://localhost/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: " Past performance language ",
        body: "Reuse this response for similar cloud bids.",
        type: "template_snippet",
        tags: ["cloud", "past performance"],
        sourceKind: "manual",
      }),
    }));
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.item).toMatchObject({
      organizationId: "org_seed",
      createdByUserId: "anon_seed",
      title: "Past performance language",
      type: "template_snippet",
      sourceKind: "manual",
    });

    const listResponse = await route.GET(
      new Request("http://localhost/api/knowledge?q=cloud&type=template_snippet&limit=10"),
    );
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]).toMatchObject({
      id: createBody.item.id,
      body: "Reuse this response for similar cloud bids.",
      tags: ["cloud", "past performance"],
    });
  });

  it("returns INVALID_REQUEST for unsupported type", async () => {
    const response = await route.POST(new Request("http://localhost/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Bad type",
        body: "This should not be stored.",
        type: "unsupported",
        tags: [],
        sourceKind: "manual",
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toEqual({
      code: "INVALID_REQUEST",
      message: "Unsupported knowledge item type.",
    });
  });
});
