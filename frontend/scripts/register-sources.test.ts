import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { dataSources } from "../src/server/db/schema";
import { type SourceCandidate, registerSources, validateCandidate } from "./register-sources";

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
