import { randomInt, timingSafeEqual } from "node:crypto";
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LayawayCollector, LedgerAccountType, LedgerSide, OrderStatus, PaymentIntentStatus, Prisma } from "@prisma/client";
import { APP_CONFIG, AppConfig } from "../config/config";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../database/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { InvoiceProvider } from "./invoice.provider";
import { MockEMecefInvoiceProvider } from "./invoice.provider";
import { KkiapayProvider } from "./kkiapay.provider";
import { MerchantCredentials, PaymentProvider, VerifiedTransaction } from "./payment-provider";
import { MockPaymentProvider } from "./mock-payment.provider";
import { assertLayawayTransition } from "./layaway-state";

const INTENT_TTL_MS = 15 * 60_000;
const PICKUP_CODE_DIGITS = 6;

export type LedgerLine = { account: LedgerAccountType; side: LedgerSide; amountXof: number };

export function allocateLayawayInstallmentPayments(
  installments: readonly { id: string; sequence: number; amountDueXof: number; amountPaidXof: number }[],
  amountXof: number,
) {
  if (!Number.isSafeInteger(amountXof) || amountXof <= 0) throw new BadRequestException("Le versement doit être un entier XOF positif.");
  let remaining = amountXof;
  const allocations: { id: string; amountPaidXof: number; paid: boolean }[] = [];
  for (const installment of [...installments].sort((left, right) => left.sequence - right.sequence)) {
    if (remaining === 0) break;
    const outstanding = installment.amountDueXof - installment.amountPaidXof;
    if (!Number.isSafeInteger(outstanding) || outstanding < 0) throw new BadRequestException("L’échéancier comporte un montant invalide.");
    const applied = Math.min(outstanding, remaining);
    if (applied === 0) continue;
    const amountPaidXof = installment.amountPaidXof + applied;
    allocations.push({ id: installment.id, amountPaidXof, paid: amountPaidXof === installment.amountDueXof });
    remaining -= applied;
  }
  if (remaining !== 0) throw new BadRequestException("Le versement dépasse le solde de l’échéancier.");
  return allocations;
}

export function getSellerCommission(priceXof: number): number {
  if (!Number.isSafeInteger(priceXof) || priceXof <= 0) throw new BadRequestException("Le prix doit être un entier positif en XOF.");
  return priceXof <= 200_000 ? 15_000 : 20_000;
}

export function assertPaymentMatchesIntent(expectedAmountXof: number, submittedId: string, verified: VerifiedTransaction): void {
  if (verified.status !== "SUCCESS" || verified.transactionId !== submittedId || verified.amountXof !== expectedAmountXof || verified.currency !== "XOF") {
    throw new BadRequestException("Le statut, le montant, la devise ou la référence de transaction ne correspond pas au paiement attendu.");
  }
}

export function allocateRefund(totalXof: number, sellerPayableXof: number, amountBeforeXof: number, refundAmountXof: number) {
  if (
    ![totalXof, sellerPayableXof, amountBeforeXof, refundAmountXof].every(Number.isSafeInteger)
    || totalXof <= 0
    || sellerPayableXof < 0
    || amountBeforeXof < 0
    || refundAmountXof <= 0
    || amountBeforeXof + refundAmountXof > totalXof
  ) {
    throw new BadRequestException("Allocation de remboursement invalide.");
  }
  const sellerRefundXof = Math.floor(sellerPayableXof * (amountBeforeXof + refundAmountXof) / totalXof)
    - Math.floor(sellerPayableXof * amountBeforeXof / totalXof);
  return { sellerRefundXof, platformRefundXof: refundAmountXof - sellerRefundXof };
}

