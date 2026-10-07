import { PaymentIntentStatus } from "@prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { AppConfig } from "../src/config/config";
import { CryptoService } from "../src/crypto/crypto.service";
import { PrismaService } from "../src/database/prisma.service";
import { MockEMecefInvoiceProvider } from "../src/payments/invoice.provider";
import { KkiapayProvider } from "../src/payments/kkiapay.provider";
import { PaymentsService } from "../src/payments/payments.service";
import { MockPaymentProvider } from "../src/payments/mock-payment.provider";

describe("Layaway installment payment journey", () => {
  it("applies three payments once, balances the ledger, then creates a pickup code", async () => {
    const fixture = createLayawayPaymentFixture();
    const provider = new MockPaymentProvider("success");
    const payments = new PaymentsService(
      fixture.prisma,
      {
        encrypt: (value: string) => value,
        decrypt: (value: string) => value,
        hashSecret: (value: string) => `hash:${value}`,
      } as unknown as CryptoService,
      new KkiapayProvider(),
      provider,
      new MockEMecefInvoiceProvider(),
      { PAYMENT_PROVIDER: "mock", PLATFORM_COLLECTION_ENABLED: false, NODE_ENV: "test" } as AppConfig,
    );
    const buyer: AuthenticatedUser = { id: "buyer-1", phone: "+22997000000", roles: ["BUYER"] };
    const createdTransactions: string[] = [];

    for (const amountXof of [40_000, 30_000, 30_000]) {
      const intent = fixture.addIntent(amountXof);
      const setup = await provider.initiate({ id: intent.id, amountXof, expiresAt: intent.expiresAt, buyerPhone: buyer.phone! });
      createdTransactions.push(setup.mockTransactionId!);
      await payments.verifyPayment(intent.id, setup.mockTransactionId!, buyer);
      expect(fixture.plan.paidXof).toBe(100_000 - fixture.plan.installments.reduce((sum, installment) => sum + installment.amountDueXof - installment.amountPaidXof, 0));
    }

    expect(fixture.plan.status).toBe("READY_FOR_PICKUP");
    expect(fixture.plan.paidXof).toBe(100_000);
    expect(fixture.plan.pickupOtpHash).toBeTruthy();
    expect(fixture.plan.pickupOtpEncrypted).toMatch(/^\d{6}$/);
    expect(fixture.plan.installments.map(({ status }) => status)).toEqual(["PAID", "PAID", "PAID"]);
    expect(fixture.ledgerTransactions).toHaveLength(3);
    expect(fixture.ledgerTransactions.map(({ idempotencyKey }) => idempotencyKey)).toEqual(
      fixture.intents.map(({ id }) => `layaway-payment:${id}`),
    );
    expect(createdTransactions).toHaveLength(3);

    const beforeReplay = fixture.ledgerTransactions.length;
    await Promise.all(Array.from({ length: 10 }, () => payments.verifyPayment(fixture.intents[0]!.id, createdTransactions[0]!, buyer)));
    expect(fixture.ledgerTransactions).toHaveLength(beforeReplay);
    expect(fixture.plan.paidXof).toBe(100_000);
  });
});

