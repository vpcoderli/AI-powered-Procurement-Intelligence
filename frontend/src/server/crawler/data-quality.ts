import { getBidDescription } from "@/lib/bid-description";
import { getBidCoreIssues } from "@/lib/bid-usability";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { hasSourceWideVerifiedEmpty } from "@/lib/crawler-data-quality";
import { effectiveImportBidId, matchesExpectedSourceNamespace, sourceIdentityDifferences, type IdentityField } from "@/lib/source-identity";

type Row = Record<string, unknown>;
export function qualityRecord(value: unknown): Row {
  if (typeof value === "string") {
    try { return qualityRecord(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const validTimestamp = (value: unknown) => text(value) && Number.isFinite(Date.parse(text(value))) ? text(value) : null;
const strings = (value: unknown): string[] => {
  if (typeof value === "string") {
    try { return strings(JSON.parse(value)); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};
const bodyOf = (row: Row) => getBidDescription({ title: text(row.title), description: text(row.description), fullDescription: text(row.full_description) });
const identityOf = (row: Row) => ({ id: row.id, sourceBidId: row.source_bid_id, dedupeKey: row.dedupe_key,
  stateCode: row.state_code, issuerType: row.issuer_type, jurisdictionLevel: row.jurisdiction_level, fipsCode: row.fips_code });
const identityColumn: Record<IdentityField, string> = { sourceBidId: "source_bid_id", dedupeKey: "dedupe_key",
  stateCode: "state_code", issuerType: "issuer_type", jurisdictionLevel: "jurisdiction_level", fipsCode: "fips_code" };

export interface CrawlerBidQuality {
  schemaVersion: 1;
  checkedAt?: string;
  coreValid: boolean;
  coreIssues: string[];
  warnings: string[];
  capabilities: { discovery: boolean; analysis: boolean; attachments: boolean };
  body: { valid: boolean; reason: string; verifiedAt: string | null; reused: boolean };
  attachments: { discovered: number; archived: number; verified: number };
}

/** Pure shared record assessment; never trust a crawler's precomputed quality verdict. */
export function evaluateCrawlerBid(row: Row): CrawlerBidQuality {
  const coreIssues = getBidCoreIssues({
    id: text(row.id), sourceBidId: text(row.source_bid_id), dedupeKey: text(row.dedupe_key),
    title: text(row.title), issuerName: text(row.issuer_name), issuerType: text(row.issuer_type),
    stateCode: text(row.state_code), sourceUrl: text(row.source_url),
    jurisdictionLevel: text(row.jurisdiction_level), fipsCode: text(row.fips_code),
    qualityFlags: strings(row.quality_flags_json),
  });
  const raw = qualityRecord(row.raw_payload);
  const priorQuality = qualityRecord(raw.data_quality);
  const bodyQuality = qualityRecord(priorQuality.body);
  const outcome = qualityRecord(qualityRecord(raw.enrichment).outcome);
  const validBody = Boolean(bodyOf(row));
  const attachments = Array.isArray(row.attachments) ? row.attachments.map(qualityRecord) : [];
  const archived = attachments.filter((file) => file.archive_status === "archived");
  const verified = archived.filter((file) => text(file.storage_path) && Number(file.byte_size) > 0 &&
    /^[a-f0-9]{64}$/i.test(text(file.checksum_sha256)) && Boolean(validTimestamp(file.verified_at)) &&
    !/html/i.test(text(file.content_type) || text(file.mime_type)));
  const warnings = [
    !validBody ? "missing_valid_body" : null,
    !text(row.deadline_date) ? "missing_deadline" : !validTimestamp(row.deadline_date) ? "invalid_deadline" : null,
    !text(row.published_date) ? "missing_published_date" : !validTimestamp(row.published_date) ? "invalid_published_date" : null,
  ].filter((value): value is string => value !== null);
  return {
    schemaVersion: 1, coreValid: coreIssues.length === 0, coreIssues, warnings,
    capabilities: { discovery: coreIssues.length === 0, analysis: coreIssues.length === 0 && validBody, attachments: verified.length > 0 },
    body: {
      valid: validBody, reason: validBody ? "valid" : "missing_or_invalid",
      verifiedAt: validBody ? validTimestamp(bodyQuality.verifiedAt) ?? validTimestamp(outcome.verified_at) ?? validTimestamp(row.detail_fetched_at) : null,
      reused: bodyQuality.reused === true,
    },
    attachments: { discovered: attachments.length, archived: archived.length, verified: verified.length },
  };
}

/** A bad reimport must not change an existing opportunity's identity. */
export function existingIdentityIssues(incoming: Row, existing: Row): string[] {
  return sourceIdentityDifferences(identityOf(incoming), identityOf(existing))
    .map((field) => `identity_changed:${identityColumn[field]}`);
}

/** Annotate the effective merged snapshot, preserving the selected body's actual age. */
export function stampPersistedBidQuality(incoming: Row, merged: Row, existing: Row | undefined, at: string): Row {
  const quality = evaluateCrawlerBid(merged);
  const selected = bodyOf(merged);
  const incomingBody = bodyOf(incoming);
  const raw = qualityRecord(incoming.raw_payload);
  const enrichment = qualityRecord(raw.enrichment);
  const outcome = qualityRecord(enrichment.outcome);
  const applied = strings(enrichment.applied_fields);
  const fetchedSelected = selected && selected === incomingBody &&
    (outcome.status === "success" && outcome.valid_body === true && outcome.attempted === true ||
      applied.some((field) => field === "description" || field === "full_description"));
  const reused = Boolean(existing && selected && selected === bodyOf(existing) && !fetchedSelected);
  const oldBody = qualityRecord(qualityRecord(qualityRecord(existing?.raw_payload).data_quality).body);
  quality.checkedAt = at;
  quality.body.reused = reused;
  quality.body.verifiedAt = !selected ? null : reused
    ? validTimestamp(oldBody.verifiedAt) ?? validTimestamp(qualityRecord(qualityRecord(existing?.raw_payload).enrichment).verified_at) ?? validTimestamp(existing?.detail_fetched_at)
    : validTimestamp(outcome.verified_at) ?? validTimestamp(incoming.detail_fetched_at) ?? at;
  const qualityFlags = strings(merged.quality_flags_json).filter((flag) => !fetchedSelected || !["description_not_fetched", "description_fetch_failed"].includes(flag));
  return { ...merged, quality_flags_json: qualityFlags, raw_payload: { ...qualityRecord(merged.raw_payload), data_quality: quality } };
}

export interface ImportDataQuality {
  schemaVersion: 1;
  checkedAt: string;
  execution: "success" | "failure";
  listCoverage: "complete" | "partial" | "unknown";
  contentStatus: "usable" | "partial" | "unusable" | "empty_verified" | "unknown";
  receivedCount: number;
  uniqueCount: number;
  acceptedCount: number;
  quarantinedCount: number;
  duplicateCount: number;
  duplicateRecords: Array<{ index: number; id: string | null; row: Row }>;
  validBodyCount: number;
  retainedBodyCount: number;
  fetchedBodyCount: number;
  analysisReadyCount: number;
  acceptedIds: string[];
  quarantinedRecords: Array<{ index: number; id: string | null; issues: string[]; row: Row }>;
  reconciliation: { observed: number; accepted: number; quarantined: number; balanced: boolean };
}

function sourceIdentityIssues(row: Row, payload: CrawlerJsonRunPayload): string[] {
  const expected = qualityRecord(payload.metadata?.sourceIdentity);
  const identity = identityOf(row);
  const issues = sourceIdentityDifferences(identity, { stateCode: expected.stateCode, issuerType: expected.issuerType,
    jurisdictionLevel: expected.jurisdictionLevel, fipsCode: expected.fipsCode })
    .map((field) => `source_identity_mismatch:${identityColumn[field]}`);
  const effectiveId = effectiveImportBidId(identity, payload.source);
  if (!matchesExpectedSourceNamespace(effectiveId, expected.id)) issues.push("source_identity_mismatch:id");
  if (text(expected.baseUrl) && text(row.source_url) === text(expected.baseUrl)) issues.push("generic_source_url");
  return issues;
}

/** Retain quarantined evidence, but redact authentication values from persisted diagnostics. */
function evidenceRow(row: Row): Row {
  const redact = (value: unknown, key = ""): unknown => {
    if (/^(?:api[_-]?key|access[_-]?token|authorization|password|cookie|secret)$/i.test(key)) return "[redacted]";
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        url.username = ""; url.password = "";
        for (const name of [...url.searchParams.keys()]) if (/key|token|secret|signature|password/i.test(name)) url.searchParams.set(name, "[redacted]");
        return url.toString();
      } catch { return value; }
    }
    return value;
  };
  return qualityRecord(redact(row));
}

/** One per-run gate shared by both importers, with unique-ID accounting and quarantine. */
export function createImportQualityGate(payload: CrawlerJsonRunPayload) {
  const input = payload.bids ?? [];
  const pagination = qualityRecord(payload.metadata?.pagination);
  const scoped = payload.metadata?.dateFilter != null || payload.metadata?.mode === "detail_backfill";
  const validEmpty = payload.status === "success" && input.length === 0 && hasSourceWideVerifiedEmpty(payload.metadata);
  const manifest: ImportDataQuality = {
    schemaVersion: 1, checkedAt: payload.finishedAt ?? payload.startedAt, execution: payload.status,
    listCoverage: payload.status !== "success" ? "unknown" : scoped ? "partial" : pagination.complete === true ? "complete" : Object.keys(pagination).length > 0 ? "partial" : "unknown",
    contentStatus: validEmpty ? "empty_verified" : "unknown", receivedCount: input.length, uniqueCount: 0,
    acceptedCount: 0, quarantinedCount: 0, duplicateCount: 0, duplicateRecords: [], validBodyCount: 0, retainedBodyCount: 0,
    fetchedBodyCount: 0, analysisReadyCount: 0, acceptedIds: [], quarantinedRecords: [],
    reconciliation: { observed: 0, accepted: 0, quarantined: 0, balanced: true },
  };
  const rows: Array<{ row: Row; index: number }> = [];
  const quarantine = (row: Row, index: number, issues: string[]) => {
    manifest.quarantinedRecords.push({ index, id: text(row.id) || null, issues, row: evidenceRow(row) });
    manifest.quarantinedCount += 1;
    manifest.listCoverage = "partial";
  };
  type Candidate = { row: Row; index: number };
  const groups = new Set<Candidate[]>();
  const aliases = new Map<string, Candidate[]>();
  if (payload.status === "success") for (const [index, value] of input.entries()) {
    const row = { ...qualityRecord(value) };
    const keys = [text(row.id) && `id:${text(row.id)}`, text(row.dedupe_key) && `dedupe:${text(row.dedupe_key)}`,
      text(row.source_bid_id) && `source:${payload.source}:${text(row.source_bid_id)}`].filter(Boolean);
    const linked = [...new Set(keys.map((key) => aliases.get(key)).filter((group): group is Candidate[] => Boolean(group)))];
    const group = linked[0] ?? [];
    groups.add(group);
    for (const other of linked.slice(1)) {
      group.push(...other); groups.delete(other);
      for (const [key, value] of aliases) if (value === other) aliases.set(key, group);
    }
    group.push({ row, index });
    for (const key of keys) aliases.set(key, group);
  }
  for (const group of groups) {
    manifest.uniqueCount += 1;
    manifest.duplicateCount += group.length - 1;
    const scored = group.map((candidate) => ({ ...candidate,
      issues: [...evaluateCrawlerBid(candidate.row).coreIssues, ...sourceIdentityIssues(candidate.row, payload)] }));
    scored.sort((a, b) => a.issues.length - b.issues.length || bodyOf(b.row).length - bodyOf(a.row).length || a.index - b.index);
    const selected = scored[0];
    for (const duplicate of scored.slice(1)) manifest.duplicateRecords.push({ index: duplicate.index, id: text(duplicate.row.id) || null, row: evidenceRow(duplicate.row) });
    const conflicting = ["source_bid_id", "dedupe_key", "state_code", "issuer_type", "jurisdiction_level", "fips_code"]
      .some((field) => new Set(group.map(({ row }) => text(row[field])).filter(Boolean)).size > 1);
    if (conflicting) selected.issues.push("conflicting_duplicate_identity");
    if (selected.issues.length) quarantine(selected.row, selected.index, selected.issues);
    else {
      if (!text(selected.row.id)) selected.row.id = effectiveImportBidId(identityOf(selected.row), payload.source);
      rows.push({ row: selected.row, index: selected.index });
    }
  }
  return {
    rows, manifest, quarantine,
    accepted(id: string, row: Row) {
      manifest.acceptedCount += 1;
      manifest.acceptedIds.push(id);
      const quality = evaluateCrawlerBid(row);
      if (quality.body.valid) manifest.validBodyCount += 1;
      if (quality.body.valid && quality.body.reused) manifest.retainedBodyCount += 1;
      if (quality.capabilities.analysis) manifest.analysisReadyCount += 1;
    },
    finish(): CrawlerJsonRunPayload {
      manifest.fetchedBodyCount = manifest.validBodyCount - manifest.retainedBodyCount;
      manifest.reconciliation = { observed: manifest.uniqueCount, accepted: manifest.acceptedCount, quarantined: manifest.quarantinedCount,
        balanced: manifest.uniqueCount === manifest.acceptedCount + manifest.quarantinedCount };
      if (!manifest.reconciliation.balanced) throw new Error("Crawler quality reconciliation failed.");
      if (payload.status === "success" && manifest.uniqueCount > 0) manifest.contentStatus = manifest.acceptedCount === 0 ? "unusable"
        : manifest.quarantinedCount > 0 || manifest.validBodyCount < manifest.acceptedCount ? "partial" : "usable";
      const metadata: Row = { ...payload.metadata, dataQuality: manifest };
      if ((manifest.quarantinedCount > 0 || scoped) && Object.keys(pagination).length) metadata.pagination = { ...pagination, complete: false, ...(scoped ? { scope_blocked: true } : {}), ...(manifest.quarantinedCount > 0 ? { quality_blocked: true } : {}) };
      return { ...payload, metadata };
    },
  };
}
