import type { IntentDetail } from "@/server/intents/types";
import { bidDetailPath } from "@/lib/bid-routes";
import type { PursuitEvidenceRef } from "@/server/pursuit/types";
import type { ComplianceCategory, GeneratedComplianceItem } from "./types";

function uniq(items: GeneratedComplianceItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.category}:${item.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceUrlRef(intent: IntentDetail): PursuitEvidenceRef {
  return {
    kind: "source_url",
    label: "Original source",
    citationId: "citation_source_url",
    url: intent.bid.sourceUrl,
  };
}

function bidDetailRef(intent: IntentDetail): PursuitEvidenceRef {
  return { kind: "bid_detail", label: "Bid detail", url: bidDetailPath(intent.bid.id) };
}

function supplierProfileRef(): PursuitEvidenceRef {
  return { kind: "supplier_profile", label: "Supplier profile", url: "/profile" };
}

function matchSnapshotRef(): PursuitEvidenceRef {
  return { kind: "match_snapshot", label: "Match snapshot" };
}

function generatedOutputRef(label: string, citationId = "citation_generated_brief"): PursuitEvidenceRef {
  return { kind: "generated_output", label, citationId };
}

function deadlineRef(): PursuitEvidenceRef {
  return { kind: "citation", label: "Deadline", citationId: "citation_deadline" };
}

function attachmentRefs(intent: IntentDetail): PursuitEvidenceRef[] {
  return intent.bid.attachments.slice(0, 3).map((attachment, index) => ({
    kind: "attachment",
    label: attachment.name,
    citationId: `citation_attachment_${index + 1}`,
    url: attachment.url,
  }));
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function compactRefs(refs: PursuitEvidenceRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.citationId ?? ref.url ?? ref.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

export function buildComplianceEvidenceRefs(
  intent: IntentDetail,
  item: Pick<GeneratedComplianceItem, "title" | "category"> | { title: string; category: ComplianceCategory },
): PursuitEvidenceRef[] {
  const title = item.title.toLowerCase();
  const refs: PursuitEvidenceRef[] = [];

  if (item.category === "eligibility") {
    refs.push(supplierProfileRef(), sourceUrlRef(intent), generatedOutputRef("Generated checklist"));
  }

  if (item.category === "documents") {
    refs.push(...attachmentRefs(intent), bidDetailRef(intent), sourceUrlRef(intent));
  }

  if (item.category === "pricing") {
    refs.push(matchSnapshotRef(), bidDetailRef(intent), sourceUrlRef(intent));
  }

  if (item.category === "submission") {
    refs.push(deadlineRef(), sourceUrlRef(intent), generatedOutputRef("Generated checklist"));
  }

  if (item.category === "risk") {
    refs.push(generatedOutputRef("Generated risk flags"), matchSnapshotRef(), bidDetailRef(intent));
  }

  if (hasAny(title, [/attachment/, /form/, /certification/, /addend/, /solicitation/])) {
    refs.push(...attachmentRefs(intent), bidDetailRef(intent));
  }

  if (hasAny(title, [/deadline/, /portal/, /receipt/, /submission/, /submit/])) {
    refs.push(deadlineRef(), sourceUrlRef(intent));
  }

  return compactRefs(refs);
}

function item(
  intent: IntentDetail,
  input: Omit<GeneratedComplianceItem, "evidenceRefs">,
): GeneratedComplianceItem {
  return {
    ...input,
    evidenceRefs: buildComplianceEvidenceRefs(intent, input),
  };
}

export function generateComplianceManifestItems(intent: IntentDetail): GeneratedComplianceItem[] {
  const generated: GeneratedComplianceItem[] = [
    item(intent, {
      title: "Confirm supplier eligibility and registration requirements.",
      category: "eligibility",
      evidenceStatus: "needed",
    }),
    item(intent, {
      title: "Collect required solicitation forms, certifications, and attachments.",
      category: "documents",
      evidenceStatus: "needed",
    }),
    item(intent, {
      title: "Validate pricing assumptions against the solicitation scope.",
      category: "pricing",
      evidenceStatus: "needed",
    }),
    item(intent, {
      title: "Verify submission method, deadline, and receipt requirements.",
      category: "submission",
      evidenceStatus: "needed",
    }),
  ];

  for (const checklistItem of intent.generated.initialChecklist.slice(0, 4)) {
    generated.push(item(intent, {
      title: checklistItem,
      category: "documents",
      evidenceStatus: "needed",
    }));
  }

  for (const risk of intent.generated.riskFlags.slice(0, 3)) {
    generated.push(item(intent, {
      title: `Resolve risk: ${risk}`,
      category: "risk",
      evidenceStatus: "needed",
    }));
  }

  return uniq(generated);
}
