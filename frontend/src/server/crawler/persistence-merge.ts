type JsonRecord = Record<string, unknown>;

const detailFields = ["description", "full_description", "original_category", "contact_name", "contact_email", "contact_phone", "published_date"];

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

/** Shared snake_case merge for SQLite and MySQL, performed inside the write transaction. */
export function mergePersistedBid(incoming: JsonRecord, existing: JsonRecord = {}): JsonRecord {
  const merged = { ...incoming };
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
  return merged;
}

/** Drizzle exposes camelCase properties while crawler JSON/MySQL rows use snake_case. */
export function snakeCaseRecord(row: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
}

const archiveFields = ["storage_path", "byte_size", "content_type", "checksum_sha256", "fetched_at"];

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
      merged.push({ ...attachment, id });
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
    merged[index] = row;
  }
  return merged;
}
