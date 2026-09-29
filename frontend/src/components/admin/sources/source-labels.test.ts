import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import {
  crawlerAdapterLabel,
  crawlerCapabilityLabel,
  crawlerMaturityLabel,
  sourceApprovalLabel,
  sourceAuthorityLabel,
  sourceEvidenceLabel,
  sourceHealthClassificationLabel,
  sourceHealthDispositionLabel,
  sourceHealthTriageLabel,
  sourceHealthTriagePatchForAction,
  sourceHealthTriageStatus,
  sourceLegalReviewLabel,
  sourceLegalReviewTone,
  sourceRequirementLabels,
  sourceTrustLabel,
  formatCrawlerBaseUrl,
} from "./source-labels";
import { adminSourceFixture } from "./test-fixtures";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const adminEn = en.admin as Record<string, string>;
const adminZh = zh.admin as Record<string, string>;
/** The page's `t` for `admin.` keys; a key the dictionary lacks comes back as itself, as the real lookup does. */
const t = (key: string) => adminEn[key.replace(/^admin\./, "")] ?? key;

describe("source labels", () => {
  it("reads source health classification labels", () => {
    const labels: Record<string, string> = {
      "admin.sourceHealthClassification_all": "All",
      "admin.sourceHealthClassification_ok": "OK",
      "admin.sourceHealthClassification_forbidden": "Forbidden",
      "admin.sourceHealthClassification_timeout": "Timeout",
      "admin.sourceHealthClassification_bot_check": "Bot check",
      "admin.sourceHealthClassification_login_required": "Login required",
      "admin.sourceHealthClassification_empty_or_placeholder": "Empty/placeholder",
      "admin.sourceHealthClassification_tls_or_network_error": "Network/TLS",
      "admin.sourceHealthClassification_http_error": "HTTP error",
      "admin.sourceHealthClassification_unknown": "Unknown",
    };

    expect(sourceHealthClassificationLabel((key) => labels[key] ?? key, "empty_or_placeholder")).toBe(
      "Empty/placeholder",
    );
    expect(sourceHealthClassificationLabel((key) => labels[key] ?? key, "tls_or_network_error")).toBe("Network/TLS");
  });

  it("derives source health triage queue status from live review fields", () => {
    const now = new Date("2026-06-12T00:00:00.000Z");

    expect(sourceHealthTriageStatus({ liveHealthOwner: null, liveHealthNextReviewAt: null })).toBe("unassigned");
    expect(
      sourceHealthTriageStatus({
        liveHealthOwner: "ops@example.com",
        liveHealthNextReviewAt: "2026-06-11T00:00:00.000Z",
      }, now),
    ).toBe("overdue");
    expect(
      sourceHealthTriageStatus({
        liveHealthOwner: "ops@example.com",
        liveHealthNextReviewAt: "2026-06-13T00:00:00.000Z",
      }, now),
    ).toBe("scheduled");
    expect(
      sourceHealthTriageStatus({
        liveHealthOwner: "ops@example.com",
        liveHealthDisposition: "accepted_fallback",
        liveHealthNextReviewAt: null,
        liveHealthReviewedAt: "2026-06-10T00:00:00.000Z",
      }),
    ).toBe("reviewed");
  });

  it("creates source health triage patch payloads for quick actions", () => {
    const now = new Date("2026-06-12T00:00:00.000Z");

    expect(sourceHealthTriagePatchForAction("assign", "ops@example.com", now)).toMatchObject({
      liveHealthOwner: "ops@example.com",
      liveHealthDisposition: null,
      liveHealthNextReviewAt: "2026-06-13T00:00:00.000Z",
      liveHealthReviewedAt: null,
    });
    expect(sourceHealthTriagePatchForAction("vendor_account", "ops@example.com", now)).toMatchObject({
      liveHealthOwner: "ops@example.com",
      liveHealthDisposition: "vendor_account",
      liveHealthNextReviewAt: null,
      liveHealthReviewedAt: "2026-06-12T00:00:00.000Z",
    });
    expect(sourceHealthTriagePatchForAction("clear", "ops@example.com", now)).toEqual({
      liveHealthOwner: null,
      liveHealthDisposition: null,
      liveHealthNextReviewAt: null,
      liveHealthNotes: null,
      liveHealthReviewedAt: null,
    });
  });

  it("names the triage status and the disposition, and shows an unknown disposition as stored", () => {
    for (const status of ["unassigned", "overdue", "scheduled", "reviewed"] as const) {
      expect(sourceHealthTriageLabel(t, status)).toBe(adminEn[`sourceHealthTriage_${status}`]);
    }
    for (const disposition of ["accepted_fallback", "manual", "vendor_account"]) {
      expect(sourceHealthDispositionLabel(t, disposition)).toBe(adminEn[`sourceHealthDisposition_${disposition}`]);
    }
    expect(sourceHealthDispositionLabel(t, null)).toBe(adminEn.sourceHealthDisposition_pending);
    expect(sourceHealthDispositionLabel(t, "escalated")).toBe("escalated");
  });

  it("keeps the live health label keys and the triage fields in the shared helpers", () => {
    const labels = read("source-labels.ts");

    expect(labels).toContain('t("admin.liveSourceHealth_healthy")');
    expect(labels).toContain('t("admin.liveSourceHealthNoCheck")');
    expect(labels).toContain('t("admin.sourceHealthAction_update_registry_url")');
    for (const field of [
      "liveHealthOwner",
      "liveHealthDisposition",
      "liveHealthNextReviewAt",
      "liveHealthNotes",
      "liveHealthReviewedAt",
    ]) {
      expect(labels).toContain(field);
    }
  });
});

