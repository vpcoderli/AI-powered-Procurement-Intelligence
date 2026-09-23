import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { dataSources } from "../src/server/db/schema";
import {
  CandidateFileError,
  type SourceCandidate,
  describeCandidateFile,
  parseCandidateFile,
  partialDiscoveryRefusal,
  registerSources,
  validateCandidate,
} from "./register-sources";

const NOW = "2026-07-31T00:00:00.000Z";

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    id: "bidnet_co_denver",
    label: "Denver County (BidNet)",
    issuerType: "county",
    stateCode: "CO",
    baseUrl: "https://www.bidnetdirect.com/denver-county/solicitations/open-bids",
    jurisdictionLevel: "county",
    jurisdictionName: "Denver County",
    fipsCode: "08031",
    providerFamily: "bidnet",
    cadence: "daily",
    fetchConfig: { base_url: "https://www.bidnetdirect.com/denver-county/solicitations/open-bids" },
    ...overrides,
  };
}

describe("validateCandidate", () => {
  it("accepts a valid candidate", () => {
    expect(validateCandidate(candidate())).toEqual([]);
  });

  it("rejects a candidate missing id", () => {
    const errors = validateCandidate(candidate({ id: "" }));
    expect(errors).toContainEqual(expect.stringContaining("id"));
  });

  it("rejects a candidate with invalid jurisdiction_level", () => {
    const errors = validateCandidate(candidate({ jurisdictionLevel: "planet" }));
    expect(errors).toContainEqual(expect.stringContaining("jurisdictionLevel"));
  });
});

/**
 * Cross-language contract with `python -m apsi_crawler.cli discover-sources`
 * (`crawler/apsi_crawler/discovery_service.py`, spec §4.2). The two objects below are
 * copied verbatim from that command's output, so this file fails the moment the Python
 * emitter and `SourceCandidate` drift apart. The Python twin is
 * `crawler/tests/test_discover_sources_cli.py::test_candidate_carries_exactly_the_source_candidate_fields_plus_discovery`.
 */
interface DiscoveredCandidate extends SourceCandidate {
  discovery: {
    agencyName: string;
    group: string | null;
    matchedOn: string;
    confidence: "exact" | "jurisdiction_prefix";
    /** Names the jurisdiction when the agency is a department within it; null on an exact match. */
    matchedPrefix: string | null;
  };
}

const DISCOVERED: DiscoveredCandidate[] = [
  {
    id: "bidnet_oh_cuyahoga",
    label: "Cuyahoga County (BidNet)",
    issuerType: "county",
    stateCode: "OH",
    baseUrl: "https://www.bidnetdirect.com/ohio/cuyahogacounty/solicitations/open-bids",
    jurisdictionLevel: "county",
    jurisdictionName: "Cuyahoga County",
    fipsCode: "39035",
    providerFamily: "bidnet",
    cadence: "daily",
    fetchConfig: { base_url: "https://www.bidnetdirect.com/ohio/cuyahogacounty/solicitations/open-bids" },
    discovery: {
      agencyName: "Cuyahoga County",
      group: "ohio",
      matchedOn: "county",
      confidence: "exact",
      matchedPrefix: null,
    },
  },
  {
    id: "bidnet_oh_columbus",
    label: "City of Columbus (BidNet)",
    issuerType: "city",
    stateCode: "OH",
    baseUrl: "https://www.bidnetdirect.com/ohio/city-of-columbus/solicitations/open-bids",
    jurisdictionLevel: "city",
    jurisdictionName: "Columbus city",
    fipsCode: "3918000",
    providerFamily: "bidnet",
    cadence: "daily",
    fetchConfig: { base_url: "https://www.bidnetdirect.com/ohio/city-of-columbus/solicitations/open-bids" },
    discovery: {
      agencyName: "City of Columbus",
      group: "ohio",
      matchedOn: "city",
      confidence: "exact",
      matchedPrefix: null,
    },
  },
  {
    // A department *within* Franklin County: still a registerable source, but the reviewer is
    // told the GEOID came from the jurisdiction the name opens with, not from the agency name.
    id: "bidnet_oh_franklin_county_children_services",
    label: "Franklin County Children Services (BidNet)",
    issuerType: "county",
    stateCode: "OH",
    baseUrl: "https://www.bidnetdirect.com/ohio/franklincountychildrensservices/solicitations/open-bids",
    jurisdictionLevel: "county",
    jurisdictionName: "Franklin County",
    fipsCode: "39049",
    providerFamily: "bidnet",
    cadence: "daily",
    fetchConfig: {
      base_url: "https://www.bidnetdirect.com/ohio/franklincountychildrensservices/solicitations/open-bids",
    },
    discovery: {
      agencyName: "Franklin County Children Services",
      group: "ohio",
      matchedOn: "county",
      confidence: "jurisdiction_prefix",
      matchedPrefix: "Franklin County",
    },
  },
];

