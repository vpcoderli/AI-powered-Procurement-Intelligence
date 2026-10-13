import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CI runs `npm run risk:check` on a seeded throwaway database, which holds a state bid in five states and none in the
// other 45. RISK_CHECK_SEED_DATA is what lets the 50-state checks report NOT RUN there instead of failing, so it has to
// stay on that one step: anywhere else it would set a real check aside for no reason this file can see.
const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").split("\n");

/** Lines that are instructions: the comments may name the variable freely. */
const withoutComments = (lines: string[]) => lines.filter((line) => !line.trim().startsWith("#"));

/** The lines of one job: from its key (two spaces in) up to the next job's key. */
function jobLines(name: string): string[] {
  const start = workflow.findIndex((line) => line === `  ${name}:`);
  if (start === -1) throw new Error(`.github/workflows/ci.yml has no job named ${name}`);
  const next = workflow.findIndex((line, index) => index > start && /^ {2}[\w-]+:\s*$/.test(line));
  return workflow.slice(start, next === -1 ? undefined : next);
}

/** The steps of a job, each as its lines: a step starts at a `- ` list item six spaces in. */
function steps(lines: string[]): string[][] {
  const result: string[][] = [];
  for (const line of lines) {
    if (/^ {6}- /.test(line)) result.push([line]);
    else result.at(-1)?.push(line);
  }
  return result;
}

describe(".github/workflows/ci.yml seed-data opt-out", () => {
  it("sets RISK_CHECK_SEED_DATA once in the whole workflow, on the frontend job's Risk check step", () => {
    expect(withoutComments(workflow).filter((line) => line.includes("RISK_CHECK_SEED_DATA")).map((line) => line.trim())).toEqual([
      'RISK_CHECK_SEED_DATA: "true"',
    ]);

    const setting = steps(withoutComments(jobLines("frontend"))).filter((step) => step.some((line) => line.includes("RISK_CHECK_SEED_DATA")));
    expect(setting).toHaveLength(1);
    expect(setting[0][0].trim()).toBe("- name: Risk check");
    expect(setting[0].some((line) => line.trim() === "run: npm run risk:check")).toBe(true);
  });

  it("does not set NODE_ENV in the frontend job, which would make the checklist ignore the opt-out and require all 50 states", () => {
    expect(withoutComments(jobLines("frontend")).filter((line) => line.includes("NODE_ENV"))).toEqual([]);
  });
});
