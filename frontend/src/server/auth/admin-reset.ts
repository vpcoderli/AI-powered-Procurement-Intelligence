import { and, asc, eq } from "drizzle-orm";
import { organizationMemberships, organizations, users } from "@/server/db/schema";
import type { AppDatabase } from "@/server/db/client";
import { hashPassword } from "./password";

export const LOCAL_ADMIN_EMAIL = "admin@winbids.local";
export const LOCAL_ADMIN_PASSWORD = "AdminLocal-2026!";

const LOCAL_ADMIN_USER_ID = "user_local_admin";
const LOCAL_ADMIN_ORGANIZATION_ID = "org_local_admin";

interface ResetLocalAdminPasswordInput {
  email?: string;
  password?: string;
  displayName?: string;
}

export async function resetLocalAdminPassword(
  db: AppDatabase,
  input: ResetLocalAdminPasswordInput = {},
) {
  const email = input.email ?? LOCAL_ADMIN_EMAIL;
  const password = input.password ?? LOCAL_ADMIN_PASSWORD;
  const displayName = input.displayName ?? "WinBids Local Admin";
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  const existingUser = db.select().from(users).where(eq(users.email, email)).get();
  const userId = existingUser?.id ?? LOCAL_ADMIN_USER_ID;
  const existingMembership = existingUser
    ? db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, existingUser.id))
        .orderBy(asc(organizationMemberships.createdAt), asc(organizationMemberships.organizationId))
        .get()
    : undefined;
  const organizationId = existingMembership?.organizationId ?? LOCAL_ADMIN_ORGANIZATION_ID;

  const existingOrganization = db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .get();
  if (existingOrganization) {
    db.update(organizations)
      .set({
        name: existingOrganization.name || "WinBids Local Admin Workspace",
        accountTier: "enterprise",
        updatedAt: now,
      })
      .where(eq(organizations.id, organizationId))
      .run();
  } else {
    db.insert(organizations)
      .values({
        id: organizationId,
        name: "WinBids Local Admin Workspace",
        accountTier: "enterprise",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  if (existingUser) {
    db.update(users)
      .set({
        passwordHash,
        displayName: existingUser.displayName ?? displayName,
        role: "admin",
        accountTier: "enterprise",
        isDisabled: 0,
        updatedAt: now,
      })
      .where(eq(users.id, existingUser.id))
      .run();
  } else {
    db.insert(users)
      .values({
        id: userId,
        email,
        passwordHash,
        displayName,
        role: "admin",
        accountTier: "enterprise",
        isDisabled: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  if (existingMembership) {
    db.update(organizationMemberships)
      .set({
        role: "owner",
        status: "active",
        updatedAt: now,
      })
      .where(and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.organizationId, organizationId),
      ))
      .run();
  } else {
    db.insert(organizationMemberships)
      .values({
        organizationId,
        userId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  return {
    email,
    password,
    userId,
    organizationId,
  };
}
