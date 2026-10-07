import { LayawayCollector, LedgerAccountType, LedgerSide, PaymentIntentStatus } from "@prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { AppConfig } from "../src/config/config";
import { CryptoService } from "../src/crypto/crypto.service";
import { PrismaService } from "../src/database/prisma.service";
import { MockEMecefInvoiceProvider } from "../src/payments/invoice.provider";
import { KkiapayProvider } from "../src/payments/kkiapay.provider";
import { MockPaymentProvider } from "../src/payments/mock-payment.provider";
import { allocateLayawaySchedule, assertLayawayTransition, calculateBuyerCancellationRefund } from "../src/payments/layaway.service";
import {
  allocateRefund,
  assertBalancedLedger,
  assertPaymentMatchesIntent,
  allocateLayawayInstallmentPayments,
  getSellerCommission,
  LedgerLine,
  PaymentsService,
  verifyKkiapayWebhookSecret,
} from "../src/payments/payments.service";

describe("Payment accounting invariants", () => {
  it.each([
    [200_000, 15_000],
    [200_001, 20_000],
  ])("applies seller-only commission for %i XOF", (price, commission) => {
    expect(getSellerCommission(price)).toBe(commission);
  });

  it("accepts balanced integer-XOF transactions and rejects imbalanced or fractional entries", () => {
    const balanced: LedgerLine[] = [
      { account: LedgerAccountType.PROVIDER_CLEARING, side: LedgerSide.DEBIT, amountXof: 80_000 },
      { account: LedgerAccountType.PLATFORM_REVENUE, side: LedgerSide.CREDIT, amountXof: 15_000 },
      { account: LedgerAccountType.SELLER_PAYABLE, side: LedgerSide.CREDIT, amountXof: 65_000 },
    ];
    expect(() => assertBalancedLedger(balanced)).not.toThrow();
    expect(() => assertBalancedLedger([...balanced, { ...balanced[0]!, amountXof: 1 }])).toThrow();
    expect(() => assertBalancedLedger([{ ...balanced[0]!, amountXof: 0.5 }, balanced[1]!])).toThrow();
  });

  it("allocates partial and total refunds exactly between seller and platform", () => {
    const first = allocateRefund(100_000, 85_000, 0, 40_000);
    const rest = allocateRefund(100_000, 85_000, 40_000, 60_000);
    expect(first).toEqual({ sellerRefundXof: 34_000, platformRefundXof: 6_000 });
    expect(rest).toEqual({ sellerRefundXof: 51_000, platformRefundXof: 9_000 });
    expect(first.sellerRefundXof + rest.sellerRefundXof).toBe(85_000);
    expect(first.platformRefundXof + rest.platformRefundXof).toBe(15_000);
  });

  it("rejects a falsified amount or a different transaction reference", () => {
    const payment = { transactionId: "tx-1", status: "SUCCESS" as const, amountXof: 99_999, currency: "XOF", feesXof: 0 };
    expect(() => assertPaymentMatchesIntent(100_000, "tx-1", payment)).toThrow();
    expect(() => assertPaymentMatchesIntent(99_999, "tx-other", payment)).toThrow();
    expect(() => assertPaymentMatchesIntent(99_999, "tx-1", { ...payment, currency: "USD" })).toThrow();
  });

  it("compares webhook secrets safely and refuses non-matching values", () => {
    expect(verifyKkiapayWebhookSecret("hash-secret", "hash-secret")).toBe(true);
    expect(verifyKkiapayWebhookSecret("wrong-secret", "hash-secret")).toBe(false);
    expect(verifyKkiapayWebhookSecret("x", "hash-secret")).toBe(false);
  });
});

