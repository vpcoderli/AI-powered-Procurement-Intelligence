/** Detail fields a platform shows only to its registered members (spec 2026-09-24 §5.6). */
export const RESTRICTABLE_DETAIL_FIELDS = ["description", "documents", "contact"] as const;
export type RestrictableDetailField = (typeof RESTRICTABLE_DETAIL_FIELDS)[number];

export interface BidDetailAccess {
  platform: string;
  restricted: RestrictableDetailField[];
}

export function detailAccessFromRawPayload(raw: unknown): BidDetailAccess | null {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const access = (value as Record<string, unknown>).detail_access;
  if (!access || typeof access !== "object" || Array.isArray(access)) return null;
  const { platform, restricted } = access as Record<string, unknown>;
  const fields = Array.isArray(restricted)
    ? restricted.filter((field): field is RestrictableDetailField => (RESTRICTABLE_DETAIL_FIELDS as readonly unknown[]).includes(field))
    : [];
  if (typeof platform !== "string" || !platform.trim() || fields.length === 0) return null;
  return { platform: platform.trim(), restricted: fields };
}
