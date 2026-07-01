/**
 * Prompt version registry.
 *
 * Every AI feature in this codebase already stamps its output with a free-form
 * `promptVersion` string (see `run-metadata.ts` / `AiRunMetadata.promptVersion`),
 * for example `"intent-brief-lite@2026-06-10"`. That convention works, but the
 * version strings are hand-typed at each call site with no central place that
 * confirms a given prompt name/version pair is a real, known prompt, and no
 * place to look up what a version actually contains (template, model hints,
 * changelog) after the fact.
 *
 * This module adds a lightweight, in-process registry on top of that existing
 * convention:
 *   - `registerPrompt` / `getPrompt` let call sites resolve a `promptVersion`
 *     string from a stable `(name, version)` pair instead of hand-typing it.
 *   - `resolvePromptVersion(name)` returns the current (latest active) version
 *     string for a prompt name, so call sites can adopt the registry without
 *     changing their `AiRunMetadata.promptVersion` field shape.
 *   - `assertKnownPromptVersion` lets cost/confidence tooling (or tests) verify
 *     that a `promptVersion` string emitted by a call site is actually a
 *     registered version, catching silent drift between the prompt text and
 *     the version stamped on stored output.
 *
 * This intentionally does not depend on any specific LLM SDK. As of this
 * writing there is no `openai` / `@anthropic-ai/sdk` / `ai` (Vercel AI SDK)
 * package in `frontend/package.json` and no live LLM call site in the repo
 * (see `frontend/src/server/ai/providers.ts` — only deterministic/mock
 * providers exist today). The registry stores plain prompt template strings
 * and metadata so it will work unmodified once a real provider is wired in
 * through `AiProviderRegistry`.
 */

export type PromptStatus = "active" | "deprecated";

export interface PromptDefinition {
  /** Stable, human-readable prompt name, e.g. "intent_brief". Not versioned. */
  name: string;
  /** Explicit version identifier, e.g. "2026-06-10" or "v2". Combined with name to form promptVersion. */
  version: string;
  /** The prompt template itself (may contain {{placeholder}} tokens). Empty string is valid for deterministic/rule-based "prompts" that don't call an LLM yet. */
  template: string;
  /** Free-text description of what changed in this version, for audit/debugging. */
  changelog: string;
  /** "active" versions are eligible for resolvePromptVersion(); "deprecated" versions remain registered (so old logged runs still resolve) but are never returned as the current version. */
  status: PromptStatus;
  /** ISO timestamp this version was registered/authored. */
  createdAt: string;
}

export interface RegisterPromptInput {
  name: string;
  version: string;
  template: string;
  changelog?: string;
  status?: PromptStatus;
  createdAt?: string;
}

/**
 * The full identifier stamped onto `AiRunMetadata.promptVersion` elsewhere in
 * the codebase. Kept as a plain string type (not a branded type) so it drops
 * into existing `promptVersion: string` fields without churn.
 */
export type PromptVersionId = string;

export class UnknownPromptError extends Error {
  constructor(name: string) {
    super(`No prompt is registered under the name "${name}".`);
    this.name = "UnknownPromptError";
  }
}

export class UnknownPromptVersionError extends Error {
  constructor(promptVersionId: string) {
    super(`"${promptVersionId}" is not a registered prompt version.`);
    this.name = "UnknownPromptVersionError";
  }
}

export class DuplicatePromptVersionError extends Error {
  constructor(name: string, version: string) {
    super(`Prompt "${name}" already has a registered version "${version}".`);
    this.name = "DuplicatePromptVersionError";
  }
}

export class NoActivePromptVersionError extends Error {
  constructor(name: string) {
    super(`Prompt "${name}" has no active (non-deprecated) version registered.`);
    this.name = "NoActivePromptVersionError";
  }
}

function buildPromptVersionId(name: string, version: string): PromptVersionId {
  return `${name}@${version}`;
}

/**
 * Parses a promptVersion identifier of the form "<name>@<version>" back into
 * its parts. Returns null if the string does not match that shape (some
 * legacy call sites may have stamped bespoke strings before this registry
 * existed; callers should treat those as "unregistered" rather than throwing).
 */
