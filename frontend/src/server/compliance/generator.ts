import type { IntentDetail } from "@/server/intents/types";
import type { GeneratedComplianceItem } from "./types";

function uniq(items: GeneratedComplianceItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.category}:${item.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateComplianceManifestItems(intent: IntentDetail): GeneratedComplianceItem[] {
  const generated: GeneratedComplianceItem[] = [
    {
      title: "Confirm supplier eligibility and registration requirements.",
      category: "eligibility",
      evidenceStatus: "needed",
    },
    {
      title: "Collect required solicitation forms, certifications, and attachments.",
      category: "documents",
      evidenceStatus: "needed",
    },
    {
      title: "Validate pricing assumptions against the solicitation scope.",
      category: "pricing",
      evidenceStatus: "needed",
    },
    {
      title: "Verify submission method, deadline, and receipt requirements.",
      category: "submission",
      evidenceStatus: "needed",
    },
  ];

  for (const item of intent.generated.initialChecklist.slice(0, 4)) {
    generated.push({
      title: item,
      category: "documents",
      evidenceStatus: "needed",
    });
  }

  for (const risk of intent.generated.riskFlags.slice(0, 3)) {
    generated.push({
      title: `Resolve risk: ${risk}`,
      category: "risk",
      evidenceStatus: "needed",
    });
  }

  return uniq(generated);
}
