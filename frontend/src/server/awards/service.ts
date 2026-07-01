import crypto from "node:crypto";
import { ensureMysqlUserWorkspace } from "@/server/account/mysql-workspace";
import { ensureUserWorkspace } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  findAwardArtifactRow,
  findAwardArtifactRowFromMysql,
  findAwardOutcomeRow,
  findAwardOutcomeRowFromMysql,
  upsertAwardOutcomeRow,
  upsertAwardOutcomeRowFromMysql,
  type AwardOutcomeRow,
} from "./repository";
import {
  isAwardNextAction,
  isAwardOutcomeStatus,
  isLossReasonCode,
  type AwardLearningSummary,
  type AwardNextAction,
  type AwardOutcome,
  type AwardOutcomeStatus,
  type LossReasonCode,
  type UpdateAwardOutcomeInput,
} from "./types";

const MAX_SHORT_TEXT_LENGTH = 240;
const MAX_LONG_TEXT_LENGTH = 4000;

export class AwardOutcomeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwardOutcomeValidationError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeOptionalText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new AwardOutcomeValidationError(`${field} must be a string.`);
  }

  return value.trim().slice(0, maxLength);
}

function normalizeOptionalDateText(value: unknown, field: string) {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AwardOutcomeValidationError(`${field} must be a string or null.`);
  }

  return value.trim() || null;
}

function normalizeUrl(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new AwardOutcomeValidationError(`${field} must be a string.`);
  }

  const normalized = value.trim();
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" || url.protocol === "https:") return normalized;
  } catch {
    // Fall through to the validation error below.
  }

  throw new AwardOutcomeValidationError(`${field} must be an http or https URL.`);
}

function normalizeArtifactId(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AwardOutcomeValidationError("Tabulation artifact is invalid.");
  }

  return value.trim() || null;
}

function normalizeAmount(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AwardOutcomeValidationError("Award amount must be a non-negative integer.");
  }

  return value;
}

function normalizeCurrency(value: unknown) {
  if (typeof value !== "string") {
    throw new AwardOutcomeValidationError("Currency must be a string.");
  }

  return value.trim().toUpperCase().slice(0, 12) || "USD";
}

function normalizeUpdate(input: UpdateAwardOutcomeInput): UpdateAwardOutcomeInput {
  const normalized: UpdateAwardOutcomeInput = {};

  if (input.status !== undefined) {
    if (!isAwardOutcomeStatus(input.status)) {
      throw new AwardOutcomeValidationError("Award outcome status is invalid.");
    }
    normalized.status = input.status;
  }
  if (input.lossReason !== undefined) {
    if (!isLossReasonCode(input.lossReason)) {
      throw new AwardOutcomeValidationError("Loss reason is invalid.");
    }
    normalized.lossReason = input.lossReason;
  }
  if (input.nextAction !== undefined) {
    if (!isAwardNextAction(input.nextAction)) {
      throw new AwardOutcomeValidationError("Award next action is invalid.");
    }
    normalized.nextAction = input.nextAction;
  }
  if (input.awardNoticeUrl !== undefined) {
    normalized.awardNoticeUrl = normalizeUrl(input.awardNoticeUrl, "Award notice URL");
  }
  if (input.tabulationArtifactUrl !== undefined) {
    normalized.tabulationArtifactUrl = normalizeUrl(input.tabulationArtifactUrl, "Tabulation artifact URL");
  }
  if (input.tabulationArtifactId !== undefined) {
    normalized.tabulationArtifactId = normalizeArtifactId(input.tabulationArtifactId);
  }
  if (input.winnerName !== undefined) {
    normalized.winnerName = normalizeOptionalText(input.winnerName, "Winner name", MAX_SHORT_TEXT_LENGTH);
  }
  if (input.lossReasonNotes !== undefined) {
    normalized.lossReasonNotes = normalizeOptionalText(input.lossReasonNotes, "Loss reason notes", MAX_LONG_TEXT_LENGTH);
  }
  if (input.notes !== undefined) {
    normalized.notes = normalizeOptionalText(input.notes, "Award notes", MAX_LONG_TEXT_LENGTH);
  }
  if (input.awardAmountCents !== undefined) {
    normalized.awardAmountCents = normalizeAmount(input.awardAmountCents);
  }
  if (input.currency !== undefined) {
    normalized.currency = normalizeCurrency(input.currency);
  }
  if (input.nextActionDueAt !== undefined) {
    normalized.nextActionDueAt = normalizeOptionalDateText(input.nextActionDueAt, "Next action due date");
  }
  if (input.decidedAt !== undefined) {
    normalized.decidedAt = normalizeOptionalDateText(input.decidedAt, "Decision date");
  }

  return normalized;
}

