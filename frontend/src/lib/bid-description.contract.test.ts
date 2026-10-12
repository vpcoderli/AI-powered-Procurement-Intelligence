import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getBidDescription, getBidDescriptionIssue } from "./bid-description";

const contract = JSON.parse(readFileSync(new URL("../../../crawler/tests/fixtures/description_quality_contract.json", import.meta.url), "utf8")) as {
  title: string;
  cases: Array<{ name: string; text: string; issue: string | null }>;
};

describe("shared Python / TypeScript description contract", () => {
  it.each(contract.cases)("$name", ({ text, issue }) => {
    expect(getBidDescriptionIssue(text, contract.title)).toBe(issue);
    expect(getBidDescription({ title: contract.title, description: text })).toBe(issue === null ? text.trim() : "");
  });
});
