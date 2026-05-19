export interface BidAttachment {
  name: string;
  url: string;
  size: string;
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
  saved: boolean;
  isActive: boolean;
}
