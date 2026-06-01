import { describe, expect, it, vi } from "vitest";
import {
  expandMysqlInClause,
  mysqlExecute,
  mysqlSelectMany,
  mysqlSelectOne,
  mysqlTransaction,
  normalizeMysqlBoolean,
  normalizeMysqlNumber,
  normalizeMysqlString,
} from "./mysql-runtime";

describe("mysql runtime helpers", () => {
  it("selects one or many rows from a mysql-like pool", async () => {
    const pool = {
      query: vi.fn(async () => [[{ id: "row_1" }, { id: "row_2" }]]),
    };

    await expect(mysqlSelectOne<{ id: string }>(pool, "SELECT * FROM users")).resolves.toEqual({ id: "row_1" });
    await expect(mysqlSelectMany<{ id: string }>(pool, "SELECT * FROM users")).resolves.toEqual([
      { id: "row_1" },
      { id: "row_2" },
    ]);
    expect(pool.query).toHaveBeenCalledWith("SELECT * FROM users", []);
  });

  it("returns null when selecting one row from an empty result", async () => {
    const pool = {
      query: vi.fn(async () => [[]]),
    };

    await expect(mysqlSelectOne(pool, "SELECT * FROM users WHERE id = ?", ["missing"])).resolves.toBeNull();
  });

  it("reports affected rows for execute statements", async () => {
    const pool = {
      execute: vi.fn(async () => [{ affectedRows: 3, insertId: 42 }]),
    };

    await expect(mysqlExecute(pool, "DELETE FROM sessions")).resolves.toEqual({
      affectedRows: 3,
      insertId: 42,
    });
  });

  it("expands IN clause placeholders safely", () => {
    expect(expandMysqlInClause(["a", "b", "c"])).toEqual({
      placeholders: "?, ?, ?",
      values: ["a", "b", "c"],
    });
    expect(() => expandMysqlInClause([])).toThrow("requires at least one value");
  });

  it("wraps transaction callbacks with commit and rollback behavior", async () => {
    const connection = {
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(),
    };
    const pool = {
      getConnection: vi.fn(async () => connection),
    };

    await expect(mysqlTransaction(pool, async () => "ok")).resolves.toBe("ok");
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();

    await expect(
      mysqlTransaction(pool, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledTimes(2);
  });

  it("normalizes primitive mysql values", () => {
    expect(normalizeMysqlString(null)).toBe("");
    expect(normalizeMysqlString("value")).toBe("value");
    expect(normalizeMysqlNumber("42")).toBe(42);
    expect(normalizeMysqlNumber(null)).toBeNull();
    expect(normalizeMysqlBoolean(1)).toBe(true);
    expect(normalizeMysqlBoolean("0")).toBe(false);
  });
});
