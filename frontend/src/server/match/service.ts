import type { Bid } from "@/server/bids/domain";
import type { SupplierProfile } from "@/server/profile/types";
import type { BidMatchResult } from "./types";

const COMPONENT_WEIGHTS = {
  geography: 20,
  keywords: 30,
  category: 15,
  certifications: 10,
  contractValue: 10,
  deadline: 15,
} as const;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function bidSearchText(bid: Bid) {
  return normalize(
    [
      bid.title,
      bid.description,
      bid.fullDescription,
      bid.originalCategory,
      bid.issuerName,
      bid.stateCode,
      ...bid.tags,
    ].join(" "),
  );
}

function scoreListMatches(items: string[], text: string, maxScore: number) {
  if (items.length === 0) return 0;

  const matches = items.filter((item) => {
    const normalized = normalize(item);
    if (normalized.length === 0) return false;

    return normalized
      .split(/\s+/)
      .filter(Boolean)
      .some((term) => text.includes(term));
  }).length;

  return Math.round((matches / items.length) * maxScore);
}

function scoreGeography(bid: Bid, profile: SupplierProfile) {
  const serviceStates = new Set(profile.serviceStates.map((state) => normalize(state)));
  const bidState = normalize(bid.stateCode);

  if (serviceStates.size === 0) return 0;
  if (serviceStates.has(bidState) || serviceStates.has("us")) return COMPONENT_WEIGHTS.geography;

  return 0;
}

function parseContractAmount(amount: string) {
  const matches = amount.match(/\$?\s*([\d.]+)\s*([KMB])?/gi);
  if (!matches) return null;

  const values = matches
    .map((match) => {
      const parsed = match.match(/([\d.]+)\s*([KMB])?/i);
      if (!parsed) return null;

      const value = Number.parseFloat(parsed[1]);
      if (!Number.isFinite(value)) return null;

      const suffix = parsed[2]?.toUpperCase();
      const multiplier = suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;

      return value * multiplier;
    })
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreContractValue(bid: Bid, profile: SupplierProfile) {
  if (profile.minContractValue === null && profile.maxContractValue === null) return 0;

  const amount = parseContractAmount(bid.amount);
  if (amount === null) return Math.round(COMPONENT_WEIGHTS.contractValue / 2);

  if (profile.minContractValue !== null && amount < profile.minContractValue) return 0;
  if (profile.maxContractValue !== null && amount > profile.maxContractValue) return 0;

  return COMPONENT_WEIGHTS.contractValue;
}

function scoreDeadline(bid: Bid) {
  return bid.deadlineDate ? COMPONENT_WEIGHTS.deadline : 0;
}

function confidence(score: number): BidMatchResult["confidence"] {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";

  return "low";
}

function missingProfileHints(profile: SupplierProfile) {
  const hints: string[] = [];

  if (profile.serviceStates.length === 0) {
    hints.push("Add service states to improve bid matching.");
  }

  if (profile.keywords.length === 0) {
    hints.push("Add keywords to improve bid matching.");
  }

  if (profile.categories.length === 0) {
    hints.push("Add categories to improve bid matching.");
  }

  if (profile.minContractValue === null && profile.maxContractValue === null) {
    hints.push("Add contract value preferences to improve bid matching.");
  }

  return hints;
}

function buildExplanation(components: BidMatchResult["components"]) {
  const reasons: string[] = [];

  if (components.geography > 0) {
    reasons.push("matches your service states");
  }

  if (components.keywords > 0) {
    reasons.push("shares keywords with your profile");
  }

  if (components.category > 0) {
    reasons.push("aligns with your categories");
  }

  if (components.contractValue > 0) {
    reasons.push("fits your contract value range");
  }

  if (components.deadline > 0) {
    reasons.push("has a trackable deadline");
  }

  if (reasons.length === 0) {
    return "This bid has limited match signals because your supplier profile is incomplete.";
  }

  return `This bid ${reasons.join(", ")}.`;
}

function riskNotes(bid: Bid, profile: SupplierProfile, components: BidMatchResult["components"]) {
  const notes: string[] = [];

  if (profile.serviceStates.length > 0 && components.geography === 0) {
    notes.push("Bid location is outside your listed service states.");
  }

  if (profile.minContractValue !== null || profile.maxContractValue !== null) {
    if (components.contractValue === 0) {
      notes.push("Estimated contract value is outside your preferred range.");
    }
  }

  if (bid.attachments.length === 0) {
    notes.push("No attachments are listed for this bid.");
  }

  return notes;
}

export function calculateBidMatch(bid: Bid, profile: SupplierProfile): BidMatchResult {
  const text = bidSearchText(bid);
  const components = {
    geography: scoreGeography(bid, profile),
    keywords: scoreListMatches(profile.keywords, text, COMPONENT_WEIGHTS.keywords),
    category: scoreListMatches(profile.categories, text, COMPONENT_WEIGHTS.category),
    certifications: scoreListMatches(profile.certifications, text, COMPONENT_WEIGHTS.certifications),
    contractValue: scoreContractValue(bid, profile),
    deadline: scoreDeadline(bid),
  };
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  const score = Math.min(100, total);

  return {
    bidId: bid.id,
    score,
    confidence: confidence(score),
    components,
    explanation: buildExplanation(components),
    riskNotes: riskNotes(bid, profile, components),
    missingProfileHints: missingProfileHints(profile),
  };
}
