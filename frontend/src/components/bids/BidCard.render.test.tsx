import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MOCK_BIDS, type Bid } from "@/lib/mock-data";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

const language = vi.hoisted(() => ({ current: "en" as "en" | "zh" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/context/SavedBidsContext", () => ({ useSavedBids: () => ({ isSaved: () => false, toggleSaveBid: vi.fn() }) }));
vi.mock("@/lib/i18n/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => {
    let value: unknown = language.current === "en" ? en : zh;
    for (const part of key.split(".")) value = (value as Record<string, unknown> | undefined)?.[part];
    return typeof value === "string" ? value : key;
  } }),
}));

import { BidCard } from "./BidCard";

const issuerCases = [
  ["federal", "Federal", "联邦"],
  ["state", "State", "州级"],
  ["county", "County", "县级"],
  ["city", "City", "市级"],
  ["township", "Township", "乡镇级"],
  ["special_district", "Special district", "特别区"],
] as const;

describe.each(["en", "zh"] as const)("BidCard issuer badges (%s)", (locale) => {
  it("shows a truthful pending description instead of placeholder content", () => {
    language.current = locale;
    const bid: Bid = { ...MOCK_BIDS[1], description: "Please log in to view details.", fullDescription: "Description:" };
    const html = renderToStaticMarkup(<BidCard bid={bid} />);
    expect(html).toContain(locale === "en" ? "Description pending" : "正文待补");
    expect(html).not.toContain("Please log in to view details.");
    expect(html).not.toContain("Description:");
  });
  it.each(issuerCases)("shows %s as its own government level", (issuerType, english, chinese) => {
    language.current = locale;
    const bid: Bid = { ...MOCK_BIDS[1], issuerType };
    const html = renderToStaticMarkup(<BidCard bid={bid} />);
    const badges = [...html.matchAll(/<span[^>]*data-slot="badge"[^>]*>([^<]*)<\/span>/g)].map((match) => match[1]);

    expect(badges).toContain(locale === "en" ? english : chinese);
    if (issuerType !== "state") expect(badges).not.toContain(locale === "en" ? "State" : "州级");
  });
});
