import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getGlossaryContent,
  getResourceHubContent,
  getSupplierWorkflowContent,
  marketingResourceLanguages,
  resourceRouteMap,
} from "./resource-content";

describe("marketing resource content", () => {
  it("defines bilingual resource routes on real local pages", () => {
    expect(marketingResourceLanguages).toEqual(["en", "zh"]);
    expect(resourceRouteMap).toEqual({
      hub: "/resources",
      glossary: "/resources/glossary",
      supplierWorkflow: "/resources/supplier-workflow",
      startFree: "/register",
      requestDemo: "/request-demo",
      publicSearch: "/search",
    });

    for (const href of Object.values(resourceRouteMap).filter((value) => value.startsWith("/"))) {
      expect(routeHasLocalPage(href), `${href} should not route to a local 404`).toBe(true);
    }
  });

  it("keeps resource hub content aligned with the public supplier lifecycle", () => {
    for (const language of marketingResourceLanguages) {
      const content = getResourceHubContent(language);

      expect(content.hero.title).toBeTruthy();
      expect(content.hero.primaryCta.href).toBe("/register");
      expect(content.hero.secondaryCta.href).toBe("/request-demo");
      expect(content.guides.map((guide) => guide.key)).toEqual([
        "glossary",
        "supplier_workflow",
        "readiness_checklist",
      ]);
      expect(content.lifecycle.map((step) => step.key)).toEqual([
        "match",
        "understand",
        "decide",
        "prepare",
        "submit",
        "learn",
      ]);
      expect(content.safeClaims).toHaveLength(3);
      expect(JSON.stringify(content)).not.toMatch(/guarantee.*win|guaranteed.*award|automatically submit/i);
      expect(JSON.stringify(content)).not.toMatch(/保证中标|自动提交|保证授标/);
    }
  });

  it("applies safe local config overrides for resource hub and workflow pages", () => {
    const defaultHub = getResourceHubContent("en");
    const hub = getResourceHubContent("en", {
      hub: {
        en: {
          hero: {
            title: "Bid education for teams that review the source first.",
          },
        },
      },
    });
    const workflow = getSupplierWorkflowContent("en", {
      workflow: {
        en: {
          hero: {
            body: "Coordinate each preparation step without replacing buyer instructions.",
          },
        },
      },
    });

    expect(hub.hero.title).toBe("Bid education for teams that review the source first.");
    expect(hub.hero.body).toBe(defaultHub.hero.body);
    expect(workflow.hero.body).toBe("Coordinate each preparation step without replacing buyer instructions.");
    expect(getResourceHubContent("en").hero.title).toBe(defaultHub.hero.title);
  });

  it("falls back to default resource content when an override contains unsafe claims", () => {
    const content = getResourceHubContent("en", {
      hub: {
        en: {
          hero: {
            title: "Complete compliance guarantee for every public bid.",
          },
        },
      },
    });

    expect(content.hero.title).toBe(getResourceHubContent("en").hero.title);
  });

  it("defines glossary terms and supplier workflow guide sections", () => {
    for (const language of marketingResourceLanguages) {
      const glossary = getGlossaryContent(language);
      const workflow = getSupplierWorkflowContent(language);

      expect(glossary.terms.map((term) => term.key)).toEqual([
        "solicitation",
        "rfp",
        "amendment",
        "addendum",
        "responsiveness",
        "responsibility",
        "no_bid",
        "award_tabulation",
      ]);
      expect(glossary.terms.every((term) => term.definition.length > 20)).toBe(true);
      expect(workflow.sections.map((section) => section.key)).toEqual([
        "profile",
        "source_review",
        "pursuit_decision",
        "response_workspace",
        "official_submission",
        "learning_loop",
      ]);
      expect(workflow.sections.every((section) => section.steps.length >= 3)).toBe(true);
      expect(workflow.safeClaims).toHaveLength(3);
    }
  });
});

function routeHasLocalPage(href: string) {
  const pathname = href.split("?")[0];
  const route = pathname === "/" ? "page.tsx" : `${pathname.replace(/^\//, "")}/page.tsx`;

  return existsSync(new URL(`../../app/${route}`, import.meta.url));
}