describe("discover-sources candidates", () => {
  it("validates every candidate the Python CLI emits", () => {
    for (const discovered of DISCOVERED) {
      expect(validateCandidate(discovered)).toEqual([]);
    }
  });

  it("carries exactly the SourceCandidate fields plus the review-only discovery block", () => {
    const expected = [
      "id",
      "label",
      "issuerType",
      "stateCode",
      "baseUrl",
      "jurisdictionLevel",
      "jurisdictionName",
      "fipsCode",
      "providerFamily",
      "cadence",
      "fetchConfig",
      "discovery",
    ].sort();

    for (const discovered of DISCOVERED) {
      expect(Object.keys(discovered).sort()).toEqual(expected);
    }
  });

  it("registers candidates with the extra discovery key untouched", async () => {
    const testDb = await createTestDatabase({ seed: false });
    try {
      const result = registerSources(testDb.db, DISCOVERED, NOW);
      expect(result).toEqual({ inserted: 3, errors: [] });

      const rows = testDb.db.select().from(dataSources).all();
      expect(rows.map((row) => row.id).sort()).toEqual([
        "bidnet_oh_columbus",
        "bidnet_oh_cuyahoga",
        "bidnet_oh_franklin_county_children_services",
      ]);
      // `discovery` is for the human reviewer only -- it must never reach fetch_config.
      for (const row of rows) {
        expect(JSON.parse(row.fetchConfig ?? "{}")).toEqual({ base_url: row.baseUrl });
        expect(row.approvalStatus).toBeNull();
      }
    } finally {
      await testDb.cleanup();
    }
  });
});

/** `discover-sources` output exactly as the Python CLI writes it (spec §4.2). */
function discoveryDocument(stats: Record<string, unknown> = {}) {
  return {
    candidates: DISCOVERED,
    review: [
      {
        agencyName: "Columbus City School District",
        tenantUrl: "https://www.bidnetdirect.com/ohio/columbuscityschools/solicitations/open-bids",
        group: "ohio",
        reason: "classified_special_district",
        detail: null,
      },
    ],
    existingMatches: [],
    stats: { pages: 43, agencies: 4, stopped_reason: "exhausted", ...stats },
  };
}

describe("candidate file contract", () => {
  it("reads the discover-sources document as that command writes it", () => {
    const file = parseCandidateFile(discoveryDocument());

    expect(file.candidates.map((c) => c.id)).toEqual(DISCOVERED.map((c) => c.id));
    expect(file.discovery).toEqual({ pages: 43, agencies: 4, review: 1, stoppedReason: "exhausted" });
    expect(describeCandidateFile(file)).toBe(
      "discover-sources output: 43 pages, 4 agencies, stopped_reason=exhausted; 3 candidates, 1 in review",
    );
    expect(partialDiscoveryRefusal(file, false)).toBeNull();
  });

  it("still reads a bare candidate array, the seed-file format", () => {
    const file = parseCandidateFile([candidate()]);

    expect(file.candidates).toHaveLength(1);
    expect(file.discovery).toBeNull();
    expect(describeCandidateFile(file)).toBe("Candidate array: 1 candidates");
    expect(partialDiscoveryRefusal(file, false)).toBeNull();
  });

  it.each(["waf_challenge", "max_pages", "fetch_failed", "no_new_links"])(
    "refuses a run that stopped with %s unless the operator allows a partial registration",
    (stoppedReason) => {
      const file = parseCandidateFile(discoveryDocument({ stopped_reason: stoppedReason, pages: 12 }));

      expect(partialDiscoveryRefusal(file, false)).toContain(`stats.stopped_reason = "${stoppedReason}", 12 pages`);
      expect(partialDiscoveryRefusal(file, true)).toBeNull();
    },
  );

  it("does not invent a stop reason the file does not carry", () => {
    const file = parseCandidateFile({ candidates: DISCOVERED, stats: {} });

    expect(file.discovery).toEqual({ pages: null, agencies: null, review: null, stoppedReason: null });
    expect(partialDiscoveryRefusal(file, false)).toBeNull();
    expect(describeCandidateFile(file)).toContain("stopped_reason=unknown");
  });

  it.each([
    ["an object without candidates", { review: [], stats: {} }],
    ["candidates that are not a list", { candidates: { id: "x" } }],
    ["a scalar", "candidates.json"],
    ["null", null],
    ["a non-object candidate", { candidates: [DISCOVERED[0], "bidnet_oh_columbus"] }],
  ])("refuses %s before anything is validated", (_label, value) => {
    expect(() => parseCandidateFile(value)).toThrow(CandidateFileError);
  });
});

