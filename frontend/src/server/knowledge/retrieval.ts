import type { AppDatabase } from "@/server/db/client";
import { listKnowledgeItems } from "./service";
import type {
  KnowledgeRetrievalChunk,
  KnowledgeRetrievalEmbeddingStatus,
  KnowledgeItem,
  KnowledgeRetrievalMatchedField,
  KnowledgeRetrievalResponse,
  KnowledgeRetrievalTrace,
} from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);
const DEFAULT_RETRIEVAL_LIMIT = 10;
const MAX_RETRIEVAL_LIMIT = 100;
const MAX_CHUNK_EXCERPT_LENGTH = 240;
const EMBEDDING_STATUS: KnowledgeRetrievalEmbeddingStatus = {
  status: "mock_unavailable",
  provider: null,
  vectorStore: "none",
  reason: "embedding_provider_out_of_scope_for_lite_phase",
};

type KnowledgeFieldMatch = KnowledgeRetrievalTrace["matchedFields"][number];

interface RankedKnowledgeItem {
  item: KnowledgeItem;
  index: number;
  score: number;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function stringMetadataValues(metadata: Record<string, unknown>) {
  return Object.values(metadata).filter((value): value is string => typeof value === "string");
}

function fieldValues(item: KnowledgeItem): Array<{ field: KnowledgeRetrievalMatchedField; value: string }> {
  return [
    { field: "title", value: item.title },
    { field: "body", value: item.body },
    { field: "tags", value: item.tags.join(" ") },
    { field: "sourceKind", value: item.sourceKind },
    { field: "sourceUrl", value: item.sourceUrl ?? "" },
    { field: "metadata", value: stringMetadataValues(item.metadata).join(" ") },
  ];
}

function scoreField(tokens: string[], value: string) {
  const lower = value.toLowerCase();
  const tokenHits = tokens.filter((token) => lower.includes(token));

  return { tokenHits, score: tokenHits.length };
}

function normalizeRetrievalLimit(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RETRIEVAL_LIMIT;

  return Math.min(Math.max(1, Math.floor(value)), MAX_RETRIEVAL_LIMIT);
}

function rankedItems(tokens: string[], items: KnowledgeItem[], limit: number): RankedKnowledgeItem[] {
  return items
    .map((item, index) => {
      const score = fieldValues(item).reduce((total, { value }) => total + scoreField(tokens, value).score, 0);
      return { item, index, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit);
}

function matchedFieldsForItems(tokens: string[], items: KnowledgeItem[]) {
  return items.flatMap((item) =>
    fieldValues(item)
      .map(({ field, value }) => ({
        itemId: item.id,
        field,
        ...scoreField(tokens, value),
      }))
      .filter((match) => match.score > 0),
  );
}

function excerptForItem(item: KnowledgeItem) {
  const excerpt = item.body.replace(/\s+/g, " ").trim() || item.title;

  if (excerpt.length <= MAX_CHUNK_EXCERPT_LENGTH) return excerpt;

  return `${excerpt.slice(0, MAX_CHUNK_EXCERPT_LENGTH - 3)}...`;
}

function matchedReason(matches: KnowledgeFieldMatch[]) {
  if (matches.length === 0) return "No lexical field matches";

  return matches
    .map((match) => `${match.field} matched ${match.tokenHits.join(", ")}`)
    .join("; ");
}

function chunksForRankedItems(
  ranked: RankedKnowledgeItem[],
  matchedFields: KnowledgeFieldMatch[],
): KnowledgeRetrievalChunk[] {
  return ranked.map(({ item, score }) => {
    const itemMatches = matchedFields.filter((match) => match.itemId === item.id);

    return {
      itemId: item.id,
      title: item.title,
      sourceRefs: {
        sourceKind: item.sourceKind,
        sourceIntentId: item.sourceIntentId,
        sourceBidId: item.sourceBidId,
        sourceUrl: item.sourceUrl,
      },
      score,
      matchedReason: matchedReason(itemMatches),
      textExcerpt: excerptForItem(item),
    };
  });
}

function traceForItems(query: string, tokens: string[], ranked: RankedKnowledgeItem[]): KnowledgeRetrievalTrace {
  const items = ranked.map(({ item }) => item);
  const matchedFields = matchedFieldsForItems(tokens, items);

  return {
    provider: "lexical",
    retrievalMode: "lexical_mock_rag",
    query,
    queryTokens: tokens,
    matchedFields,
    selectedItemIds: items.map((item) => item.id),
    embeddingStatus: EMBEDDING_STATUS,
    chunks: chunksForRankedItems(ranked, matchedFields),
    futureEmbeddingStatus: {
      status: "not_configured",
      provider: null,
      vectorStore: "none",
      reason: "embedding_provider_out_of_scope_for_lite_phase",
    },
  };
}

export async function retrieveKnowledgeContext(
  database: AppDatabase,
  input: { organizationId: string; query: string; limit?: number | null },
): Promise<KnowledgeRetrievalResponse> {
  const query = input.query.trim();
  const queryTokens = tokenize(query);
  const limit = normalizeRetrievalLimit(input.limit);
  const listed = await listKnowledgeItems(database, {
    organizationId: input.organizationId,
    limit: MAX_RETRIEVAL_LIMIT,
  });
  const ranked = rankedItems(queryTokens, listed.items, limit);
  const items = ranked.map(({ item }) => item);
  const trace = traceForItems(query, queryTokens, ranked);

  return { items, trace };
}
