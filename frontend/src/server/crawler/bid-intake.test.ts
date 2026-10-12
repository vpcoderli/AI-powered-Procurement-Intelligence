import { describe, expect, it } from "vitest";
import { intakeCrawlerRun, intakeCrawlerRunAsync, type AsyncBidIntakeStore, type BidIntakeStore } from "./bid-intake";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";

type Row = Record<string, unknown>;
const NOW = "2026-10-08T00:00:00.000Z";
const EARLIER = "2026-09-01T00:00:00.000Z";
const BODY = "Replace pavement, repair drainage, and restore the existing bridge deck.";

function bid(id = "1", values: Row = {}): Row {
  return { id: `city_portal:${id}`, source: "City portal", source_bid_id: id, dedupe_key: `city_portal:${id}`,
    title: "Bridge rehabilitation", issuer_name: "City of Aurora", issuer_type: "city", jurisdiction_level: "city",
    state_code: "CO", fips_code: "0804000", source_url: `https://procurement.example.gov/bids/${id}`,
    description: BODY, lifecycle_status: "open", ...values };
}
function run(rows: Row[], metadata: Row = {}): CrawlerJsonRunPayload {
  return { source: "city_portal", runId: "intake-run", status: "success", startedAt: NOW, finishedAt: NOW,
    bids: rows, metadata };
}
function file(values: Row = {}): Row {
  return { id: "scope-file", name: "Scope.pdf", url: "https://procurement.example.gov/scope.pdf", storage_path: "scope.pdf",
    byte_size: 42, content_type: "application/pdf", checksum_sha256: "a".repeat(64), archive_status: "archived", ...values };
}

/** Storage substitutes only persistence; all admission, merging and accounting use the public intake interface. */
function memoryStore(prior: Row[] = [], files: Row[] = []) {
  const bids = new Map(prior.map((row) => [String(row.id), structuredClone(row)]));
  const attachments = files.map((row) => structuredClone(row));
  const logs: Array<{ payload: CrawlerJsonRunPayload; counts: Row }> = [];
  const events: string[] = [];
  let failAttachments = false;
  const store: BidIntakeStore = {
    findBid(id, dedupeKey) {
      events.push(`read-bid:${id}`);
      return bids.get(id) ?? [...bids.values()].find((row) => row.dedupe_key === dedupeKey);
    },
    readAttachments(bidId) { events.push(`read-files:${bidId}`); return attachments.filter((row) => row.bid_id === bidId); },
    writeBid(row) { events.push(`write-bid:${row.id}`); bids.set(String(row.id), row); },
    writeAttachments(bidId, rows) {
      events.push(`write-files:${bidId}`);
      if (failAttachments) throw new Error("attachment write failed");
      for (const row of rows) {
        const index = attachments.findIndex((existing) => existing.id === row.id);
        if (index >= 0 && attachments[index].bid_id !== bidId) throw new Error("attachment identity collision");
        const persisted = { ...row, bid_id: bidId };
        if (index >= 0) attachments[index] = persisted;
        else attachments.push(persisted);
      }
    },
    delistMissingOpenBids(source, seen, at) {
      events.push("delist");
      let count = 0;
      for (const [id, row] of bids) if (id.startsWith(`${source}:`) && row.lifecycle_status === "open" && !seen.has(id)) {
        bids.set(id, { ...row, lifecycle_status: "closed", is_active: 0, updated_at: at }); count += 1;
      }
      return count;
    },
    writeLog(payload, counts) { events.push("log"); logs.push({ payload, counts }); },
  };
  const asyncStore: AsyncBidIntakeStore = {
    findBid: async (...args) => store.findBid(...args), readAttachments: async (...args) => store.readAttachments(...args),
    writeBid: async (...args) => store.writeBid(...args), writeAttachments: async (...args) => store.writeAttachments(...args),
    delistMissingOpenBids: async (...args) => store.delistMissingOpenBids(...args), writeLog: async (...args) => store.writeLog(...args),
  };
  return { store, asyncStore, bids, attachments, logs, events, failAttachments: () => { failAttachments = true; } };
}

