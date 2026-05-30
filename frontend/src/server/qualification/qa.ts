import type { AppDatabase } from "@/server/db/client";
import type {
  QualificationCitation,
  QualificationQuestionInput,
  QualificationQuestionResponse,
} from "./types";
import { getOrCreateQualificationCitations } from "./citations";

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

function selectCitations(question: string, citations: QualificationCitation[]) {
  const ranked = citations
    .map((citation, index) => ({
      citation,
      index,
      score: scoreCitation(question, citation),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const matched = ranked.filter((item) => item.score > 0).slice(0, 3);
  return (matched.length > 0 ? matched : ranked.slice(0, 3)).map((item) => item.citation);
}

function formatAnswer(question: string, citations: QualificationCitation[]) {
  if (citations.length === 0) {
    return "The available evidence does not contain enough information to answer this question.";
  }

  const hasDirectMatch = citations.some((citation) => scoreCitation(question, citation) > 0);
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
  const citations = selectCitations(question, evidence.citations);

  return {
    intentId: evidence.intentId,
    bidId: evidence.bidId,
    question,
    answer: formatAnswer(question, citations),
    citations,
    grounded: true,
    generatedAt: nowIso(),
  };
}
