import type { AppDatabase } from "@/server/db/client";
import { createDeterministicAiRunMetadata } from "@/server/ai/run-metadata";
import type {
  QualificationCitation,
  QualificationEvidenceCoverage,
  QualificationGroundingStatus,
  QualificationQuestionInput,
  QualificationQuestionResponse,
} from "./types";
import { getOrCreateQualificationCitations } from "./citations";

const LOCAL_QA_LIMITATIONS = [
  "Deterministic local answer generated from stored bid fields, archives, attachments, and generated brief citations only.",
  "No live LLM, embeddings, vector database, or external retrieval were used.",
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "does",
  "for",
  "from",
  "how",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "who",
  "with",
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeQuestion(question: string) {
  return question.trim().replace(/\s+/g, " ");
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function sectionHintScore(question: string, citation: QualificationCitation) {
  const lower = question.toLowerCase();

  if (citation.section === "key_dates" && /\b(deadline|date|due|close|closing|when)\b/.test(lower)) return 6;
  if (citation.section === "submission" && /\b(submit|submission|portal|where|how)\b/.test(lower)) return 5;
  if (citation.section === "compliance" && /\b(attachment|form|certification|compliance|required)\b/.test(lower)) return 5;
  if (citation.section === "brief" && /\b(scope|title|issuer|buyer|agency|about)\b/.test(lower)) return 4;
  if (citation.section === "decision" && /\b(pursue|bid|decision|risk)\b/.test(lower)) return 4;

  return 0;
}

function scoreCitation(question: string, citation: QualificationCitation) {
  const tokens = tokenize(question);
  const haystack = `${citation.section} ${citation.sourceLabel} ${citation.excerpt}`.toLowerCase();
  let score = sectionHintScore(question, citation);

  for (const token of tokens) {
    if (haystack.includes(token)) score += 2;
  }

  if (citation.confidence === "high") score += 1;
  if (citation.confidence === "low") score -= 1;

  return score;
}

function hasEvidenceTokenMatch(question: string, citation: QualificationCitation) {
  const tokens = tokenize(question);
  const haystack = `${citation.sourceLabel} ${citation.excerpt}`.toLowerCase();

  return tokens.some((token) => haystack.includes(token));
}

function rankCitations(question: string, citations: QualificationCitation[]) {
  return citations
    .map((citation, index) => ({
      citation,
      index,
      score: scoreCitation(question, citation),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

function selectCitations(question: string, citations: QualificationCitation[]) {
  const ranked = rankCitations(question, citations);

  const matched = ranked.filter((item) => item.score > 0).slice(0, 3);
  const selected = matched.length > 0 ? matched : ranked.slice(0, 3);

  return {
    citations: selected.map((item) => item.citation),
    matchedCitationCount: selected.filter((item) => hasEvidenceTokenMatch(question, item.citation)).length,
  };
}

function uniqueSections(citations: QualificationCitation[]) {
  return [...new Set(citations.map((citation) => citation.section))];
}

function createEvidenceCoverage(input: {
  selected: QualificationCitation[];
  matchedCitationCount: number;
  totalCitationCount: number;
}): QualificationEvidenceCoverage {
  const status = input.totalCitationCount === 0
    ? "insufficient"
    : input.matchedCitationCount > 0
      ? "direct"
      : "partial";

  return {
    status,
    matchedCitationCount: input.matchedCitationCount,
    selectedCitationCount: input.selected.length,
    totalCitationCount: input.totalCitationCount,
    coveredSections: uniqueSections(input.selected),
  };
}

function groundingStatusFromCoverage(coverage: QualificationEvidenceCoverage): QualificationGroundingStatus {
  if (coverage.status === "direct") return "grounded";
  if (coverage.status === "partial") return "partially_grounded";
  return "insufficient_evidence";
}

function formatAnswer(question: string, citations: QualificationCitation[]) {
  if (citations.length === 0) {
    return "The available evidence does not contain enough information to answer this question.";
  }

  const hasDirectMatch = citations.some((citation) => hasEvidenceTokenMatch(question, citation));
  const evidenceSummary = citations
    .map((citation) => `${citation.sourceLabel}: ${citation.excerpt}`)
    .join(" ");

  if (!hasDirectMatch) {
    return `The available evidence does not directly answer this question. Closest available evidence: ${evidenceSummary}`;
  }

  return `Based on available evidence, ${evidenceSummary}`;
}

export async function answerQualificationQuestion(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: QualificationQuestionInput,
): Promise<QualificationQuestionResponse> {
  const question = normalizeQuestion(input.question);
  const evidence = await getOrCreateQualificationCitations(database, userId, intentId);
  const selection = selectCitations(question, evidence.citations);
  const citations = selection.citations;
  const evidenceCoverage = createEvidenceCoverage({
    selected: citations,
    matchedCitationCount: selection.matchedCitationCount,
    totalCitationCount: evidence.citations.length,
  });

  return {
    intentId: evidence.intentId,
    bidId: evidence.bidId,
    question,
    answer: formatAnswer(question, citations),
    citations,
    grounded: true,
    groundingStatus: groundingStatusFromCoverage(evidenceCoverage),
    evidenceCoverage,
    limitations: LOCAL_QA_LIMITATIONS,
    aiRun: createDeterministicAiRunMetadata({
      action: "qualification_qa",
      promptVersion: "qualification-qa-lite@2026-06-10",
      confidence: citations[0]?.confidence ?? "medium",
      fallbackReason: "no_llm_provider_configured",
    }),
    generatedAt: nowIso(),
  };
}