describe("governance and profile labels (the detail page's source profile card)", () => {
  it("names every crawler adapter, maturity and capability from the dictionary", () => {
    expect(crawlerAdapterLabel(t, "dedicated")).toBe(adminEn.crawlerAdapter_dedicated);
    expect(crawlerAdapterLabel(t, "generic")).toBe(adminEn.crawlerAdapter_generic);
    expect(crawlerAdapterLabel(t, "none")).toBe(adminEn.crawlerAdapter_none);
    for (const maturity of ["verified", "beta", "generic", "none"] as const) {
      expect(crawlerMaturityLabel(t, maturity)).toBe(adminEn[`crawlerMaturity_${maturity}`]);
    }
    for (const capability of ["query", "attachments", "detail_pages", "pagination"] as const) {
      expect(crawlerCapabilityLabel(t, capability)).toBe(adminEn[`crawlerCapability_${capability}`]);
    }
    expect(formatCrawlerBaseUrl("https://www.caleprocure.ca.gov/pages/x")).toBe("caleprocure.ca.gov");
    expect(formatCrawlerBaseUrl(null)).toBeNull();
  });

  it("names the approval, authority, trust and evidence of a source", () => {
    expect(sourceApprovalLabel(t, adminSourceFixture({ approvalStatus: "approved" }))).toBe(adminEn.sourceApproval_approved);
    expect(sourceApprovalLabel(t, adminSourceFixture({ approvalStatus: "blocked" }))).toBe(adminEn.sourceApproval_blocked);
    expect(sourceApprovalLabel(t, adminSourceFixture({ approvalStatus: "needs_review" }))).toBe(adminEn.sourceApproval_needs_review);
    for (const authority of ["official", "official_aggregator", "public_aggregator"] as const) {
      expect(sourceAuthorityLabel(t, authority)).toBe(adminEn[`sourceAuthority_${authority}`]);
    }
    for (const trust of ["verified", "beta", "fallback", "needs_review", "blocked"] as const) {
      expect(sourceTrustLabel(t, trust)).toBe(adminEn[`sourceTrust_${trust}`]);
    }
    for (const evidence of ["direct_portal", "api", "aggregator_page", "fixture_fallback"] as const) {
      expect(sourceEvidenceLabel(t, evidence)).toBe(adminEn[`sourceEvidence_${evidence}`]);
    }
  });

  it("lists what reaching the portal requires, login included", () => {
    expect(sourceRequirementLabels(t, adminSourceFixture())).toEqual([]);
    expect(sourceRequirementLabels(t, adminSourceFixture({ requiresBrowser: true, requiresLogin: true, requiresManual: true }))).toEqual([
      adminEn.sourceRequiresBrowser,
      adminEn.sourceRequiresLogin,
      adminEn.sourceRequiresManual,
    ]);
  });

  it("names the legal review, and shows a value the registry does not write as stored", () => {
    expect(sourceLegalReviewLabel(t, "approved_public")).toBe("Approved (public)");
    expect(sourceLegalReviewLabel(t, "not_reviewed")).toBe("Not reviewed");
    expect(sourceLegalReviewLabel(t, "restricted")).toBe("Restricted");
    // The crawler gate also accepts a plain "approved"; it must not read as "not reviewed".
    expect(sourceLegalReviewLabel(t, "approved")).toBe("approved");
    expect(sourceLegalReviewLabel(t, null)).toBe("-");
    expect(sourceLegalReviewTone("approved_public")).toContain("emerald");
    expect(sourceLegalReviewTone("approved")).toContain("emerald");
    expect(sourceLegalReviewTone("restricted")).toContain("rose");
    expect(sourceLegalReviewTone("not_reviewed")).toContain("amber");
    expect(sourceLegalReviewTone("something_else")).toContain("slate");
  });
});

