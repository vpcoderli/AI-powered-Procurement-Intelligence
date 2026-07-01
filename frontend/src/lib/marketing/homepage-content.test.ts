import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMarketingHomepageContent,
  homepageAnalyticsEvents,
  homepageRouteMap,
  marketingHomepageLanguages,
  recordHomepageAnalyticsEvent,
} from "./homepage-content";

describe("marketing homepage content", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defines bilingual editable content for the full Homepage PRD surface", () => {
    expect(marketingHomepageLanguages).toEqual(["en", "zh"]);

    for (const language of marketingHomepageLanguages) {
      const content = getMarketingHomepageContent(language);

      expect(content.hero.headline).toBeTruthy();
      expect(content.hero.primaryCta.href).toBe("/register");
      expect(content.finalCta.secondaryCta.href).toBe("/request-demo");
      expect(content.hero.secondaryCta.href).toBe("#how-it-works");
      expect(content.sections.howItWorks.title).toBeTruthy();
      expect(content.sections.productMap.title).toBeTruthy();
      expect(content.sections.pricing.title).toBeTruthy();
      expect(content.sections.resources.title).toBeTruthy();
      expect(content.sections.faq.title).toBeTruthy();
      expect(content.nav.map((item) => item.label)).toHaveLength(7);
      expect(content.lifecycle.map((step) => step.key)).toEqual([
        "match",
        "understand",
        "decide",
        "prepare",
        "submit",
        "learn",
      ]);
      expect(content.productMap.map((item) => item.key)).toEqual([
        "supplier_profile",
        "bid_discovery",
        "pursuit_readiness",
        "pursuit_pipeline",
        "knowledge_station",
      ]);
      expect(content.pricingTiers.map((tier) => tier.key)).toEqual([
        "free",
        "starter",
        "builder",
        "growth",
        "enterprise",
      ]);
      expect(content.safeClaims).toHaveLength(3);
      expect(content.resources.map((resource) => resource.href)).toEqual([
        "/resources/glossary",
        "/resources/supplier-workflow",
        "/resources/supplier-workflow",
      ]);
      expect(content.faq).toHaveLength(4);
      expect(content.pricingTiers.every((tier) => Object.values(homepageRouteMap).includes(tier.cta.href))).toBe(true);
    }
  });

  it("applies safe local config overrides without changing default content", () => {
    const defaultContent = getMarketingHomepageContent("en");
    const overrideContent = getMarketingHomepageContent("en", {
      en: {
        hero: {
          headline: "Find reviewed opportunities your team can assess.",
        },
        finalCta: {
          body: "Move from public search to an organized response workspace when the fit is credible.",
        },
      },
    });

    expect(overrideContent.hero.headline).toBe("Find reviewed opportunities your team can assess.");
    expect(overrideContent.finalCta.body).toBe(
      "Move from public search to an organized response workspace when the fit is credible.",
    );
    expect(overrideContent.hero.subheadline).toBe(defaultContent.hero.subheadline);
    expect(getMarketingHomepageContent("en").hero.headline).toBe(defaultContent.hero.headline);
  });

  it("falls back to default homepage content when an override contains unsafe claims", () => {
    const content = getMarketingHomepageContent("en", {
      en: {
        hero: {
          headline: "Guarantee wins with complete compliance guarantee.",
        },
      },
    });

    expect(content.hero.headline).toBe(getMarketingHomepageContent("en").hero.headline);
  });

  it("keeps public CTAs on real local routes or in-page anchors", () => {
    expect(homepageRouteMap).toEqual({
      product: "#product-map",
      howItWorks: "#how-it-works",
      knowledge: "#knowledge-station",
      pricing: "#pricing",
      resources: "/resources",
      signIn: "/login",
      startFree: "/register",
      requestDemo: "/request-demo",
      publicSearch: "/search",
    });
  });

  it("keeps homepage CTA smoke routes on local 200 surfaces or in-page anchors", () => {
    const ctas = [
      { label: "Start Free", href: homepageRouteMap.startFree },
      { label: "Request Demo", href: homepageRouteMap.requestDemo },
      { label: "Public Search", href: homepageRouteMap.publicSearch },
      { label: "Pricing", href: homepageRouteMap.pricing },
      { label: "Resources", href: homepageRouteMap.resources },
    ];

    expect(ctas).toEqual([
      { label: "Start Free", href: "/register" },
      { label: "Request Demo", href: "/request-demo" },
      { label: "Public Search", href: "/search" },
      { label: "Pricing", href: "#pricing" },
      { label: "Resources", href: "/resources" },
    ]);

    for (const cta of ctas.filter((item) => item.href.startsWith("/"))) {
      expect(routeHasLocalPage(cta.href), `${cta.label} should not route to a local 404`).toBe(true);
    }
  });

  it("documents the funnel analytics events without storing credentials or secrets", () => {
    expect(homepageAnalyticsEvents).toEqual([
      "view_homepage",
      "click_start_free",
      "click_see_how_it_works",
      "click_pricing_tier",
      "click_request_demo",
      "click_public_search",
      "start_signup",
    ]);

    expect(JSON.stringify(homepageAnalyticsEvents)).not.toMatch(/secret|token|password|key/i);
  });

  it("records homepage funnel events in a local browser queue", () => {
    const fakeWindow = {} as Window;
    vi.stubGlobal("window", fakeWindow);

    recordHomepageAnalyticsEvent("click_start_free", { surface: "hero" });
    recordHomepageAnalyticsEvent("click_pricing_tier", { tier: "enterprise" });

    expect(
      (fakeWindow as Window & {
        winbidsMarketingEvents?: Array<{ eventName: string; metadata: Record<string, string> }>;
      }).winbidsMarketingEvents,
    ).toEqual([
      expect.objectContaining({ eventName: "click_start_free", metadata: { surface: "hero" } }),
      expect.objectContaining({ eventName: "click_pricing_tier", metadata: { tier: "enterprise" } }),
    ]);
  });
});

function routeHasLocalPage(href: string) {
  const pathname = href.split("?")[0];
  const route = pathname === "/" ? "page.tsx" : `${pathname.replace(/^\//, "")}/page.tsx`;

  return existsSync(new URL(`../../app/${route}`, import.meta.url));
}