function outcomeClassForStatus(status: AwardOutcomeStatus) {
  if (status === "awarded_to_us") return "win";
  if (status === "awarded_to_competitor" || status === "cancelled" || status === "no_award") return "loss";
  return "no_decision";
}

function recommendedActionsForOutcome(row: AwardOutcomeRow): AwardNextAction[] {
  const actions: AwardNextAction[] = [];
  if (row.nextAction !== "none" && isAwardNextAction(row.nextAction)) {
    actions.push(row.nextAction as AwardNextAction);
  }

  if (row.status === "awarded_to_competitor") {
    if (row.lossReason === "price_uncompetitive") actions.push("update_pricing");
    if (row.lossReason === "compliance_gap") actions.push("fix_compliance_gap");
    if (row.lossReason === "past_performance") actions.push("refresh_past_performance");
    if (row.lossReason === "scope_fit" || row.lossReason === "schedule_or_capacity") {
      actions.push("requalify_future_bid");
    }
  }

  if (row.status === "awarded_to_us") actions.push("archive");
  if (row.status === "cancelled" || row.status === "no_award") actions.push("requalify_future_bid");

  return [...new Set(actions)];
}

function buildAwardLearningSummary(row: AwardOutcomeRow): AwardLearningSummary {
  const status = row.status as AwardOutcomeStatus;
  const outcomeClass = outcomeClassForStatus(status);
  const winnerName = row.winnerName.trim();
  const primaryDriver = outcomeClass === "win" ? "win" : row.lossReason as LossReasonCode;
  const headline = outcomeClass === "win"
    ? `Won${winnerName ? ` with ${winnerName}` : ""}`
    : outcomeClass === "loss"
      ? status === "awarded_to_competitor"
        ? `Lost to ${winnerName || "competitor"}: ${row.lossReason}`
        : `Closed as ${status}: ${row.lossReason}`
      : "Awaiting award decision";
  const lessons = outcomeClass === "win"
    ? ["Record winning differentiators and reusable artifacts for future pursuits."]
    : outcomeClass === "loss"
      ? [`Recorded loss driver: ${row.lossReason}.`]
      : ["Capture award notice or tabulation when available."];

  if (row.lossReasonNotes.trim()) {
    lessons.push(row.lossReasonNotes.trim());
  } else if (row.notes.trim()) {
    lessons.push(row.notes.trim());
  }

  return {
    outcomeClass,
    headline,
    primaryDriver,
    lessons,
    recommendedActions: recommendedActionsForOutcome(row),
    evidence: {
      awardNoticeUrl: row.awardNoticeUrl,
      tabulationArtifactId: row.tabulationArtifactId,
      tabulationArtifactUrl: row.tabulationArtifactUrl,
      decidedAt: row.decidedAt,
    },
    amountCents: row.awardAmountCents,
    currency: row.currency,
  };
}