describe("source label dictionary keys", () => {
  const families: Record<string, readonly string[]> = {
    // SourceLiveHealthCard's triage badge and disposition line.
    sourceHealthTriage: ["unassigned", "overdue", "scheduled", "reviewed"],
    sourceHealthDisposition: ["pending", "accepted_fallback", "manual", "vendor_account"],
    // SourceProfileCard.
    crawlerAdapter: ["dedicated", "generic", "none"],
    crawlerMaturity: ["verified", "beta", "generic", "none"],
    crawlerCapability: ["query", "attachments", "detail_pages", "pagination"],
    sourceApproval: ["approved", "needs_review", "blocked"],
    sourceAuthority: ["official", "official_aggregator", "public_aggregator"],
    sourceTrust: ["verified", "beta", "fallback", "needs_review", "blocked"],
    sourceEvidence: ["direct_portal", "api", "aggregator_page", "fixture_fallback"],
    sourceLegalReview: ["approved_public", "not_reviewed", "restricted"],
  };

  it.each(Object.entries(families))("has every %s_* key the helpers read in both languages", (family, values) => {
    for (const value of values) {
      const key = `${family}_${value}`;
      expect(adminEn[key], `en ${key}`).toBeTruthy();
      expect(adminZh[key], `zh ${key}`).toBeTruthy();
    }
  });

  it("gives the triage and disposition labels a Chinese text of their own", () => {
    for (const family of ["sourceHealthTriage", "sourceHealthDisposition"]) {
      for (const value of families[family]) expect(adminZh[`${family}_${value}`]).not.toBe(adminEn[`${family}_${value}`]);
    }
  });

  it("has the profile card's own labels in both languages, translated", () => {
    for (const key of [
      "sourceProfileTitle",
      "sourceLegalReview",
      "sourceLegalReview_approved_public",
      "sourceLegalReview_not_reviewed",
      "sourceLegalReview_restricted",
      "sourceApprovalNotes",
      "sourceAccessPattern",
      "sourceAccessMode",
      "sourceActivationStatus",
      "sourceRequirements",
      "sourceTrustProfile",
      "sourceValidityNotes",
      "sourceFallbackNotes",
    ]) {
      expect(adminEn[key], `en ${key}`).toBeTruthy();
      expect(adminZh[key], `zh ${key}`).toBeTruthy();
      expect(adminZh[key], key).not.toBe(adminEn[key]);
    }
    // Labels the card reuses.
    for (const key of ["fieldApproval", "sourceApprovalRequired", "sourceConfidence", "crawler", "sourceRequiresBrowser", "sourceRequiresLogin", "sourceRequiresManual"]) {
      expect(adminEn[key], `en ${key}`).toBeTruthy();
      expect(adminZh[key], `zh ${key}`).toBeTruthy();
    }
  });
});
