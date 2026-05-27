export interface BidMatchResult {
  bidId: string;
  score: number;
  confidence: "low" | "medium" | "high";
  components: {
    geography: number;
    keywords: number;
    category: number;
    certifications: number;
    contractValue: number;
    deadline: number;
  };
  explanation: string;
  riskNotes: string[];
  missingProfileHints: string[];
}

export interface BidMatchResponse {
  match: BidMatchResult;
}
