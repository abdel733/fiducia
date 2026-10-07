export interface MerchantCredentials {
  publicKey: string;
  privateKey: string;
  secretKey: string;
  sandbox: boolean;
}

export interface PaymentIntentDetails {
  id: string;
  amountXof: number;
  expiresAt: Date;
  buyerPhone: string;
}

export interface VerifiedTransaction {
  transactionId: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  amountXof: number;
  currency: string;
  feesXof: number;
  payerPhone?: string;
}

export interface ParsedPaymentWebhook {
  transactionId: string;
  reference: string;
  event: string;
}

export interface PaymentProvider {
  readonly kind: "KKIAPAY" | "MOCK";
  initiate(intent: PaymentIntentDetails, credentials: MerchantCredentials): Promise<{
    publicKey: string;
    sandbox: boolean;
    reference: string;
    mockTransactionId?: string;
  }>;
  verify(transactionId: string, credentials: MerchantCredentials): Promise<VerifiedTransaction>;
  refund(transactionId: string, amountXof: number, credentials: MerchantCredentials): Promise<{ succeeded: boolean; reference?: string; reason?: string }>;
  parseWebhook(payload: unknown): ParsedPaymentWebhook;
  testConnection(transactionId: string, credentials: MerchantCredentials): Promise<void>;
}
