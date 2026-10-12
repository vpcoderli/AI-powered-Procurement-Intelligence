import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminCrawlerLog } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { AdminResourceStatus, useAdminResource } from "../use-admin-resource";
import type { CrawlerLogPage } from "./crawler-log-pages";

// The list reads its first page through one resource; the hook is replaced with plain state so each load state
// can be rendered without a DOM. The stub is typed against the real hook, so a change to its return shape fails
// type-checking of this file.
type ResourceStub = ReturnType<typeof useAdminResource<CrawlerLogPage>>;
const stubs = vi.hoisted(() => ({ resource: null as ResourceStub | null }));

vi.mock("../use-admin-resource", () => ({
  useAdminResource: (): ResourceStub => {
    if (!stubs.resource) throw new Error("load() was not called");
    return stubs.resource;
  },
}));

import { CrawlerLogList, CrawlerLogRow } from "./CrawlerLogList";

const admin = en.admin as Record<string, string>;

function run(id: string, source: string): AdminCrawlerLog {
  return {
    id, source, runId: `run-${id}`, status: "success", startedAt: "2026-09-20T10:00:00.000Z", finishedAt: null, durationMs: null,
    fetchedCount: 1, insertedCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0, errorCode: null, errorMessage: null,
    metadata: null, fallbackSource: null, fallbackReason: null, fallbackFixture: null,
  };
}

/** The list's key for a source set: the sources joined by a NUL, "" for every run. */
const keyOf = (...sources: string[]) => sources.join("\u0000");
const pageOf = (key: string, source: string, nextCursor: CrawlerLogPage["nextCursor"] = null): CrawlerLogPage => ({
  key, logs: [run(`${source}-1`, source), run(`${source}-2`, source)], nextCursor,
});
const NEXT = { before: "2026-09-19T00:00:00.000Z", beforeId: "log-19" };

function load(state: { status: AdminResourceStatus; data?: CrawlerLogPage | null; error?: unknown }) {
  const resource: ResourceStub = {
    status: state.status, data: state.data ?? null, error: state.error ?? null, reload: async () => undefined, setData: () => undefined,
  };
  stubs.resource = resource;
}

const render = (sources?: readonly string[]) =>
  renderToStaticMarkup(<LanguageProvider><CrawlerLogList sources={sources} title="Run history" /></LanguageProvider>);
/** The rendered "Load more" button, or "" when the list offers none. */
const loadMoreButton = (html: string) => new RegExp(`<button[^>]*>${admin.loadMore}</button>`).exec(html)?.[0] ?? "";

beforeEach(() => {
  load({ status: "loading" });
});

describe("CrawlerLogList first page", () => {
  it("shows a loading card until the first page arrives", () => {
    const html = render(["bidnet_co_denver"]);

    expect(html).toContain('data-state-code="loading"');
    expect(html).toContain("Run history");
    expect(loadMoreButton(html)).toBe("");
  });

  it("answers a failed first load with a retryable error card", () => {
    load({ status: "error", error: new Error("offline") });
    const html = render(["bidnet_co_denver"]);

    expect(html).toContain('data-state-code="error"');
    expect(html).toContain(admin.refresh);
  });

  it("lists the runs of the first page, with Load more when the API returned a cursor", () => {
    load({ status: "ready", data: pageOf(keyOf("bidnet_co_denver"), "bidnet_co_denver", NEXT) });
    const html = render(["bidnet_co_denver"]);

    expect(html).toContain("bidnet_co_denver");
    expect(loadMoreButton(html)).not.toBe("");
    expect(loadMoreButton(html)).not.toContain(' disabled=""');
  });

  it("offers no Load more at the end of the list, and says so for an empty one", () => {
    load({ status: "ready", data: pageOf(keyOf("bidnet_co_denver"), "bidnet_co_denver", null) });
    expect(loadMoreButton(render(["bidnet_co_denver"]))).toBe("");

    load({ status: "ready", data: { key: keyOf("bidnet_co_denver"), logs: [], nextCursor: null } });
    const empty = render(["bidnet_co_denver"]);
    expect(empty).toContain(admin.noLogs);
    expect(loadMoreButton(empty)).toBe("");
  });

  it("lists every crawler run when no source set is given", () => {
    load({ status: "ready", data: pageOf("", "sam_gov", NEXT) });
    const html = render();

    expect(html).toContain("sam_gov");
    expect(loadMoreButton(html)).not.toBe("");
  });

  it("disables Load more while the same source set's first page is being read again", () => {
    load({ status: "loading", data: pageOf(keyOf("bidnet_co_denver"), "bidnet_co_denver", NEXT) });
    const html = render(["bidnet_co_denver"]);

    expect(html).toContain("bidnet_co_denver");
    expect(loadMoreButton(html)).toContain(' disabled=""');
  });
});

