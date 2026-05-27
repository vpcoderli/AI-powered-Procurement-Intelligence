import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSupplierProfile, updateSupplierProfile } from "./profile";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

const profile = {
  userId: "anon_profile",
  companyName: "Acme Supply",
  businessTypes: [],
  categories: [],
  keywords: ["cloud"],
  certifications: [],
  serviceStates: [],
  minContractValue: null,
  maxContractValue: null,
  riskPreferences: [],
  completionScore: 25,
  createdAt: null,
  updatedAt: "2026-05-27T00:00:00.000Z",
} as const;

describe("supplier profile API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches supplier profile", async () => {
    const body = { profile };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchSupplierProfile();

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/company/profile");
  });

  it("updates supplier profile", async () => {
    const input = { companyName: "Acme Supply", keywords: ["cloud"] };
    const body = { profile };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateSupplierProfile(input);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/company/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });
});
