import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AuthRequiredState", () => {
  it("renders Link-backed actions without native button semantics", () => {
    const source = readFileSync(new URL("AuthRequiredState.tsx", import.meta.url), "utf8");

    expect(source).toContain('render={<Link href="/login" />}');
    expect(source).toContain('render={<Link href="/register" />}');
    expect(source.match(/nativeButton={false}/g)).toHaveLength(2);
  });
});
