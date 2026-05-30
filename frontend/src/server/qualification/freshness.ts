import type { Bid } from "@/server/bids/domain";
import type { AppDatabase } from "@/server/db/client";
import { listWorkspaceMemberUserIds } from "@/server/account/workspace";
import { calculateBidMatch } from "@/server/match/service";
import { getSupplierProfile } from "@/server/profile/service";
import { generateIntentBrief } from "@/server/intents/brief-generator";
import { getUserIntent } from "@/server/intents/service";
import { IntentBidNotFoundError, IntentNotFoundError } from "@/server/intents/types";
import {
  findIntentByUsersAndId,
  updateIntentQualificationSnapshotForUsers,
} from "@/server/intents/repository";
import { buildQualificationCitations } from "./citations";
import type {
  QualificationAmendmentSignal,
  QualificationCitation,
  QualificationCitationsResponse,
  QualificationFreshnessResponse,
  QualificationRefreshResponse,
} from "./types";

const AMENDMENT_PATTERNS = [
  /\bamend(?:ment|ed)?\b/i,
  /\baddend(?:um|a)\b/i,
  /\brevised?\b/i,
  /\bupdated?\b/i,
  /\bquestions?\s*(?:and|&)?\s*answers?\b/i,
  /\bq\s*&\s*a\b/i,
];

function nowIso() {
  return new Date().toISOString();
}

function includesSignal(value: string) {
  return AMENDMENT_PATTERNS.some((pattern) => pattern.test(value));
}

function excerpt(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

function latestIso(values: Array<string | null>) {
  const sorted = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();

  return sorted.at(-1) ?? null;
}

function latestSignal(signals: QualificationAmendmentSignal[]) {
  const datedSignals = signals
    .filter((signal) => signal.detectedAt)
    .sort((left, right) => String(left.detectedAt).localeCompare(String(right.detectedAt)));

  return datedSignals.at(-1) ?? signals.at(0) ?? null;
}

function parseCitations(value: string): QualificationCitation[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is QualificationCitation => {
      if (typeof item !== "object" || item === null) return false;
      const citation = item as Partial<QualificationCitation>;
      return typeof citation.generatedAt === "string";
    });
  } catch {
    return [];
  }
}

export function detectQualificationAmendmentSignals(bid: Bid): QualificationAmendmentSignal[] {
  const signals: QualificationAmendmentSignal[] = [];
  const bidFieldDetectedAt = bid.updatedAt ?? (bid.detailFetchedAt || null);

  const fieldCandidates = [
    { sourceType: "title" as const, label: "Solicitation title", value: bid.title, detectedAt: bidFieldDetectedAt },
    { sourceType: "description" as const, label: "Description", value: bid.description, detectedAt: bidFieldDetectedAt },
    { sourceType: "detail_archive" as const, label: "Full description", value: bid.fullDescription, detectedAt: bid.detailFetchedAt || bidFieldDetectedAt },
  ];

  for (const candidate of fieldCandidates) {
    if (!candidate.value || !includesSignal(candidate.value)) continue;
    signals.push({
      sourceType: candidate.sourceType,
      label: candidate.label,
      excerpt: excerpt(candidate.value),
      detectedAt: candidate.detectedAt,
      url: bid.sourceUrl,
    });
  }

  for (const attachment of bid.attachments) {
    const text = [attachment.name, attachment.originalUrl, attachment.url].filter(Boolean).join(" ");
    if (!includesSignal(text)) continue;
    signals.push({
      sourceType: "attachment",
      label: attachment.name,
      excerpt: excerpt(text),
      detectedAt: attachment.fetchedAt || null,
      url: attachment.url || attachment.originalUrl,
    });
  }

  return signals;
}

async function getScopedIntent(database: AppDatabase, userId: string, intentId: string) {
  const scopeUserIds = listWorkspaceMemberUserIds(database, userId);
  const row = findIntentByUsersAndId(database, scopeUserIds, intentId);

  if (!row) {
    throw new IntentNotFoundError();
  }

  const intent = await getUserIntent(database, userId, intentId, { scopeUserIds }).catch((error) => {
    if (error instanceof IntentBidNotFoundError) {
      throw new IntentNotFoundError();
    }
    throw error;
  });

  if (!intent) {
    throw new IntentNotFoundError();
  }

  return { scopeUserIds, row, intent };
}

function freshnessFromInputs(input: {
  intentId: string;
  bidId: string;
  signals: QualificationAmendmentSignal[];
  citations: QualificationCitation[];
}): QualificationFreshnessResponse {
  const lastRefreshedAt = latestIso(input.citations.map((citation) => citation.generatedAt));
  const latestSignalAt = latestIso(input.signals.map((signal) => signal.detectedAt));
  const status = !lastRefreshedAt
    ? "not_refreshed"
    : latestSignalAt && latestSignalAt > lastRefreshedAt
      ? "stale"
      : "current";

  return {
    intentId: input.intentId,
    bidId: input.bidId,
    status,
    needsRefresh: status !== "current",
    lastRefreshedAt,
    latestSignalAt,
    latestSignal: latestSignal(input.signals),
    signalCount: input.signals.length,
    signals: input.signals,
  };
}

export async function getQualificationFreshness(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<QualificationFreshnessResponse> {
  const { row, intent } = await getScopedIntent(database, userId, intentId);

  return freshnessFromInputs({
    intentId: intent.id,
    bidId: intent.bid.id,
    signals: detectQualificationAmendmentSignals(intent.bid),
    citations: parseCitations(row.evidenceCitationsJson),
  });
}

export async function refreshQualificationEvidence(
  database: AppDatabase,
  userId: string,
  intentId: string,
  options: { now?: string } = {},
): Promise<QualificationRefreshResponse> {
  const { scopeUserIds, intent } = await getScopedIntent(database, userId, intentId);
  const profile = await getSupplierProfile(database, userId);
  const match = calculateBidMatch(intent.bid, profile);
  const generated = generateIntentBrief({ bid: intent.bid, match });
  const timestamp = options.now ?? nowIso();
  const refreshedIntent = {
    ...intent,
    generated,
    match,
    updatedAt: timestamp,
  };
  const citations = buildQualificationCitations(refreshedIntent, timestamp);
  const row = updateIntentQualificationSnapshotForUsers(database, scopeUserIds, intentId, {
    generated,
    match,
    citationsJson: JSON.stringify(citations),
    timestamp,
  });

  if (!row) {
    throw new IntentNotFoundError();
  }

  const hydratedIntent = await getUserIntent(database, userId, intentId, { scopeUserIds });
  if (!hydratedIntent) {
    throw new IntentNotFoundError();
  }

  const citationResponse: QualificationCitationsResponse = {
    intentId,
    bidId: hydratedIntent.bid.id,
    citations,
  };

  return {
    intent: hydratedIntent,
    citations: citationResponse,
    freshness: freshnessFromInputs({
      intentId,
      bidId: hydratedIntent.bid.id,
      signals: detectQualificationAmendmentSignals(hydratedIntent.bid),
      citations,
    }),
  };
}
