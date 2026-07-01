import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as marketingFunnel from "@/server/marketing/funnel";
import * as profileService from "@/server/profile/service";
import type { SupplierProfile } from "@/server/profile/types";
import { GET, PUT } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/profile/service", () => ({
  getSupplierProfile: vi.fn(),
  upsertSupplierProfile: vi.fn(),
}));
vi.mock("@/server/marketing/funnel", () => ({
  recordMarketingFunnelEvent: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getSupplierProfile = vi.mocked(profileService.getSupplierProfile);
const upsertSupplierProfile = vi.mocked(profileService.upsertSupplierProfile);

const emptyProfile: SupplierProfile = {
  userId: "user_1",
  companyName: "",
  businessTypes: [],
  categories: [],
  keywords: [],
  certifications: [],
  serviceStates: [],
  minContractValue: null,
  maxContractValue: null,
  riskPreferences: [],
  completionScore: 0,
  createdAt: null,
  updatedAt: null,
};

describe("GET /api/company/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({
      kind: "anonymous",
      userId: "anonymous",
      role: "user",
      tier: "free",
      features: [],
    });
  });

  it("requires an authenticated principal before reading the company profile", async () => {
    const response = await GET(new Request("http://localhost/api/company/profile"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(getSupplierProfile).not.toHaveBeenCalled();
  });

  it("returns empty profile for authenticated users", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    getSupplierProfile.mockResolvedValueOnce(emptyProfile);

    const response = await GET(new Request("http://localhost/api/company/profile"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ profile: emptyProfile });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(getSupplierProfile).toHaveBeenCalledWith(expect.anything(), "user_1");
  });

  it("returns JSON internal error when profile loading fails", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    getSupplierProfile.mockRejectedValueOnce(new Error("database failed"));

    const response = await GET(new Request("http://localhost/api/company/profile"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("PUT /api/company/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({
      kind: "anonymous",
      userId: "anonymous",
      role: "user",
      tier: "free",
      features: [],
    });
  });

  it("requires an authenticated principal before storing the company profile", async () => {
    const response = await PUT(
      new Request("http://localhost/api/company/profile", {
        method: "PUT",
        body: JSON.stringify({ companyName: "Acme Supply" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(upsertSupplierProfile).not.toHaveBeenCalled();
  });

  it("stores profile and returns score", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    const input = {
      companyName: "Acme Supply",
      keywords: ["cloud"],
    };
    const profile = {
      ...emptyProfile,
      companyName: "Acme Supply",
      keywords: ["cloud"],
      completionScore: 25,
      updatedAt: "2026-05-27T00:00:00.000Z",
    };
    upsertSupplierProfile.mockResolvedValueOnce(profile);

    const response = await PUT(
      new Request("http://localhost/api/company/profile", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ profile });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(upsertSupplierProfile).toHaveBeenCalledWith(expect.anything(), "user_1", input);
  });

  it("records supplier profile funnel events when the profile reaches completion threshold", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    upsertSupplierProfile.mockResolvedValueOnce({
      ...emptyProfile,
      companyName: "Acme Supply",
      categories: ["cloud"],
      serviceStates: ["CA", "TX"],
      completionScore: 75,
      updatedAt: "2026-05-27T00:00:00.000Z",
    });

    const response = await PUT(
      new Request("http://localhost/api/company/profile", {
        method: "PUT",
        body: JSON.stringify({ companyName: "Acme Supply", categories: ["cloud"], serviceStates: ["CA", "TX"] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(marketingFunnel.recordMarketingFunnelEvent).toHaveBeenNthCalledWith(1, expect.anything(), {
      eventName: "marketing.start_supplier_profile",
      actorId: "user_1",
      targetId: "user_1",
      metadata: { completionScore: 75 },
    });
    expect(marketingFunnel.recordMarketingFunnelEvent).toHaveBeenNthCalledWith(2, expect.anything(), {
      eventName: "marketing.complete_supplier_profile",
      actorId: "user_1",
      targetId: "user_1",
      metadata: { completionScore: 75 },
    });
  });

  it("invalid body returns 400", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });

    const response = await PUT(
      new Request("http://localhost/api/company/profile", {
        method: "PUT",
        body: "{",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(upsertSupplierProfile).not.toHaveBeenCalled();
  });

  it("returns JSON internal error when profile update fails", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    upsertSupplierProfile.mockRejectedValueOnce(new Error("database failed"));

    const response = await PUT(
      new Request("http://localhost/api/company/profile", {
        method: "PUT",
        body: JSON.stringify({ companyName: "Acme Supply" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
