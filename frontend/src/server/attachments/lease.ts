/**
 * Per-source `crawler_locks` lease for attachment repair, so two workers never hit the same
 * portal at once. Mirrors the acquire/renew/release lifecycle in `crawler/orchestrator.ts`.
 */

import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import {
  acquireCrawlerLock,
  acquireCrawlerLockFromMysql,
  releaseCrawlerLock,
  releaseCrawlerLockFromMysql,
  renewCrawlerLock,
  renewCrawlerLockFromMysql,
  type MysqlCrawlerLockStore,
} from "@/server/crawler/lock-repository";

export const ATTACHMENT_LEASE_TTL_MS = 10 * 60 * 1000;

export function attachmentLockSource(sourceId: string) {
  return `attachment_repair:${sourceId}`;
}

export interface AttachmentLeaseOptions {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  sourceId: string;
  owner: string;
  now?: () => Date;
  ttlMs?: number;
}

export type AttachmentLeaseOutcome<T> =
  | { status: "ran"; value: T }
  | { status: "locked"; lockedBy?: string; lockExpiresAt?: string };

/**
 * Run `work` while holding the source's lease, renewing every TTL/3. Returns `locked` without
 * running anything when another owner holds the lease.
 */
export async function withAttachmentLease<T>(
  options: AttachmentLeaseOptions,
  work: () => Promise<T>,
): Promise<AttachmentLeaseOutcome<T>> {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? ATTACHMENT_LEASE_TTL_MS;
  const lockSource = attachmentLockSource(options.sourceId);
  // A unique suffix keeps a stale attempt from releasing a newer lease.
  const leaseOwner = `${options.owner}:${randomUUID()}`;
  const acquiredAt = now();
  const lockInput = {
    source: lockSource,
    owner: leaseOwner,
    acquiredAt: acquiredAt.toISOString(),
    expiresAt: new Date(acquiredAt.getTime() + ttlMs).toISOString(),
  };

  const lock = options.mysql
    ? await acquireCrawlerLockFromMysql(options.mysql, lockInput)
    : acquireCrawlerLock(options.database, lockInput);

  if (!lock.acquired) {
    return { status: "locked", lockedBy: lock.owner, lockExpiresAt: lock.expiresAt };
  }

  let renewing: Promise<void> | undefined;
  const renew = () => {
    if (renewing) return renewing;
    const checkedAt = now();
    renewing = (async () => {
      const input = {
        source: lockSource,
        owner: leaseOwner,
        now: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + ttlMs).toISOString(),
      };
      if (options.mysql) await renewCrawlerLockFromMysql(options.mysql, input);
      else renewCrawlerLock(options.database, input);
    })()
      .catch(() => {
        // Losing a renewal is not fatal for this run: the download loop is bounded by the
        // crawler's own process timeout and the write-back is idempotent per row.
      })
      .finally(() => {
        renewing = undefined;
      });
    return renewing;
  };

  let stopped = false;
  const heartbeat = setInterval(() => {
    if (!stopped) void renew();
  }, Math.max(1, Math.floor(ttlMs / 3)));
  heartbeat.unref?.();

  try {
    return { status: "ran", value: await work() };
  } finally {
    stopped = true;
    clearInterval(heartbeat);
    await renewing?.catch(() => {});
    const releaseInput = { source: lockSource, owner: leaseOwner };
    try {
      if (options.mysql) await releaseCrawlerLockFromMysql(options.mysql, releaseInput);
      else releaseCrawlerLock(options.database, releaseInput);
    } catch (error) {
      console.error(
        JSON.stringify({ event: "attachment_lock_release_failed", source: lockSource, error: String(error) }),
      );
    }
  }
}
