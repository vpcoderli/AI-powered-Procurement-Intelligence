import type { Pool } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMysqlSessionUser } from "./mysql-service";

const NOW = Date.parse("2026-10-01T00:00:00.000Z");

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => vi.restoreAllMocks());

function sessionStore(expiresAt: string) {
  const store = {
    query: vi.fn(async (sql: string) => [sql.includes("FROM sessions") ? [{
      sessionId: "session-1", expiresAt, id: "user-1", email: "user@example.com", passwordHash: null,
      displayName: null, role: "user", accountTier: "free", isDisabled: 0,
    }] : []]),
    execute: vi.fn(async () => [{ affectedRows: 1 }]),
  };
  return { store, pool: store as unknown as Pool };
}

describe("MySQL user session expiry", () => {
  it.each(["", "not a date", "275760-09-14T00:00:00.000Z", "2000-01-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"])(
    "refuses and removes an unreadable or elapsed expiry %j",
    async (expiresAt) => {
      const { store, pool } = sessionStore(expiresAt);

      await expect(getMysqlSessionUser(pool, "token")).resolves.toBeNull();
      expect(store.execute).toHaveBeenCalledExactlyOnceWith("DELETE FROM sessions WHERE id = ?", ["session-1"]);
      expect(store.query).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a valid future session and returns its user", async () => {
    const { store, pool } = sessionStore("2026-10-01T00:00:00.001Z");

    await expect(getMysqlSessionUser(pool, "token")).resolves.toMatchObject({ id: "user-1", email: "user@example.com" });
    expect(store.execute).toHaveBeenCalledExactlyOnceWith("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [expect.any(String), "session-1"]);
  });
});
