import type { IssuerType } from "@/lib/issuer-types";
import type { BidDetailAccess } from "@/lib/bid-access";
import type { BidLifecycleStatus } from "@/lib/bid-lifecycle";
import type { BidDataQuality } from "@/lib/bid-usability";

export type { IssuerType } from "@/lib/issuer-types";

export interface BidAttachment {
  name: string;
  url: string;
  size: string;
  originalUrl: string;
  archiveStatus: string;
  storagePath: string;
  byteSize: number | null;
  contentType: string;
  checksumSha256: string;
  fetchedAt: string;
  verifiedAt?: string;
  archiveError: string;
}

export interface Bid {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  issuerName: string;
  issuerType: IssuerType;
  stateCode: string;
  originalCategory: string;
  description: string;
  fullDescription: string;
  amount: string;
  publishedDate: string;
  deadlineDate: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  attachments: BidAttachment[];
  tags: string[];
  sourceConfidence: string;
  qualityFlags: string[];
  adminReviewStatus: string;
  detailArchiveStatus: string;
  detailArchivePath: string;
  detailFetchedAt: string;
  detailChecksumSha256: string;
  detailArchiveError: string;
  saved: boolean;
  isActive: boolean;
  solicitationNumber: string;
  lifecycleStatus: BidLifecycleStatus;
  awardedDate: string;
  /** Platform-locked detail fields, e.g. BidNet members-only description/documents/contact. */
  detailAccess: BidDetailAccess | null;
  dataQuality?: BidDataQuality | null;
  sourceBidId?: string;
  dedupeKey?: string;
  jurisdictionLevel?: string;
  fipsCode?: string;
  updatedAt?: string;
}