describe("Layaway policy invariants", () => {
  it("creates exact FIXED_3 and FLEX schedules from the cash price", () => {
    const start = new Date("2026-10-07T00:00:00.000Z");
    expect(allocateLayawaySchedule(100_001, start, "FIXED_3").map(({ amountDueXof }) => amountDueXof)).toEqual([40_000, 30_000, 30_001]);
    expect(allocateLayawaySchedule(100_000, start, "FLEX", 90)).toEqual([
      { sequence: 1, amountDueXof: 100_000, dueAt: new Date("2027-01-05T00:00:00.000Z") },
    ]);
    expect(() => allocateLayawaySchedule(100_000, start, "FLEX", 120)).toThrow();
  });

  it("allocates partial and advance payments to the oldest unpaid installment", () => {
    const installments = [
      { id: "third", sequence: 3, amountDueXof: 30_000, amountPaidXof: 0 },
      { id: "first", sequence: 1, amountDueXof: 40_000, amountPaidXof: 10_000 },
      { id: "second", sequence: 2, amountDueXof: 30_000, amountPaidXof: 0 },
    ];
    expect(allocateLayawayInstallmentPayments(installments, 35_000)).toEqual([
      { id: "first", amountPaidXof: 40_000, paid: true },
      { id: "second", amountPaidXof: 5_000, paid: false },
    ]);
    expect(() => allocateLayawayInstallmentPayments(installments, 100_001)).toThrow();
  });

  it("rejects illegal state transitions and caps buyer cancellation fees", () => {
    expect(() => assertLayawayTransition("HANDED_OVER", "ACTIVE")).toThrow();
    expect(() => assertLayawayTransition("ACTIVE", "LATE")).not.toThrow();
    expect(() => assertLayawayTransition("PENDING_FIRST_PAYMENT", "ACTIVE")).not.toThrow();
    expect(() => assertLayawayTransition("ACTIVE", "COMPLETED")).not.toThrow();
    expect(() => assertLayawayTransition("LATE", "COMPLETED")).not.toThrow();
    expect(() => assertLayawayTransition("COMPLETED", "READY_FOR_PICKUP")).not.toThrow();
    expect(calculateBuyerCancellationRefund(100_000, 500, 10_000)).toEqual({ feeXof: 5_000, refundAmountXof: 95_000 });
    expect(calculateBuyerCancellationRefund(500_000, 500, 10_000)).toEqual({ feeXof: 10_000, refundAmountXof: 490_000 });
  });
});

describe("Mock KKiaPay scenarios", () => {
  const intent = { id: "intent-1", amountXof: 100_000, expiresAt: new Date(Date.now() + 60_000), buyerPhone: "+22997000000" };

  it("simulates success and a delayed provider response", async () => {
    const provider = new MockPaymentProvider("delay");
    const setup = await provider.initiate(intent);
    await expect(provider.verify(setup.mockTransactionId!)).resolves.toMatchObject({ status: "SUCCESS", amountXof: 100_000, currency: "XOF" });
  });

  it("simulates failed payment and refused refund", async () => {
    const failed = new MockPaymentProvider("failure");
    const failedSetup = await failed.initiate(intent);
    await expect(failed.verify(failedSetup.mockTransactionId!)).resolves.toMatchObject({ status: "FAILED" });
    const declined = new MockPaymentProvider("refund-declined");
    await expect(declined.refund("tx-1")).resolves.toMatchObject({ succeeded: false });
  });

  it("parses duplicate webhook scenarios with the same internal reference", async () => {
    const provider = new MockPaymentProvider("duplicate-webhook");
    const setup = await provider.initiate(intent);
    expect(provider.parseWebhook({ transactionId: setup.mockTransactionId, partnerId: intent.id, event: "transaction.success" })).toEqual({
      transactionId: setup.mockTransactionId,
      reference: intent.id,
      event: "transaction.success",
    });
  });
});

