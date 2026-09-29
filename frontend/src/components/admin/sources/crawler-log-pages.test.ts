import { describe, expect, it } from "vitest";
import type { AdminCrawlerLog, AdminCrawlerLogsCursor } from "@/lib/api/admin";
import { appendCrawlerLogPage, visibleCrawlerLogs, type CrawlerLogPage } from "./crawler-log-pages";

function run(id: string): AdminCrawlerLog {
  return {
    id, source: "bidnet_co_denver", runId: `run-${id}`, status: "success", startedAt: "2026-09-20T10:00:00.000Z", finishedAt: null,
    durationMs: null, fetchedCount: 1, insertedCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0, errorCode: null,
    errorMessage: null, metadata: null, fallbackSource: null, fallbackReason: null, fallbackFixture: null,
  };
}

const cursor = (n: number): AdminCrawlerLogsCursor => ({ before: `2026-09-${String(n).padStart(2, "0")}T00:00:00.000Z`, beforeId: `log-${n}` });
const page = (key: string, ids: string[], nextCursor: AdminCrawlerLogsCursor | null): CrawlerLogPage => ({ key, logs: ids.map(run), nextCursor });
const ids = (logs: readonly AdminCrawlerLog[]) => logs.map((log) => log.id);

describe("visibleCrawlerLogs", () => {
  it("shows the first page alone, with its own cursor, until more pages are loaded", () => {
    const first = page("a", ["l1", "l2"], cursor(2));
    const view = visibleCrawlerLogs("a", first, null);

    expect(view.first).toBe(first);
    expect(ids(view.logs)).toEqual(["l1", "l2"]);
    expect(view.cursor).toEqual(cursor(2));
  });

  it("appends the loaded pages after the first page in order and hands the cursor to the last one", () => {
    const first = page("a", ["l1", "l2"], cursor(2));
    const second = appendCrawlerLogPage(first, null, { logs: [run("l3"), run("l4")], nextCursor: cursor(4) });
    expect(ids(visibleCrawlerLogs("a", first, second).logs)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(visibleCrawlerLogs("a", first, second).cursor).toEqual(cursor(4));

    const third = appendCrawlerLogPage(first, second, { logs: [run("l5")], nextCursor: null });
    expect(ids(visibleCrawlerLogs("a", first, third).logs)).toEqual(["l1", "l2", "l3", "l4", "l5"]);
    // The last page reached the end of the list: nothing is left to load.
    expect(visibleCrawlerLogs("a", first, third).cursor).toBeNull();
  });

  it("offers no cursor when the first page already reached the end of the list", () => {
    const view = visibleCrawlerLogs("a", page("a", ["l1"], null), null);

    expect(ids(view.logs)).toEqual(["l1"]);
    expect(view.cursor).toBeNull();
  });

  it("has nothing to show, and no cursor, when the first page was read for another source set", () => {
    const stale = page("a", ["l1", "l2"], cursor(2));

    for (const view of [visibleCrawlerLogs("b", stale, null), visibleCrawlerLogs("b", null, null)]) {
      expect(view.first).toBeNull();
      expect(view.logs).toEqual([]);
      expect(view.cursor).toBeNull();
    }
  });

  it("ignores appended pages that were loaded for another source set", () => {
    const firstA = page("a", ["l1", "l2"], cursor(2));
    const moreA = appendCrawlerLogPage(firstA, null, { logs: [run("l3")], nextCursor: cursor(3) });
    const firstB = page("b", ["m1"], cursor(9));
    const view = visibleCrawlerLogs("b", firstB, moreA);

    expect(ids(view.logs)).toEqual(["m1"]);
    // b's own cursor, never a's.
    expect(view.cursor).toEqual(cursor(9));
  });

  it("ignores appended pages of another source set even when they start from an equal cursor", () => {
    // Overlapping sets (["x", "y"] and ["y"]) can end a first page on the very same run, so the cursor alone
    // does not tell whose pages these are.
    const firstA = page("a", ["l1", "l2"], cursor(2));
    const moreA = appendCrawlerLogPage(firstA, null, { logs: [run("l3")], nextCursor: cursor(3) });
    const firstB = page("b", ["m1", "l2"], cursor(2));
    const view = visibleCrawlerLogs("b", firstB, moreA);

    expect(ids(view.logs)).toEqual(["m1", "l2"]);
    expect(view.cursor).toEqual(cursor(2));
    expect(ids(appendCrawlerLogPage(firstB, moreA, { logs: [run("m3")], nextCursor: null }).logs)).toEqual(["m3"]);
  });

  it("drops appended pages that continue from an older first page of the same source set", () => {
    const oldFirst = page("a", ["l1", "l2"], cursor(2));
    const oldMore = appendCrawlerLogPage(oldFirst, null, { logs: [run("l3")], nextCursor: cursor(3) });
    // The first page was read again and now ends elsewhere (newer runs pushed the older ones down).
    const newFirst = page("a", ["n1", "l1"], cursor(1));
    const view = visibleCrawlerLogs("a", newFirst, oldMore);

    expect(ids(view.logs)).toEqual(["n1", "l1"]);
    expect(view.cursor).toEqual(cursor(1));
  });

  it("never lists a run twice, keeping its first position", () => {
    const first = page("a", ["l1", "l2"], cursor(2));
    const overlapping = appendCrawlerLogPage(first, null, { logs: [run("l2"), run("l3"), run("l3")], nextCursor: cursor(3) });

    expect(ids(overlapping.logs)).toEqual(["l2", "l3"]);
    expect(ids(visibleCrawlerLogs("a", first, overlapping).logs)).toEqual(["l1", "l2", "l3"]);
    const again = appendCrawlerLogPage(first, overlapping, { logs: [run("l3"), run("l4")], nextCursor: null });
    expect(ids(visibleCrawlerLogs("a", first, again).logs)).toEqual(["l1", "l2", "l3", "l4"]);
  });

  it("does not modify the pages it is given", () => {
    const first = page("a", ["l1"], cursor(1));
    const more = appendCrawlerLogPage(first, null, { logs: [run("l2")], nextCursor: null });
    const snapshot = JSON.stringify({ first, more });

    visibleCrawlerLogs("a", first, more);
    appendCrawlerLogPage(first, more, { logs: [run("l3")], nextCursor: null });

    expect(JSON.stringify({ first, more })).toBe(snapshot);
  });
});

describe("appendCrawlerLogPage", () => {
  it("records the source set and the first-page cursor the appended pages continue from", () => {
    const first = page("a", ["l1"], cursor(1));
    const more = appendCrawlerLogPage(first, null, { logs: [run("l2")], nextCursor: cursor(2) });

    expect(more.key).toBe("a");
    expect(more.after).toEqual(cursor(1));
    expect(more.nextCursor).toEqual(cursor(2));
    expect(ids(more.logs)).toEqual(["l2"]);
    // A page appended later keeps the same starting point.
    expect(appendCrawlerLogPage(first, more, { logs: [run("l3")], nextCursor: null }).after).toEqual(cursor(1));
  });

  it("starts over when the loaded pages belong to another source set", () => {
    const firstA = page("a", ["l1"], cursor(1));
    const moreA = appendCrawlerLogPage(firstA, null, { logs: [run("l2")], nextCursor: cursor(2) });
    const firstB = page("b", ["m1"], cursor(5));
    const moreB = appendCrawlerLogPage(firstB, moreA, { logs: [run("m2")], nextCursor: null });

    expect(moreB.key).toBe("b");
    expect(ids(moreB.logs)).toEqual(["m2"]);
    expect(moreB.after).toEqual(cursor(5));
  });
});
