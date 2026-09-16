import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminDataSource, AdminSourcePrecheckResult } from "@/lib/api/admin";
import {
  approveLocalSourceFormFromSource,
  buildApproveLocalSourcePatch,
  defaultComplianceReviewDueAt,
  isLocalJurisdictionSource,
  legalReferenceRequired,
  validateApproveLocalSourceForm,
  type ApproveLocalSourceForm,
} from "./ApproveLocalSourceDialog";

function adminSource(overrides: Partial<AdminDataSource> = {}): AdminDataSource {
  return {
    id: "bidnet_ny_erie",
    label: "Erie County, NY (BidNet)",
    issuerType: "county",
    stateCode: "NY",
    jurisdictionLevel: "county",
    requiresLogin: false,
    tosUrl: null,
    complianceReviewer: null,
    legalOpinionReference: null,
    complianceReviewDueAt: null,
    complianceNotes: null,
    ...overrides,
  } as AdminDataSource;
}

function precheck(overrides: Partial<AdminSourcePrecheckResult> = {}): AdminSourcePrecheckResult {
  return {
    sourceId: "bidnet_ny_erie",
    checkedAt: "2026-09-16T00:00:00.000Z",
    verdict: "ready",
    reasons: [],
    robots: { status: "clear", flagged: false, flagReason: null },
    fetch: {
      status: "ok",
      items: 3,
      sample: [],
      listMethod: "scrapling",
      errorCode: null,
      errorMessage: null,
      httpStatus: 200,
      wafChallenge: false,
    },
    suggestedBaseUrl: null,
    ...overrides,
  };
}

const form: ApproveLocalSourceForm = {
  tosUrl: "  https://www.bidnetdirect.com/terms  ",
  complianceReviewer: "  admin@example.com  ",
  legalOpinionReference: "",
  complianceReviewDueAt: "2027-09-16",
  complianceNotes: "  Public solicitation pages only.  ",
  approvalNotes: "",
};

describe("isLocalJurisdictionSource", () => {
  it("treats everything outside federal/state as governance-gated", () => {
    expect(isLocalJurisdictionSource(adminSource({ jurisdictionLevel: "county" }))).toBe(true);
    expect(isLocalJurisdictionSource(adminSource({ jurisdictionLevel: "city" }))).toBe(true);
    expect(isLocalJurisdictionSource(adminSource({ jurisdictionLevel: "special_district" }))).toBe(true);
    expect(isLocalJurisdictionSource(adminSource({ jurisdictionLevel: "state" }))).toBe(false);
    expect(isLocalJurisdictionSource(adminSource({ jurisdictionLevel: "federal" }))).toBe(false);
  });

  it("maps legacy NULL jurisdiction rows the way the orchestrator's gate does", () => {
    // Same fallback as blockedReasonFor(): legacy rows are state portals, federal issuers federal.
    expect(isLocalJurisdictionSource(adminSource({ jurisdictionLevel: null }))).toBe(false);
    expect(
      isLocalJurisdictionSource(adminSource({ jurisdictionLevel: null, issuerType: "federal" })),
    ).toBe(false);
  });
});

describe("defaultComplianceReviewDueAt", () => {
  it("defaults the next review to twelve months out", () => {
    expect(defaultComplianceReviewDueAt(new Date("2026-09-16T10:00:00.000Z"))).toBe("2027-09-16");
    expect(defaultComplianceReviewDueAt(new Date("2026-12-31T23:00:00.000Z"))).toBe("2027-12-31");
  });
});

describe("legalReferenceRequired", () => {
  it("demands a legal reference when robots.txt was flagged by the last pre-check", () => {
    expect(
      legalReferenceRequired(
        adminSource(),
        precheck({ robots: { status: "flagged", flagged: true, flagReason: "Disallow: /solicitations" } }),
      ),
    ).toBe(true);
  });

  it("demands a legal reference for a login-walled source even without a pre-check", () => {
    expect(legalReferenceRequired(adminSource({ requiresLogin: true }), null)).toBe(true);
  });

  it("leaves it optional for a clean public source", () => {
    expect(legalReferenceRequired(adminSource(), precheck())).toBe(false);
    expect(legalReferenceRequired(adminSource(), null)).toBe(false);
  });
});

describe("approveLocalSourceFormFromSource", () => {
  it("prefills the reviewer from the signed-in admin and the due date from today + 12 months", () => {
    const hydrated = approveLocalSourceFormFromSource(
      adminSource(),
      "admin@example.com",
      new Date("2026-09-16T00:00:00.000Z"),
    );

    expect(hydrated.complianceReviewer).toBe("admin@example.com");
    expect(hydrated.complianceReviewDueAt).toBe("2027-09-16");
    expect(hydrated.tosUrl).toBe("");
    // Approval notes are per-approval, never carried over from a previous one.
    expect(hydrated.approvalNotes).toBe("");
  });

  it("keeps a reviewer already recorded on the row over the signed-in admin", () => {
    const hydrated = approveLocalSourceFormFromSource(
      adminSource({ complianceReviewer: "legal@example.com", complianceReviewDueAt: "2027-01-31T00:00:00.000Z" }),
      "admin@example.com",
      new Date("2026-09-16T00:00:00.000Z"),
    );

    expect(hydrated.complianceReviewer).toBe("legal@example.com");
    // Timestamps from the row are narrowed to the ISO date the <input type="date"> expects.
    expect(hydrated.complianceReviewDueAt).toBe("2027-01-31");
  });

  it("falls back to an empty reviewer when the session carries no email", () => {
    expect(
      approveLocalSourceFormFromSource(adminSource(), null, new Date("2026-09-16T00:00:00.000Z"))
        .complianceReviewer,
    ).toBe("");
  });
});