describe("Payment confirmation idempotency", () => {
  it("turns ten replays into one paid order, ledger journal, and invoice", async () => {
    const state = makePaymentFixture();
    const provider = new MockPaymentProvider("success");
    const setup = await provider.initiate({
      id: state.intent.id,
      amountXof: state.intent.amountXof,
      expiresAt: state.intent.expiresAt,
      buyerPhone: "+22997000000",
    });
    const service = makePaymentsService(state, provider);
    const buyer: AuthenticatedUser = { id: "buyer-1", phone: "+22997000000", roles: ["BUYER"] };
    const attempts = await Promise.all(Array.from({ length: 10 }, () => service.verifyPayment(state.intent.id, setup.mockTransactionId!, buyer)));
    expect(attempts).toHaveLength(10);
    expect(state.ledgerKeys).toEqual(["payment:intent-1"]);
    expect(state.orderStatus).toBe("PAID");
    expect(state.invoiceCount).toBe(1);
    expect(state.intent.status).toBe(PaymentIntentStatus.SUCCEEDED);
  });

  it("holds platform-collected funds until the order is handed over", async () => {
    const state = makePaymentFixture({ collector: "PLATFORM" });
    const provider = new MockPaymentProvider("success");
    const setup = await provider.initiate({
      id: state.intent.id,
      amountXof: state.intent.amountXof,
      expiresAt: state.intent.expiresAt,
      buyerPhone: "+22997000000",
    });
    const service = makePaymentsService(state, provider, true);
    await service.verifyPayment(state.intent.id, setup.mockTransactionId!, { id: "buyer-1", phone: "+22997000000", roles: ["BUYER"] });
    expect(state.ledgerEntries).toEqual([
      { account: "PROVIDER_CLEARING", side: "DEBIT", amountXof: 100_000 },
      { account: "CUSTOMER_FUNDS_HELD", side: "CREDIT", amountXof: 100_000 },
    ]);
  });

  it("rejects a provider transaction ID already used by another intent", async () => {
    const state = makePaymentFixture({ reusedTransactionId: "used-transaction" });
    const service = makePaymentsService(state, new MockPaymentProvider("success"));
    await expect(service.verifyPayment(
      state.intent.id,
      "used-transaction",
      { id: "buyer-1", phone: "+22997000000", roles: ["BUYER"] },
    )).rejects.toThrow("déjà été utilisée");
    expect(state.ledgerKeys).toHaveLength(0);
  });

  it("rejects a webhook without the configured KKiaPay secret", async () => {
    const state = makePaymentFixture({ provider: "KKIAPAY", webhookSecret: "configured-secret" });
    const service = makePaymentsService(state, new MockPaymentProvider("success"));
    await expect(service.acceptWebhook("wrong-secret", {
      transactionId: "provider-transaction",
      partnerId: state.intent.id,
      event: "transaction.success",
    })).rejects.toThrow("Signature webhook KKiaPay invalide");
  });

  it("rejects a provider-verified payment whose amount was altered", async () => {
    class FalsifiedProvider extends MockPaymentProvider {
      override async verify(transactionId: string) {
        return { ...await super.verify(transactionId), amountXof: 99_999 };
      }
    }
    const state = makePaymentFixture();
    const provider = new FalsifiedProvider("success");
    const setup = await provider.initiate({
      id: state.intent.id,
      amountXof: state.intent.amountXof,
      expiresAt: state.intent.expiresAt,
      buyerPhone: "+22997000000",
    });
    const service = makePaymentsService(state, provider);
    await expect(service.verifyPayment(
      state.intent.id,
      setup.mockTransactionId!,
      { id: "buyer-1", phone: "+22997000000", roles: ["BUYER"] },
    )).rejects.toThrow("ne correspond pas");
    expect(state.ledgerKeys).toHaveLength(0);
  });
});

function makePaymentsService(state: ReturnType<typeof makePaymentFixture>, provider: MockPaymentProvider, platformCollectionEnabled = false) {
  return new PaymentsService(
    state.prisma,
    { encrypt: (value: string) => value, decrypt: (value: string) => value, hashSecret: (value: string) => value } as unknown as CryptoService,
    new KkiapayProvider(),
    provider,
    new MockEMecefInvoiceProvider(),
    { PAYMENT_PROVIDER: "mock", PLATFORM_COLLECTION_ENABLED: platformCollectionEnabled, NODE_ENV: "test" } as AppConfig,
  );
}

