import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  UNIVERSAL_STATE_CODES,
  defaultUniversalStateContent,
  type UniversalStateCode,
} from "@/lib/universal-state";
import { UniversalState } from "./universal-state";

const expectedCodes: UniversalStateCode[] = [
  "loading",
  "empty",
  "error",
  "permission_denied",
  "ai_unavailable",
  "low_confidence",
  "upload_failed",
  "source_unavailable",
  "duplicate_opportunity",
  "expired_deadline",
  "plan_limit",
];

describe("UniversalState", () => {
  it("defines the stable P0 state codes", () => {
    expect(UNIVERSAL_STATE_CODES).toEqual(expectedCodes);
  });

  it.each(expectedCodes)("renders default content for %s", (code) => {
    const html = renderToStaticMarkup(<UniversalState code={code} />);
    const content = defaultUniversalStateContent[code];

    expect(html).toContain(`data-state-code="${code}"`);
    expect(html).toContain(content.title);
    expect(html).toContain(content.message);
  });

  it("renders an error with alert semantics and trace id", () => {
    const html = renderToStaticMarkup(
      <UniversalState code="error" traceId="trace-123" />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Trace ID");
    expect(html).toContain("trace-123");
  });

  it("allows title, message, severity, metadata, and actions overrides", () => {
    const html = renderToStaticMarkup(
      <UniversalState
        actions={[{ href: "/settings/billing", label: "Upgrade plan" }]}
        code="plan_limit"
        message="Your workspace needs more export credits."
        metadata={{ Workspace: "Acme", Limit: "Exports" }}
        severity="warning"
        title="Export limit reached"
      />
    );

    expect(html).toContain('data-severity="warning"');
    expect(html).toContain("Export limit reached");
    expect(html).toContain("Your workspace needs more export credits.");
    expect(html).toContain("Workspace");
    expect(html).toContain("Acme");
    expect(html).toContain("Limit");
    expect(html).toContain("Exports");
    expect(html).toContain('href="/settings/billing"');
    expect(html).toContain("Upgrade plan");
  });

  it("uses status semantics for loading states", () => {
    const html = renderToStaticMarkup(<UniversalState code="loading" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});
