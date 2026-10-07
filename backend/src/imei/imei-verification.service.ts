import { createHash } from "node:crypto";
import { normalizeImei, maskImei } from "@fiducia/shared";
import { ImeiProvider, ImeiProviderResult, ImeiCheckOptions, VerificationReport, ImeiVerificationVerdict } from "./imei.types";
import { ImeiRegistry, ImeiRegistryStatus } from "./imei-registry.service";

export interface ImeiVerificationServiceOptions {
  providers?: ImeiProvider[];
  registry?: ImeiRegistry;
  cacheTtlMs?: number;
}

export class ImeiVerificationService {
  private readonly providers: ImeiProvider[];
  private readonly registry: ImeiRegistry;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { expiresAt: number; report: VerificationReport }>();
  private readonly circuitBreakers = new Map<string, { openedUntil: number; failures: number }>();

  constructor(options: ImeiVerificationServiceOptions = {}) {
    this.providers = options.providers ?? [];
    this.registry = options.registry ?? new ImeiRegistry();
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  async verify(imei: string, options: ImeiCheckOptions = {}): Promise<VerificationReport> {
    const normalized = normalizeImei(imei);
    const cacheKey = createHash("sha256").update(`imei:${normalized}`).digest("hex");
    const cached = this.cache.get(cacheKey);
    if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.report;
    }

    const providerResults = await Promise.all(
      this.providers.map(async (provider) => this.callProvider(provider, normalized, options)),
    );

    const registryStatus = this.registry.getStatus(normalized)?.status ?? null;
    const report = this.aggregate(normalized, providerResults, registryStatus, options);

    this.cache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, report });
    return report;
  }

  getProviderHealth(): Array<{ provider: string; failures: number; openUntil: number | null }> {
    return Array.from(this.circuitBreakers.entries()).map(([provider, breaker]) => ({
      provider,
      failures: breaker.failures,
      openUntil: breaker.openedUntil > Date.now() ? breaker.openedUntil : null,
    }));
  }

  private async callProvider(provider: ImeiProvider, imei: string, options: ImeiCheckOptions): Promise<ImeiProviderResult> {
    const breaker = this.circuitBreakers.get(provider.name) ?? { openedUntil: 0, failures: 0 };
    if (breaker.openedUntil > Date.now()) {
      const errorResult: ImeiProviderResult = {
        providerName: provider.name,
        checkedAt: new Date().toISOString(),
        status: "ERROR",
        details: { reason: "Circuit breaker ouvert pour ce fournisseur" },
        latencyMs: 0,
        confidence: 0,
      };
      this.logCall(provider.name, "blocked", 0, "ERROR");
      return errorResult;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const startedAt = Date.now();
        const result = await Promise.race([
          provider.check(imei, options),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("timeout")), 3000);
          }),
        ]);
        this.logCall(provider.name, "success", Date.now() - startedAt, result.status);
        this.circuitBreakers.set(provider.name, { openedUntil: 0, failures: 0 });
        this.logTransfer(provider.name, "IMEI verification", Date.now() - startedAt);
        return result;
      } catch (error) {
        lastError = error;
        this.logCall(provider.name, "error", 0, "ERROR");
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    const failureCount = (this.circuitBreakers.get(provider.name)?.failures ?? 0) + 1;
    const openedUntil = failureCount >= 2 ? Date.now() + 60_000 : 0;
    this.circuitBreakers.set(provider.name, { openedUntil, failures: failureCount });

    return {
      providerName: provider.name,
      checkedAt: new Date().toISOString(),
      status: "ERROR",
      details: { reason: lastError instanceof Error ? lastError.message : "Erreur de fournisseur", provider: provider.name },
      latencyMs: 0,
      confidence: 0,
    };
  }

  private aggregate(
    imei: string,
    providerResults: ImeiProviderResult[],
    registryStatus: ImeiRegistryStatus | null,
    options: ImeiCheckOptions,
  ): VerificationReport {
    const checkedAt = new Date().toISOString();
    const mask = maskImei(imei);
    const imeiHash = createHash("sha256").update(imei).digest("hex");
    const sourcesConsulted = providerResults.map((result) => result.providerName);
    const sourcesFailed = providerResults.filter((result) => result.status === "ERROR").map((result) => result.providerName);
    const coverageScore = providerResults.length === 0 ? 0 : providerResults.filter((result) => result.status !== "ERROR").length / providerResults.length;

    let verdict: ImeiVerificationVerdict = "TRUSTED";
    const reasons: string[] = [];

    if (registryStatus === "REPORTED_STOLEN" || registryStatus === "BLOCKED") {
      verdict = "REJECTED";
      reasons.push("L'IMEI est signalé comme volé ou bloqué dans le registre interne.");
    }

    if (registryStatus === "UNDER_LIEN") {
      verdict = "UNDER_LIEN";
      reasons.push("Un gage actif est connu sur cet IMEI dans le registre interne.");
    }

    if (providerResults.some((result) => result.status === "STOLEN")) {
      verdict = "REJECTED";
      reasons.push("Un fournisseur signale un IMEI volé ou détourné.");
    }

    if (providerResults.some((result) => result.status === "LOCKED")) {
      verdict = "REJECTED";
      reasons.push("Un fournisseur signale un Activation Lock actif.");
    }

    if (providerResults.some((result) => result.status === "BLACKLISTED")) {
      verdict = "REJECTED";
      reasons.push("Le dispositif est signalé en liste noire par une source consultée.");
    }

    if (options.tac && options.model && options.tac !== "" && !options.model.toLowerCase().includes(options.tac.toLowerCase().slice(0, 2))) {
      if (verdict !== "REJECTED") verdict = "WARNING";
      reasons.push("Le TAC est incompatible avec le modèle déclaré et exige un contrôle manuel.");
    }

    if (providerResults.some((result) => result.status === "FINANCED")) {
      verdict = "UNDER_LIEN";
      reasons.push("Un financement actif ou un dossier de blocage est détecté.");
    }

    if (providerResults.length > 0 && providerResults.every((result) => result.status === "CLEAN")) {
      verdict = "TRUSTED";
      reasons.push("Aucune anomalie détectée sur les sources consultées.");
    }

    if (coverageScore < 1 && verdict === "TRUSTED") {
      verdict = "WARNING";
      reasons.push("La couverture est partielle : au moins une source n'a pas répondu.");
    }

    if (coverageScore < 0.6 && verdict !== "REJECTED") {
      verdict = "WARNING";
      reasons.push("Le niveau de couverture est insuffisant pour une validation forte.");
    }

    if (providerResults.some((result) => result.status === "UNKNOWN") && verdict === "TRUSTED") {
      verdict = "WARNING";
      reasons.push("Au moins une source ne dispose d'aucun signalement fiable pour ce code.");
    }

    if (reasons.length === 0) {
      reasons.push("Aucune anomalie détectée sur les sources consultées.");
    }

    return {
      imeiHash,
      maskedImei: mask,
      verdict,
      riskLevel: verdict,
      reasons,
      sourcesConsulted,
      sourcesFailed,
      coverageScore: Number(coverageScore.toFixed(2)),
      checkedAt,
      providerResults,
    };
  }

  private logCall(providerName: string, phase: string, latencyMs: number, status: string): void {
    console.info(JSON.stringify({ event: "imei_provider_call", providerName, phase, latencyMs, status }));
  }

  private logTransfer(providerName: string, kind: string, latencyMs: number): void {
    console.info(JSON.stringify({ event: "imei_data_transfer", providerName, kind, latencyMs, note: "Aucune donnée personnelle ni IMEI lisible n'est journalisé dans le log." }));
  }
}
