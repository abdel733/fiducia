import { ImeiVerificationService } from "../src/imei/imei-verification.service";
import { MockImeiProvider } from "../src/imei/mock-imei-provider";

describe("ImeiVerificationService", () => {
  it("returns a trusted verdict for a clean IMEI", async () => {
    const provider = new MockImeiProvider("CLEAN");
    const service = new ImeiVerificationService({ providers: [provider] });

    const report = await service.verify("490154203237518");

    expect(report.verdict).toBe("TRUSTED");
    expect(report.riskLevel).toBe("TRUSTED");
    expect(report.reasons).toContain("Aucune anomalie détectée sur les sources consultées.");
  });

  it("rejects a stolen IMEI and keeps the provider result traceable", async () => {
    const provider = new MockImeiProvider("STOLEN");
    const service = new ImeiVerificationService({ providers: [provider] });

    const report = await service.verify("490154203237518");

    expect(report.verdict).toBe("REJECTED");
    expect(report.riskLevel).toBe("REJECTED");
    expect(report.sourcesConsulted).toContain("mock");
    expect(report.reasons.some((reason) => reason.toLowerCase().includes("vol"))).toBe(true);
  });

  it("keeps a warning verdict when coverage is partial", async () => {
    const provider = new MockImeiProvider("TIMEOUT");
    const service = new ImeiVerificationService({ providers: [provider] });

    const report = await service.verify("490154203237518");

    expect(report.verdict).toBe("WARNING");
    expect(report.coverageScore).toBeLessThan(1);
    expect(report.sourcesFailed.length).toBeGreaterThan(0);
  });
});
