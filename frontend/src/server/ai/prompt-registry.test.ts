import { describe, expect, it } from "vitest";
import {
  DuplicatePromptVersionError,
  NoActivePromptVersionError,
  PromptRegistry,
  UnknownPromptError,
  UnknownPromptVersionError,
  parsePromptVersionId,
} from "./prompt-registry";

describe("prompt registry", () => {
  it("registers a prompt version and resolves it as the current active version", () => {
    const registry = new PromptRegistry();

    const promptVersionId = registry.register({
      name: "intent_brief",
      version: "2026-06-10",
      template: "Summarize {{title}} for {{issuer}}.",
      changelog: "Initial version.",
      createdAt: "2026-06-10T00:00:00.000Z",
    });

    expect(promptVersionId).toBe("intent_brief@2026-06-10");
    expect(registry.resolvePromptVersion("intent_brief")).toBe("intent_brief@2026-06-10");
    expect(registry.isKnownPromptVersion("intent_brief@2026-06-10")).toBe(true);
    expect(registry.isKnownPromptVersion("intent_brief@does-not-exist")).toBe(false);
  });

  it("renders a template's placeholders and leaves unresolved ones untouched", () => {
    const registry = new PromptRegistry();
    const promptVersionId = registry.register({
      name: "intent_brief",
      version: "2026-06-10",
      template: "Summarize {{title}} for {{issuer}}.",
    });

    expect(registry.render(promptVersionId, { title: "Roof repair", issuer: "City of Springfield" })).toBe(
      "Summarize Roof repair for City of Springfield.",
    );
    expect(registry.render(promptVersionId, { title: "Roof repair" })).toBe(
      "Summarize Roof repair for {{issuer}}.",
    );
  });

  it("throws when registering a duplicate name/version pair", () => {
    const registry = new PromptRegistry();
    registry.register({ name: "intent_brief", version: "2026-06-10", template: "" });

    expect(() => registry.register({ name: "intent_brief", version: "2026-06-10", template: "" })).toThrow(
      DuplicatePromptVersionError,
    );
  });

  it("throws when resolving an unknown prompt name", () => {
    const registry = new PromptRegistry();

    expect(() => registry.resolvePromptVersion("does_not_exist")).toThrow(UnknownPromptError);
  });

  it("throws when every version of a prompt has been deprecated", () => {
    const registry = new PromptRegistry();
    registry.register({ name: "intent_brief", version: "2026-06-10", template: "" });
    registry.deprecate("intent_brief", "2026-06-10");

    expect(() => registry.resolvePromptVersion("intent_brief")).toThrow(NoActivePromptVersionError);
    // Deprecated versions remain resolvable by exact id so old logged runs still resolve.
    expect(registry.getPrompt("intent_brief@2026-06-10").status).toBe("deprecated");
  });

  it("resolves to the newest active version and keeps deprecated versions listed", () => {
    const registry = new PromptRegistry();
    registry.register({
      name: "intent_brief",
      version: "2026-05-01",
      template: "old",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    registry.deprecate("intent_brief", "2026-05-01");
    registry.register({
      name: "intent_brief",
      version: "2026-06-10",
      template: "new",
      createdAt: "2026-06-10T00:00:00.000Z",
    });

    expect(registry.resolvePromptVersion("intent_brief")).toBe("intent_brief@2026-06-10");
    expect(registry.listVersions("intent_brief")).toHaveLength(2);
  });

  it("throws UnknownPromptVersionError when looking up an unregistered promptVersion id", () => {
    const registry = new PromptRegistry();

    expect(() => registry.getPrompt("intent_brief@missing")).toThrow(UnknownPromptVersionError);
    expect(() => registry.deprecate("intent_brief", "missing")).toThrow(UnknownPromptVersionError);
    expect(registry.tryGetPrompt("intent_brief@missing")).toBeNull();
  });

  it("parses a well-formed promptVersion id into name and version", () => {
    expect(parsePromptVersionId("intent-brief-lite@2026-06-10")).toEqual({
      name: "intent-brief-lite",
      version: "2026-06-10",
    });
  });

  it("returns null for malformed promptVersion ids", () => {
    expect(parsePromptVersionId("no-separator")).toBeNull();
    expect(parsePromptVersionId("@missing-name")).toBeNull();
    expect(parsePromptVersionId("missing-version@")).toBeNull();
  });
});
