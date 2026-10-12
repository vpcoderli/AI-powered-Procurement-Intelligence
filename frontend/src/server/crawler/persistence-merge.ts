import { getBidDescriptionIssue } from "@/lib/bid-description";
import { closedPayload, resolveLifecycle, type LifecycleMergeOptions } from "./lifecycle";

type JsonRecord = Record<string, unknown>;

const detailFields =["description", "full_description", "original_category", "contact_name", "contact_email", "contact_phone", "published_date"];

function record(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

// Mirrors crawler/apsi_crawler/content_quality.py `echo_key`: identity ignores case,
// whitespace runs and edge punctuation ("Road repair." is still the title "Road repair").
const EDGE_PUNCTUATION = /^[\s.,:;!?\-\u2013\u2014_*/'"()\[\]{}\u3002\uFF0C\u3001\uFF1A\uFF1B\uFF01\uFF1F]+|[\s.,:;!?\-\u2013\u2014_*/'"()\[\]{}\u3002\uFF0C\u3001\uFF1A\uFF1B\uFF01\uFF1F]+$/g;

export function echoKey(value: unknown) {
  return text(value).toLowerCase().replace(EDGE_PUNCTUATION, "");
}

function sameText(left: unknown, right: unknown) {
  return echoKey(left) === echoKey(right);
}

function meaningful(row: JsonRecord, field: string) {
  // Mirrors content_quality.is_contact_metadata. Historical heuristic values are portal
  // labels, so provenance must not protect them from a valid contact or an empty refresh.
  if (field === "contact_name" && /^(?:purchase method|type code|bid type|informal bid flag|allow electronic quote)\s*(?::|：|$)/i.test(text(row[field]))) return false;
  if ((field === "description" || field === "full_description") && getBidDescriptionIssue(typeof row[field] === "string" ? row[field] as string : null, text(row.title))) return false;
  return Boolean(text(row[field])) && (!(field === "description" || field === "full_description") || !sameText(row[field], row.title));
}

function fieldSet(value: unknown) {
  return new Set(Array.isArray(value) ? value.filter((field): field is string => typeof field === "string") : []);
}

function detailProvenance(row: JsonRecord, persisted: boolean) {
  const enrichment = record(record(row.raw_payload).enrichment);
  const fields = fieldSet(enrichment.applied_fields);
  if (persisted) for (const field of fieldSet(enrichment.persisted_fields)) fields.add(field);
  // Older crawlers recorded only a detail timestamp/diagnostics. Protect their meaningful
  // fields conservatively; an explicit [] from newer crawlers means no fields were applied.
  if (!Array.isArray(enrichment.applied_fields) &&
    (text(row.detail_fetched_at) || Object.keys(record(enrichment.fields)).length > 0)) {
    for (const field of detailFields) if (meaningful(row, field)) fields.add(field);
  }
  return fields;
}

/**
 * Shared snake_case merge for SQLite and MySQL, performed inside the write transaction.
 * `options.now` is the ISO instant the run finished: an open bid whose deadline has passed by then is
 * stored closed, and its raw payload says the deadline closed it.
 */
export function mergePersistedBid(incoming: JsonRecord, existing: JsonRecord = {}, options: LifecycleMergeOptions = {}): JsonRecord {
  const merged = { ...incoming };
  for (const field of ["source_bid_id", "dedupe_key", "jurisdiction_level", "fips_code"]) {
    if (!text(incoming[field]) && text(existing[field])) merged[field] = existing[field];
  }
  const priorDetail = detailProvenance(existing, true);
  const incomingDetail = detailProvenance(incoming, false);
  for (const field of detailFields) {
    if (field === "full_description" && incoming.full_description === null &&
      incomingDetail.has("full_description") && incomingDetail.has("description") && meaningful(incoming, "description")) {
      merged.full_description = null;
      continue;
    }
    const keepPrior = meaningful(existing, field) &&
      (!meaningful(incoming, field) || (priorDetail.has(field) && !incomingDetail.has(field)));
    if (keepPrior) merged[field] = existing[field];
    else if (!meaningful(incoming, field)) merged[field] = field === "description" ? "" : null;
  }
  // Normalize old title echoes and duplicated short/long descriptions during refresh.
  if (!meaningful(merged, "description")) merged.description = "";
  if (!meaningful(merged, "full_description") || sameText(merged.full_description, merged.description)) merged.full_description = null;
  if (!text(incoming.detail_fetched_at)) merged.detail_fetched_at = existing.detail_fetched_at ?? null;
  if (existing.detail_archive_status === "archived" &&
    (incoming.detail_archive_status !== "archived" || !text(incoming.detail_archive_path))) {
    for (const field of ["detail_archive_status", "detail_archive_path", "detail_checksum_sha256", "detail_archive_error"]) {
      merged[field] = existing[field];
    }
  }

  const previousRaw = record(existing.raw_payload);
  const incomingRaw = record(incoming.raw_payload ?? incoming);
  const previousEnrichment = record(previousRaw.enrichment);
  const nextEnrichment = record(incomingRaw.enrichment);
  if (Object.keys(previousEnrichment).length || Object.keys(nextEnrichment).length || priorDetail.size || incomingDetail.size) {
    const persistedFields = new Set([...priorDetail, ...incomingDetail]);
    merged.raw_payload = {
      ...incomingRaw,
      enrichment: {
        ...previousEnrichment,
        ...nextEnrichment,
        fields: { ...record(previousEnrichment.fields), ...record(nextEnrichment.fields) },
        original_values: { ...record(previousEnrichment.original_values), ...record(nextEnrichment.original_values) },
        // applied_fields remains the parser's per-run evidence. persisted_fields records
        // cumulative detail protection, including fields retained from earlier imports.
        persisted_fields: [...persistedFields].filter((field) => field === "attachments" || meaningful(merged, field)),
      },
    };
  }
  const lifecycle = resolveLifecycle(incoming, existing, options);
  Object.assign(merged, lifecycle.fields);
  if (lifecycle.closedByDeadline !== null && options.now !== undefined) {
    // The reason goes only on a payload that is a JSON object (or text that parses to one). Any other payload, or none,
    // is stored exactly as the import would have stored it: the bid still closes, but a payload is never rewritten for it.
    // The incoming payload replaces the stored one, so a bid that is open again carries no stale reason.
    const closed = closedPayload(merged.raw_payload, "deadline_passed", options.now, { deadline: lifecycle.closedByDeadline });
    if (closed) merged.raw_payload = closed;
  }
  return merged;
}

/** Drizzle exposes camelCase properties while crawler JSON/MySQL rows use snake_case. */
export function snakeCaseRecord(row: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
}

const archiveFields = ["storage_path", "byte_size", "content_type", "checksum_sha256", "fetched_at"];
const repairFields = ["archive_status", "archive_error", "failure_kind", "repair_attempts", "next_repair_at"];

/** Seen again without a new file: like the Python storage, an incoming not_archived is no archive news. */
function reobservedOnly(attachment: JsonRecord) {
  return !text(attachment.storage_path) && ["", "not_archived"].includes(text(attachment.archive_status));
}

function attachmentUrls(row: JsonRecord) {
  return [text(row.url), text(row.original_url)].filter(Boolean);
}

/** Keep unobserved attachments. Match URLs before IDs, because legacy IDs used list indexes. */
export function mergePersistedAttachments(existing: JsonRecord[], incoming: JsonRecord[], bidId: string): JsonRecord[] {
  const merged = existing.map((row) => ({ ...row }));
  for (const attachment of incoming) {
    const urls = attachmentUrls(attachment);
    let index = merged.findIndex((row) => attachmentUrls(row).some((url) => urls.includes(url)));
    if (index < 0 && text(attachment.id) && !/:attachment:\d+$/.test(String(attachment.id))) {
      index = merged.findIndex((row) => row.id === attachment.id);
    }
    if (index < 0) {
      let id = text(attachment.id);
      if (!id || merged.some((row) => row.id === id)) {
        let suffix = merged.length + 1;
        do { id = `${bidId}:attachment:${suffix++}`; } while (merged.some((row) => row.id === id));
      }
      merged.push({ ...attachment, id, verified_at: null });
      continue;
    }
    const prior = merged[index];
    const row: JsonRecord = { ...prior, ...attachment, id: prior.id, created_at: prior.created_at ?? attachment.created_at };
    for (const [key, value] of Object.entries(prior)) if (!text(attachment[key])) row[key] = value;
    // A discovery-only crawl cannot erase a successful archive or its associated metadata.
    if (prior.archive_status === "archived" && !text(attachment.storage_path)) {
      for (const field of archiveFields) row[field] = prior[field];
      row.archive_status = prior.archive_status;
      row.archive_error = prior.archive_error;
    }
    // Nor can it reset the repair worker's retry state: a failed or parked link keeps its
    // status, failure kind and next attempt, or every re-crawl would make it due again.
    if ((prior.archive_status === "failed" || prior.archive_status === "unavailable") && reobservedOnly(attachment)) {
      for (const field of repairFields) row[field] = prior[field];
    }
    // Only persisted verification of the exact same archived bytes is authoritative.
    const sameArchive = ["storage_path", "byte_size", "content_type", "checksum_sha256"].every((field) => text(row[field]) === text(prior[field]));
    row.verified_at = sameArchive ? prior.verified_at ?? null : null;
    merged[index] = row;
  }
  return merged;
}
