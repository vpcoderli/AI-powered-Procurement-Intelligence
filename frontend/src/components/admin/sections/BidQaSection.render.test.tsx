import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBidQaItem, AdminBidQaResponse } from "@/lib/api/admin";
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
type ResourceStub = ReturnType<typeof useAdminResource<AdminBidQaResponse>>;
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

import { BidQaSection } from "./BidQaSection";

type Language = "en" | "zh";
const dictionaries = { en, zh };

beforeEach(() => {
  stubs.session = {
    user: { id: "user-1", email: "admin@example.com", displayName: null, role: "admin", tier: "enterprise", features: [] },
    ...adminRoleFlags("admin"),
  };
  stubs.resource = {
    status: "ready",
    data: { summary: { total: 0, needsReview: 0, archiveIssues: 0, lowQuality: 0 }, items: [] },
    error: null,
    reload: async () => undefined,
    setData: () => undefined,
  };
});

function render(language: Language) {
  stubs.language = language;
  return renderToStaticMarkup(
    <LanguageProvider>
      <BidQaSection />
    </LanguageProvider>,
  );
}

/** The `[value, label]` pairs of the select whose accessible name is `ariaLabel`. */
function optionsOf(html: string, ariaLabel: string) {
  const select = [...html.matchAll(/<select[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)].find((match) => match[1] === ariaLabel);
  if (!select) throw new Error(`no select named "${ariaLabel}"`);
  return [...select[2].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((option) => [option[1], option[2]]);
}

describe("bid QA source confidence filter", () => {
  it.each<[Language, string[][]]>([
    ["en", [["all", "All confidence"], ["high", "High confidence"], ["medium", "Medium confidence"], ["low", "Low confidence"]]],
    ["zh", [["all", "全部置信度"], ["high", "高置信度"], ["medium", "中等置信度"], ["low", "低置信度"]]],
  ])("lists translated options in %s and keeps the stored values", (language, expected) => {
    const admin = dictionaries[language].admin as Record<string, string>;

    expect(optionsOf(render(language), admin.sourceConfidence)).toEqual(expected);
  });

  it.each<Language>(["en", "zh"])("takes the labels from the shared three-tier confidence vocabulary in %s", (language) => {
    const admin = dictionaries[language].admin as Record<string, string>;
    const tiers = dictionaries[language].intentsPage.confidence;

    expect(optionsOf(render(language), admin.sourceConfidence)).toEqual([
      ["all", admin.allConfidence],
      ["high", tiers.high],
      ["medium", tiers.medium],
      ["low", tiers.low],
    ]);
  });

  it("no longer prints the stored words as labels", () => {
    for (const language of ["en", "zh"] as const) {
      const labels = optionsOf(render(language), (dictionaries[language].admin as Record<string, string>).sourceConfidence).map(([, label]) => label);

      for (const word of ["high", "medium", "low"]) expect(labels, `${language} ${word}`).not.toContain(word);
    }
  });
});

// The row's correction draft carries a flag for a date the browser holds only in part (badInput). A row nobody touched has
// none: its date input shows the stored day, is not marked invalid, and Save corrections stays off until something changes.
// (A server render never fires the input's events, so the flagged state is covered by the helpers' tests.)
describe("bid QA deadline correction input", () => {
  const ITEM: AdminBidQaItem = {
    id: "bid-1",
    title: "Roof replacement",
    source: "co_bidnet",
    sourceBidId: "B-100",
    issuerName: "City of Aurora",
    stateCode: "CO",
    deadlineDate: "07/10/2026",
    sourceConfidence: "high",
    qualityFlags: [],
    qualityScore: 90,
    adminReviewStatus: "unreviewed",
    adminReviewNote: null,
    adminReviewedAt: null,
    adminReviewedBy: null,
    displayStatus: "published",
    detailArchiveStatus: "archived",
    detailArchiveError: null,
    attachmentCount: 0,
    archiveIssueCount: 0,
    archiveFailedCount: 0,
    archiveUnavailableCount: 0,
    correctionCount: 0,
    updatedAt: "2026-09-30T00:00:00.000Z",
  };

  function renderWithItem(language: Language) {
    stubs.resource = {
      ...stubs.resource!,
      data: { summary: { total: 1, needsReview: 1, archiveIssues: 0, lowQuality: 0 }, items: [ITEM] },
    };
    return render(language);
  }

  it.each<Language>(["en", "zh"])("shows the stored day in an unflagged date input, with Save corrections off, in %s", (language) => {
    const admin = dictionaries[language].admin as Record<string, string>;
    const html = renderWithItem(language);
    // The filter bar has two date inputs of its own; the row's is the one labelled for the correction.
    const dateInputs = (html.match(/<input[^>]*\btype="date"[^>]*>/g) ?? []).filter((input) => input.includes(admin.saveCorrections));

    // "07/10/2026" is the day the deadline column prints, and the input shows the same day.
    expect(dateInputs).toHaveLength(1);
    expect(dateInputs[0]).toContain('value="2026-07-10"');
    // (The class list carries "aria-invalid:" variants; only the attribute counts.)
    expect(dateInputs[0]).not.toMatch(/\saria-invalid=/);
    expect(html).toMatch(new RegExp(`<button[^>]*\\bdisabled=""[^>]*>${admin.saveCorrections}</button>`));
  });
});