describe("validateApproveLocalSourceForm", () => {
  it("requires a compliance reviewer", () => {
    expect(validateApproveLocalSourceForm({ ...form, complianceReviewer: "   " }, false)).toEqual({
      ok: false,
      messageKey: "admin.approveLocalSourceReviewerRequired",
    });
  });

  it("requires a legal reference only when the source demands one", () => {
    expect(validateApproveLocalSourceForm(form, true)).toEqual({
      ok: false,
      messageKey: "admin.approveLocalSourceLegalRequired",
    });
    expect(validateApproveLocalSourceForm(form, false)).toEqual({ ok: true });
    expect(validateApproveLocalSourceForm({ ...form, legalOpinionReference: "LEGAL-2026-11" }, true)).toEqual({
      ok: true,
    });
  });
});

describe("buildApproveLocalSourcePatch", () => {
  it("writes approval, legal review and the compliance ledger in one PATCH (C6)", () => {
    expect(buildApproveLocalSourcePatch(form)).toEqual({
      approvalStatus: "approved",
      legalReviewStatus: "approved_public",
      approvedForIngestion: true,
      isEnabled: true,
      tosReviewed: true,
      tosUrl: "https://www.bidnetdirect.com/terms",
      complianceReviewer: "admin@example.com",
      legalOpinionReference: null,
      complianceReviewDueAt: "2027-09-16",
      complianceNotes: "Public solicitation pages only.",
      approvalNotes: null,
    });
  });

  it("sends blank optional ledger fields as null rather than empty strings", () => {
    const patch = buildApproveLocalSourcePatch({
      ...form,
      tosUrl: "   ",
      complianceNotes: "",
      complianceReviewDueAt: "  ",
    });

    expect(patch.tosUrl).toBeNull();
    expect(patch.complianceNotes).toBeNull();
    expect(patch.complianceReviewDueAt).toBeNull();
  });
});

describe("ApproveLocalSourceDialog wiring", () => {
  const component = readFileSync(new URL("ApproveLocalSourceDialog.tsx", import.meta.url), "utf8");

  it("submits exactly one updateAdminDataSource call with the C6 patch", () => {
    expect(component).toContain("updateAdminDataSource(source.id, buildApproveLocalSourcePatch(form))");
    // Nothing here may re-implement or skip the governance gate; it only writes the ledger.
    expect(component).not.toContain("runStateCrawlersNow");
  });

  it("surfaces server rejections verbatim instead of a generic failure string", () => {
    expect(component).toContain("caught instanceof Error ? caught.message : String(caught)");
    expect(component).toContain('role="alert"');
  });

  it("gates submission on the explicit terms-of-service acknowledgement", () => {
    expect(component).toContain("disabled={disabled || saving || !tosAcknowledged}");
    expect(component).toContain('t("admin.approveLocalSourceTosAcknowledge")');
  });

  it("keeps every string behind the i18n dictionaries", () => {
    for (const key of [
      "admin.approveLocalSourceOpen",
      "admin.approveLocalSourceTitle",
      "admin.approveLocalSourceDescription",
      "admin.approveLocalSourceReviewer",
      "admin.approveLocalSourceTosUrl",
      "admin.approveLocalSourceLegalReference",
      "admin.approveLocalSourceLegalReferenceRequired",
      "admin.approveLocalSourceLegalReferenceHint",
      "admin.approveLocalSourceReviewDue",
      "admin.approveLocalSourceComplianceNotes",
      "admin.approveLocalSourceApprovalNotes",
      "admin.approveLocalSourceSubmit",
      "admin.approveLocalSourceSaving",
    ]) {
      expect(component).toContain(`t("${key}")`);
    }
  });

  it("has both dictionaries carrying the approval form keys, translated", () => {
    const en = readFileSync(new URL("../../lib/i18n/dictionaries/en.ts", import.meta.url), "utf8");
    const zh = readFileSync(new URL("../../lib/i18n/dictionaries/zh.ts", import.meta.url), "utf8");

    for (const dictionary of [en, zh]) {
      expect(dictionary).toContain("approveLocalSourceTitle:");
      expect(dictionary).toContain("approveLocalSourceLegalRequired:");
      expect(dictionary).toContain("approveLocalSourceTosAcknowledge:");
    }
    expect(zh).toContain("批准县/市源");
  });
});
