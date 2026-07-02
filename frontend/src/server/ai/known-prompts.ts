/**
 * Central registration point for every prompt used by an AI feature call site
 * in this codebase. Importing this module has the side effect of populating
 * `promptRegistry` (see `prompt-registry.ts`) — call sites then resolve their
 * `promptVersion` via `resolvePromptVersion(name)` instead of hand-typing a
 * version string inline.
 *
 * Existing call sites (`intents/brief-generator.ts`, `qualification/qa.ts`,
 * etc.) already stamp `AiRunMetadata.promptVersion` with literals like
 * `"intent-brief-lite@2026-06-10"`. Those exact strings are preserved here as
 * the initial registered version (`name` + `version` combine to reproduce the
 * same "<name>@<version>" identifier) so adopting the registry does not
 * change any persisted or displayed value — it only adds a lookup layer on
 * top of what call sites already emit.
 *
 * `template` is intentionally empty for prompts whose current implementation
 * is a deterministic/rule-based generator rather than a real LLM call (see
 * `frontend/src/server/ai/providers.ts` — no LLM SDK is configured yet).
 * Once a real provider is wired in, fill in the template text here; call
 * sites do not need to change since they only ever ask for
 * `resolvePromptVersion(name)`.
 */

import { registerPrompt } from "./prompt-registry";

export const PROMPT_NAMES = {
  intentBrief: "intent-brief-lite",
  qualificationQa: "qualification-qa-lite",
} as const;

export type KnownPromptName = (typeof PROMPT_NAMES)[keyof typeof PROMPT_NAMES];

let registered = false;

/**
 * Idempotent registration entry point. Safe to call multiple times (e.g. once
 * per test file) — subsequent calls are no-ops. Modules that resolve prompt
 * versions should import `ensureKnownPromptsRegistered` and call it before
 * calling `resolvePromptVersion`, since ES module evaluation order is not
 * guaranteed across separate test files that import this module independently.
 */
export function ensureKnownPromptsRegistered(): void {
  if (registered) {
    return;
  }

  registerPrompt({
    name: PROMPT_NAMES.intentBrief,
    version: "2026-06-10",
    template: "",
    changelog: "Initial deterministic intent brief generator (no live LLM call). Matches the promptVersion literal already emitted by generateIntentBrief().",
    status: "active",
    createdAt: "2026-06-10T00:00:00.000Z",
  });

  registerPrompt({
    name: PROMPT_NAMES.qualificationQa,
    version: "2026-06-10",
    template: "",
    changelog: "Initial deterministic qualification Q&A answerer (no live LLM call). Matches the promptVersion literal already emitted by answerQualificationQuestion().",
    status: "active",
    createdAt: "2026-06-10T00:00:00.000Z",
  });

  registered = true;
}

ensureKnownPromptsRegistered();