/**
 * The documented handoff, end to end: `discover-sources > file`, then
 * `npm run source:register -- --file file --dry-run` (docs/operations/source-discovery.md §4).
 * QA 2026-09-23 C08b: this used to exit 1 with "candidates is not iterable".
 */
describe("register-sources CLI", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "apsi-discovery-contract-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function dryRun(document: unknown, ...extra: string[]) {
    const file = join(directory, "candidates.json");
    writeFileSync(file, JSON.stringify(document));
    return spawnSync(
      process.execPath,
      [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/register-sources.ts", "--file", file, "--dry-run", ...extra],
      { cwd: process.cwd(), encoding: "utf8" },
    );
  }

  it("dry-runs the discover-sources output as written", () => {
    const result = dryRun(discoveryDocument());

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("discover-sources output: 43 pages, 4 agencies, stopped_reason=exhausted");
    expect(result.stdout).toContain("Dry run: 3 candidates");
    for (const discovered of DISCOVERED) {
      expect(result.stdout).toContain(`  ${discovered.id}: OK`);
    }
    expect(result.stdout).toContain("Dry run: 3 valid, 0 invalid");
  });

  it("answers a partial run the way the real run would, and lets the operator opt in", () => {
    const refused = dryRun(discoveryDocument({ stopped_reason: "waf_challenge", pages: 7 }));
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("Dry run: 3 valid, 0 invalid");
    expect(refused.stderr).toContain('stats.stopped_reason = "waf_challenge", 7 pages');
    expect(refused.stderr).toContain("--allow-partial");

    const allowed = dryRun(discoveryDocument({ stopped_reason: "waf_challenge", pages: 7 }), "--allow-partial");
    expect(allowed.status).toBe(0);
  });

  it("names the problem instead of crashing on a file of the wrong shape", () => {
    const result = dryRun({ review: [], stats: {} });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected the discover-sources output");
    expect(result.stderr).not.toContain("TypeError");
  });
});

describe("registerSources", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("inserts new sources with approval_status = NULL", () => {
    const result = registerSources(testDb.db, [candidate()], NOW);
    expect(result.inserted).toBe(1);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("bidnet_co_denver");
    expect(rows[0].approvalStatus).toBeNull();
    expect(rows[0].jurisdictionLevel).toBe("county");
    expect(rows[0].providerFamily).toBe("bidnet");
    expect(rows[0].cadence).toBe("daily");
  });

  it("updates non-governance fields on conflict", () => {
    registerSources(testDb.db, [candidate()], NOW);
    registerSources(testDb.db, [candidate({ label: "Denver Updated" })], NOW);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Denver Updated");
  });

  it("never overwrites approval_status on upsert", () => {
    registerSources(testDb.db, [candidate()], NOW);

    // Simulate admin manually approving the source
    testDb.db
      .update(dataSources)
      .set({ approvalStatus: "approved" })
      .where(eq(dataSources.id, "bidnet_co_denver"))
      .run();

    registerSources(testDb.db, [candidate({ label: "Denver Updated" })], NOW);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows[0].approvalStatus).toBe("approved");
  });

  it("handles multiple candidates in one call", () => {
    const candidates = [
      candidate({ id: "bidnet_co_denver" }),
      candidate({ id: "bidnet_ca_la_county", stateCode: "CA", jurisdictionName: "Los Angeles County" }),
    ];
    const result = registerSources(testDb.db, candidates, NOW);
    expect(result.inserted).toBe(2);
  });

  it("skips invalid candidates and reports errors", () => {
    const candidates = [
      candidate({ id: "" }),
      candidate({ id: "bidnet_co_denver" }),
    ];
    const result = registerSources(testDb.db, candidates, NOW);
    expect(result.inserted).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
