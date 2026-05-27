import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import * as profileService from "@/server/profile/service";
import { GET, PUT } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/profile/service", () => ({
  getSupplierProfile: vi.fn(),
  upsertSupplierProfile: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getSupplierProfile = vi.mocked(profileService.getSupplierProfile);
const upsertSupplierProfile = vi.mocked(profileService.upsertSupplierProfile);

const emptyProfile = {
  userId: "anon_profile",
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
} as const;

describe("GET /api/company/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty profile for anonymous user", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_profile",
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_profile; Path=/`,
    });
    getSupplierProfile.mockResolvedValueOnce(emptyProfile);

    const response = await GET(new Request("http://localhost/api/company/profile"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ profile: emptyProfile });
    expect(response.headers.get("set-cookie")).toContain(
      `${ANONYMOUS_USER_COOKIE_NAME}=anon_profile`,
    );
    expect(getSupplierProfile).toHaveBeenCalledWith(expect.anything(), "anon_profile");
  });
});

describe("PUT /api/company/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "anonymous", userId: "anon_profile" });
  });

  it("stores profile and returns score", async () => {
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
    expect(upsertSupplierProfile).toHaveBeenCalledWith(expect.anything(), "anon_profile", input);
  });

  it("invalid body returns 400", async () => {
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
});