function makePaymentFixture(options: {
  collector?: LayawayCollector;
  provider?: "KKIAPAY" | "MOCK";
  reusedTransactionId?: string;
  webhookSecret?: string;
} = {}) {
  const order = {
    id: "order-1",
    status: "AWAITING_PAYMENT" as const,
    totalXof: 100_000,
    commissionXof: 15_000,
    sellerPayableXof: 85_000,
    listingId: "listing-1",
    shopId: "shop-1",
  };
  const intent = {
    id: "intent-1",
    userId: "buyer-1",
    amountXof: 100_000,
    status: PaymentIntentStatus.PENDING,
    transactionId: null as string | null,
    expiresAt: new Date(Date.now() + 60_000),
    provider: options.provider ?? "MOCK",
    shop: {
      encryptedKkiapayPrivateKey: null,
      encryptedKkiapayPublicKey: null,
      encryptedKkiapaySecretKey: options.webhookSecret ?? null,
      kkiapaySandbox: true,
      layawayCollector: options.collector ?? "SELLER",
    },
    order,
  };
  let orderStatus = "AWAITING_PAYMENT";
  let invoiceCount = 0;
  const ledgerKeys: string[] = [];
  const ledgerEntries: LedgerLine[] = [];
  let invoiceExists = false;
  let transactionLock = Promise.resolve();
  const transactionClient = {
    paymentIntent: {
      updateMany: async ({ where, data }: { where: { status?: string; transactionId?: string | null }; data: Record<string, unknown> }) => {
        if (intent.status !== where.status || (where.transactionId !== undefined && intent.transactionId !== where.transactionId)) return { count: 0 };
        Object.assign(intent, data);
        return { count: 1 };
      },
      findUnique: async () => ({ ...intent }),
    },
    order: {
      updateMany: async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (orderStatus !== where.status) return { count: 0 };
        orderStatus = data.status;
        return { count: 1 };
      },
    },
    ledgerTransaction: {
      create: async ({ data }: { data: { idempotencyKey: string; entries: { create: LedgerLine[] } } }) => {
        ledgerKeys.push(data.idempotencyKey);
        ledgerEntries.push(...data.entries.create);
        return data;
      },
    },
  };
  const prisma = {
    paymentIntent: {
      updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        if (where.id !== intent.id || (where.status && intent.status !== where.status)) return { count: 0 };
        Object.assign(intent, data);
        return { count: 1 };
      },
      findUnique: async ({ where }: { where: { id?: string; transactionId?: string } }) => {
      if (where.transactionId) {
        if (where.transactionId === options.reusedTransactionId) return { id: "other-intent" };
        return intent.transactionId === where.transactionId ? { id: intent.id } : null;
      }
        return { ...intent, order: { ...order, status: orderStatus }, shop: intent.shop };
      },
    },
    $transaction: async <T>(callback: (transaction: typeof transactionClient) => Promise<T>) => {
      let release!: () => void;
      const previous = transactionLock;
      transactionLock = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback(transactionClient);
      } finally {
        release();
      }
    },
    invoice: {
      findUnique: async () => invoiceExists ? { id: "invoice-1" } : null,
      create: async () => {
        if (!invoiceExists) {
          invoiceExists = true;
          invoiceCount += 1;
        }
        return { id: "invoice-1" };
      },
    },
    order: {
      findUniqueOrThrow: async () => ({ shop: { name: "Boutique" } }),
    },
  };
  return {
    intent,
    prisma: prisma as unknown as PrismaService,
    ledgerKeys,
    ledgerEntries,
    get orderStatus() { return orderStatus; },
    get invoiceCount() { return invoiceCount; },
  };
}
