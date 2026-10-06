import { createHash } from "node:crypto";
import { ImeiCheckOptions, ImeiProvider, ImeiProviderResult, ImeiProviderStatus } from "./imei.types";

export type MockScenario = "CLEAN" | "STOLEN" | "LOST" | "BLACKLISTED" | "LOCKED" | "UNKNOWN" | "TIMEOUT" | "INCONSISTENT";

export class MockImeiProvider implements ImeiProvider {
  name = "mock";
  capabilities = ["pilotage", "test"]; 

  constructor(private scenario: MockScenario = "CLEAN") {}

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  async check(imei: string, _options?: ImeiCheckOptions): Promise<ImeiProviderResult> {
    const baseStatus: Record<MockScenario, ImeiProviderStatus> = {
      CLEAN: "CLEAN",
      STOLEN: "STOLEN",
      LOST: "LOST",
      BLACKLISTED: "BLACKLISTED",
      LOCKED: "LOCKED",
      UNKNOWN: "UNKNOWN",
      TIMEOUT: "ERROR",
      INCONSISTENT: "ERROR",
    };

    if (this.scenario === "TIMEOUT") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        providerName: this.name,
        checkedAt: new Date().toISOString(),
        status: "ERROR",
        details: { scenario: "TIMEOUT", reason: "Le fournisseur a dépassé la limite de temps" },
        latencyMs: 150,
        confidence: 0,
      };
    }

    if (this.scenario === "INCONSISTENT") {
      return {
        providerName: this.name,
        checkedAt: new Date().toISOString(),
        status: "ERROR",
        details: { scenario: "INCONSISTENT", reason: "Réponse incomplète de la source" },
        latencyMs: 40,
        confidence: 0,
      };
    }

    const status = baseStatus[this.scenario];
    return {
      providerName: this.name,
      checkedAt: new Date().toISOString(),
      status,
      details: {
        scenario: this.scenario,
        imeiHash: createHash("sha256").update(imei).digest("hex"),
        note: status === "CLEAN" ? "Aucune anomalie détectée." : "Action à risque à confirmer.",
      },
      latencyMs: 24,
      confidence: status === "CLEAN" ? 0.94 : 0.85,
    };
  }
}
