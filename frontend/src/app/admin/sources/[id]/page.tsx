"use client";

import { useParams } from "next/navigation";
import { SourceDetailView } from "@/components/admin/sources/SourceDetailView";

function sourceIdFrom(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function AdminSourceDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const sourceId = sourceIdFrom(params?.id);
  return sourceId ? <SourceDetailView key={sourceId} sourceId={sourceId} /> : null;
}
