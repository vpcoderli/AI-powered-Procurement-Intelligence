import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Database } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AdminNotice, AdminSectionStateCard, SummaryCard } from "./AdminStateCards";

describe("admin state cards", () => {
  it("renders a summary card", () => {
    const html = renderToStaticMarkup(<SummaryCard label="Sources" value={1020} icon={Database} />);
    expect(html).toContain("Sources");
    expect(html).toContain("1020");
  });

  it("renders a notice only when there is a message", () => {
    expect(renderToStaticMarkup(<AdminNotice message={null} />)).toBe("");
    expect(renderToStaticMarkup(<AdminNotice message="Saved." />)).toContain('role="status"');
    expect(renderToStaticMarkup(<AdminNotice message="Failed." tone="error" />)).toContain('role="alert"');
  });

  it("renders a section state card through UniversalState", () => {
    const html = renderToStaticMarkup(
      <AdminSectionStateCard actionLabel="Retry" code="error" message="Could not load." title="Users" />,
    );
    expect(html).toContain('data-state-code="error"');
    expect(html).toContain("Could not load.");
  });
});