function createLayawayPaymentFixture() {
  const start = new Date();
  const shop = { id: "shop-1", layawayCollector: "SELLER" as const, encryptedKkiapayPrivateKey: null, encryptedKkiapayPublicKey: null, encryptedKkiapaySecretKey: null, kkiapaySandbox: true };
  const buyer = { id: "buyer-1", phone: "+22997000000" };
  const plan = {
    id: "plan-1",
    status: "PENDING_FIRST_PAYMENT" as string,
    priceXof: 100_000,
    paidXof: 0,
    dueAt: new Date(start.getTime() + 60 * 24 * 60 * 60_000),
    graceEndsAt: new Date(start.getTime() + 7 * 24 * 60 * 60_000),
    startedAt: null as Date | null,
    consentSnapshot: { gracePeriodDays: 7 },
    pickupOtpHash: null as string | null,
    pickupOtpEncrypted: null as string | null,
    pickupOtpExpiresAt: null as Date | null,
    shopId: shop.id,
    buyerId: buyer.id,
    listingId: "listing-1",
    shop,
    buyer,
    listing: { device: { model: "Phone", imeiHash: "imei-hash" } },
    installments: [
      { id: "installment-1", sequence: 1, amountDueXof: 40_000, amountPaidXof: 0, dueAt: start, status: "PENDING" as string, paidAt: null as Date | null },
      { id: "installment-2", sequence: 2, amountDueXof: 30_000, amountPaidXof: 0, dueAt: new Date(start.getTime() + 30 * 24 * 60 * 60_000), status: "PENDING" as string, paidAt: null as Date | null },
      { id: "installment-3", sequence: 3, amountDueXof: 30_000, amountPaidXof: 0, dueAt: new Date(start.getTime() + 60 * 24 * 60 * 60_000), status: "PENDING" as string, paidAt: null as Date | null },
    ],
  };
  const intents: {
    id: string;
    orderId: null;
    layawayPlanId: string;
    userId: string;
    amountXof: number;
    status: PaymentIntentStatus;
    transactionId: string | null;
    expiresAt: Date;
    provider: "MOCK";
  }[] = [];
  const ledgerTransactions: { idempotencyKey: string; entries: { create: { account: string; side: string; amountXof: number }[] } }[] = [];
  const events: unknown[] = [];

  const client = {
    paymentIntent: {
      updateMany: async ({ where, data }: { where: { id: string; status?: string; transactionId?: string | null; expiresAt?: { gt: Date }; OR?: unknown[] }; data: Record<string, unknown> }) => {
        const intent = intents.find((entry) => entry.id === where.id);
        if (!intent || (where.status && intent.status !== where.status)
          || (where.expiresAt && intent.expiresAt <= where.expiresAt.gt)
          || (where.transactionId !== undefined && intent.transactionId !== where.transactionId)) return { count: 0 };
        Object.assign(intent, data);
        return { count: 1 };
      },
      findUnique: async ({ where }: { where: { id: string } }) => intents.find(({ id }) => id === where.id) ?? null,
    },
    layawayPlan: {
      updateMany: async ({ where, data }: { where: { id: string; status: string; paidXof: number }; data: Record<string, unknown> }) => {
        if (plan.id !== where.id || plan.status !== where.status || plan.paidXof !== where.paidXof) return { count: 0 };
      const { paidXof, ...planData } = data;
      Object.assign(plan, planData);
      if (typeof paidXof === "object" && paidXof !== null && "increment" in paidXof) {
        plan.paidXof += Number(paidXof.increment);
      }
        return { count: 1 };
      },
    },
    installment: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const installment = plan.installments.find(({ id }) => id === where.id);
        if (!installment) throw new Error("Installment missing");
        Object.assign(installment, data);
        return installment;
      },
    },
    layawayNotification: { createMany: async () => ({ count: 2 }) },
    marketplaceListing: { updateMany: async () => ({ count: 1 }) },
    ledgerTransaction: {
      create: async ({ data }: { data: (typeof ledgerTransactions)[number] }) => {
        ledgerTransactions.push(data);
        return data;
      },
    },
    layawayEvent: {
      create: async ({ data }: { data: unknown }) => { events.push(data); return data; },
      createMany: async ({ data }: { data: unknown[] }) => { events.push(...data); return { count: data.length }; },
    },
  };
  const prisma = {
    paymentIntent: {
      findUnique: async ({ where }: { where: { id?: string; transactionId?: string }; include?: unknown }) => {
        if (where.transactionId) return intents.find(({ transactionId }) => transactionId === where.transactionId) ?? null;
        const intent = intents.find(({ id }) => id === where.id);
        return intent ? { ...intent, shop, layawayPlan: { ...plan, installments: plan.installments.map((item) => ({ ...item })) } } : null;
      },
    },
    $transaction: async <T>(callback: (transaction: typeof client) => Promise<T>) => callback(client),
  };

  return {
    plan,
    intents,
    ledgerTransactions,
    events,
    prisma: prisma as unknown as PrismaService,
    addIntent(amountXof: number) {
      const intent = {
        id: `intent-${intents.length + 1}`,
        orderId: null,
        layawayPlanId: plan.id,
        userId: buyer.id,
        amountXof,
        status: PaymentIntentStatus.PENDING,
        transactionId: null,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        provider: "MOCK" as const,
      };
      intents.push(intent);
      return intent;
    },
  };
}
