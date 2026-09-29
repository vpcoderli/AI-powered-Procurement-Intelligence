import { describe, expect, it } from "vitest";
import { adminRoleFlags } from "./admin-session";

describe("adminRoleFlags", () => {
  it("matches the old page's role flags", () => {
    expect(adminRoleFlags("admin")).toEqual({ role: "admin", isAdmin: true, isOperator: false, canRunOperations: true, canManageUsers: true, canManageConfig: true });
    expect(adminRoleFlags("operator")).toEqual({ role: "operator", isAdmin: false, isOperator: true, canRunOperations: true, canManageUsers: false, canManageConfig: false });
    expect(adminRoleFlags("support")).toEqual({ role: "support", isAdmin: false, isOperator: false, canRunOperations: false, canManageUsers: false, canManageConfig: false });
  });
});
