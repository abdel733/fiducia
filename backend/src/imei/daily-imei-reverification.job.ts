import { ImeiVerificationService } from "./imei-verification.service";
import { ImeiRegistry } from "./imei-registry.service";

export class DailyImeiReverificationJob {
  constructor(
    private readonly verification: ImeiVerificationService,
    private readonly registry: ImeiRegistry,
  ) {}

  async run(imeis: string[]): Promise<{ processed: number; suspended: number; revoked: number }> {
    let suspended = 0;
    let revoked = 0;

    for (const imei of imeis) {
      const report = await this.verification.verify(imei);
      if (report.verdict === "REJECTED") {
        this.registry.setStatus(imei, "BLOCKED", "Révision quotidienne : alerte de sécurité détectée.", "job:daily");
        revoked += 1;
      }
      if (report.verdict === "WARNING") {
        suspended += 1;
      }
    }

    return { processed: imeis.length, suspended, revoked };
  }
}
