import type { CrawlableSource } from "./source-registry";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const CADENCE_INTERVAL_MS = {
  hourly: HOUR_MS,
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
} as const;

/** Backoff cap: no matter how many consecutive failures, retry waits at most 7 days. */
const MAX_BACKOFF_MS = 7 * DAY_MS;

const JURISDICTION_ORDER = ["federal", "state", "county", "city", "special_district"];

export function cadenceIntervalMs(cadence: string): number | null {
  if (cadence === "manual") return null;
  return CADENCE_INTERVAL_MS[cadence as keyof typeof CADENCE_INTERVAL_MS] ?? CADENCE_INTERVAL_MS.daily;
}

export function nextDueAt(source: CrawlableSource): string | null {
  if (!source.lastSuccessAt) return null;
  const interval = cadenceIntervalMs(source.cadence);
  if (interval === null) return null;

  const failures = Math.max(0, source.consecutiveFailures);
  // 2^failures overflows for large failure counts; clamp the exponent to 10 (1024x) before
  // exponentiating, then apply the min() cap below.
  const factor = 2 ** Math.min(failures, 10);
  const effective = Math.min(interval * factor, MAX_BACKOFF_MS);

  return new Date(new Date(source.lastSuccessAt).getTime() + effective).toISOString();
}

function jurisdictionRank(level: string | null) {
  const index = JURISDICTION_ORDER.indexOf(level ?? "");
  return index === -1 ? JURISDICTION_ORDER.length : index;
}

/** Round-robins sources within the same provider_family so the same platform isn't hit back-to-back. */
function interleaveByProviderFamily(sources: CrawlableSource[]): CrawlableSource[] {
  const groups = new Map<string, CrawlableSource[]>();
  for (const source of sources) {
    const key = source.providerFamily ?? `__self__:${source.id}`;
    const group = groups.get(key);
    if (group) group.push(source);
    else groups.set(key, [source]);
  }

  const result: CrawlableSource[] = [];
  const lists = [...groups.values()];
  let placed = true;
  while (placed) {
    placed = false;
    for (const list of lists) {
      const next = list.shift();
      if (next) {
        result.push(next);
        placed = true;
      }
    }
  }

  return result;
}

export function selectDueSources(sources: CrawlableSource[], now: Date): CrawlableSource[] {
  const nowMs = now.getTime();

  const due = sources.filter((source) => {
    if (cadenceIntervalMs(source.cadence) === null) return false;
    const dueAt = nextDueAt(source);
    return dueAt === null || nowMs >= new Date(dueAt).getTime();
  });

  const sorted = [...due].sort((left, right) => {
    const rankDelta = jurisdictionRank(left.jurisdictionLevel) - jurisdictionRank(right.jurisdictionLevel);
    if (rankDelta !== 0) return rankDelta;

    const leftDue = nextDueAt(left);
    const rightDue = nextDueAt(right);
    if (leftDue === null && rightDue !== null) return -1;
    if (leftDue !== null && rightDue === null) return 1;
    if (leftDue !== null && rightDue !== null && leftDue !== rightDue) {
      return leftDue < rightDue ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });

  // Layered interleave: shuffle only within a jurisdiction level, preserving overall
  // state-first ordering.
  const byLevel = new Map<number, CrawlableSource[]>();
  for (const source of sorted) {
    const rank = jurisdictionRank(source.jurisdictionLevel);
    const bucket = byLevel.get(rank);
    if (bucket) bucket.push(source);
    else byLevel.set(rank, [source]);
  }

  return [...byLevel.keys()]
    .sort((a, b) => a - b)
    .flatMap((rank) => interleaveByProviderFamily(byLevel.get(rank)!));
}
