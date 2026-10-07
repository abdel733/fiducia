export type ImeiProviderStatus = "CLEAN" | "BLACKLISTED" | "STOLEN" | "LOST" | "FINANCED" | "LOCKED" | "UNKNOWN" | "ERROR";
export type ImeiVerificationVerdict = "TRUSTED" | "WARNING" | "REJECTED" | "UNDER_LIEN";

export interface ImeiProviderResult {
  providerName: string;
  checkedAt: string;
  status: ImeiProviderStatus;
  details: Record<string, unknown>;
  latencyMs: number;
  confidence: number;
}

export interface ImeiCheckOptions {
  tac?: string;
  model?: string;
  publicMode?: boolean;
  forceRefresh?: boolean;
}

export interface ImeiProvider {
  name: string;
  capabilities: string[];
  check(imei: string, options?: ImeiCheckOptions): Promise<ImeiProviderResult>;
}

export interface VerificationReport {
  imeiHash: string;
  maskedImei: string;
  verdict: ImeiVerificationVerdict;
  riskLevel: ImeiVerificationVerdict;
  reasons: string[];
  sourcesConsulted: string[];
  sourcesFailed: string[];
  coverageScore: number;
  checkedAt: string;
  providerResults: ImeiProviderResult[];
}
