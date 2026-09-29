import { describe, expect, it } from "vitest";
import { PRECHECK_REQUEST_CHUNK } from "@/components/admin/sources/source-bulk-actions";
import { MAX_REQUESTED_IDS } from "@/server/admin/precheck-queue";

describe("precheck request chunk", () => {
  it("is the number of ids one precheck-requests call accepts", () => {
    // The source list may not import precheck-queue.ts (phase-3 governance code), so it repeats the limit and only
    // this test ties the two together. A bigger chunk is refused with 400 INVALID_REQUEST ("at most N sourceIds per
    // request"); a smaller one only costs extra requests.
    expect(PRECHECK_REQUEST_CHUNK).toBe(MAX_REQUESTED_IDS);
  });
});
