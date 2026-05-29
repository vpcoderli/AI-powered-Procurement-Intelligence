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
  archiveError: string;
}

export type IssuerType = "federal" | "state";

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
}
