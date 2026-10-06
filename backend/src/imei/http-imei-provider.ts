import { ImeiCheckOptions, ImeiProvider, ImeiProviderResult, ImeiProviderStatus } from "./imei.types";

export interface HttpImeiProviderConfig {
  name: string;
  url: string;
  authToken?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  mapping?: Record<string, string>;
}

export class HttpImeiProvider implements ImeiProvider {
  name: string;
  capabilities = ["api"]; 

  constructor(private readonly config: HttpImeiProviderConfig) {
    this.name = config.name;
  }

  async check(imei: string, options?: ImeiCheckOptions): Promise<ImeiProviderResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify({ imei, ...options }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 2000),
      });

      const payload = await response.json().catch(() => ({}));
      const status = this.normalizeStatus(payload.status ?? payload.verdict ?? payload.state ?? "UNKNOWN");
      return {
        providerName: this.name,
        checkedAt: new Date().toISOString(),
        status,
        details: payload.details ?? payload ?? {},
        latencyMs: Date.now() - startedAt,
        confidence: Number(payload.confidence ?? 0.5),
      };
    } catch (error) {
      return {
        providerName: this.name,
        checkedAt: new Date().toISOString(),
        status: "ERROR",
        details: { reason: error instanceof Error ? error.message : "Erreur inconnue", providerUrl: this.config.url },
        latencyMs: Date.now() - startedAt,
        confidence: 0,
      };
    }
  }

  private normalizeStatus(value: unknown): ImeiProviderStatus {
    const normalized = String(value ?? "UNKNOWN").toUpperCase();
    const map: Record<string, ImeiProviderStatus> = {
      CLEAN: "CLEAN",
      BLACKLISTED: "BLACKLISTED",
      STOLEN: "STOLEN",
      LOST: "LOST",
      FINANCED: "FINANCED",
      LOCKED: "LOCKED",
      UNKNOWN: "UNKNOWN",
      ERROR: "ERROR",
    };
    return map[normalized] ?? "UNKNOWN";
  }
}
