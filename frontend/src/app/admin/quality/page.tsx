"use client";

import { SourceDataQualitySection } from "@/components/admin/sections/SourceDataQualitySection";
import { RiskCheckSection } from "@/components/admin/sections/RiskCheckSection";

export default function AdminQualityPage() {
  return <div className="space-y-6"><SourceDataQualitySection /><RiskCheckSection /></div>;
}
