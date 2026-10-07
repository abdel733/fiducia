import { Injectable } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { MerchantCredentials, ParsedPaymentWebhook, PaymentIntentDetails, PaymentProvider, VerifiedTransaction } from "./payment-provider";

export type MockPaymentScenario = "success" | "failure" | "delay" | "duplicate-webhook" | "refund-declined";

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly kind = "MOCK" as const;
  private readonly transactionAmounts = new Map<string, number>();

  constructor(private readonly scenario: MockPaymentScenario = "success") {}

  async initiate(intent: PaymentIntentDetails): Promise<{
    publicKey: string;
    sandbox: boolean;
    reference: string;
    mockTransactionId?: string;
  }> {
    if (this.scenario === "delay") await new Promise((resolve) => setTimeout(resolve, 25));
    const mockTransactionId = `${this.scenario === "failure" ? "MOCK-FAILED-" : "MOCK-SUCCESS-"}${intent.id}`;
    this.transactionAmounts.set(mockTransactionId, intent.amountXof);
    return {
      publicKey: "mock-public-key",
      sandbox: true,
      reference: intent.id,
      mockTransactionId,
    };
  }

  async verify(transactionId: string): Promise<VerifiedTransaction> {
    if (this.scenario === "delay") await new Promise((resolve) => setTimeout(resolve, 25));
    const isSuccess = this.scenario !== "failure" && !transactionId.startsWith("MOCK-FAILED-");
    return {
      transactionId,
      status: isSuccess ? "SUCCESS" : "FAILED",
      amountXof: this.transactionAmounts.get(transactionId) ?? 0,
      currency: "XOF",
      feesXof: 0,
    };
  }

  async refund(transactionId: string) {
    return this.scenario === "refund-declined"
      ? { succeeded: false, reason: "Remboursement simulé refusé." }
      : { succeeded: true, reference: `MOCK-REFUND-${transactionId}` };
  }

  parseWebhook(payload: unknown): ParsedPaymentWebhook {
    if (!payload || typeof payload !== "object") throw new BadRequestException("Événement de paiement invalide.");
    const body = payload as Record<string, unknown>;
    if (typeof body.transactionId !== "string" || typeof body.partnerId !== "string" || typeof body.event !== "string") {
      throw new BadRequestException("Événement de paiement incomplet.");
    }
    return { transactionId: body.transactionId, reference: body.partnerId, event: body.event };
  }

  async testConnection() {}
}
