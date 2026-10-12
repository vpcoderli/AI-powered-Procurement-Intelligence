import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

const language = vi.hoisted(() => ({ current: "en" as "en" | "zh" }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user_1", email: "user@example.com", tier: "enterprise", role: "user", features: [] }, isLoading: false, refreshSession: vi.fn() }),
}));
vi.mock("@/lib/i18n/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => {
    let value: unknown = language.current === "en" ? en : zh;
    for (const part of key.split(".")) value = (value as Record<string, unknown> | undefined)?.[part];
    return typeof value === "string" ? value : key;
  } }),
}));
// Render the pages' options without the select portal or active-tab visibility hiding their content.
vi.mock("@/components/ui/select", () => {
  const container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Select: container, SelectTrigger: container, SelectContent: container, SelectValue: () => null,
    SelectItem: ({ children, value }: { children?: React.ReactNode; value: string }) => <span data-option={value}>{children}</span>,
  };
});
vi.mock("@/components/ui/tabs", () => {
  const container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Tabs: container, TabsContent: container, TabsList: container, TabsTrigger: container };
});

import SearchPage from "@/app/search/page";
import SettingsPage from "@/app/settings/page";

const expectedTypes = [
  ["federal", "Federal", "联邦"], ["state", "State", "州级"],
  ["county", "County", "县级"], ["city", "City", "市级"],
  ["township", "Township", "乡镇级"], ["special_district", "Special district", "特别区"],
];

describe.each(["en", "zh"] as const)("issuer controls (%s)", (locale) => {
  it.each([["search", SearchPage], ["subscription editor", SettingsPage]] as const)("offers every actual government level in %s", (_name, Page) => {
    language.current = locale;
    const html = renderToStaticMarkup(<Page />);
    const options = [...html.matchAll(/<span data-option="([^"]+)">([^<]*)<\/span>/g)].map((match) => [match[1], match[2]]);

    for (const [value, english, chinese] of expectedTypes) {
      expect(options).toContainEqual([value, locale === "en" ? english : chinese]);
    }
    expect(options.filter(([value]) => value === "all")).toHaveLength(1);
    expect(html).not.toContain("State and local");
    expect(html).not.toContain("州与地方");
  });
});
