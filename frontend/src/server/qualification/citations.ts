import type { AppDatabase } from "@/server/db/client";
import { bidDetailPath } from "@/lib/bid-routes";
import { listWorkspaceMemberUserIds } from "@/server/account/workspace";
import { listMysqlWorkspaceMemberUserIds } from "@/server/account/mysql-workspace";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { getUserIntent } from "@/server/intents/service";
import { IntentBidNotFoundError, IntentNotFoundError } from "@/server/intents/types";
import { validateBidSourceUrl } from "@/server/source-validity/url-validity";
import {
  findIntentByUsersAndId,
  updateIntentEvidenceCitationsForUsers,
} from "@/server/intents/repository";
import {
  findIntentQualificationSnapshotFromMysql,
  updateIntentEvidenceCitationsForUsersFromMysql,
} from "./mysql-runtime";
import type {
  QualificationCitation,
  QualificationCitationsResponse,
} from "./types";
import {
  QUALIFICATION_CITATION_SECTIONS,
  QUALIFICATION_CITATION_SOURCE_TYPES,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

function confidence(value: string): QualificationCitation["confidence"] {
  return value === "high" || value === "low" ? value : "medium";
}

function validCitation(value: unknown): value is QualificationCitation {
  if (typeof value !== "object" || value === null) return false;
  const citation = value as Partial<QualificationCitation>;

  return (
    typeof citation.id === "string" &&
    QUALIFICATION_CITATION_SECTIONS.includes(citation.section as QualificationCitation["section"]) &&
    QUALIFICATION_CITATION_SOURCE_TYPES.includes(citation.sourceType as QualificationCitation["sourceType"]) &&
    typeof citation.sourceLabel === "string" &&
    typeof citation.excerpt === "string" &&
    typeof citation.url === "string" &&
    (citation.confidence === "low" || citation.confidence === "medium" || citation.confidence === "high") &&
    typeof citation.generatedAt === "string"
  );
}

function parsePersistedCitations(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(validCitation) ? parsed : [];
  } catch {
    return [];
  }
}

function makeCitation(input: Omit<QualificationCitation, "generatedAt">, generatedAt: string): QualificationCitation {
  return { ...input, generatedAt };
}

function bidEvidenceUrl(bid: NonNullable<Awaited<ReturnType<typeof getUserIntent>>>["bid"]) {
  return validateBidSourceUrl(bid.sourceUrl).length === 0 ? bid.sourceUrl : bidDetailPath(bid.id);
}

export function buildQualificationCitations(intent: NonNullable<Awaited<ReturnType<typeof getUserIntent>>>, generatedAt: string) {
  const bid = intent.bid;
  const baseConfidence = confidence(bid.sourceConfidence);
  const safeBidEvidenceUrl = bidEvidenceUrl(bid);
  const citations: QualificationCitation[] = [
    makeCitation({
      id: "citation_bid_title",
      section: "brief",
      sourceType: "bid_field",
      sourceLabel: "Solicitation title",
      excerpt: bid.title,
      url: safeBidEvidenceUrl,
      confidence: baseConfidence,
    }, generatedAt),
    makeCitation({
      id: "citation_issuer",
      section: "brief",
      sourceType: "bid_field",
      sourceLabel: "Issuer",
      excerpt: bid.issuerName,
      url: safeBidEvidenceUrl,
      confidence: baseConfidence,
    }, generatedAt),
    makeCitation({
      id: "citation_deadline",
      section: "key_dates",
      sourceType: "bid_field",
      sourceLabel: "Deadline",
      excerpt: bid.deadlineDate || "No deadline published",
      url: safeBidEvidenceUrl,
      confidence: bid.deadlineDate ? baseConfidence : "low",
    }, generatedAt),
    makeCitation({
      id: "citation_source_url",
      section: "submission",
      sourceType: "bid_field",
      sourceLabel: "Original source",
      excerpt: safeBidEvidenceUrl,
      url: safeBidEvidenceUrl,
      confidence: baseConfidence,
    }, generatedAt),
  ];

  if (bid.detailArchiveStatus === "archived" && bid.detailArchivePath) {
    citations.push(makeCitation({
      id: "citation_detail_archive",
      section: "brief",
      sourceType: "detail_archive",
      sourceLabel: "Archived detail page",
      excerpt: bid.detailArchivePath,
      url: safeBidEvidenceUrl,
      confidence: "high",
    }, generatedAt));
  }

  for (const [index, attachment] of bid.attachments.slice(0, 5).entries()) {
    citations.push(makeCitation({
      id: `citation_attachment_${index + 1}`,
      section: "compliance",
      sourceType: "attachment",
      sourceLabel: attachment.name,
      excerpt: attachment.contentType || attachment.size || attachment.originalUrl || attachment.url,
      url: attachment.url || attachment.originalUrl,
      confidence: attachment.archiveStatus === "archived" ? "high" : baseConfidence,
    }, generatedAt));
  }

  if (intent.generated.aiBidBrief) {
    citations.push(makeCitation({
      id: "citation_generated_brief",
      section: "brief",
      sourceType: "generated_output",
      sourceLabel: "Generated bid brief",
      excerpt: intent.generated.aiBidBrief,
      url: safeBidEvidenceUrl,
      confidence: baseConfidence,
    }, generatedAt));
  }

  return citations;
}

function generateCitations(intent: Awaited<ReturnType<typeof getUserIntent>>, generatedAt: string) {
  if (!intent) return [];
  return buildQualificationCitations(intent, generatedAt);
}

export async function getOrCreateQualificationCitations(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<QualificationCitationsResponse> {
  if (isMysqlDatabaseUrlConfigured()) {
    const mysql = resolveMysqlPool();
    const scopeUserIds = await listMysqlWorkspaceMemberUserIds(mysql, userId);
    const row = await findIntentQualificationSnapshotFromMysql(mysql, scopeUserIds, intentId);

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

    const persisted = parsePersistedCitations(row.evidenceCitationsJson);
    if (persisted.length > 0) {
      return { intentId: row.id, bidId: row.bidId, citations: persisted };
    }

    const citations = generateCitations(intent, nowIso());
    await updateIntentEvidenceCitationsForUsersFromMysql(
      mysql,
      scopeUserIds,
      intentId,
      JSON.stringify(citations),
      nowIso(),
    );

    return { intentId: intent.id, bidId: intent.bid.id, citations };
  }

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

  const persisted = parsePersistedCitations(row.evidenceCitationsJson);
  if (persisted.length > 0) {
    return { intentId: row.id, bidId: row.bidId, citations: persisted };
  }

  const citations = generateCitations(intent, nowIso());
  updateIntentEvidenceCitationsForUsers(
    database,
    scopeUserIds,
    intentId,
    JSON.stringify(citations),
    nowIso(),
  );

  return { intentId: intent.id, bidId: intent.bid.id, citations };
}
