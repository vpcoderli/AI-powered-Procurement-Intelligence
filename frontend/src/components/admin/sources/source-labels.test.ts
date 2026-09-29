import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  sourceHealthClassificationLabel,
  sourceHealthTriagePatchForAction,
  sourceHealthTriageStatus,
} from "./source-labels";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("source labels", () => {
  // Moved from src/app/admin/page.test.ts ("defines source health classification filter options and readable
  // labels"); the SOURCE_HEALTH_CLASSIFICATION_FILTERS assertions stay there until the old table is retired.
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

  // Moved from src/app/admin/page.test.ts.
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

  // Moved from src/app/admin/page.test.ts.
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

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations"): the
  // label helpers that carry these dictionary keys now live in source-labels.ts.
  it("keeps the crawler, trust, evidence and live health label keys in the shared helpers", () => {
    const labels = read("source-labels.ts");

    expect(labels).toContain('t("admin.crawlerAdapter_dedicated")');
    expect(labels).toContain('t("admin.crawlerMaturity_verified")');
    expect(labels).toContain('t("admin.sourceAuthority_official")');
    expect(labels).toContain('t("admin.sourceTrust_fallback")');
    expect(labels).toContain('t("admin.sourceEvidence_aggregator_page")');
    expect(labels).toContain('t("admin.liveSourceHealth_healthy")');
    expect(labels).toContain('t("admin.liveSourceHealthNoCheck")');
    expect(labels).toContain('t("admin.sourceHealthAction_update_registry_url")');
    expect(labels).toContain('t("admin.sourceHealthTriage_unassigned")');
    expect(labels).toContain('t("admin.sourceHealthTriage_overdue")');
    expect(labels).toContain('t("admin.sourceHealthTriage_scheduled")');
    expect(labels).toContain('t("admin.sourceHealthDisposition_accepted_fallback")');
    expect(labels).toContain('t("admin.sourceHealthDisposition_manual")');
    expect(labels).toContain('t("admin.sourceHealthDisposition_vendor_account")');
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
