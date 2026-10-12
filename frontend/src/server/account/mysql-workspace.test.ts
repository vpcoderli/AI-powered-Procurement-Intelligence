import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceInvitationNotFoundError } from "./workspace";
import { acceptMysqlWorkspaceInvitation } from "./mysql-workspace";

describe("MySQL workspace invitation expiry", () => {
  it.each(["", "not a date", "275760-09-14T00:00:00.000Z"])(
    "refuses an unreadable expiry %j before any member lookup or credential write",
    async (expiresAt) => {
      const store = {
        query: vi.fn(async () => [[{
          id: "invitation-1", organizationId: "org-1", invitedUserId: "user-1", invitedByUserId: "owner-1",
          expiresAt, acceptedAt: null, revokedAt: null,
        }]]),
        execute: vi.fn(async () => [{ affectedRows: 1 }]),
      };

      await expect(acceptMysqlWorkspaceInvitation(store as unknown as Pool, { token: "token", password: "strong-password" })).rejects.toBeInstanceOf(WorkspaceInvitationNotFoundError);
      expect(store.query).toHaveBeenCalledTimes(1);
      expect(store.execute).not.toHaveBeenCalled();
    },
  );
});
