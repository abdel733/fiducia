import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import { MerchantCredentials, ParsedPaymentWebhook, PaymentIntentDetails, PaymentProvider, VerifiedTransaction } from "./payment-provider";

const LIVE_API = "https://api.kkiapay.me";
const SANDBOX_API = "https://api-sandbox.kkiapay.me";

@Injectable()
export class KkiapayProvider implements PaymentProvider {
  readonly kind = "KKIAPAY" as const;

  async initiate(intent: PaymentIntentDetails, credentials: MerchantCredentials): Promise<{
    publicKey: string;
    sandbox: boolean;
    reference: string;
    mockTransactionId?: string;
  }> {
    return {
      publicKey: credentials.publicKey,
      sandbox: credentials.sandbox,
      reference: intent.id,
    };
  }

  async verify(transactionId: string, credentials: MerchantCredentials): Promise<VerifiedTransaction> {
    const response = await this.request("/api/v1/transactions/status", credentials, { transactionId });
    const body = response as Record<string, unknown>;
    const amount = Number(body.amount);
    const fees = Number(body.fees ?? 0);
    const status = String(body.status ?? (body.isPaymentSucces === true ? "SUCCESS" : body.isPaymentSucces === false ? "FAILED" : "PENDING")).toUpperCase();
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(fees) || fees < 0) {
      throw new BadGatewayException("KKiaPay a renvoyé un montant ou des frais invalides.");
    }
    return {
      transactionId: String(body.transactionId ?? transactionId),
      status: status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING",
      amountXof: amount,
      currency: String(body.currency ?? "").toUpperCase(),
      feesXof: fees,
      ...(typeof body.phoneNumber === "string" ? { payerPhone: body.phoneNumber } : typeof body.phone === "string" ? { payerPhone: body.phone } : {}),
    };
  }

  async refund(transactionId: string, amountXof: number, credentials: MerchantCredentials) {
    const response = await this.request("/api/v1/transactions/revert", credentials, { transactionId });
    const body = response as Record<string, unknown>;
    const state = String(body.status ?? body.message ?? "").toUpperCase();
    return state === "SUCCESS"
      ? { succeeded: true, reference: String(body.transactionId ?? transactionId) }
      : { succeeded: false, reason: String(body.reason ?? body.message ?? "KKiaPay a refusé le remboursement.") };
  }

  parseWebhook(payload: unknown): ParsedPaymentWebhook {
    if (!payload || typeof payload !== "object") throw new BadRequestException("Événement KKiaPay invalide.");
    const body = payload as Record<string, unknown>;
    if (typeof body.transactionId !== "string" || typeof body.partnerId !== "string" || typeof body.event !== "string") {
      throw new BadRequestException("Événement KKiaPay incomplet.");
    }
    return { transactionId: body.transactionId, reference: body.partnerId, event: body.event };
  }

  async testConnection(transactionId: string, credentials: MerchantCredentials): Promise<void> {
    const transaction = await this.verify(transactionId, credentials);
    if (transaction.status !== "SUCCESS" || transaction.currency !== "XOF") {
      throw new BadRequestException("La référence sandbox doit désigner une transaction réussie en XOF.");
    }
  }

  private async request(path: string, credentials: MerchantCredentials, body: Record<string, string>) {
    const baseUrl = credentials.sandbox ? SANDBOX_API : LIVE_API;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": credentials.publicKey,
          "x-secret-key": credentials.secretKey,
          "x-private-key": credentials.privateKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException("KKiaPay est temporairement indisponible.");
    }
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new BadGatewayException("KKiaPay n’a pas confirmé la transaction.");
    }
    return payload;
  }
}