function hydrateAwardOutcome(row: AwardOutcomeRow): AwardOutcome {
  if (!isAwardOutcomeStatus(row.status)) {
    throw new Error("Invalid award outcome status.");
  }
  if (!isLossReasonCode(row.lossReason)) {
    throw new Error("Invalid award loss reason.");
  }
  if (!isAwardNextAction(row.nextAction)) {
    throw new Error("Invalid award next action.");
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    status: row.status as AwardOutcomeStatus,
    awardNoticeUrl: row.awardNoticeUrl,
    tabulationArtifactId: row.tabulationArtifactId,
    tabulationArtifactUrl: row.tabulationArtifactUrl,
    winnerName: row.winnerName,
    awardAmountCents: row.awardAmountCents,
    currency: row.currency,
    lossReason: row.lossReason as LossReasonCode,
    lossReasonNotes: row.lossReasonNotes,
    nextAction: row.nextAction as AwardNextAction,
    nextActionDueAt: row.nextActionDueAt,
    notes: row.notes,
    decidedAt: row.decidedAt,
    learningSummary: buildAwardLearningSummary(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function defaultAwardOutcomeRow(input: {
  organizationId: string;
  intentId: string;
  bidId: string;
  userId: string;
  timestamp: string;
}): AwardOutcomeRow {
  return {
    id: `award_outcome_${crypto.randomUUID()}`,
    organizationId: input.organizationId,
    intentId: input.intentId,
    bidId: input.bidId,
    userId: input.userId,
    status: "awaiting_award",
    awardNoticeUrl: "",
    tabulationArtifactId: null,
    tabulationArtifactUrl: "",
    winnerName: "",
    awardAmountCents: null,
    currency: "USD",
    lossReason: "unknown",
    lossReasonNotes: "",
    nextAction: "capture_tabulation",
    nextActionDueAt: null,
    notes: "",
    decidedAt: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

async function loadContext(database: AppDatabase, userId: string, intentId: string) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const workspace = mysql
    ? await ensureMysqlUserWorkspace(mysql, userId)
    : ensureUserWorkspace(database, userId);
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  return { mysql, workspace, intent };
}

async function findExistingOutcome(
  database: AppDatabase,
  mysql: ReturnType<typeof resolveMysqlPool> | null,
  organizationId: string,
  intentId: string,
) {
  return mysql
    ? await findAwardOutcomeRowFromMysql(mysql, organizationId, intentId)
    : findAwardOutcomeRow(database, organizationId, intentId) ?? null;
}

async function validateTabulationArtifact(
  database: AppDatabase,
  mysql: ReturnType<typeof resolveMysqlPool> | null,
  intentId: string,
  artifactId: string | null | undefined,
) {
  if (artifactId === undefined || artifactId === null) return;

  const artifact = mysql
    ? await findAwardArtifactRowFromMysql(mysql, intentId, artifactId)
    : findAwardArtifactRow(database, intentId, artifactId);

  if (!artifact) {
    throw new AwardOutcomeValidationError("Tabulation artifact must belong to this intent.");
  }
}

async function saveOutcome(
  database: AppDatabase,
  mysql: ReturnType<typeof resolveMysqlPool> | null,
  row: AwardOutcomeRow,
) {
  return mysql ? upsertAwardOutcomeRowFromMysql(mysql, row) : upsertAwardOutcomeRow(database, row);
}

export async function getAwardOutcome(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<AwardOutcome> {
  const { mysql, workspace, intent } = await loadContext(database, userId, intentId);
  const existing = await findExistingOutcome(database, mysql, workspace.organizationId, intent.id);

  if (existing) {
    return hydrateAwardOutcome(existing);
  }

  const row = await saveOutcome(database, mysql, defaultAwardOutcomeRow({
    organizationId: workspace.organizationId,
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    timestamp: nowIso(),
  }));

  return hydrateAwardOutcome(row);
}

export async function getAwardLearningSummary(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<AwardLearningSummary> {
  const outcome = await getAwardOutcome(database, userId, intentId);

  return outcome.learningSummary;
}

export async function updateAwardOutcome(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateAwardOutcomeInput,
): Promise<AwardOutcome> {
  const normalized = normalizeUpdate(input);
  const { mysql, workspace, intent } = await loadContext(database, userId, intentId);
  await validateTabulationArtifact(database, mysql, intent.id, normalized.tabulationArtifactId);

  const timestamp = nowIso();
  const existing = await findExistingOutcome(database, mysql, workspace.organizationId, intent.id);
  const base = existing ?? defaultAwardOutcomeRow({
    organizationId: workspace.organizationId,
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    timestamp,
  });
  const row = await saveOutcome(database, mysql, {
    ...base,
    ...normalized,
    organizationId: workspace.organizationId,
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: base.userId || userId,
    updatedAt: timestamp,
  });

  return hydrateAwardOutcome(row);
}
