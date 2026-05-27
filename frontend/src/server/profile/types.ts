export interface SupplierProfileInput {
  companyName?: string;
  businessTypes?: string[];
  categories?: string[];
  keywords?: string[];
  certifications?: string[];
  serviceStates?: string[];
  minContractValue?: number | null;
  maxContractValue?: number | null;
  riskPreferences?: string[];
}

export interface SupplierProfile extends Required<Omit<SupplierProfileInput, "minContractValue" | "maxContractValue">> {
  userId: string;
  minContractValue: number | null;
  maxContractValue: number | null;
  completionScore: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SupplierProfileResponse {
  profile: SupplierProfile;
}
