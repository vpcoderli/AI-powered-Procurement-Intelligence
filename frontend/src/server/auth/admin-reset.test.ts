import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organizationMemberships, organizations, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { hashPassword, verifyPassword } from "./password";
import {
  LOCAL_ADMIN_EMAIL,
  LOCAL_ADMIN_PASSWORD,
  resetLocalAdminPassword,
} from "./admin-reset";

describe("local admin password reset", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("creates the local admin account when it is missing", async () => {
    const result = await resetLocalAdminPassword(testDb.db);

    expect(result).toMatchObject({
      email: LOCAL_ADMIN_EMAIL,
      password: LOCAL_ADMIN_PASSWORD,
    });

    const admin = testDb.db.select().from(users).where(eq(users.email, LOCAL_ADMIN_EMAIL)).get();
    expect(admin).toMatchObject({
      role: "admin",
      accountTier: "enterprise",
      isDisabled: 0,
    });
    expect(await verifyPassword(LOCAL_ADMIN_PASSWORD, admin?.passwordHash ?? "")).toBe(true);

    const membership = testDb.db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, admin?.id ?? ""))
      .get();
    expect(membership).toMatchObject({ role: "owner", status: "active" });
  });

  it("resets an existing disabled non-admin local account into an active enterprise admin", async () => {
    const now = new Date().toISOString();
    testDb.db.insert(organizations).values({
      id: "org_local_admin",
      name: "Old Local Admin Workspace",
      accountTier: "free",
      createdAt: now,
      updatedAt: now,
    }).run();
    testDb.db.insert(users).values({
      id: "user_local_admin",
      email: LOCAL_ADMIN_EMAIL,
      passwordHash: await hashPassword("OldPassword-2026!"),
      displayName: "Old Admin",
      role: "user",
      accountTier: "free",
      isDisabled: 1,
      createdAt: now,
      updatedAt: now,
    }).run();

    const result = await resetLocalAdminPassword(testDb.db);

    const admin = testDb.db.select().from(users).where(eq(users.id, "user_local_admin")).get();
    expect(result.userId).toBe("user_local_admin");
    expect(admin).toMatchObject({
      role: "admin",
      accountTier: "enterprise",
      isDisabled: 0,
    });
    expect(await verifyPassword("OldPassword-2026!", admin?.passwordHash ?? "")).toBe(false);
    expect(await verifyPassword(LOCAL_ADMIN_PASSWORD, admin?.passwordHash ?? "")).toBe(true);

    const organization = testDb.db.select().from(organizations).where(eq(organizations.id, "org_local_admin")).get();
    expect(organization).toMatchObject({ accountTier: "enterprise" });
  });

  it("promotes the existing local admin workspace tier used by login sessions", async () => {
    const now = new Date().toISOString();
    testDb.db.insert(organizations).values({
      id: "org_existing_admin",
      name: "Existing Admin Workspace",
      accountTier: "free",
      createdAt: now,
      updatedAt: now,
    }).run();
    testDb.db.insert(users).values({
      id: "user_existing_admin",
      email: LOCAL_ADMIN_EMAIL,
      passwordHash: await hashPassword("OldPassword-2026!"),
      displayName: "Existing Admin",
      role: "admin",
      accountTier: "free",
      isDisabled: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    testDb.db.insert(organizationMemberships).values({
      organizationId: "org_existing_admin",
      userId: "user_existing_admin",
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).run();

    const result = await resetLocalAdminPassword(testDb.db);

    expect(result.organizationId).toBe("org_existing_admin");
    expect(testDb.db.select().from(organizations).where(eq(organizations.id, "org_existing_admin")).get())
      .toMatchObject({ accountTier: "enterprise" });
  });
});
