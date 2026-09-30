import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminConfigRegistryEntry } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { AdminResourceStatus, useAdminResource } from "../use-admin-resource";

// The section reads one resource and the language. The resource hook is replaced with plain state, typed against the
// real hook's return type. English goes through the real LanguageProvider; Chinese cannot (a server render always
// resolves to English), so `useLanguage` answers with the real Chinese dictionary and the same dot-path lookup.
type ResourceStub = ReturnType<typeof useAdminResource<AdminConfigRegistryEntry[]>>;
const stubs = vi.hoisted(() => ({ language: "en" as "en" | "zh", resource: null as ResourceStub | null }));

vi.mock("../use-admin-resource", () => ({
  useAdminResource: (): ResourceStub => {
    if (!stubs.resource) throw new Error("load() was not called");
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

import { ConfigRegistrySection } from "./ConfigRegistrySection";

const enAdmin = en.admin as Record<string, string>;
const zhAdmin = zh.admin as Record<string, string>;
type Language = "en" | "zh";
const admin = (language: Language) => (language === "en" ? enAdmin : zhAdmin);

function load(state: { status: AdminResourceStatus; data?: AdminConfigRegistryEntry[] | null }) {
  stubs.resource = { status: state.status, data: state.data ?? null, error: null, reload: async () => undefined, setData: () => undefined };
}

function entry(overrides: Partial<AdminConfigRegistryEntry>): AdminConfigRegistryEntry {
  return {
    id: "cfg-1",
    scopeType: "global",
    scopeId: null,
    module: "feature",
    configKey: "quote_workflow",
    configValue: { enabled: true },
    schemaVersion: 1,
    status: "active",
    effectiveFrom: null,
    effectiveTo: null,
    createdBy: null,
    updatedBy: null,
    changeReason: "",
    auditEventId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
}

// A `$&` in an admin-typed reason must come out as typed.
const MARKETING = entry({ id: "cfg-copy", module: "ux_state", configKey: "copy_library", status: "draft", changeReason: "Raised the price to $& 5" });
const OTHER = entry({ id: "cfg-feature", scopeType: "organization", scopeId: "org-1" });

function render(language: Language) {
  stubs.language = language;
  return renderToStaticMarkup(
    <LanguageProvider>
      <ConfigRegistrySection />
    </LanguageProvider>,
  );
}

/** The text nodes of rendered markup, so an attribute value (`value="draft"`) is never read as on-screen copy. */
const textNodes = (html: string) => html.split(/<[^>]*>/).map((text) => text.trim()).filter(Boolean);
const tagsCount = (html: string, text: string) => html.split(text).length - 1;

beforeEach(() => {
  load({ status: "ready", data: [MARKETING, OTHER] });
});

describe.each<Language>(["en", "zh"])("config registry section in %s", (language) => {
  const t = admin(language);

  it("prints the titles, the CMS cues, the headers and the empty state from the dictionary", () => {
    const text = textNodes(render(language));

    expect(text).toContain(t.configRegistryTitle);
    expect(text).toContain(t.configRegistrySubtitle);
    expect(text).toContain(t.configRegistryCmsTitle);
    expect(text).toContain(t.configRegistrySafeValidationLabel);
    expect(text).toContain(t.configRegistrySafeValidationText);
    for (const key of [
      "configRegistryModule",
      "configRegistryKey",
      "status",
      "configRegistryScope",
      "configRegistryConfigJson",
      "configRegistryChangeReason",
      "configRegistryUpdated",
      "configRegistryAction",
    ]) {
      expect(text, key).toContain(t[key]);
    }

    load({ status: "ready", data: [] });
    expect(textNodes(render(language))).toContain(t.configRegistryEmpty);
  });

  // The label ends in its colon and the sentence follows it, two nodes with only the closing tag between them. The gap
  // has to be a space of its own: a margin on the label looks the same on screen but reads, copies and searches as
  // "validation:unsafe" (the pre-translation markup printed ": " after the label).
  it("puts a real space between the safe-validation label and its sentence", () => {
    const readingOrder = render(language).replace(/<[^>]*>/g, "");

    expect(readingOrder).toContain(`${t.configRegistrySafeValidationLabel} ${t.configRegistrySafeValidationText}`);
  });

  it("puts the CMS entry id in a code chip in the middle of the description", () => {
    const [before, after] = t.configRegistryCmsDescription.split("{key}");

    expect(render(language)).toContain(`${before}<code class="rounded bg-white px-1">ux_state.copy_library</code>${after}`);
  });

  it("shows the copy-library note on the marketing entry only", () => {
    const html = render(language);

    expect(tagsCount(html, t.configRegistryCopyLibraryNote)).toBe(1);
  });

  it("labels the status badge and every status option, keeping the stored value", () => {
    const html = render(language);

    // The marketing entry is a draft: its badge names the draft status and its select lists all three.
    expect(html).toMatch(new RegExp(`<option value="draft"[^>]*>${t.configRegistryStatus_draft}</option>`));
    expect(html).toMatch(new RegExp(`<option value="active"[^>]*>${t.configRegistryStatus_active}</option>`));
    expect(html).toMatch(new RegExp(`<option value="inactive"[^>]*>${t.configRegistryStatus_inactive}</option>`));
    expect(textNodes(html).filter((text) => text === t.configRegistryStatus_draft).length).toBeGreaterThanOrEqual(2);
  });

  it("names the inputs by entry id and translated label, and prints the last reason as typed", () => {
    const html = render(language);

    expect(html).toContain(`aria-label="ux_state.copy_library ${t.configRegistryConfigJson}"`);
    expect(html).toContain(`aria-label="ux_state.copy_library ${t.configRegistryChangeReason}"`);
    expect(html).toContain(`placeholder="${t.configRegistryChangeReason}"`);
    // (The expectation fills the placeholder through a function for the same reason the component does.)
    const lastReason = (reason: string) => t.configRegistryLastReason.replace("{reason}", () => reason);
    expect(textNodes(html)).toContain(lastReason("Raised the price to $& 5").replace(/&/g, "&amp;"));
    expect(textNodes(html)).toContain(lastReason("-"));
  });

  it("labels the save button and leaves no placeholder or dictionary key on the page", () => {
    const html = render(language);

    expect(textNodes(html)).toContain(t.configRegistrySave);
    expect(html).not.toMatch(/\{(key|reason)\}/);
    // A key the dictionary lacks would print as itself.
    expect(html).not.toMatch(/admin\.[a-zA-Z]/);
  });

  it("titles the loading and the failed state", () => {
    load({ status: "loading" });
    expect(textNodes(render(language))).toContain(t.configRegistryTitle);

    load({ status: "error" });
    expect(textNodes(render(language))).toContain(t.configRegistryTitle);
  });
});

describe("config registry section in Chinese", () => {
  it("renders the safe-validation label, a space and its sentence", () => {
    expect(render("zh")).toContain(
      ">安全校验：</span> 不安全声明拦截由营销内容解析器强制执行。涉及结果、合规或提交的不安全声明会在发布前被拒绝，站点将回退到默认营销文案。",
    );
  });

  it("prints none of the English copy the component used to hard-code", () => {
    const text = textNodes(render("zh"));

    for (const key of [
      "configRegistryTitle",
      "configRegistrySubtitle",
      "configRegistryRefreshing",
      "configRegistryCmsTitle",
      "configRegistrySafeValidationLabel",
      "configRegistrySafeValidationText",
      "configRegistryModule",
      "configRegistryKey",
      "configRegistryScope",
      "configRegistryConfigJson",
      "configRegistryChangeReason",
      "configRegistryUpdated",
      "configRegistryAction",
      "configRegistryCopyLibraryNote",
      "configRegistrySave",
      "configRegistryStatus_active",
      "configRegistryStatus_draft",
      "configRegistryStatus_inactive",
      "status",
      "refresh",
    ]) {
      expect(zhAdmin[key], key).not.toBe(enAdmin[key]);
      expect(text.filter((node) => node.includes(enAdmin[key])), `${key}: "${enAdmin[key]}"`).toEqual([]);
    }
  });
});

describe("config registry section in English", () => {
  it("renders the copy it always did", () => {
    const html = render("en");

    expect(html).toContain("Config Registry");
    expect(html).toContain("Config Matrix");
    expect(html).toContain("Marketing Content CMS");
    expect(html).toContain(
      'Copy Library edits live in <code class="rounded bg-white px-1">ux_state.copy_library</code> and cover homepage/resources scope.',
    );
    expect(html).toContain(">safe validation:</span> unsafe claim guard is enforced by the marketing content resolver. Unsafe outcome, compliance, or submission claims are rejected before publish and the site falls back to default marketing copy.");
    expect(html).toContain(">Save config</button>");
    expect(html).toContain("Last: -");
    expect(html).toContain("Last: Raised the price to $&amp; 5");
  });
});
