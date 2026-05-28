import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/server/admin/auth";
import * as adminAuth from "@/server/admin/auth";
import * as usersRepository from "@/server/admin/users-repository";
import { GET, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock("@/server/admin/users-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/users-repository")>();
  return {
    ...actual,
    listAdminUserFeatureOverrides: vi.fn(),
    updateAdminUserFeatureOverride: vi.fn(),
  };
});

const context = { params: Promise.resolve({ id: "user_1" }) };

describe("GET /api/admin/users/[id]/feature-overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns feature overrides for full admins", async () => {
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });
    vi.mocked(usersRepository.listAdminUserFeatureOverrides).mockReturnValueOnce({
      organizationId: "org_1",
      organizationName: "Buyer Workspace",
      overrides: [{ featureKey: "compliance_manifest", isEnabled: true }],
    });

    const response = await GET(new Request("http://localhost/api/admin/users/user_1/feature-overrides"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.overrides).toEqual([{ featureKey: "compliance_manifest", isEnabled: true }]);
    expect(usersRepository.listAdminUserFeatureOverrides).toHaveBeenCalledWith({}, "user_1");
  });

  it("denies non-admin requests", async () => {
    vi.mocked(adminAuth.requireAdmin).mockRejectedValueOnce(new AdminAuthError());

    const response = await GET(new Request("http://localhost/api/admin/users/user_1/feature-overrides"), context);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("PATCH /api/admin/users/[id]/feature-overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a feature override for full admins", async () => {
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });
    vi.mocked(usersRepository.updateAdminUserFeatureOverride).mockReturnValueOnce({
      organizationId: "org_1",
      organizationName: "Buyer Workspace",
      overrides: [{ featureKey: "compliance_manifest", isEnabled: false }],
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/users/user_1/feature-overrides", {
        method: "PATCH",
        body: JSON.stringify({ featureKey: "compliance_manifest", isEnabled: false }),
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.overrides).toEqual([{ featureKey: "compliance_manifest", isEnabled: false }]);
    expect(usersRepository.updateAdminUserFeatureOverride).toHaveBeenCalledWith(
      {},
      "user_1",
      { featureKey: "compliance_manifest", isEnabled: false },
      { actorKind: "admin", actorUserId: "admin_1" },
    );
  });

  it("rejects admin console feature overrides", async () => {
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });

    const response = await PATCH(
      new Request("http://localhost/api/admin/users/user_1/feature-overrides", {
        method: "PATCH",
        body: JSON.stringify({ featureKey: "admin_console", isEnabled: true }),
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(usersRepository.updateAdminUserFeatureOverride).not.toHaveBeenCalled();
  });
});
