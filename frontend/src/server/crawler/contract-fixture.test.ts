import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCrawlTaskPayload } from "./state-runner";
import type { CrawlableSource } from "./source-registry";

const CONTRACT_PATH = path.resolve(
  process.cwd(),
  "..",
  "crawler",
  "tests",
  "fixtures",
  "contracts",
  "fetch_task_v1.json",
);

const SOURCE: CrawlableSource = {
  id: "ca_caleprocure",
  label: "California Cal eProcure",
  issuerType: "state",
  stateCode: "CA",
  baseUrl: "https://caleprocure.ca.gov",
  cadence: "daily",
  providerFamily: null,
  jurisdictionLevel: "state",
  jurisdictionName: "California",
  fipsCode: "06",
  fetchConfig: { base_url: "https://caleprocure.ca.gov" },
  lastSuccessAt: null,
  consecutiveFailures: 0,
};

describe("fetch-task contract fixture", () => {
  it("matches the sample the Python side consumes", () => {
    const payload = buildCrawlTaskPayload(SOURCE, { taskId: "tsk_contract_1" });
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;

    if (process.env.UPDATE_CONTRACT_FIXTURE === "1") {
      mkdirSync(path.dirname(CONTRACT_PATH), { recursive: true });
      writeFileSync(CONTRACT_PATH, serialized, "utf8");
    }

    expect(readFileSync(CONTRACT_PATH, "utf8")).toBe(serialized);
  });
});
