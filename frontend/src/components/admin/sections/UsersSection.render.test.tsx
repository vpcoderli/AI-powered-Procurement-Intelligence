import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { adminRoleFlags, type useAdminSession } from "../admin-session";
import type { useAdminResource } from "../use-admin-resource";

// The section reads the shell's session, one resource and the language. The two hooks are replaced with plain state,
// typed against the real hooks' return types. English goes through the real LanguageProvider; Chinese cannot (a server
// render always resolves to English), so `useLanguage` answers with the real Chinese dictionary and the same dot-path
// lookup.
type SessionStub = ReturnType<typeof useAdminSession>;
type ResourceStub = ReturnType<typeof useAdminResource<AdminUser[]>>;
const stubs = vi.hoisted(() => ({ language: "en" as "en" | "zh", session: null as SessionStub | null, resource: null as ResourceStub | null }));

vi.mock("../admin-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../admin-session")>()),
  useAdminSession: (): SessionStub => {
    if (!stubs.session) throw new Error("session was not set");
    return stubs.session;
  },
}));
vi.mock("../use-admin-resource", () => ({
  useAdminResource: (): ResourceStub => {
    if (!stubs.resource) throw new Error("resource was not set");
    return stubs.resource;
  },
}));
vi.mock("@/lib/i18n/LanguageContext", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/i18n/LanguageContext")>();
  const { zh: zhDictionary } = await import("@/lib/i18n/dictionaries/zh");
  const lookup = (key: string): string => {
    let value: unknown = zhDictionary;
    for (const part of key.split(".")) value = (value as Record<string, unknown> | undefined)?.[part];
    return typeof value === "string" ? value : key;
  };
  const zhLanguage: ReturnType<typeof original.useLanguage> = { language: "zh", setLanguage: () => undefined, t: lookup, dict: zhDictionary };
  return { ...original, useLanguage: () => (stubs.language === "zh" ? zhLanguage : original.useLanguage()) };
});

import { UsersSection } from "./UsersSection";

type Language = "en" | "zh";
const dictionaries = { en, zh };

const user = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: "on",
  email: "on@example.com",
  displayName: "Olive On",
  role: "user",
  tier: "free",
  isDisabled: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastLoginAt: null,
  ...overrides,
});

beforeEach(() => {
  stubs.session = {
    user: { id: "user-1", email: "admin@example.com", displayName: null, role: "admin", tier: "enterprise", features: [] },
    ...adminRoleFlags("admin"),
  };
  stubs.resource = {
    status: "ready",
    data: [user(), user({ id: "off", email: "off@example.com", displayName: "Otto Off", isDisabled: true })],
    error: null,
    reload: async () => undefined,
    setData: () => undefined,
  };
});

function render(language: Language) {
  stubs.language = language;
  return renderToStaticMarkup(
    <LanguageProvider>
      <UsersSection />
    </LanguageProvider>,
  );
}

/** The `[value, label]` pairs of the select whose accessible name is `ariaLabel`. */
function optionsOf(html: string, ariaLabel: string) {
  const select = [...html.matchAll(/<select[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)].find((match) => match[1] === ariaLabel);
  if (!select) throw new Error(`no select named "${ariaLabel}"`);
  return [...select[2].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((option) => [option[1], option[2]]);
}

/** The text of every column header of the users table, in order. */
const headers = (html: string) => [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1]);

/** The word beside the switch of the row for user `id` (the switch's label points at `user-<id>`). */
const stateWord = (html: string, id: string) => new RegExp(`<label[^>]*for="user-${id}"[^>]*>([^<]*)</label>`).exec(html)?.[1];

// `admin.enabled` / `admin.disabled` were the words of the status filter and of each row's switch, and `admin.enabled` was also the
// header of the switch column, so one Chinese text (启用, the action's word) stood for a state and for the column, next to 已禁用,
// a word the console uses nowhere else for a disabled thing.
describe("users section state words", () => {
  it.each<[Language, string[][]]>([
    ["en", [["all", "All statuses"], ["enabled", "Enabled"], ["disabled", "Disabled"]]],
    ["zh", [["all", "全部状态"], ["enabled", "已启用"], ["disabled", "已停用"]]],
  ])("offers the status filter as two states in %s and keeps the stored values", (language, expected) => {
    const admin = dictionaries[language].admin as Record<string, string>;

    expect(optionsOf(render(language), admin.status)).toEqual(expected);
  });

  it.each<[Language, string, string]>([
    ["en", "Enabled", "Disabled"],
    ["zh", "已启用", "已停用"],
  ])("says which state each account is in with the state words, in %s", (language, enabled, disabled) => {
    const html = render(language);

    expect(stateWord(html, "on")).toBe(enabled);
    expect(stateWord(html, "off")).toBe(disabled);
  });

  it("prints no 已禁用 anywhere in the Chinese section", () => {
    // Matched apart from the markup, so a failure prints the hits and not the page.
    expect(render("zh").match(/已禁用/g)).toBeNull();
  });
});

describe("users section switch column header", () => {
  it.each<[Language, string[]]>([
    ["en", ["Account", "Role", "Plan", "Last login", "Feature Overrides", "Enabled"]],
    ["zh", ["账户", "角色", "套餐", "上次登录", "功能覆盖", "启用状态"]],
  ])("heads the column in %s with a noun over the switches", (language, expected) => {
    expect(headers(render(language))).toEqual(expected);
  });

  it("does not head the Chinese column with either state word or with the action's word", () => {
    const [header] = headers(render("zh")).slice(-1);

    for (const word of ["已启用", "已停用", "启用", "停用"]) expect(header).not.toBe(word);
  });
});