export function parsePromptVersionId(promptVersionId: string): { name: string; version: string } | null {
  const separatorIndex = promptVersionId.indexOf("@");
  if (separatorIndex <= 0 || separatorIndex === promptVersionId.length - 1) {
    return null;
  }

  return {
    name: promptVersionId.slice(0, separatorIndex),
    version: promptVersionId.slice(separatorIndex + 1),
  };
}

export class PromptRegistry {
  private readonly prompts = new Map<string, PromptDefinition>();

  register(input: RegisterPromptInput): PromptVersionId {
    const promptVersionId = buildPromptVersionId(input.name, input.version);

    if (this.prompts.has(promptVersionId)) {
      throw new DuplicatePromptVersionError(input.name, input.version);
    }

    this.prompts.set(promptVersionId, {
      name: input.name,
      version: input.version,
      template: input.template,
      changelog: input.changelog ?? "",
      status: input.status ?? "active",
      createdAt: input.createdAt ?? new Date().toISOString(),
    });

    return promptVersionId;
  }

  /** Marks a previously registered version as deprecated so it stops being returned by resolvePromptVersion, without deleting its record (old logged runs must still resolve). */
  deprecate(name: string, version: string) {
    const promptVersionId = buildPromptVersionId(name, version);
    const existing = this.prompts.get(promptVersionId);

    if (!existing) {
      throw new UnknownPromptVersionError(promptVersionId);
    }

    this.prompts.set(promptVersionId, { ...existing, status: "deprecated" });
  }

  /** Look up a specific registered prompt by its full "<name>@<version>" identifier. */
  getPrompt(promptVersionId: PromptVersionId): PromptDefinition {
    const prompt = this.prompts.get(promptVersionId);

    if (!prompt) {
      throw new UnknownPromptVersionError(promptVersionId);
    }

    return prompt;
  }

  tryGetPrompt(promptVersionId: PromptVersionId): PromptDefinition | null {
    return this.prompts.get(promptVersionId) ?? null;
  }

  /** All registered versions (active and deprecated) for a given prompt name, newest-registered first. */
  listVersions(name: string): PromptDefinition[] {
    return [...this.prompts.values()]
      .filter((prompt) => prompt.name === name)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /** Returns the identifier of the current active version for a prompt name. Throws if the name is unknown or has no active version (e.g. every version was deprecated without a replacement). */
  resolvePromptVersion(name: string): PromptVersionId {
    const versions = this.listVersions(name);

    if (versions.length === 0) {
      throw new UnknownPromptError(name);
    }

    const active = versions.find((version) => version.status === "active");

    if (!active) {
      throw new NoActivePromptVersionError(name);
    }

    return buildPromptVersionId(active.name, active.version);
  }

  /** Confirms a promptVersion string (as stamped onto AiRunMetadata.promptVersion) is a version this registry actually knows about. Intended for tests/audits that want to catch drift between call-site strings and registered prompts. */
  isKnownPromptVersion(promptVersionId: string): boolean {
    return this.prompts.has(promptVersionId);
  }

  /** Renders a template's {{placeholder}} tokens with the given values. Pure string substitution — no external templating dependency. Unresolved placeholders are left as-is so callers can detect missing values. */
  render(promptVersionId: PromptVersionId, values: Record<string, string>): string {
    const prompt = this.getPrompt(promptVersionId);

    return prompt.template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
    });
  }
}

/**
 * Process-wide singleton registry. AI feature modules register their prompts
 * once at import time (see `known-prompts.ts`) and call sites resolve
 * `promptVersion` strings from it instead of hand-typing version literals.
 */
export const promptRegistry = new PromptRegistry();

export function registerPrompt(input: RegisterPromptInput): PromptVersionId {
  return promptRegistry.register(input);
}

export function resolvePromptVersion(name: string): PromptVersionId {
  return promptRegistry.resolvePromptVersion(name);
}

export function assertKnownPromptVersion(promptVersionId: string): void {
  if (!promptRegistry.isKnownPromptVersion(promptVersionId)) {
    throw new UnknownPromptVersionError(promptVersionId);
  }
}