export function assertBalancedLedger(lines: readonly LedgerLine[]): void {
  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amountXof) || line.amountXof <= 0) throw new BadRequestException("Une écriture du ledger doit être un entier XOF strictement positif.");
    if (line.side === "DEBIT") debits += line.amountXof;
    else credits += line.amountXof;
  }
  if (lines.length < 2 || debits !== credits || !Number.isSafeInteger(debits)) {
    throw new BadRequestException("La transaction du ledger doit être équilibrée en XOF.");
  }
}

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private webhookTimer: NodeJS.Timeout | undefined;
  private reconciliationTimer: NodeJS.Timeout | undefined;
  private processingWebhooks = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly kkiapay: KkiapayProvider,
    private readonly mock: MockPaymentProvider,
    @Inject(MockEMecefInvoiceProvider) private readonly invoiceProvider: InvoiceProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.webhookTimer = setInterval(() => { void this.processPendingWebhooks(); }, 5_000);
    this.webhookTimer.unref();
    this.reconciliationTimer = setInterval(() => { void this.reconcilePayments(); }, 60_000);
    this.reconciliationTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.webhookTimer) clearInterval(this.webhookTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
  }

  async createOrder(listingSlug: string, acceptedRefundPolicy: boolean, buyer: AuthenticatedUser) {
    if (acceptedRefundPolicy !== true) throw new BadRequestException("La politique de remboursement doit être acceptée.");
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { slug: listingSlug },
      include: { shop: true, device: true, certificate: true },
    });
    const now = new Date();
    if (!listing || listing.shop.status !== "VERIFIED") {
      throw new NotFoundException("Cette annonce n’est plus disponible.");
    }
    if (listing.status === "RESERVED") {
      const existing = await this.prisma.order.findFirst({
        where: { listingId: listing.id, buyerId: buyer.id, activeListingId: listing.id },
        select: { id: true, status: true, totalXof: true, commissionXof: true, sellerPayableXof: true, createdAt: true },
      });
      if (existing) return existing;
    }
    if (listing.status !== "PUBLISHED") throw new ConflictException("Cette annonce n’est plus disponible.");
    if (!listing.certificate || listing.certificate.status !== "ACTIVE" || listing.certificate.expiresAt <= now) {
      throw new BadRequestException("Un certificat actif est requis pour commander cet appareil.");
    }
    if (listing.shop.ownerId === buyer.id) throw new BadRequestException("Vous ne pouvez pas commander votre propre annonce.");
    const commissionXof = getSellerCommission(listing.priceCashXof);
    if (commissionXof >= listing.priceCashXof) throw new BadRequestException("Le prix est trop faible pour couvrir la commission vendeur.");

    return this.prisma.$transaction(async (transaction) => {
      const reserved = await transaction.marketplaceListing.updateMany({
        where: { id: listing.id, status: "PUBLISHED" },
        data: { status: "RESERVED", reservedUntil: new Date(now.getTime() + INTENT_TTL_MS) },
      });
      if (reserved.count !== 1) {
        const duplicate = await transaction.order.findFirst({
          where: { activeListingId: listing.id, buyerId: buyer.id },
          select: { id: true, status: true, totalXof: true, commissionXof: true, sellerPayableXof: true, createdAt: true },
        });
        if (duplicate) return duplicate;
        throw new ConflictException("Cette annonce vient d’être réservée par un autre acheteur.");
      }
      return transaction.order.create({
        data: {
          listingId: listing.id,
          shopId: listing.shopId,
          buyerId: buyer.id,
          totalXof: listing.priceCashXof,
          commissionXof,
          sellerPayableXof: listing.priceCashXof - commissionXof,
          activeListingId: listing.id,
          refundPolicyAcceptedAt: now,
          status: "CREATED",
        },
        select: { id: true, status: true, totalXof: true, commissionXof: true, sellerPayableXof: true, createdAt: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createPaymentIntent(orderId: string, buyer: AuthenticatedUser) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shop: true, buyer: true } });
    if (!order) throw new NotFoundException("Commande introuvable.");
    if (order.buyerId !== buyer.id) throw new ForbiddenException("Cette commande ne vous appartient pas.");
    if (!["CREATED", "AWAITING_PAYMENT"].includes(order.status)) throw new BadRequestException("Cette commande n’attend pas de paiement.");

    const existing = await this.prisma.paymentIntent.findFirst({
      where: { orderId, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return this.paymentIntentResponse(existing, order.shop, order.buyer.phone ?? "");

    const provider = this.getProvider();
    const credentials = provider.kind === "MOCK" ? this.mockCredentials() : this.decryptCredentials(order.shop);
    if (provider.kind === "KKIAPAY" && order.shop.layawayCollector !== "SELLER" && !this.config.PLATFORM_COLLECTION_ENABLED) {
      throw new BadRequestException("La collecte plateforme est désactivée. Configurez la collecte directe vendeur.");
    }

    const intent = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.order.findUnique({ where: { id: orderId } });
      if (!current || !["CREATED", "AWAITING_PAYMENT"].includes(current.status)) throw new ConflictException("La commande a changé d’état.");
      const active = await transaction.paymentIntent.findFirst({ where: { orderId, status: "PENDING", expiresAt: { gt: new Date() } } });
      if (active) return active;
      const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
      await transaction.order.update({ where: { id: orderId }, data: { status: "AWAITING_PAYMENT" } });
      return transaction.paymentIntent.create({
        data: {
          orderId,
          shopId: order.shopId,
          userId: buyer.id,
          amountXof: order.totalXof,
          expiresAt,
          provider: provider.kind,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.paymentIntentResponse(intent, order.shop, order.buyer.phone ?? "", credentials);
  }

  async createLayawayPaymentIntent(planId: string, amountXof: number, buyer: AuthenticatedUser) {
    if (!Number.isSafeInteger(amountXof) || amountXof <= 0) throw new BadRequestException("Le versement doit être un entier XOF positif.");
    const plan = await this.prisma.layawayPlan.findUnique({
      where: { id: planId },
      include: { shop: true, buyer: true, installments: true },
    });
    if (!plan) throw new NotFoundException("Réservation introuvable.");
    if (plan.buyerId !== buyer.id) throw new ForbiddenException("Cette réservation ne vous appartient pas.");
    if (!["PENDING_FIRST_PAYMENT", "ACTIVE", "LATE"].includes(plan.status)) {
      throw new BadRequestException("Cette réservation n’accepte plus de versement.");
    }
    const remainingXof = plan.priceXof - plan.paidXof;
    if (amountXof > remainingXof) throw new BadRequestException("Le versement dépasse le reste à payer.");
    if (plan.paidXof === 0) {
      const policy = plan.consentSnapshot as { firstPaymentMinimumXof?: number } | null;
      if (amountXof < (policy?.firstPaymentMinimumXof ?? 1)) {
        throw new BadRequestException("Le premier versement est inférieur au minimum prévu.");
      }
    }

    const provider = this.getProvider();
    if (provider.kind === "KKIAPAY" && plan.shop.layawayCollector !== "SELLER" && !this.config.PLATFORM_COLLECTION_ENABLED) {
      throw new BadRequestException("La collecte plateforme est désactivée.");
    }
    const credentials = provider.kind === "MOCK" ? this.mockCredentials() : this.decryptCredentials(plan.shop);
    const intent = await this.prisma.$transaction(async (transaction) => {
      const active = await transaction.paymentIntent.findFirst({
        where: { layawayPlanId: planId, status: "PENDING", expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      if (active) {
        if (active.amountXof !== amountXof) throw new ConflictException("Un autre versement est déjà en cours pour cette réservation.");
        return active;
      }
      return transaction.paymentIntent.create({
        data: {
          layawayPlanId: planId,
          shopId: plan.shopId,
          userId: buyer.id,
          amountXof,
          expiresAt: new Date(Date.now() + INTENT_TTL_MS),
          provider: provider.kind,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.paymentIntentResponse(intent, plan.shop, plan.buyer.phone ?? "", credentials);
  }

  async verifyPayment(intentId: string, transactionId: string, buyer: AuthenticatedUser) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: {
        order: true,
        shop: true,
        layawayPlan: { include: { shop: true, buyer: true, listing: { include: { device: true } }, installments: { orderBy: { sequence: "asc" } } } },
      },
    });
    if (!intent) throw new NotFoundException("Intention de paiement introuvable.");
    if (intent.userId !== buyer.id) throw new ForbiddenException("Ce paiement ne vous appartient pas.");
    return this.confirmIntentPayment(intent, transactionId);
  }

  async configureKkiapay(shopId: string, input: Omit<MerchantCredentials, "sandbox"> & { sandboxTransactionId: string }, actor: AuthenticatedUser) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, ownerId: true } });
    if (!shop) throw new NotFoundException("Boutique introuvable.");
    if (shop.ownerId !== actor.id) throw new ForbiddenException("Seul le propriétaire peut configurer KKiaPay.");
    const credentials = { ...input, sandbox: this.config.NODE_ENV !== "production" };
    await this.kkiapay.testConnection(input.sandboxTransactionId, credentials);
    await this.prisma.shop.update({
      where: { id: shopId },
      data: {
        encryptedKkiapayPublicKey: this.crypto.encrypt(input.publicKey.trim()),
        encryptedKkiapayPrivateKey: this.crypto.encrypt(input.privateKey.trim()),
        encryptedKkiapaySecretKey: this.crypto.encrypt(input.secretKey.trim()),
        kkiapaySandbox: credentials.sandbox,
      },
    });
    return { configured: true, mode: "sandbox" as const };
  }

  async acceptWebhook(secretHeader: string | undefined, payload: unknown) {
    if (!secretHeader) throw new ForbiddenException("Signature webhook KKiaPay absente.");
    const webhook = this.kkiapay.parseWebhook(payload);
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: webhook.reference },
      include: { shop: true },
    });
    if (!intent || intent.provider !== "KKIAPAY" || !intent.shop.encryptedKkiapaySecretKey) {
      throw new ForbiddenException("Webhook KKiaPay non associé.");
    }
    const configuredSecret = this.crypto.decrypt(intent.shop.encryptedKkiapaySecretKey);
    if (!verifyKkiapayWebhookSecret(secretHeader, configuredSecret)) throw new ForbiddenException("Signature webhook KKiaPay invalide.");
    const dedupeKey = `${webhook.transactionId}:${webhook.event}`;
    try {
      await this.prisma.paymentWebhook.create({
        data: { dedupeKey, transactionId: webhook.transactionId, event: webhook.event, payload: payload as Prisma.InputJsonValue },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { accepted: true, duplicate: true };
      throw error;
    }
    setTimeout(() => { void this.processPendingWebhooks(); }, 0).unref();
    return { accepted: true };
  }

  async listMyOrders(actor: AuthenticatedUser) {
    return this.prisma.order.findMany({
      where: { buyerId: actor.id },
      orderBy: { createdAt: "desc" },
      include: {
        listing: { select: { slug: true, device: { select: { model: true, capacity: true, imeiEncrypted: true } } } },
        paymentIntents: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, amountXof: true, expiresAt: true } },
        invoice: { select: { invoiceNumber: true, issuedAt: true, provider: true } },
      },
    }).then((orders) => orders.map(({ listing, ...order }) => ({
      ...order,
      listing: {
        slug: listing.slug,
        model: listing.device.model,
        capacity: listing.device.capacity,
      },
    })));
  }

  async getOrder(orderId: string, actor: AuthenticatedUser) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        listing: { include: { device: { select: { model: true, capacity: true, imeiEncrypted: true } } } },
        shop: { select: { ownerId: true, name: true } },
        paymentIntents: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, amountXof: true, expiresAt: true } },
        invoice: { select: { invoiceNumber: true, issuedAt: true, provider: true } },
      },
    });
    if (!order || (order.buyerId !== actor.id && order.shop.ownerId !== actor.id && !actor.roles.includes("ADMIN"))) {
      throw new NotFoundException("Commande introuvable.");
    }
    return {
      id: order.id,
      status: order.status,
      totalXof: order.totalXof,
      commissionXof: order.commissionXof,
      sellerPayableXof: order.sellerPayableXof,
      createdAt: order.createdAt,
      listing: { slug: order.listing.slug, model: order.listing.device.model, capacity: order.listing.device.capacity },
      shopName: order.shop.name,
      paymentIntents: order.paymentIntents,
      invoice: order.invoice,
      ...(actor.id === order.buyerId && order.pickupOtpEncrypted
        ? { pickupCode: this.crypto.decrypt(order.pickupOtpEncrypted) }
        : {}),
    };
  }

  async cancelOrder(orderId: string, actor: AuthenticatedUser) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Commande introuvable.");
    if (order.buyerId !== actor.id) throw new ForbiddenException("Cette commande ne vous appartient pas.");
    if (order.status !== "CREATED" && order.status !== "AWAITING_PAYMENT") throw new BadRequestException("Une commande payée doit faire l’objet d’un remboursement.");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.order.update({ where: { id: orderId }, data: { status: "CANCELLED", activeListingId: null } });
      await transaction.paymentIntent.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "EXPIRED" } });
      await transaction.marketplaceListing.updateMany({
        where: { id: order.listingId, status: "RESERVED" },
        data: { status: "PUBLISHED", reservedUntil: null },
      });
    });
    return { id: orderId, status: "CANCELLED" as const };
  }

  async disputeOrder(orderId: string, actor: AuthenticatedUser) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.buyerId !== actor.id) throw new NotFoundException("Commande introuvable.");
    if (!["PAID", "READY_FOR_PICKUP", "COMPLETED"].includes(order.status)) throw new BadRequestException("Cette commande ne peut pas être signalée comme litigieuse.");
    const changed = await this.prisma.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: "DISPUTED" },
    });
    if (changed.count !== 1) throw new ConflictException("La commande a changé d’état.");
    return { id: orderId, status: "DISPUTED" as const };
  }

  async markReadyForPickup(orderId: string, actor: AuthenticatedUser) {
    const order = await this.getAuthorizedShopOrder(orderId, actor);
    if (order.status !== "PAID") throw new BadRequestException("Seule une commande payée peut être préparée.");
    const code = randomInt(0, 10 ** PICKUP_CODE_DIGITS).toString().padStart(PICKUP_CODE_DIGITS, "0");
    const changed = await this.prisma.order.updateMany({
      where: { id: orderId, status: "PAID" },
      data: {
        status: "READY_FOR_PICKUP",
        pickupOtpHash: this.crypto.hashSecret(`pickup:${orderId}:${code}`),
        pickupOtpEncrypted: this.crypto.encrypt(code),
      },
    });
    if (changed.count !== 1) throw new ConflictException("La commande a changé d’état.");
    return { id: orderId, status: "READY_FOR_PICKUP" as const };
  }

  async verifyPickupImei(orderId: string, imei: string, actor: AuthenticatedUser) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { listing: { include: { device: true } } },
    });
    if (!order || order.buyerId !== actor.id) throw new NotFoundException("Commande introuvable.");
    if (order.status !== "READY_FOR_PICKUP") throw new BadRequestException("L’appareil n’est pas prêt pour le retrait.");
    if (this.crypto.hashImei(imei) !== order.listing.device.imeiHash) throw new BadRequestException("L’IMEI de l’appareil ne correspond pas à la commande.");
    await this.prisma.order.update({ where: { id: orderId }, data: { imeiVerifiedAt: new Date() } });
    return { verified: true };
  }

  async completeHandover(orderId: string, pickupCode: string, actor: AuthenticatedUser) {
    if (!/^\d{6}$/.test(pickupCode)) throw new BadRequestException("Le code de retrait doit contenir 6 chiffres.");
    const order = await this.getAuthorizedShopOrder(orderId, actor);
    if (order.status !== "READY_FOR_PICKUP" || !order.imeiVerifiedAt || !order.pickupOtpHash) {
      throw new BadRequestException("L’acheteur doit vérifier l’IMEI avant la remise.");
    }
    const expected = order.pickupOtpHash;
    const supplied = this.crypto.hashSecret(`pickup:${orderId}:${pickupCode}`);
    if (!constantTimeSecretEquals(supplied, expected)) throw new BadRequestException("Code de retrait invalide.");
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.order.updateMany({
        where: { id: orderId, status: "READY_FOR_PICKUP", completedAt: null },
        data: { status: "COMPLETED", completedAt: new Date(), pickupOtpHash: null, pickupOtpEncrypted: null, activeListingId: null },
      });
      if (changed.count !== 1) throw new ConflictException("La remise de cette commande est déjà enregistrée.");
      if (order.shop.layawayCollector !== "SELLER") {
        const refundedAmountXof = (await transaction.refund.aggregate({
          where: { orderId: order.id, status: "REFUNDED" },
          _sum: { amountXof: true },
        }))._sum.amountXof ?? 0;
        const refundedAllocation = refundedAmountXof > 0
          ? allocateRefund(order.totalXof, order.sellerPayableXof, 0, refundedAmountXof)
          : { sellerRefundXof: 0, platformRefundXof: 0 };
        const remainingHeldXof = order.totalXof - refundedAmountXof;
        await postLedger(transaction, {
          idempotencyKey: `release-held:${order.id}`,
          orderId: order.id,
          description: "Déblocage des fonds après remise confirmée",
          lines: [
            { account: "CUSTOMER_FUNDS_HELD", side: "DEBIT", amountXof: remainingHeldXof },
            ...(order.sellerPayableXof - refundedAllocation.sellerRefundXof > 0
              ? [{ account: "SELLER_PAYABLE" as const, side: "CREDIT" as const, amountXof: order.sellerPayableXof - refundedAllocation.sellerRefundXof }]
              : []),
            ...(order.commissionXof - refundedAllocation.platformRefundXof > 0
              ? [{ account: "PLATFORM_REVENUE" as const, side: "CREDIT" as const, amountXof: order.commissionXof - refundedAllocation.platformRefundXof }]
              : []),
          ],
        });
      }
      await transaction.marketplaceListing.update({ where: { id: order.listingId }, data: { status: "SOLD", reservedUntil: null } });
    });
    return { id: orderId, status: "COMPLETED" as const };
  }

  async requestRefund(orderId: string, amountXof: number, actor: AuthenticatedUser) {
    if (!Number.isSafeInteger(amountXof) || amountXof <= 0) throw new BadRequestException("Le montant du remboursement doit être un entier XOF positif.");
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { paymentIntents: { where: { status: { in: ["SUCCEEDED", "REFUND_FAILED"] } }, orderBy: { createdAt: "desc" }, take: 1 }, refunds: { where: { status: "REFUNDED" } } },
    });
    if (!order) throw new NotFoundException("Commande introuvable.");
    if (order.buyerId !== actor.id && !actor.roles.includes("ADMIN")) throw new ForbiddenException("Cette commande ne vous appartient pas.");
    if (!["PAID", "READY_FOR_PICKUP", "COMPLETED", "DISPUTED"].includes(order.status)) throw new BadRequestException("Cette commande ne peut pas être remboursée.");
    const intent = order.paymentIntents[0];
    if (!intent) throw new BadRequestException("Aucun paiement confirmé n’est associé à la commande.");
    const refund = await this.prisma.$transaction(async (transaction) => {
      const prior = await transaction.refund.aggregate({
        where: { orderId, status: { in: ["PENDING", "REFUNDED", "FAILED"] } },
        _sum: { amountXof: true },
      });
      const refundable = order.totalXof - (prior._sum.amountXof ?? 0);
      if (amountXof > refundable) throw new BadRequestException("Le remboursement dépasse le montant restant.");
      if (intent.provider === "KKIAPAY" && amountXof !== refundable) {
        throw new BadRequestException("KKiaPay ne permet actuellement que le remboursement intégral d’une transaction.");
      }
      return transaction.refund.create({ data: { orderId, paymentIntentId: intent.id, amountXof } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.executeRefund(refund.id);
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id }, select: { id: true, amountXof: true, status: true, failureReason: true } });
  }

  async retryRefund(refundId: string, actor: AuthenticatedUser) {
    if (!actor.roles.includes("ADMIN")) throw new ForbiddenException();
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund || refund.status !== "FAILED") throw new NotFoundException("Aucun remboursement échoué à reprendre.");
    await this.prisma.refund.update({ where: { id: refundId }, data: { status: "PENDING", failureReason: null } });
    await this.executeRefund(refundId);
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId }, select: { id: true, amountXof: true, status: true, failureReason: true } });
  }

  async recordPayout(shopId: string, externalReference: string, amountXof: number, actor: AuthenticatedUser) {
    if (!actor.roles.includes("ADMIN")) throw new ForbiddenException();
    if (!this.config.PLATFORM_COLLECTION_ENABLED) throw new ForbiddenException("Les reversements plateforme sont désactivés.");
    if (!externalReference.trim() || !Number.isSafeInteger(amountXof) || amountXof <= 0) throw new BadRequestException("Référence de paiement et montant XOF valides requis.");
    return this.prisma.$transaction(async (transaction) => {
      const entries = await transaction.ledgerEntry.findMany({
        where: {
          account: "SELLER_PAYABLE",
          transaction: { is: { OR: [{ order: { is: { shopId } } }, { payoutBatch: { is: { shopId } } }] } },
        },
        select: { side: true, amountXof: true },
      });
      const balance = entries.reduce((current, entry) => current + (entry.side === "CREDIT" ? entry.amountXof : -entry.amountXof), 0);
      if (amountXof > balance) throw new BadRequestException("Le reversement dépasse le solde vendeur disponible.");
      const batch = await transaction.payoutBatch.create({
        data: { shopId, amountXof, externalReference: externalReference.trim(), status: "PAID", paidAt: new Date() },
      });
      await postLedger(transaction, {
        idempotencyKey: `payout:${batch.id}`,
        payoutBatchId: batch.id,
        description: "Reversement manuel vendeur",
        lines: [
          { account: "SELLER_PAYABLE", side: "DEBIT", amountXof },
          { account: "PROVIDER_CLEARING", side: "CREDIT", amountXof },
        ],
      });
      return batch;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reconcilePayout(payoutBatchId: string, amountXof: number, externalReference: string, actor: AuthenticatedUser) {
    if (!actor.roles.includes("ADMIN")) throw new ForbiddenException();
    if (!this.config.PLATFORM_COLLECTION_ENABLED) throw new ForbiddenException("Les reversements plateforme sont désactivés.");
    const batch = await this.prisma.payoutBatch.findUnique({ where: { id: payoutBatchId } });
    if (!batch || batch.status !== "PAID") throw new NotFoundException("Reversement en attente de rapprochement introuvable.");
    if (batch.amountXof !== amountXof || batch.externalReference !== externalReference.trim()) {
      throw new BadRequestException("Le montant ou la référence ne correspond pas au reversement enregistré.");
    }
    await this.prisma.payoutBatch.update({ where: { id: payoutBatchId }, data: { status: "RECONCILED" } });
    return { id: payoutBatchId, status: "RECONCILED" as const };
  }

  async reverseLedgerTransaction(transactionId: string, reason: string, actor: AuthenticatedUser) {
    if (!actor.roles.includes("ADMIN")) throw new ForbiddenException();
    if (reason.trim().length < 8 || reason.length > 500) throw new BadRequestException("Une justification de 8 à 500 caractères est requise.");
    return this.prisma.$transaction(async (transaction) => {
      const original = await transaction.ledgerTransaction.findUnique({ where: { id: transactionId }, include: { entries: true } });
      if (!original) throw new NotFoundException("Écriture comptable introuvable.");
      if (await transaction.ledgerTransaction.findFirst({ where: { reversalOfId: transactionId }, select: { id: true } })) {
        throw new ConflictException("Cette écriture a déjà été contrepassée.");
      }
      const reversedLines: LedgerLine[] = original.entries.map((entry) => ({
        account: entry.account,
        side: entry.side === "DEBIT" ? "CREDIT" : "DEBIT",
        amountXof: entry.amountXof,
      }));
      assertBalancedLedger(reversedLines);
      return transaction.ledgerTransaction.create({
        data: {
          idempotencyKey: `reversal:${transactionId}`,
          orderId: original.orderId,
          refundId: original.refundId,
          payoutBatchId: original.payoutBatchId,
          reversalOfId: original.id,
          description: `Contrepassation: ${reason.trim()}`,
          entries: { create: reversedLines },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async exportPayoutCsv(actor: AuthenticatedUser) {
    if (!actor.roles.includes("ADMIN")) throw new ForbiddenException();
    if (!this.config.PLATFORM_COLLECTION_ENABLED) throw new ForbiddenException("Les reversements plateforme sont désactivés.");
    const shopRows = await this.prisma.shop.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
    const balances = await Promise.all(shopRows.map(async (shop) => ({ ...shop, amount: await this.getSellerPayableBalance(shop.id) })));
    const rows = [["shopId", "shopName", "amountXof", "reference"], ...balances
      .filter((shop) => shop.amount > 0)
      .map((shop) => [shop.id, shop.name, String(shop.amount), ""])]
      .map((row) => row.map(csvCell).join(","));
    return rows.join("\r\n");
  }

  async listFailedRefunds(actor: AuthenticatedUser) {
    if (!actor.roles.includes("ADMIN")) throw new ForbiddenException();
    return this.prisma.refund.findMany({ where: { status: "FAILED" }, include: { order: { select: { id: true, shopId: true, totalXof: true } } }, orderBy: { updatedAt: "asc" } });
  }

  async listReconciliationIssues(actor: AuthenticatedUser) {
    if (!actor.roles.includes("ADMIN")) throw new ForbiddenException();
    return this.prisma.paymentIntent.findMany({
      where: { reconciliationIssue: { not: null } },
      select: { id: true, orderId: true, shopId: true, amountXof: true, currency: true, status: true, transactionId: true, reconciliationIssue: true, lastVerifiedAt: true },
      orderBy: { updatedAt: "asc" },
    });
  }

  async listShopOrders(shopId: string, actor: AuthenticatedUser) {
    await this.requireShopAccess(shopId, actor);
    return this.prisma.order.findMany({
      where: { shopId, status: { in: ["PAID", "READY_FOR_PICKUP", "COMPLETED", "DISPUTED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, totalXof: true, sellerPayableXof: true, createdAt: true, imeiVerifiedAt: true, listing: { select: { device: { select: { model: true, capacity: true } } } }, buyer: { select: { phone: true } } },
    });
  }

  private async paymentIntentResponse(
    intent: { id: string; amountXof: number; expiresAt: Date; provider: "KKIAPAY" | "MOCK" },
    shop: { encryptedKkiapayPublicKey: string | null; encryptedKkiapayPrivateKey: string | null; encryptedKkiapaySecretKey: string | null; kkiapaySandbox: boolean },
    phone: string,
    credentials?: MerchantCredentials,
  ) {
    const provider = intent.provider === "MOCK" ? this.mock : this.kkiapay;
    const merchant = credentials ?? (intent.provider === "MOCK" ? this.mockCredentials() : {
      ...this.decryptCredentials(shop),
      publicKey: shop.encryptedKkiapayPublicKey ? this.crypto.decrypt(shop.encryptedKkiapayPublicKey) : "",
      sandbox: shop.kkiapaySandbox,
    });
    const widget = await provider.initiate({ id: intent.id, amountXof: intent.amountXof, expiresAt: intent.expiresAt, buyerPhone: phone }, merchant);
    return {
      id: intent.id,
      amountXof: intent.amountXof,
      currency: "XOF" as const,
      expiresAt: intent.expiresAt,
      provider: intent.provider,
      publicKey: widget.publicKey,
      sandbox: widget.sandbox,
      reference: widget.reference,
      ...(widget.mockTransactionId ? { mockTransactionId: widget.mockTransactionId } : {}),
    };
  }

  private async confirmIntentPayment(
    intent: Prisma.PaymentIntentGetPayload<{
      include: {
        order: true;
        shop: true;
        layawayPlan: {
          include: {
            shop: true;
            buyer: true;
            listing: { include: { device: true } };
            installments: true;
          };
        };
      };
    }>,
    transactionId: string,
  ) {
    if (intent.layawayPlanId) return this.confirmLayawayPayment(intent, transactionId);
    if (!intent.order) throw new NotFoundException("Commande de paiement introuvable.");
    return this.confirmPayment({ ...intent, order: intent.order }, transactionId);
  }

  private async confirmPayment(intent: {
    id: string;
    amountXof: number;
    status: PaymentIntentStatus;
    transactionId: string | null;
    expiresAt: Date;
    provider: "KKIAPAY" | "MOCK";
    shop: { encryptedKkiapayPrivateKey: string | null; encryptedKkiapayPublicKey: string | null; encryptedKkiapaySecretKey: string | null; kkiapaySandbox: boolean; layawayCollector: LayawayCollector };
    order: { id: string; status: OrderStatus; totalXof: number; commissionXof: number; sellerPayableXof: number; listingId: string; shopId: string };
  }, transactionId: string) {
    if (!transactionId.trim() || transactionId.length > 200) throw new BadRequestException("Référence de transaction invalide.");
    if (intent.status === "SUCCEEDED" && intent.transactionId === transactionId) {
      await this.issueInvoice(intent.order);
      return { id: intent.order.id, status: intent.order.status };
    }
    if (intent.status !== "PENDING") throw new ConflictException("Cette intention de paiement n’est plus en attente.");
    if (intent.expiresAt <= new Date()) {
      await this.prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "EXPIRED" } });
      throw new BadRequestException("L’intention de paiement a expiré. Relancez le paiement.");
    }
    const usedTransaction = await this.prisma.paymentIntent.findUnique({ where: { transactionId }, select: { id: true } });
    if (usedTransaction && usedTransaction.id !== intent.id) {
      throw new ConflictException("Cette transaction KKiaPay a déjà été utilisée.");
    }
    const provider = intent.provider === "MOCK" ? this.mock : this.kkiapay;
    const credentials = intent.provider === "MOCK" ? this.mockCredentials() : this.decryptCredentials(intent.shop);
    const verified = await provider.verify(transactionId, credentials);
    if (verified.status === "FAILED") {
      await this.prisma.paymentIntent.updateMany({ where: { id: intent.id, status: "PENDING" }, data: { status: "FAILED", transactionId, lastVerifiedAt: new Date() } });
      return { id: intent.order.id, status: intent.order.status, paymentStatus: "FAILED" as const };
    }
    if (verified.status !== "SUCCESS") {
      await this.prisma.paymentIntent.updateMany({
        where: { id: intent.id, status: "PENDING", OR: [{ transactionId: null }, { transactionId }] },
        data: { transactionId, lastVerifiedAt: new Date() },
      });
      throw new BadRequestException("KKiaPay n’a pas encore confirmé le paiement.");
    }
    try {
      assertPaymentMatchesIntent(intent.amountXof, transactionId, verified);
      if (verified.amountXof !== intent.order.totalXof) throw new BadRequestException("Le montant de la transaction ne correspond pas à la commande.");
    } catch (error) {
      await this.prisma.paymentIntent.updateMany({
        where: { id: intent.id, status: "PENDING" },
        data: { status: "FAILED", transactionId, lastVerifiedAt: new Date(), reconciliationIssue: "Montant, devise ou référence fournisseur incohérents." },
      });
      throw error;
    }
    if (!Number.isSafeInteger(verified.feesXof) || verified.feesXof < 0 || verified.feesXof >= verified.amountXof) {
      throw new BadGatewayException("Les frais renvoyés par le prestataire sont invalides.");
    }
    let recorded: boolean;
    try {
      recorded = await this.recordSuccessfulPayment(intent, verified);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Cette transaction KKiaPay a déjà été utilisée.");
      }
      throw error;
    }
    if (recorded) await this.issueInvoice(intent.order);
    return { id: intent.order.id, status: "PAID" as const, paymentStatus: "SUCCEEDED" as const };
  }

  private async confirmLayawayPayment(intent: Prisma.PaymentIntentGetPayload<{
    include: {
      shop: true;
      layawayPlan: {
        include: {
          shop: true;
          buyer: true;
          listing: { include: { device: true } };
          installments: true;
        };
      };
    };
  }>, transactionId: string) {
    const plan = intent.layawayPlan;
    if (!plan) throw new NotFoundException("Réservation introuvable.");
    if (!transactionId.trim() || transactionId.length > 200) throw new BadRequestException("Référence de transaction invalide.");
    if (intent.status === "SUCCEEDED" && intent.transactionId === transactionId) {
      return { id: plan.id, status: plan.status, paymentStatus: "SUCCEEDED" as const, paidXof: plan.paidXof };
    }
    if (intent.status !== "PENDING") throw new ConflictException("Cette intention de paiement n’est plus en attente.");
    if (intent.expiresAt <= new Date()) {
      await this.prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "EXPIRED" } });
      throw new BadRequestException("L’intention de paiement a expiré. Relancez le versement.");
    }
    const usedTransaction = await this.prisma.paymentIntent.findUnique({ where: { transactionId }, select: { id: true } });
    if (usedTransaction && usedTransaction.id !== intent.id) throw new ConflictException("Cette transaction KKiaPay a déjà été utilisée.");
    const provider = intent.provider === "MOCK" ? this.mock : this.kkiapay;
    const credentials = intent.provider === "MOCK" ? this.mockCredentials() : this.decryptCredentials(intent.shop);
    const verified = await provider.verify(transactionId, credentials);
    if (verified.status === "FAILED") {
      await this.prisma.paymentIntent.updateMany({ where: { id: intent.id, status: "PENDING" }, data: { status: "FAILED", transactionId, lastVerifiedAt: new Date() } });
      return { id: plan.id, status: plan.status, paymentStatus: "FAILED" as const };
    }
    if (verified.status !== "SUCCESS") throw new BadRequestException("Le prestataire n’a pas encore confirmé le versement.");
    assertPaymentMatchesIntent(intent.amountXof, transactionId, verified);
    if (verified.payerPhone && plan.buyer.phone && lastPhoneDigits(verified.payerPhone) !== lastPhoneDigits(plan.buyer.phone)) {
      await this.prisma.layawayRiskAlert.create({
        data: {
          layawayPlanId: plan.id,
          buyerId: plan.buyerId,
          shopId: plan.shopId,
          kind: "MOBILE_MONEY_HOLDER_MISMATCH",
          details: { paymentIntentId: intent.id },
        },
      });
      throw new ConflictException("Le numéro Mobile Money du paiement ne correspond pas au numéro du compte client.");
    }
    if (verified.amountXof >= plan.priceXof || !Number.isSafeInteger(verified.feesXof) || verified.feesXof < 0 || verified.feesXof >= verified.amountXof) {
      throw new BadRequestException("Le montant ou les frais du prestataire ne correspondent pas au versement attendu.");
    }

    const paidAfterXof = plan.paidXof + verified.amountXof;
    if (paidAfterXof > plan.priceXof) throw new ConflictException("Le cumul des versements dépasse le prix figé de la réservation.");
    const fullyPaid = paidAfterXof === plan.priceXof;
    const pickupCode = fullyPaid ? randomInt(0, 10 ** PICKUP_CODE_DIGITS).toString().padStart(PICKUP_CODE_DIGITS, "0") : null;
    const oldStatus = plan.status;
    const startsFromPending = oldStatus === "PENDING_FIRST_PAYMENT";
    const installmentAllocations = allocateLayawayInstallmentPayments(plan.installments, verified.amountXof);
    const allocatedById = new Map(installmentAllocations.map((allocation) => [allocation.id, allocation.amountPaidXof]));
    const stillOverdue = plan.installments.some((installment) => {
      const paidAfter = allocatedById.get(installment.id) ?? installment.amountPaidXof;
      return installment.dueAt < new Date() && paidAfter < installment.amountDueXof;
    });
    const gracePeriodDays = (plan.consentSnapshot as { gracePeriodDays?: number } | null)?.gracePeriodDays ?? 7;
    const nextUnpaidInstallment = [...plan.installments]
      .sort((left, right) => left.sequence - right.sequence)
      .find((installment) => (allocatedById.get(installment.id) ?? installment.amountPaidXof) < installment.amountDueXof);
    const graceEndsAt = nextUnpaidInstallment
      ? new Date(nextUnpaidInstallment.dueAt.getTime() + gracePeriodDays * 24 * 60 * 60_000)
      : plan.graceEndsAt;
    const recoveredFromLate = oldStatus === "LATE" && !stillOverdue;
    const nextStatus = fullyPaid
      ? "READY_FOR_PICKUP"
      : startsFromPending ? "ACTIVE" : recoveredFromLate ? "ACTIVE" : oldStatus;
    if (fullyPaid) {
      const completedFrom = startsFromPending ? "ACTIVE" : oldStatus;
      if (startsFromPending) assertLayawayTransition(oldStatus, "ACTIVE");
      assertLayawayTransition(completedFrom, "COMPLETED");
      assertLayawayTransition("COMPLETED", "READY_FOR_PICKUP");
    } else if (startsFromPending) {
      assertLayawayTransition(oldStatus, "ACTIVE");
    } else if (recoveredFromLate) {
      assertLayawayTransition(oldStatus, "ACTIVE");
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.paymentIntent.updateMany({
          where: { id: intent.id, status: "PENDING", expiresAt: { gt: new Date() }, OR: [{ transactionId: null }, { transactionId }] },
          data: { status: "SUCCEEDED", transactionId, providerFeesXof: verified.feesXof, lastVerifiedAt: new Date() },
        });
        if (claimed.count !== 1) {
          const current = await transaction.paymentIntent.findUnique({ where: { id: intent.id } });
          if (current?.status === "SUCCEEDED" && current.transactionId === transactionId) return false;
          throw new ConflictException("Ce versement a déjà été traité ou a expiré.");
        }
        const planUpdate = await transaction.layawayPlan.updateMany({
          where: { id: plan.id, status: oldStatus, paidXof: plan.paidXof },
          data: {
            paidXof: { increment: verified.amountXof },
            status: nextStatus,
            ...(plan.startedAt ? {} : { startedAt: new Date() }),
            graceEndsAt,
            ...(fullyPaid && pickupCode ? {
              pickupOtpHash: this.crypto.hashSecret(`layaway-pickup:${plan.id}:${pickupCode}`),
              pickupOtpEncrypted: this.crypto.encrypt(pickupCode),
              pickupOtpExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
            } : {}),
          },
        });
        if (planUpdate.count !== 1) throw new ConflictException("La réservation a changé pendant la confirmation.");

        for (const allocation of installmentAllocations) {
          await transaction.installment.update({
            where: { id: allocation.id },
            data: {
              amountPaidXof: allocation.amountPaidXof,
              status: allocation.paid ? "PAID" : "PARTIALLY_PAID",
              ...(allocation.paid ? { paidAt: new Date() } : {}),
            },
          });
        }
        if (plan.buyer.phone) {
          const message = `Versement confirmé : ${verified.amountXof} XOF. Reste à payer : ${plan.priceXof - paidAfterXof} XOF. Suivi et paiement : ${this.config.WEB_ORIGIN}/compte/reservations`;
          await transaction.layawayNotification.createMany({
            data: ["SMS", "WHATSAPP"].map((channel) => ({
              layawayPlanId: plan.id,
              idempotencyKey: `payment-confirmation:${intent.id}:${channel}`,
              channel: channel as "SMS" | "WHATSAPP",
              recipient: plan.buyer.phone!,
              message,
              scheduledFor: new Date(),
            })),
            skipDuplicates: true,
          });
        }

        const ledgerLines: LedgerLine[] = [
          { account: "PROVIDER_CLEARING", side: "DEBIT", amountXof: verified.amountXof - verified.feesXof },
          ...(verified.feesXof ? [{ account: "PROVIDER_FEES" as const, side: "DEBIT" as const, amountXof: verified.feesXof }] : []),
          { account: plan.shop.layawayCollector === "SELLER" ? "SELLER_PAYABLE" : "CUSTOMER_FUNDS_HELD", side: "CREDIT", amountXof: verified.amountXof },
        ];
        await postLedger(transaction, {
          idempotencyKey: `layaway-payment:${intent.id}`,
          layawayPlanId: plan.id,
          description: `Versement ${verified.amountXof} XOF confirmé`,
          lines: ledgerLines,
        });

        const completionFrom: typeof oldStatus = startsFromPending ? "ACTIVE" : oldStatus;
        if (startsFromPending) {
          await transaction.layawayEvent.create({ data: { layawayPlanId: plan.id, type: "FIRST_PAYMENT_CONFIRMED", fromStatus: oldStatus, toStatus: "ACTIVE" } });
        }
        if (fullyPaid) {
          await transaction.layawayEvent.createMany({ data: [
            { layawayPlanId: plan.id, type: "BALANCE_PAID", fromStatus: completionFrom, toStatus: "COMPLETED" },
            { layawayPlanId: plan.id, type: "PICKUP_READY", fromStatus: "COMPLETED", toStatus: "READY_FOR_PICKUP" },
          ] });
        } else {
          await transaction.layawayEvent.create({ data: { layawayPlanId: plan.id, type: "INSTALLMENT_PAID", fromStatus: oldStatus, toStatus: nextStatus, details: { amountXof: verified.amountXof, paidAfterXof } } });
        }
        const reservation = await transaction.marketplaceListing.updateMany({
          where: { id: plan.listingId, status: "RESERVED" },
          data: { reservedUntil: graceEndsAt },
        });
        if (reservation.count !== 1) throw new ConflictException("Le stock réservé n’est plus disponible.");
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Cette transaction KKiaPay a déjà été utilisée.");
      }
      throw error;
    }
    return { id: plan.id, status: nextStatus, paymentStatus: "SUCCEEDED" as const, paidXof: paidAfterXof };
  }

  private async recordSuccessfulPayment(intent: {
    id: string;
    amountXof: number;
    shop: { layawayCollector: LayawayCollector };
    order: { id: string; status: OrderStatus; totalXof: number; commissionXof: number; sellerPayableXof: number; listingId: string; shopId: string };
  }, payment: VerifiedTransaction) {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.paymentIntent.updateMany({
        where: { id: intent.id, status: "PENDING", expiresAt: { gt: new Date() }, OR: [{ transactionId: null }, { transactionId: payment.transactionId }] },
        data: { status: "SUCCEEDED", transactionId: payment.transactionId, providerFeesXof: payment.feesXof, lastVerifiedAt: new Date() },
      });
      if (claimed.count !== 1) {
        const current = await transaction.paymentIntent.findUnique({ where: { id: intent.id } });
        if (current?.status === "SUCCEEDED" && current.transactionId === payment.transactionId) return false;
        throw new ConflictException("Le paiement a déjà été traité ou a expiré.");
      }
      const paid = await transaction.order.updateMany({ where: { id: intent.order.id, status: "AWAITING_PAYMENT" }, data: { status: "PAID" } });
      if (paid.count !== 1) throw new ConflictException("La commande n’attend plus ce paiement.");
      const clearingXof = payment.amountXof - payment.feesXof;
      const lines: LedgerLine[] = [
        { account: "PROVIDER_CLEARING", side: "DEBIT", amountXof: clearingXof },
        ...(payment.feesXof ? [{ account: "PROVIDER_FEES" as const, side: "DEBIT" as const, amountXof: payment.feesXof }] : []),
        ...(intent.shop.layawayCollector === "SELLER"
          ? [
              { account: "SELLER_PAYABLE" as const, side: "CREDIT" as const, amountXof: intent.order.sellerPayableXof },
              { account: "PLATFORM_REVENUE" as const, side: "CREDIT" as const, amountXof: intent.order.commissionXof },
            ]
          : [{ account: "CUSTOMER_FUNDS_HELD" as const, side: "CREDIT" as const, amountXof: intent.order.totalXof }]),
      ];
      await postLedger(transaction, {
        idempotencyKey: `payment:${intent.id}`,
        orderId: intent.order.id,
        description: "Paiement de commande confirmé par KKiaPay",
        lines,
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async issueInvoice(order: { id: string; totalXof: number }) {
    if (await this.prisma.invoice.findUnique({ where: { orderId: order.id } })) return;
    const details = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { shop: { select: { name: true } } } });
    const invoice = await this.invoiceProvider.issue({ orderId: order.id, amountXof: order.totalXof, shopName: details.shop.name });
    try {
      await this.prisma.invoice.create({
        data: { orderId: order.id, providerRef: invoice.reference, invoiceNumber: invoice.invoiceNumber },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && await this.prisma.invoice.findUnique({ where: { orderId: order.id } })) return;
      throw error;
    }
  }

  private async processPendingWebhooks(): Promise<void> {
    if (this.processingWebhooks) return;
    this.processingWebhooks = true;
    try {
      for (let count = 0; count < 10; count += 1) {
        const webhook = await this.prisma.paymentWebhook.findFirst({
          where: { processedAt: null, attempts: { lt: 10 } },
          orderBy: { createdAt: "asc" },
        });
        if (!webhook) break;
        try {
          const parsed = this.kkiapay.parseWebhook(webhook.payload);
          const intent = await this.prisma.paymentIntent.findUnique({
            where: { id: parsed.reference },
            include: {
              order: true,
              shop: true,
              layawayPlan: { include: { shop: true, buyer: true, listing: { include: { device: true } }, installments: true } },
            },
          });
          if (intent) await this.confirmIntentPayment(intent, parsed.transactionId);
          await this.prisma.paymentWebhook.update({ where: { id: webhook.id }, data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
        } catch (error) {
          await this.prisma.paymentWebhook.update({
            where: { id: webhook.id },
            data: { attempts: { increment: 1 }, lastError: error instanceof Error ? error.message.slice(0, 500) : "Erreur inconnue" },
          });
          break;
        }
      }
    } finally {
      this.processingWebhooks = false;
    }
  }

  private async reconcilePayments(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.paymentIntent.findMany({
      where: { status: "PENDING", expiresAt: { lte: now } },
      select: { id: true, orderId: true, order: { select: { listingId: true } } },
      take: 50,
      orderBy: { expiresAt: "asc" },
    });
    for (const intent of expired) {
      await this.prisma.$transaction(async (transaction) => {
        const changed = await transaction.paymentIntent.updateMany({
          where: { id: intent.id, status: "PENDING", expiresAt: { lte: now } },
          data: { status: "EXPIRED" },
        });
        if (changed.count !== 1) return;
        if (intent.orderId && intent.order) {
          await transaction.order.updateMany({
            where: { id: intent.orderId, status: "AWAITING_PAYMENT" },
            data: { status: "CANCELLED", activeListingId: null },
          });
          await transaction.marketplaceListing.updateMany({
            where: { id: intent.order.listingId, status: "RESERVED" },
            data: { status: "PUBLISHED", reservedUntil: null },
          });
        }
      });
    }

    const pending = await this.prisma.paymentIntent.findMany({
      where: {
        status: "PENDING",
        transactionId: { not: null },
        expiresAt: { gt: now },
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lte: new Date(now.getTime() - 60_000) } }],
      },
      include: {
        order: true,
        shop: true,
        layawayPlan: { include: { shop: true, buyer: true, listing: { include: { device: true } }, installments: true } },
      },
      take: 50,
      orderBy: { createdAt: "asc" },
    });
    for (const intent of pending) {
      try {
        const provider = intent.provider === "MOCK" ? this.mock : this.kkiapay;
        const credentials = intent.provider === "MOCK" ? this.mockCredentials() : this.decryptCredentials(intent.shop);
        const latest = await provider.verify(intent.transactionId!, credentials);
        if (latest.status === "SUCCESS") {
          await this.confirmIntentPayment(intent, latest.transactionId);
        } else if (latest.status === "FAILED") {
          await this.prisma.paymentIntent.updateMany({
            where: { id: intent.id, status: "PENDING" },
            data: { status: "FAILED", transactionId: latest.transactionId, lastVerifiedAt: now },
          });
        } else {
          await this.prisma.paymentIntent.updateMany({
            where: { id: intent.id, status: "PENDING" },
            data: { lastVerifiedAt: now },
          });
        }
      } catch (error) {
        await this.prisma.paymentIntent.updateMany({
          where: { id: intent.id, status: "PENDING" },
          data: {
            lastVerifiedAt: now,
            reconciliationIssue: error instanceof Error ? error.message.slice(0, 500) : "Réconciliation échouée.",
          },
        });
      }
    }

    const recentlyPaid = await this.prisma.paymentIntent.findMany({
      where: {
        status: "SUCCEEDED",
        transactionId: { not: null },
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lte: new Date(now.getTime() - 24 * 60 * 60_000) } }],
      },
      include: { order: true, shop: true },
      take: 50,
      orderBy: { lastVerifiedAt: "asc" },
    });
    for (const intent of recentlyPaid) {
      try {
        const ledger = await this.prisma.ledgerTransaction.findUnique({
          where: { idempotencyKey: `payment:${intent.id}` },
          include: { entries: true },
        });
        if (!ledger || ledger.entries.reduce((sum, entry) => sum + (entry.side === "DEBIT" ? entry.amountXof : -entry.amountXof), 0) !== 0) {
          await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: { reconciliationIssue: "Écart entre paiement confirmé et ledger." },
          });
          continue;
        }
        const provider = intent.provider === "MOCK" ? this.mock : this.kkiapay;
        const credentials = intent.provider === "MOCK" ? this.mockCredentials() : this.decryptCredentials(intent.shop);
        const latest = await provider.verify(intent.transactionId!, credentials);
        if (latest.status !== "SUCCESS" || latest.amountXof !== intent.amountXof || latest.currency !== "XOF") {
          await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: { reconciliationIssue: "Le statut ou le montant KKiaPay diverge du paiement enregistré." },
          });
        } else {
          await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: { lastVerifiedAt: now, reconciliationIssue: null },
          });
        }
      } catch (error) {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { reconciliationIssue: error instanceof Error ? error.message.slice(0, 500) : "Réconciliation échouée." },
        });
      }
    }
  }

  private async executeRefund(refundId: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { order: { include: { shop: true, refunds: { where: { status: "REFUNDED" } } } }, paymentIntent: true },
    });
    if (!refund) throw new NotFoundException("Remboursement introuvable.");
    await this.prisma.paymentIntent.updateMany({
      where: { id: refund.paymentIntentId, status: { in: ["SUCCEEDED", "REFUND_FAILED"] } },
      data: { status: "REFUND_PENDING", refundFailureReason: null },
    });
    const provider = refund.paymentIntent.provider === "MOCK" ? this.mock : this.kkiapay;
    const credentials = provider.kind === "MOCK" ? this.mockCredentials() : this.decryptCredentials(refund.order.shop);
    let result: { succeeded: boolean; reference?: string; reason?: string };
    try {
      result = await provider.refund(refund.paymentIntent.transactionId ?? "", refund.amountXof, credentials);
    } catch (error) {
      result = { succeeded: false, reason: error instanceof Error ? error.message : "Échec de communication avec le prestataire." };
    }
    if (!result.succeeded) {
      await this.prisma.$transaction([
        this.prisma.refund.update({ where: { id: refundId }, data: { status: "FAILED", failureReason: result.reason ?? "Remboursement refusé." } }),
        this.prisma.paymentIntent.update({ where: { id: refund.paymentIntentId }, data: { status: "REFUND_FAILED", refundFailureReason: result.reason ?? "Remboursement refusé." } }),
      ]);
      return;
    }

    const amountBefore = refund.order.refunds.reduce((sum, previous) => sum + previous.amountXof, 0);
    const amountAfter = amountBefore + refund.amountXof;
    const { sellerRefundXof: sellerRefund, platformRefundXof: platformRefund } =
      allocateRefund(refund.order.totalXof, refund.order.sellerPayableXof, amountBefore, refund.amountXof);
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.refund.updateMany({
        where: { id: refundId, status: "PENDING" },
        data: { status: "REFUNDED", providerReference: result.reference, failureReason: null },
      });
      if (changed.count !== 1) return;
      await transaction.paymentIntent.update({ where: { id: refund.paymentIntentId }, data: { status: amountAfter === refund.order.totalXof ? "REFUNDED" : "SUCCEEDED", refundFailureReason: null } });
      await postLedger(transaction, {
        idempotencyKey: `refund:${refundId}`,
        orderId: refund.orderId,
        refundId,
        description: "Remboursement confirmé par le prestataire",
        lines: [
          ...(refund.order.shop.layawayCollector !== "SELLER" && !refund.order.completedAt
            ? [{ account: "CUSTOMER_FUNDS_HELD" as const, side: "DEBIT" as const, amountXof: refund.amountXof }]
            : [
                ...(sellerRefund ? [{ account: "SELLER_PAYABLE" as const, side: "DEBIT" as const, amountXof: sellerRefund }] : []),
                ...(platformRefund ? [{ account: "PLATFORM_REVENUE" as const, side: "DEBIT" as const, amountXof: platformRefund }] : []),
              ]),
          { account: "PROVIDER_CLEARING", side: "CREDIT", amountXof: refund.amountXof },
        ],
      });
      if (amountAfter === refund.order.totalXof) {
        await transaction.order.update({ where: { id: refund.orderId }, data: { status: "REFUNDED", activeListingId: null } });
        await transaction.marketplaceListing.updateMany({
          where: { id: refund.order.listingId, status: "RESERVED" },
          data: { status: "PUBLISHED", reservedUntil: null },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async getAuthorizedShopOrder(orderId: string, actor: AuthenticatedUser) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shop: true } });
    if (!order) throw new NotFoundException("Commande introuvable.");
    await this.requireShopAccess(order.shopId, actor);
    return order;
  }

  private async requireShopAccess(shopId: string, actor: AuthenticatedUser) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }] },
      select: { id: true },
    });
    if (!shop) throw new ForbiddenException("Vous n’êtes pas membre de cette boutique.");
    return shop;
  }

  private getProvider(): PaymentProvider {
    return this.config.PAYMENT_PROVIDER === "mock" ? this.mock : this.kkiapay;
  }

  private decryptCredentials(shop: { encryptedKkiapayPublicKey: string | null; encryptedKkiapayPrivateKey: string | null; encryptedKkiapaySecretKey: string | null; kkiapaySandbox: boolean }): MerchantCredentials {
    if (!shop.encryptedKkiapayPublicKey || !shop.encryptedKkiapayPrivateKey || !shop.encryptedKkiapaySecretKey) {
      throw new BadRequestException("Configurez les identifiants KKiaPay de la boutique avant d’encaisser.");
    }
    return {
      publicKey: this.crypto.decrypt(shop.encryptedKkiapayPublicKey),
      privateKey: this.crypto.decrypt(shop.encryptedKkiapayPrivateKey),
      secretKey: this.crypto.decrypt(shop.encryptedKkiapaySecretKey),
      sandbox: shop.kkiapaySandbox,
    };
  }

  private mockCredentials(): MerchantCredentials {
    return { publicKey: "mock-public-key", privateKey: "mock-private-key", secretKey: "mock-secret-key", sandbox: true };
  }

  private async getSellerPayableBalance(shopId: string) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        account: "SELLER_PAYABLE",
        transaction: { is: { OR: [{ order: { is: { shopId } } }, { payoutBatch: { is: { shopId } } }] } },
      },
      select: { side: true, amountXof: true },
    });
    return entries.reduce((balance, entry) => balance + (entry.side === "CREDIT" ? entry.amountXof : -entry.amountXof), 0);
  }
}

async function postLedger(
  transaction: Prisma.TransactionClient,
  input: { idempotencyKey: string; orderId?: string; refundId?: string; payoutBatchId?: string; layawayPlanId?: string; description: string; lines: LedgerLine[] },
) {
  assertBalancedLedger(input.lines);
  await transaction.ledgerTransaction.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      orderId: input.orderId,
      refundId: input.refundId,
      payoutBatchId: input.payoutBatchId,
      layawayPlanId: input.layawayPlanId,
      description: input.description,
      entries: { create: input.lines },
    },
  });
}

export function verifyKkiapayWebhookSecret(supplied: string, expected: string): boolean {
  return constantTimeSecretEquals(supplied, expected);
}

function constantTimeSecretEquals(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (suppliedBytes.length !== expectedBytes.length) {
    const padded = Buffer.alloc(expectedBytes.length);
    suppliedBytes.copy(padded, 0, 0, Math.min(suppliedBytes.length, padded.length));
    timingSafeEqual(padded, expectedBytes);
    return false;
  }

  return timingSafeEqual(suppliedBytes, expectedBytes);
}

function lastPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-8);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