describe("CrawlerLogList after the source set changes", () => {
  // useAdminResource keeps the previous data while the new load runs; that page belongs to the old source set.
  const stale = pageOf(keyOf("bidnet_co_adams"), "bidnet_co_adams", NEXT);

  it("shows the loading card, not the old set's runs, and offers no Load more while the new first page loads", () => {
    load({ status: "loading", data: stale });
    const html = render(["bidnet_co_denver"]);

    expect(html).toContain('data-state-code="loading"');
    expect(html).not.toContain("bidnet_co_adams");
    expect(loadMoreButton(html)).toBe("");
  });

  it("never pages the new set with the old set's cursor, even for a render that still holds the old page as ready", () => {
    load({ status: "ready", data: stale });
    const html = render(["bidnet_co_denver"]);

    expect(html).not.toContain("bidnet_co_adams");
    expect(loadMoreButton(html)).toBe("");
  });

  it("answers a failed load of the new set with the error card instead of the old set's runs", () => {
    load({ status: "error", data: stale, error: new Error("offline") });
    const html = render(["bidnet_co_denver"]);

    expect(html).toContain('data-state-code="error"');
    expect(html).not.toContain("bidnet_co_adams");
    expect(loadMoreButton(html)).toBe("");
  });

  it("treats a page read for every run as another set than one source's page", () => {
    load({ status: "ready", data: pageOf("", "sam_gov", NEXT) });
    const html = render(["bidnet_co_denver"]);

    expect(html).not.toContain("sam_gov");
    expect(loadMoreButton(html)).toBe("");
  });
});


describe("CrawlerLogRow quality evidence", () => {
  it("reports body evidence separately when the execution succeeded", () => {
    const log = run("quality", "city_source");
    log.metadata = JSON.stringify({ dataQuality: { schemaVersion: 1, execution: "success", listCoverage: "complete", contentStatus: "partial", receivedCount: 2, uniqueCount: 2, acceptedCount: 2, quarantinedCount: 0, duplicateCount: 0, validBodyCount: 1, retainedBodyCount: 1, analysisReadyCount: 1, reconciliation: { balanced: true } }, enrichment: { enriched: 2 } });
    const html = renderToStaticMarkup(<LanguageProvider><CrawlerLogRow log={log} /></LanguageProvider>);
    expect(html).toContain(admin.sourceQualityExecution);
    expect(html).toContain(admin.sourceQualityCoverage);
    expect(html).toContain(admin.sourceQualityContent_partial);
    expect(html).toContain(admin.sourceQualityRetainedBodies);
    expect(html).not.toContain("enriched");
  });
  it("labels detail backfill execution separately from list crawl execution", () => {
    const log = run("backfill", "city_source");
    log.metadata = JSON.stringify({ mode: "detail_backfill" });
    const html = renderToStaticMarkup(<LanguageProvider><CrawlerLogRow log={log} /></LanguageProvider>);
    expect(html).toContain("Mode: Detail backfill");
    expect(html).not.toContain(admin.sourceQualityMode_list);
  });
  it("does not label legacy successes as usable content", () => {
    const html = renderToStaticMarkup(<LanguageProvider><CrawlerLogRow log={run("legacy", "city_source")} /></LanguageProvider>);
    expect(html).toContain(admin.sourceQualityContent_unknown);
    expect(html).toContain("N/A");
  });
});
