import type { Bid as ClientBid, BidAttachment as ClientBidAttachment } from "@/lib/mock-data";
import type { Bid, BidAttachment } from "./domain";

/**
 * `@/lib/mock-data`'s `Bid` is the lighter client/demo shape and doesn't carry the server-only
 * admin-review, detail-archive, or lifecycle/access bookkeeping fields that `@/server/bids/domain`'s
 * `Bid` requires. Several tests hand a `MOCK_BIDS` entry to code that expects a full server `Bid`;
 * this fills in the server-only fields with neutral defaults (matching the SQLite/MySQL column
 * defaults in `src/server/db/schema.ts`) so those fixtures satisfy the type without changing any
 * test's assertions.
 */
export function toServerBidFixture(bid: ClientBid): Bid {
  return {
    id: bid.id,
    title: bid.title,
    source: bid.source,
    sourceUrl: bid.sourceUrl,
    issuerName: bid.issuerName,
    issuerType: bid.issuerType,
    stateCode: bid.stateCode,
    originalCategory: bid.originalCategory,
    description: bid.description,
    fullDescription: bid.fullDescription,
    amount: bid.amount,
    publishedDate: bid.publishedDate,
    deadlineDate: bid.deadlineDate,
    contactName: bid.contactName,
    contactEmail: bid.contactEmail,
    contactPhone: bid.contactPhone,
    attachments: bid.attachments.map(toServerAttachmentFixture),
    tags: [...bid.tags],
    sourceConfidence: "high",
    qualityFlags: [],
    adminReviewStatus: "unreviewed",
    detailArchiveStatus: "not_archived",
    detailArchivePath: "",
    detailFetchedAt: "",
    detailChecksumSha256: "",
    detailArchiveError: "",
    saved: bid.saved,
    isActive: bid.isActive,
    solicitationNumber: bid.solicitationNumber ?? "",
    lifecycleStatus: bid.lifecycleStatus ?? "open",
    awardedDate: bid.awardedDate ?? "",
    detailAccess: bid.detailAccess ?? null,
  };
}

function toServerAttachmentFixture(attachment: ClientBidAttachment): BidAttachment {
  return {
    name: attachment.name,
    url: attachment.url,
    size: attachment.size,
    originalUrl: attachment.url,
    archiveStatus: attachment.archiveStatus ?? "not_archived",
    storagePath: attachment.storagePath ?? "",
    byteSize: null,
    contentType: "",
    checksumSha256: "",
    fetchedAt: "",
    archiveError: attachment.archiveError ?? "",
  };
}