describe("bid intake", () => {
  it.each([
    { mode: "sync", malformed: false, blankId: false }, { mode: "async", malformed: false, blankId: false },
    { mode: "sync", malformed: true, blankId: false }, { mode: "async", malformed: true, blankId: false },
    { mode: "sync", malformed: false, blankId: true },
  ])("rejects the foreign actual dedupe target before attachment reads ($mode, malformed=$malformed, blankId=$blankId)", async ({ mode, malformed, blankId }) => {
    const dedupeKey = blankId ? "city_portal:one" : "other_portal:one";
    const prior = bid("one", { id: "other_portal:one", dedupe_key: dedupeKey, source: "Other City", state_code: "IL", fips_code: null,
      title: malformed ? "Untitled opportunity" : "Other city road repairs", description: "Preserve the other city's existing reconstruction scope." });
    const old = bid("old", { state_code: "IL", fips_code: null });
    const savedFile = file({ bid_id: prior.id, verified_at: EARLIER });
    const memory = memoryStore([prior, old], [savedFile]);
    const incoming = bid("one", { id: blankId ? "" : "city_portal:one", dedupe_key: dedupeKey, state_code: "IL", fips_code: null, source: "New City",
      description: "Replace this new city's storm sewer and drainage systems.", attachments: [file({ id: "new-file" })] });
    const payload = run([incoming], { sourceIdentity: { id: "city_portal", stateCode: "IL", issuerType: "city", jurisdictionLevel: "city" },
      pagination: { list_kind: "open", complete: true } });
    const outcome = mode === "sync" ? intakeCrawlerRun(payload, memory.store) : await intakeCrawlerRunAsync(payload, memory.asyncStore);
    expect(outcome.result).toEqual({ fetchedCount: 1, insertedCount: 0, updatedCount: 0, logCount: 1 });
    expect(memory.events).toEqual(["read-bid:city_portal:one", "log"]);
    expect([...memory.bids.values()]).toEqual([prior, old]);
    expect(memory.attachments).toEqual([savedFile]);
    expect(outcome.metadata).toMatchObject({ pagination: { complete: false, quality_blocked: true }, dataQuality: {
      acceptedCount: 0, quarantinedCount: 1, acceptedIds: [], listCoverage: "partial", contentStatus: "unusable",
      quarantinedRecords: [{ id: incoming.id || null, issues: ["source_identity_mismatch:id"], row: incoming }],
      reconciliation: { observed: 1, accepted: 0, quarantined: 1, balanced: true },
    } });
  });

  it.each([
    { storedId: "city_portal:stored", metadata: { sourceIdentity: { id: "city_portal" } } },
    { storedId: "legacy_one", metadata: { sourceIdentity: { id: "city_portal" } } },
    { storedId: "other_portal:stored", metadata: {} },
  ])("preserves allowed stored dedupe IDs and opaque dedupe formats ($storedId)", ({ storedId, metadata }) => {
    const prior = bid("one", { id: storedId, dedupe_key: "opaque_dedupe_key" });
    const memory = memoryStore([prior]);
    const outcome = intakeCrawlerRun(run([bid("one", { dedupe_key: "opaque_dedupe_key" })], metadata), memory.store);
    expect(outcome.result).toMatchObject({ insertedCount: 0, updatedCount: 1 });
    expect(outcome.metadata).toMatchObject({ dataQuality: { acceptedIds: [storedId], quarantinedCount: 0 } });
  });

  it("quarantines a foreign namespace derived from dedupe before writes or delisting and preserves original evidence", () => {
    const memory = memoryStore([bid("old")]);
    const incoming = bid("one", { id: "", dedupe_key: "other_portal:one", state_code: "IL", fips_code: null });
    const payload = run([incoming], { sourceIdentity: { id: "city_portal", stateCode: "IL", issuerType: "city", jurisdictionLevel: "city" },
      pagination: { list_kind: "open", complete: true } });
    const outcome = intakeCrawlerRun(payload, memory.store);
    expect(outcome.result).toMatchObject({ insertedCount: 0, updatedCount: 0 });
    expect(outcome.metadata).toMatchObject({ pagination: { complete: false, quality_blocked: true }, dataQuality: {
      acceptedCount: 0, quarantinedCount: 1, contentStatus: "unusable", acceptedIds: [],
      quarantinedRecords: [{ id: null, issues: ["source_identity_mismatch:id"], row: { id: "", dedupe_key: "other_portal:one" } }],
    } });
    expect(memory.events).toEqual(["log"]);
    expect([...memory.bids.keys()]).toEqual(["city_portal:old"]);
    expect(memory.bids.get("city_portal:old")?.lifecycle_status).toBe("open");
    expect(incoming.id).toBe("");
  });

  it("publishes the best duplicate, quarantines bad candidates and logs reconciled evidence after writes", () => {
    const memory = memoryStore();
    const payload = run([bid("1", { title: "Untitled opportunity", description: "" }), bid(), bid("bad", { issuer_name: "Unknown issuer" })],
      { pagination: { list_kind: "open", complete: true }, dataQuality: { acceptedCount: 99, contentStatus: "usable" } });
    const originalMetadata = structuredClone(payload.metadata);
    const outcome = intakeCrawlerRun(payload, memory.store);
    expect(outcome.result).toEqual({ fetchedCount: 3, insertedCount: 1, updatedCount: 0, logCount: 1 });
    expect([...memory.bids.keys()]).toEqual(["city_portal:1"]);
    expect(outcome.metadata).toMatchObject({ pagination: { complete: false }, dataQuality: {
      receivedCount: 3, uniqueCount: 2, acceptedCount: 1, duplicateCount: 1, quarantinedCount: 1,
      acceptedIds: ["city_portal:1"], validBodyCount: 1, analysisReadyCount: 1, contentStatus: "partial",
      reconciliation: { observed: 2, accepted: 1, quarantined: 1, balanced: true },
    } });
    expect(memory.events.at(-1)).toBe("log");
    expect(memory.events).not.toContain("delist");
    expect(memory.logs[0]).toMatchObject({ counts: { fetchedCount: 3, insertedCount: 1 }, payload: { metadata: outcome.metadata } });
    expect(payload.metadata).toEqual(originalMetadata);
  });

  it("quarantines conflicting duplicate identities as one unique candidate", () => {
    const memory = memoryStore();
    const outcome = intakeCrawlerRun(run([bid(), bid("1", { state_code: "IL" })]), memory.store);
    expect(memory.bids.size).toBe(0);
    expect(outcome.metadata).toMatchObject({ dataQuality: { uniqueCount: 1, duplicateCount: 1, quarantinedCount: 1,
      quarantinedRecords: [{ issues: ["conflicting_duplicate_identity"] }], reconciliation: { balanced: true } } });
  });

  it("protects prior core-valid identity and blocks delisting when a changed identity is unresolved", () => {
    const memory = memoryStore([bid(), bid("old")]);
    const outcome = intakeCrawlerRun(run([bid("1", { fips_code: "0810000" })], { pagination: { complete: true, list_kind: "open" } }), memory.store);
    expect(memory.bids.get("city_portal:1")?.fips_code).toBe("0804000");
    expect(memory.bids.get("city_portal:old")?.lifecycle_status).toBe("open");
    expect(outcome.result).toMatchObject({ insertedCount: 0, updatedCount: 0 });
    expect(outcome.metadata).toMatchObject({ dataQuality: { quarantinedCount: 1, acceptedCount: 0,
      quarantinedRecords: [{ issues: ["identity_changed:fips_code"] }] } });
  });

  it("can repair prior malformed core identity with a valid incoming candidate", () => {
    const memory = memoryStore([bid("1", { issuer_name: "Unknown issuer", fips_code: "0810000" })]);
    const outcome = intakeCrawlerRun(run([bid()]), memory.store);
    expect(outcome.result.updatedCount).toBe(1);
    expect(memory.bids.get("city_portal:1")?.fips_code).toBe("0804000");
  });

  it("uses the actual stored primary id for a dedupe match and its attachments and accepted evidence", () => {
    const memory = memoryStore([bid("1", { id: "city_portal:legacy" })]);
    const outcome = intakeCrawlerRun(run([bid("1", { attachments: [file({ id: undefined })] })], { pagination: { complete: true, list_kind: "open" } }), memory.store);
    expect([...memory.bids.keys()]).toEqual(["city_portal:legacy"]);
    expect(outcome.result).toMatchObject({ insertedCount: 0, updatedCount: 1, delistedCount: 0 });
    expect(outcome.metadata).toMatchObject({ dataQuality: { acceptedIds: ["city_portal:legacy"] } });
    expect(memory.attachments[0]).toMatchObject({ id: "city_portal:legacy:attachment:1", bid_id: "city_portal:legacy" });
  });

  it("preserves retained body age, provenance, archives and verified attachment capabilities without incoming files", () => {
    const prior = bid("1", { detail_fetched_at: EARLIER, detail_archive_status: "archived", detail_archive_path: "detail.html",
      raw_payload: { enrichment: { applied_fields: ["description"] }, data_quality: { body: { verifiedAt: EARLIER } } } });
    const memory = memoryStore([prior], [file({ bid_id: "city_portal:1", verified_at: EARLIER })]);
    const outcome = intakeCrawlerRun(run([bid("1", { description: "Bridge rehabilitation", attachments: [],
      detail_archive_status: "failed", detail_fetched_at: NOW,
      raw_payload: { enrichment: { applied_fields: [], outcome: { status: "failure", attempted: true } } } })]), memory.store);
    expect(memory.bids.get("city_portal:1")).toMatchObject({ description: BODY, detail_archive_status: "archived", detail_archive_path: "detail.html",
      raw_payload: { enrichment: { persisted_fields: ["description"] }, data_quality: { body: { reused: true, verifiedAt: EARLIER },
        capabilities: { analysis: true, attachments: true }, attachments: { discovered: 1, verified: 1 } } } });
    expect(outcome.metadata).toMatchObject({ dataQuality: { validBodyCount: 1, retainedBodyCount: 1, fetchedBodyCount: 0 } });
    expect(memory.attachments).toHaveLength(1);
    expect(memory.events).not.toContain("write-files:city_portal:1");
  });

  it("does not trust new-file verification and invalidates verified bytes after an archive change", () => {
    const memory = memoryStore([bid()], [file({ bid_id: "city_portal:1", verified_at: EARLIER })]);
    intakeCrawlerRun(run([bid("1", { attachments: [file({ checksum_sha256: "b".repeat(64), verified_at: NOW }),
      file({ id: "new-file", url: "https://procurement.example.gov/new.pdf", verified_at: NOW })] })]), memory.store);
    expect(memory.attachments.map((row) => row.verified_at)).toEqual([null, null]);
    expect(memory.bids.get("city_portal:1")).toMatchObject({ raw_payload: { data_quality: {
      capabilities: { attachments: false }, attachments: { discovered: 2, archived: 2, verified: 0 } } } });
  });

  it("retains known files while merging URL aliases and writes the same snapshot that quality assessed", () => {
    const memory = memoryStore([bid()], [file({ bid_id: "city_portal:1", verified_at: EARLIER })]);
    intakeCrawlerRun(run([bid("1", { attachments: [file({ id: "changed-id", archive_status: "not_archived", storage_path: null,
      name: "Updated scope" }), { name: "Other", url: "https://procurement.example.gov/other.pdf" }] })]), memory.store);
    expect(memory.attachments).toHaveLength(2);
    expect(memory.attachments[0]).toMatchObject({ id: "scope-file", name: "Updated scope", archive_status: "archived", verified_at: EARLIER });
    expect(memory.bids.get("city_portal:1")).toMatchObject({ raw_payload: { data_quality: {
      attachments: { discovered: 2, archived: 1, verified: 1 }, capabilities: { attachments: true } } } });
    expect(memory.events.filter((event) => event.startsWith("read-files"))).toHaveLength(1);
  });

  it.each([{ dateFilter: { from: "2026-09-01" } }, { mode: "detail_backfill" }, { pagination: { complete: false, list_kind: "open" } }])(
    "keeps missing open bids after a scoped or partial list (%j)", (metadata) => {
      const memory = memoryStore([bid("old")]);
      const outcome = intakeCrawlerRun(run([bid()], { pagination: { complete: true, list_kind: "open" }, ...metadata }), memory.store);
      expect(memory.bids.get("city_portal:old")?.lifecycle_status).toBe("open");
      expect(outcome.result).not.toHaveProperty("delistedCount");
      expect(memory.events).not.toContain("delist");
    });

  it("delists only after accepted bid and attachment writes and logs the completed result", () => {
    const memory = memoryStore([bid("old"), bid("other", { id: "other_source:other" })]);
    const outcome = intakeCrawlerRun(run([bid("1", { attachments: [file()] })], { pagination: { complete: true, list_kind: "open" } }), memory.store);
    expect(outcome.result.delistedCount).toBe(1);
    expect(memory.bids.get("city_portal:old")?.lifecycle_status).toBe("closed");
    expect(memory.bids.get("other_source:other")?.lifecycle_status).toBe("open");
    expect(memory.events.slice(-4)).toEqual(["write-bid:city_portal:1", "write-files:city_portal:1", "delist", "log"]);
    expect(memory.logs[0].payload.metadata).toMatchObject({ lifecycle: { delisted: 1 }, dataQuality: { acceptedIds: ["city_portal:1"] } });
  });

  describe("deadline-passed close", () => {
    // NOW is 2026-10-08T00:00:00Z; a date-only deadline is good until 10:00Z on the following day.
    const PASSED = "10/06/2026";
    const AHEAD = "10/09/2026";

    it.each(["sync", "async"] as const)("stores a bid closed once its deadline has passed, and says why (%s)", async (mode) => {
      const memory = memoryStore();
      const payload = run([bid("1", { deadline_date: PASSED }), bid("2", { deadline_date: AHEAD }), bid("3", { deadline_date: "TBD" }), bid("4")]);
      if (mode === "sync") intakeCrawlerRun(payload, memory.store);
      else await intakeCrawlerRunAsync(payload, memory.asyncStore);

      expect(memory.bids.get("city_portal:1")).toMatchObject({ lifecycle_status: "closed", is_active: 0,
        raw_payload: { lifecycle: { closed_reason: "deadline_passed", closed_observed_at: NOW, deadline: PASSED } } });
      for (const id of ["2", "3", "4"]) expect(memory.bids.get(`city_portal:${id}`)).toMatchObject({ lifecycle_status: "open", is_active: 1 });
      expect(memory.bids.get("city_portal:2")?.raw_payload).not.toHaveProperty("lifecycle");
    });

    it("opens the bid again, with no stale reason, when the next run shows a deadline that is ahead", () => {
      const memory = memoryStore();
      intakeCrawlerRun(run([bid("1", { deadline_date: PASSED })]), memory.store);
      expect(memory.bids.get("city_portal:1")).toMatchObject({ lifecycle_status: "closed" });
      intakeCrawlerRun(run([bid("1", { deadline_date: AHEAD })]), memory.store);

      expect(memory.bids.get("city_portal:1")).toMatchObject({ lifecycle_status: "open", is_active: 1, deadline_date: AHEAD });
      expect(JSON.stringify(memory.bids.get("city_portal:1")?.raw_payload)).not.toContain("closed_reason");
    });

    it("judges by the time the run finished, falling back to the time it started", () => {
      const memory = memoryStore();
      const rows = [bid("1", { deadline_date: PASSED })];
      intakeCrawlerRun({ ...run(rows), startedAt: EARLIER, finishedAt: NOW }, memory.store);
      expect(memory.bids.get("city_portal:1")).toMatchObject({ lifecycle_status: "closed" });

      const other = memoryStore();
      intakeCrawlerRun({ ...run(rows), startedAt: EARLIER, finishedAt: null }, other.store);
      expect(other.bids.get("city_portal:1")).toMatchObject({ lifecycle_status: "open", is_active: 1 });
      const unset = memoryStore();
      const started = run(rows);
      delete started.finishedAt;
      intakeCrawlerRun(started, unset.store);
      expect(unset.bids.get("city_portal:1")).toMatchObject({ lifecycle_status: "closed" });
    });

    it("counts a bid the deadline closed as seen, so only the bids a complete list lacks are delisted", () => {
      const memory = memoryStore([bid("old", { deadline_date: AHEAD })]);
      const outcome = intakeCrawlerRun(run([bid("1", { deadline_date: PASSED })], { pagination: { complete: true, list_kind: "open" } }), memory.store);

      expect(outcome.result).toMatchObject({ insertedCount: 1, delistedCount: 1 });
      expect(memory.bids.get("city_portal:1")?.raw_payload).toMatchObject({ lifecycle: { closed_reason: "deadline_passed" } });
      expect(memory.bids.get("city_portal:old")?.lifecycle_status).toBe("closed");
    });
  });

  it("accepts verified empty lists but rejects unexplained zero-row success before a write", () => {
    const memory = memoryStore([bid("old")]);
    expect(() => intakeCrawlerRun(run([]), memory.store)).toThrow("no bid rows");
    expect(memory.events).toEqual([]);
    const outcome = intakeCrawlerRun(run([], { emptyState: { verified: true, tenant_confirmed: true },
      pagination: { list_kind: "open", complete: true } }), memory.store);
    expect(outcome.result).toMatchObject({ fetchedCount: 0, delistedCount: 1, logCount: 1 });
    expect(outcome.metadata).toMatchObject({ dataQuality: { contentStatus: "empty_verified" } });
  });

  it("imports no bids from a failure document even when it carries valid rows and upstream quality", () => {
    const memory = memoryStore([bid("old")]);
    const outcome = intakeCrawlerRun({ ...run([bid()], { dataQuality: { acceptedCount: 4, contentStatus: "usable" },
      pagination: { complete: true, list_kind: "open" } }), status: "failure" }, memory.store);
    expect(memory.events).toEqual(["log"]);
    expect([...memory.bids.keys()]).toEqual(["city_portal:old"]);
    expect(outcome.result).toMatchObject({ insertedCount: 0, updatedCount: 0, logCount: 1 });
    expect(outcome.metadata).toMatchObject({ dataQuality: { execution: "failure", acceptedCount: 0, contentStatus: "unknown" } });
  });

  it("propagates attachment write failure without delisting or logging success or mutating input metadata", () => {
    const memory = memoryStore(); memory.failAttachments();
    const payload = run([bid("1", { attachments: [file()] })], { pagination: { complete: true, list_kind: "open" } });
    const metadata = structuredClone(payload.metadata);
    expect(() => intakeCrawlerRun(payload, memory.store)).toThrow("attachment write failed");
    expect(memory.events).not.toContain("delist"); expect(memory.logs).toEqual([]);
    expect(payload.metadata).toEqual(metadata);
  });

  it("runs the same workflow with asynchronous storage and waits for each write before completion", async () => {
    const sync = memoryStore([bid("old")]); const async = memoryStore([bid("old")]);
    const payload = run([bid("1", { attachments: [file()] }), bid("bad", { title: "Untitled opportunity" })],
      { pagination: { complete: true, list_kind: "open" } });
    const expected = intakeCrawlerRun(payload, sync.store);
    const outcome = await intakeCrawlerRunAsync(payload, async.asyncStore);
    expect(outcome).toEqual(expected); expect(async.events).toEqual(sync.events);
    expect([...async.bids.values()]).toEqual([...sync.bids.values()]); expect(async.attachments).toEqual(sync.attachments);
    expect(async.logs).toEqual(sync.logs);
  });

  it("propagates asynchronous storage rejection before any success log", async () => {
    const memory = memoryStore(); memory.failAttachments();
    await expect(intakeCrawlerRunAsync(run([bid("1", { attachments: [file()] })]), memory.asyncStore)).rejects.toThrow("attachment write failed");
    expect(memory.logs).toEqual([]);
  });
});
