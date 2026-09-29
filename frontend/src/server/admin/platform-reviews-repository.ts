import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { platformReviews } from "@/server/db/schema";
import { writeAuditEvent, writeAuditEventFromMysql } from "@/server/events/event-log";
import { isSyntheticProviderFamily } from "./synthetic-provider-families";

/** Spec 2026-09-24 §7.1: the boundary every platform review states, verbatim. */
export const PLATFORM_ACCESS_BOUNDARY = "只读公开列表与详情页；不登录、不取会员内容、不绕 WAF";

export interface PlatformReview {
  id: string;
  providerFamily: string;
  tosUrl: string;
  tosReviewedAt: string;
  robotsUrl: string;
  robotsCheckedAt: string;
  robotsSummary: string;
  accessBoundary: string;
  reviewer: string;
  legalOpinionReference: string | null;
  reviewedAt: string;
  nextReviewAt: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreatePlatformReviewInput {
  providerFamily: string;
  tosUrl: string;
  tosReviewedAt: string;
  robotsUrl: string;
  robotsCheckedAt: string;
  robotsSummary: string;
  accessBoundary?: string;
  reviewer: string;
  legalOpinionReference?: string | null;
  reviewedAt?: string;
  nextReviewAt: string;
  notes?: string | null;
}

export class PlatformReviewValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Platform review input is invalid: ${issues.join("; ")}`);
    this.name = "PlatformReviewValidationError";
    this.issues = issues;
  }
}

const FAMILY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Normalises and validates a request body; every problem is reported at once. */
export function validatePlatformReviewInput(raw: unknown, now: Date): CreatePlatformReviewInput {
  if (!raw || typeof raw !== "object") throw new PlatformReviewValidationError(["body must be an object"]);
  const body = raw as Record<string, unknown>;
  const issues: string[] = [];

  const providerFamily = typeof body.providerFamily === "string" ? body.providerFamily.trim().toLowerCase() : "";
  if (!FAMILY_PATTERN.test(providerFamily)) {
    issues.push("providerFamily must be a lowercase slug (a-z, 0-9, _ or -)");
  } else if (isSyntheticProviderFamily(providerFamily)) {
    // A NULL provider_family reads as one of these in the console; a review of it would batch-approve own-site sources.
    issues.push("providerFamily must be a real platform, not a display fallback (public_portal/state_portal/federal_portal)");
  }
  if (!isHttpUrl(body.tosUrl)) issues.push("tosUrl must be an http(s) URL");
  if (!isHttpUrl(body.robotsUrl)) issues.push("robotsUrl must be an http(s) URL");
  if (!isIsoDate(body.tosReviewedAt)) issues.push("tosReviewedAt must be an ISO date");
  if (!isIsoDate(body.robotsCheckedAt)) issues.push("robotsCheckedAt must be an ISO date");
  const robotsSummary = typeof body.robotsSummary === "string" ? body.robotsSummary.trim() : "";
  if (!robotsSummary) issues.push("robotsSummary is required");
  const reviewer = typeof body.reviewer === "string" ? body.reviewer.trim() : "";
  if (!reviewer) issues.push("reviewer is required");
  const reviewedAt = body.reviewedAt === undefined || body.reviewedAt === null ? now.toISOString() : body.reviewedAt;
  if (!isIsoDate(reviewedAt)) issues.push("reviewedAt must be an ISO date");
  if (!isIsoDate(body.nextReviewAt)) {
    issues.push("nextReviewAt must be an ISO date");
  } else if (isIsoDate(reviewedAt) && Date.parse(body.nextReviewAt) <= Date.parse(reviewedAt)) {
    issues.push("nextReviewAt must be after reviewedAt");
  }
  const accessBoundary = optionalText(body.accessBoundary) ?? PLATFORM_ACCESS_BOUNDARY;

  if (issues.length > 0) throw new PlatformReviewValidationError(issues);

  return {
    providerFamily,
    tosUrl: body.tosUrl as string,
    tosReviewedAt: body.tosReviewedAt as string,
    robotsUrl: body.robotsUrl as string,
    robotsCheckedAt: body.robotsCheckedAt as string,
    robotsSummary,
    accessBoundary,
    reviewer,
    legalOpinionReference: optionalText(body.legalOpinionReference),
    reviewedAt: reviewedAt as string,
    nextReviewAt: body.nextReviewAt as string,
    notes: optionalText(body.notes),
  };
}

export type PlatformReviewStatus = "valid" | "expired" | "missing";

export interface EffectivePlatformReview {
  status: PlatformReviewStatus;
  review: PlatformReview | null;
}

/** Spec §7.1: the latest `reviewed_at` row is the platform's review; it is valid until `next_review_at`. */
export function effectivePlatformReview(
  reviews: readonly PlatformReview[],
  providerFamily: string,
  now: Date,
): EffectivePlatformReview {
  let latest: PlatformReview | null = null;
  for (const candidate of reviews) {
    if (candidate.providerFamily !== providerFamily) continue;
    if (!latest || Date.parse(candidate.reviewedAt) > Date.parse(latest.reviewedAt)) latest = candidate;
  }
  if (!latest) return { status: "missing", review: null };
  return { status: Date.parse(latest.nextReviewAt) > now.getTime() ? "valid" : "expired", review: latest };
}

export function effectivePlatformReviewsByFamily(
  reviews: readonly PlatformReview[],
  now: Date,
): Record<string, EffectivePlatformReview> {
  const byFamily: Record<string, EffectivePlatformReview> = {};
  for (const family of new Set(reviews.map((review) => review.providerFamily))) {
    byFamily[family] = effectivePlatformReview(reviews, family, now);
  }
  return byFamily;
}

export type MysqlPlatformReviewsStore = Parameters<typeof mysqlSelectMany>[0] & Parameters<typeof writeAuditEventFromMysql>[0];

export interface CreatePlatformReviewOptions {
  actorUserId?: string | null;
  now?: Date;
}

interface PlatformReviewRow {
  id: string;
  provider_family: string;
  tos_url: string;
  tos_reviewed_at: string;
  robots_url: string;
  robots_checked_at: string;
  robots_summary: string;
  access_boundary: string;
  reviewer: string;
  legal_opinion_reference: string | null;
  reviewed_at: string;
  next_review_at: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

function fromRow(row: PlatformReviewRow): PlatformReview {
  return {
    id: row.id,
    providerFamily: row.provider_family,
    tosUrl: row.tos_url,
    tosReviewedAt: row.tos_reviewed_at,
    robotsUrl: row.robots_url,
    robotsCheckedAt: row.robots_checked_at,
    robotsSummary: row.robots_summary,
    accessBoundary: row.access_boundary,
    reviewer: row.reviewer,
    legalOpinionReference: row.legal_opinion_reference ?? null,
    reviewedAt: row.reviewed_at,
    nextReviewAt: row.next_review_at,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

function buildReview(input: CreatePlatformReviewInput, options: CreatePlatformReviewOptions): PlatformReview {
  const now = options.now ?? new Date();
  return {
    id: `prv_${randomUUID()}`,
    providerFamily: input.providerFamily,
    tosUrl: input.tosUrl,
    tosReviewedAt: input.tosReviewedAt,
    robotsUrl: input.robotsUrl,
    robotsCheckedAt: input.robotsCheckedAt,
    robotsSummary: input.robotsSummary,
    accessBoundary: input.accessBoundary ?? PLATFORM_ACCESS_BOUNDARY,
    reviewer: input.reviewer,
    legalOpinionReference: input.legalOpinionReference ?? null,
    reviewedAt: input.reviewedAt ?? now.toISOString(),
    nextReviewAt: input.nextReviewAt,
    notes: input.notes ?? null,
    createdBy: options.actorUserId ?? null,
    createdAt: now.toISOString(),
  };
}

function auditInput(review: PlatformReview, options: CreatePlatformReviewOptions) {
  return {
    eventName: "platform_review.created",
    actorType: options.actorUserId ? "user" : "system",
    actorId: options.actorUserId ?? null,
    targetType: "platform_review",
    targetId: review.id,
    outcome: "success",
    beforeAfter: { before: null, after: review },
    occurredAt: review.createdAt,
  } as const;
}

export function listPlatformReviews(db: AppDatabase): PlatformReview[] {
  return db
    .select()
    .from(platformReviews)
    .orderBy(desc(platformReviews.reviewedAt), desc(platformReviews.createdAt))
    .all()
    .map((row) => ({ ...row, legalOpinionReference: row.legalOpinionReference ?? null, notes: row.notes ?? null, createdBy: row.createdBy ?? null }));
}

export async function listPlatformReviewsFromMysql(mysql: MysqlPlatformReviewsStore): Promise<PlatformReview[]> {
  const rows = await mysqlSelectMany<PlatformReviewRow>(
    mysql,
    `SELECT id, provider_family, tos_url, tos_reviewed_at, robots_url, robots_checked_at, robots_summary, access_boundary,
            reviewer, legal_opinion_reference, reviewed_at, next_review_at, notes, created_by, created_at
       FROM platform_reviews
      ORDER BY reviewed_at DESC, created_at DESC`,
    [],
  );
  return rows.map(fromRow);
}

export function createPlatformReview(
  db: AppDatabase,
  input: CreatePlatformReviewInput,
  options: CreatePlatformReviewOptions = {},
): PlatformReview {
  const review = buildReview(input, options);
  db.insert(platformReviews).values(review).run();
  writeAuditEvent(db, auditInput(review, options));
  return review;
}

export async function createPlatformReviewFromMysql(
  mysql: MysqlPlatformReviewsStore,
  input: CreatePlatformReviewInput,
  options: CreatePlatformReviewOptions = {},
): Promise<PlatformReview> {
  const review = buildReview(input, options);
  await mysqlExecute(
    mysql,
    `INSERT INTO platform_reviews
       (id, provider_family, tos_url, tos_reviewed_at, robots_url, robots_checked_at, robots_summary, access_boundary, reviewer, legal_opinion_reference, reviewed_at, next_review_at, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      review.id, review.providerFamily, review.tosUrl, review.tosReviewedAt, review.robotsUrl, review.robotsCheckedAt,
      review.robotsSummary, review.accessBoundary, review.reviewer, review.legalOpinionReference, review.reviewedAt,
      review.nextReviewAt, review.notes, review.createdBy, review.createdAt,
    ] as never[],
  );
  await writeAuditEventFromMysql(mysql, auditInput(review, options));
  return review;
}
