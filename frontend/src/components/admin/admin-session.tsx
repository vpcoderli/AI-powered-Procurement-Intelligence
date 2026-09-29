"use client";

import { createContext, useContext } from "react";
import type { PublicUser } from "@/lib/api/auth";
import type { AdminConsoleRole } from "@/server/auth/entitlements";

export interface AdminRoleFlags {
  role: AdminConsoleRole;
  isAdmin: boolean;
  isOperator: boolean;
  /** Crawler runs, prechecks, triage, crawler config, notification delivery, bid QA writes. */
  canRunOperations: boolean;
  /** Users, audit log, per-source approve/hold. */
  canManageUsers: boolean;
  canManageConfig: boolean;
}

export interface AdminSession extends AdminRoleFlags {
  user: PublicUser;
}

/** The old page's role flags (page.tsx: isAdmin, isOperator, canRunOperations, canManageUsers, canManageConfig). */
export function adminRoleFlags(role: AdminConsoleRole): AdminRoleFlags {
  const isAdmin = role === "admin";
  const isOperator = role === "operator";
  return {
    role,
    isAdmin,
    isOperator,
    canRunOperations: isAdmin || isOperator,
    canManageUsers: isAdmin,
    canManageConfig: isAdmin,
  };
}

const AdminSessionContext = createContext<AdminSession | null>(null);

export const AdminSessionProvider = AdminSessionContext.Provider;

export function useAdminSession(): AdminSession {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error("useAdminSession must be used inside AdminShell");
  return session;
}
