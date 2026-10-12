import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS, type Bid } from "@/lib/mock-data";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

const state = vi.hoisted(() => ({ bid: null as Bid | null, cursor: 0, language: "en" as "en" | "zh" }));
vi.mock("react", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return { ...react, useState: (initial: unknown) => {
    const cursor = state.cursor++;
    return [cursor === 0 ? state.bid : cursor === 3 ? false : initial, vi.fn()];
  } };
});
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "2" }), useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user_1" }, isLoading: false }) }));
vi.mock("@/context/SavedBidsContext", () => ({ useSavedBids: () => ({ isSaved: () => false, toggleSaveBid: vi.fn() }) }));
vi.mock("@/lib/i18n/LanguageContext", () => ({ useLanguage: () => ({ t: (key: string) => {
  let value: unknown = state.language === "en" ? en : zh;
  for (const part of key.split(".")) value = (value as Record<string, unknown> | undefined)?.[part];
  return typeof value === "string" ? value : key;
} }) }));
import BidDetailsPage from "./page";

describe.each(["en", "zh"] as const)("detail content usability (%s)", (language) => {
  beforeEach(() => { state.cursor = 0; state.language = language; });
  it("shows missing content explicitly and does not offer analysis creation", () => {
    state.bid = { ...MOCK_BIDS[1], description: "Description:", fullDescription: "Please log in to view details." };
    const html = renderToStaticMarkup(<BidDetailsPage />);
    expect(html).toContain(language === "en" ? "procurement description is missing" : "采购正文缺失");
    expect(html).toContain(language === "en" ? "Analysis pending valid content" : "等待有效正文后分析");
    expect(html).not.toContain(language === "en" ? ">Add to Intent<" : ">加入意向<");
    expect(html).not.toContain("Please log in to view details.");
  });
  it("keeps unknown verification truthful for short legacy procurement scope", () => {
    state.bid = { ...MOCK_BIDS[1], description: "Supply 12 pumps.", fullDescription: "" };
    const html = renderToStaticMarkup(<BidDetailsPage />);
    expect(html).toContain("Supply 12 pumps.");
    expect(html).toContain(language === "en" ? "last verification time is unknown" : "最近核验时间未知");
  });
});
