import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "@/server/db/client";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";

const store = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/server/db/mysql", () => ({
  isMysqlDatabaseUrlConfigured: () => true,
  resolveMysqlPool: () => store,
}));

import { requireAdminAccess } from "./auth";

const NOW = Date.parse("2026-10-01T00:00:00.000Z");
const request = () => new Request("http://localhost/api/admin/data-sources", { headers: { cookie: `${SESSION_COOKIE_NAME}=admin-token` } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ADMIN_UI_LOCAL_BYPASS", "false");
  store.execute.mockResolvedValue([{ affectedRows: 1 }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function session(expiresAt: string) {
  store.query.mockResolvedValue([[{ sessionId: "admin-session", expiresAt, userId: "admin-user", role: "admin", isDisabled: 0 }]]);
}

describe("MySQL admin session expiry", () => {
  it.each(["", "not a date", "275760-09-14T00:00:00.000Z", "2000-01-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"])(
    "refuses an unreadable or elapsed expiry %j before marking the session seen",
    async (expiresAt) => {
      session(expiresAt);

      await expect(requireAdminAccess({} as AppDatabase, request())).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(store.execute).not.toHaveBeenCalled();
    },
  );

  it("allows a valid future expiry", async () => {
    session("2026-10-01T00:00:00.001Z");

    await expect(requireAdminAccess({} as AppDatabase, request())).resolves.toEqual({ kind: "admin", role: "admin", userId: "admin-user" });
    expect(store.execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE sessions SET last_seen_at"), [expect.any(String), "admin-session"]);
  });
});
