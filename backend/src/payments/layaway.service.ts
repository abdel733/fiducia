import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LayawayPlanStatus, LayawayPlanType, Prisma, UserRole } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import sharp from "sharp";
import { AuthenticatedUser } from "../auth/auth.types";
import { APP_CONFIG, AppConfig } from "../config/config";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../database/prisma.service";
import { ImeiVerificationService } from "../imei/imei-verification.service";
import { REDIS_CLIENT } from "../redis/redis.module";
import { StorageProvider } from "../storage/storage.provider";
import { InvoiceProvider, MockEMecefInvoiceProvider } from "./invoice.provider";
import { assertLayawayTransition, canTransitionLayaway } from "./layaway-state";
import { PaymentsService, assertBalancedLedger, LedgerLine } from "./payments.service";

export { assertLayawayTransition, canTransitionLayaway } from "./layaway-state";

const DAY_MS = 24 * 60 * 60_000;
const CONSENT_POLICY_VERSION = "layaway-v1";
const ACTIVE_STATUSES: LayawayPlanStatus[] = ["PENDING_FIRST_PAYMENT", "ACTIVE", "LATE", "COMPLETED", "READY_FOR_PICKUP", "DISPUTED"];

export function allocateLayawaySchedule(
  priceXof: number,
  start: Date,
  type: LayawayPlanType,
  flexDurationDays = 60,
  fixedPercentages: number[] = [40, 30, 30],
) {
  if (!Number.isSafeInteger(priceXof) || priceXof <= 0) throw new BadRequestException("Le prix doit être un entier positif en XOF.");
  if (type === "FLEX") {
    if (![60, 90].includes(flexDurationDays)) throw new BadRequestException("La durée FLEX doit être de 60 ou 90 jours.");
    return [{ sequence: 1, amountDueXof: priceXof, dueAt: new Date(start.getTime() + flexDurationDays * DAY_MS) }];
  }
  if (fixedPercentages.length !== 3 || fixedPercentages.reduce((sum, value) => sum + value, 0) !== 100) {
    throw new BadRequestException("Les pourcentages FIXED_3 doivent totaliser 100 %.");
  }
  const first = Math.floor(priceXof * fixedPercentages[0]! / 100);
  const second = Math.floor(priceXof * fixedPercentages[1]! / 100);
  return [
    { sequence: 1, amountDueXof: first, dueAt: start },
    { sequence: 2, amountDueXof: second, dueAt: new Date(start.getTime() + 30 * DAY_MS) },
    { sequence: 3, amountDueXof: priceXof - first - second, dueAt: new Date(start.getTime() + 60 * DAY_MS) },
  ];
}

export function calculateBuyerCancellationRefund(paidXof: number, feeBps: number, feeCapXof: number) {
  if (!Number.isSafeInteger(paidXof) || paidXof < 0
    || !Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 10_000
    || !Number.isSafeInteger(feeCapXof) || feeCapXof < 0) {
    throw new BadRequestException("Paramètres de remboursement d’annulation invalides.");
  }
  const feeXof = Math.min(feeCapXof, Math.floor(paidXof * feeBps / 10_000));
  return { feeXof, refundAmountXof: paidXof - feeXof };
}

@Injectable()
export class LayawayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LayawayService.name);
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly payments: PaymentsService,
    private readonly imeiVerification: ImeiVerificationService,
    private readonly storage: StorageProvider,
    @Inject(MockEMecefInvoiceProvider) private readonly invoiceProvider: InvoiceProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const queueConnection = this.redis.duplicate({ maxRetriesPerRequest: null });
    const workerConnection = this.redis.duplicate({ maxRetriesPerRequest: null });
    this.queue = new Queue("fiducia-layaway", { connection: queueConnection });
    this.worker = new Worker("fiducia-layaway", () => this.processScheduledJobs(), {
      connection: workerConnection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, error) => this.logger.error(`Layaway job ${job?.id ?? "unknown"} failed`, error.stack));
    this.worker.on("error", (error) => this.logger.error("Layaway worker connection failed", error.stack));
    void this.queue.upsertJobScheduler("layaway-sweep", { every: 15 * 60_000 }, { name: "sweep", data: {} })
      .catch((error: unknown) => this.logger.error("Unable to schedule layaway jobs", error instanceof Error ? error.stack : String(error)));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.worker?.close(), this.queue?.close()]);
  }

  async getSettings() {
    return this.settings();
  }

  async getAdminSettings(actor: AuthenticatedUser) {
    this.requireAdmin(actor);
    return this.settings();
  }

  async updateSettings(input: Partial<{
    fixed3Enabled: boolean;
    fixed3Percentages: number[];
    flexEnabled: boolean;
    flexMinFirstPaymentPercent: number;
    flexDefaultDurationDays: number;
    flexAllowedDurationDays: number[];
    gracePeriodDays: number;
    extensionDays: number;
    buyerActivePlanLimit: number;
    shopActivePlanLimit: number | null;
    newAccountExposureCapXof: number;
    newAccountAgeDays: number;
    buyerCancellationFeeBps: number;
    buyerCancellationFeeCapXof: number;
    sellerCancellationFeeXof: number;
    sellerRefundSlaHours: number;
    guaranteeEnabled: boolean;
  }>, actor: AuthenticatedUser) {
    this.requireAdmin(actor);
    const current = await this.settings();
    validateSettings({ ...current, ...input });
    if (input.guaranteeEnabled === true) {
      throw new BadRequestException("La garantie Fiducia reste désactivée jusqu’à validation de sa forme juridique et accord d’un assureur partenaire.");
    }
    return this.prisma.layawaySettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...input },
      update: input,
    });
  }

  async quote(listingSlug: string) {
    const [settings, listing] = await Promise.all([
      this.settings(),
      this.prisma.marketplaceListing.findUnique({
        where: { slug: listingSlug },
        select: { priceCashXof: true, paymentOptions: true, status: true, shop: { select: { name: true, whatsapp: true } } },
      }),
    ]);
    if (!listing) throw new NotFoundException("Annonce introuvable.");
    const start = new Date();
    return {
      priceXof: listing.priceCashXof,
      shop: listing.shop,
      available: listing.status === "PUBLISHED" && listing.paymentOptions.includes("INSTALLMENT_A"),
      plans: [
        ...(settings.fixed3Enabled ? [{
          type: "FIXED_3" as const,
          durationDays: 60,
          schedule: allocateLayawaySchedule(listing.priceCashXof, start, "FIXED_3", 60, settings.fixed3Percentages),
          firstPaymentMinimumXof: allocateLayawaySchedule(listing.priceCashXof, start, "FIXED_3", 60, settings.fixed3Percentages)[0]!.amountDueXof,
        }] : []),
        ...(settings.flexEnabled ? settings.flexAllowedDurationDays.map((durationDays) => ({
          type: "FLEX" as const,
          durationDays,
          schedule: allocateLayawaySchedule(listing.priceCashXof, start, "FLEX", durationDays),
          firstPaymentMinimumXof: Math.ceil(listing.priceCashXof * settings.flexMinFirstPaymentPercent / 100),
        })) : []),
      ],
      cancellation: {
        policy: "Annulation client : remboursement des sommes versées, diminuées de frais raisonnables et plafonnés. Annulation vendeur ou téléphone indisponible : remboursement intégral et pénalité vendeur.",
        buyerFeeBps: settings.buyerCancellationFeeBps,
        buyerFeeCapXof: settings.buyerCancellationFeeCapXof,
        sellerRefundSlaHours: settings.sellerRefundSlaHours,
      },
      gracePeriodDays: settings.gracePeriodDays,
      extensionDays: settings.extensionDays,
      buyerActivePlanLimit: settings.buyerActivePlanLimit,
      newAccountExposureCapXof: settings.newAccountExposureCapXof,
      guaranteeEnabled: settings.guaranteeEnabled,
      guaranteeNotice: "La garantie Fiducia est désactivée par défaut; sa forme juridique doit être validée avec un assureur partenaire.",
      termsVersion: CONSENT_POLICY_VERSION,
    };
  }

  async createPlan(input: {
    listingSlug: string;
    type: LayawayPlanType;
    durationDays?: number;
    firstPaymentXof: number;
    acceptedPolicy: boolean;
    acceptedPolicyVersion: string;
  }, actor: AuthenticatedUser) {
    if (input.acceptedPolicy !== true || input.acceptedPolicyVersion !== CONSENT_POLICY_VERSION) {
      throw new BadRequestException("Le récapitulatif et la politique doivent être acceptés avant le premier versement.");
    }
    const settings = await this.settings();
    if (input.type === "FIXED_3" && !settings.fixed3Enabled) throw new BadRequestException("Le plan FIXED_3 n’est pas disponible.");
    if (input.type === "FLEX" && !settings.flexEnabled) throw new BadRequestException("Le plan FLEX n’est pas disponible.");
    const durationDays = input.type === "FIXED_3" ? 60 : input.durationDays ?? settings.flexDefaultDurationDays;
    if (input.type === "FLEX" && !settings.flexAllowedDurationDays.includes(durationDays)) throw new BadRequestException("Durée FLEX non autorisée.");
    if (!Number.isSafeInteger(input.firstPaymentXof) || input.firstPaymentXof <= 0) throw new BadRequestException("Le premier versement doit être un entier XOF positif.");

    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { slug: input.listingSlug },
      include: { shop: true, device: true, certificate: true },
    });
    if (!listing || listing.status !== "PUBLISHED" || listing.shop.status !== "VERIFIED") throw new ConflictException("Cette annonce n’est plus disponible.");
    if (!listing.paymentOptions.includes("INSTALLMENT_A")) throw new BadRequestException("Cette annonce n’accepte pas la réservation en plusieurs fois.");
    if (!listing.certificate || listing.certificate.status !== "ACTIVE") throw new BadRequestException("Un certificat actif est requis.");
    if (listing.shop.ownerId === actor.id) throw new BadRequestException("Vous ne pouvez pas réserver votre propre annonce.");
    if (input.firstPaymentXof >= listing.priceCashXof) throw new BadRequestException("Le premier versement doit rester inférieur au prix total.");

    const start = new Date();
    const schedule = allocateLayawaySchedule(listing.priceCashXof, start, input.type, durationDays, settings.fixed3Percentages);
    const firstPaymentMinimumXof = input.type === "FIXED_3"
      ? schedule[0]!.amountDueXof
      : Math.ceil(listing.priceCashXof * settings.flexMinFirstPaymentPercent / 100);
    if (input.firstPaymentXof < firstPaymentMinimumXof) throw new BadRequestException(`Le premier versement minimum est de ${firstPaymentMinimumXof} XOF.`);

    const buyer = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, createdAt: true } });
    if (!buyer) throw new NotFoundException("Compte client introuvable.");
    const dueAt = schedule[schedule.length - 1]!.dueAt;
    const graceEndsAt = new Date(schedule[0]!.dueAt.getTime() + settings.gracePeriodDays * DAY_MS);
    const consentSnapshot = {
      type: input.type,
      priceXof: listing.priceCashXof,
      durationDays,
      firstPaymentMinimumXof,
      schedule: schedule.map(({ sequence, amountDueXof, dueAt: date }) => ({ sequence, amountDueXof, dueAt: date.toISOString() })),
      cancellationFeeBps: settings.buyerCancellationFeeBps,
      cancellationFeeCapXof: settings.buyerCancellationFeeCapXof,
      refundSlaHours: settings.sellerRefundSlaHours,
      gracePeriodDays: settings.gracePeriodDays,
      feesAndInterestXof: 0,
      assignmentAllowed: false,
      certificate: {
        id: listing.certificate.id,
        code: listing.certificate.code,
        imeiHash: listing.certificate.imeiHash,
        model: listing.certificate.model,
      },
    };
    const plan = await this.prisma.$transaction(async (transaction) => {
      const activeBuyerPlans = await transaction.layawayPlan.count({ where: { buyerId: actor.id, status: { in: ACTIVE_STATUSES } } });
      const activeBuyerOrders = await transaction.order.count({ where: { buyerId: actor.id, status: { in: ["CREATED", "AWAITING_PAYMENT", "PAID", "READY_FOR_PICKUP"] } } });
      if (activeBuyerPlans + activeBuyerOrders >= settings.buyerActivePlanLimit) throw new ConflictException("Vous avez déjà atteint votre limite de commandes et réservations simultanées.");
      if (settings.shopActivePlanLimit !== null) {
        const activeShopPlans = await transaction.layawayPlan.count({ where: { shopId: listing.shopId, status: { in: ACTIVE_STATUSES } } });
        if (activeShopPlans >= settings.shopActivePlanLimit) throw new ConflictException("Cette boutique a atteint sa limite de réservations actives.");
      }
      if (Date.now() - buyer.createdAt.getTime() <= settings.newAccountAgeDays * DAY_MS) {
        const activeExposure = await transaction.layawayPlan.aggregate({
          where: { buyerId: actor.id, status: { in: ACTIVE_STATUSES } },
          _sum: { priceXof: true },
        });
        const activeOrderExposure = await transaction.order.aggregate({
          where: { buyerId: actor.id, status: { in: ["CREATED", "AWAITING_PAYMENT", "PAID", "READY_FOR_PICKUP"] } },
          _sum: { totalXof: true },
        });
        if ((activeExposure._sum.priceXof ?? 0) + (activeOrderExposure._sum.totalXof ?? 0) + listing.priceCashXof > settings.newAccountExposureCapXof) {
          throw new ConflictException("Le plafond de réservation pour un nouveau compte serait dépassé.");
        }
      }
      const reserved = await transaction.marketplaceListing.updateMany({
        where: { id: listing.id, status: "PUBLISHED" },
        data: { status: "RESERVED", reservedUntil: graceEndsAt },
      });
      if (reserved.count !== 1) throw new ConflictException("Cette annonce vient d’être réservée.");
      const registryEntry = await transaction.imeiRegistryEntry.findUnique({ where: { imeiHash: listing.device.imeiHash } });
      if (registryEntry) {
        const registryReserved = await transaction.imeiRegistryEntry.updateMany({
          where: { imeiHash: listing.device.imeiHash, status: "CERTIFIED" },
          data: { status: "UNDER_RESERVATION", reason: "Réservation Fiducia non cessible.", changedById: actor.id },
        });
        if (registryReserved.count !== 1) throw new ConflictException("L’IMEI n’est plus disponible pour cette réservation.");
      } else {
        await transaction.imeiRegistryEntry.create({
          data: { imeiHash: listing.device.imeiHash, status: "UNDER_RESERVATION", reason: "Réservation Fiducia non cessible.", changedById: actor.id },
        });
      }
      const created = await transaction.layawayPlan.create({
        data: {
          listingId: listing.id,
          shopId: listing.shopId,
          buyerId: actor.id,
          type: input.type,
          status: "PENDING_FIRST_PAYMENT",
          priceXof: listing.priceCashXof,
          dueAt,
          graceEndsAt,
          consentAt: new Date(),
          consentPolicyVersion: CONSENT_POLICY_VERSION,
          consentSnapshot,
          installments: { create: schedule },
        },
      });
      await transaction.layawayEvent.create({ data: { layawayPlanId: created.id, actorId: actor.id, type: "CONSENT_ACCEPTED_AND_RESERVED", fromStatus: "DRAFT", toStatus: "PENDING_FIRST_PAYMENT", details: consentSnapshot } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const payment = await this.payments.createLayawayPaymentIntent(plan.id, input.firstPaymentXof, actor);
    return { plan: this.safePlan(plan), payment };
  }

  async getMyPlans(actor: AuthenticatedUser) {
    const plans = await this.prisma.layawayPlan.findMany({
      where: { buyerId: actor.id },
      include: {
        listing: { select: { slug: true, device: { select: { model: true, capacity: true } } } },
        installments: { orderBy: { sequence: "asc" } },
        refunds: { orderBy: { createdAt: "desc" } },
        events: { orderBy: { createdAt: "desc" }, take: 20 },
        invoice: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return plans.map((plan) => ({
      ...plan,
      ...(plan.pickupOtpEncrypted && plan.pickupOtpExpiresAt && plan.pickupOtpExpiresAt > new Date()
        ? { pickupCode: this.crypto.decrypt(plan.pickupOtpEncrypted) }
        : {}),
      pickupOtpEncrypted: undefined,
      listing: { slug: plan.listing.slug, model: plan.listing.device.model, capacity: plan.listing.device.capacity },
    }));
  }

  async getPlan(planId: string, actor: AuthenticatedUser) {
    const plan = await this.prisma.layawayPlan.findUnique({
      where: { id: planId },
      include: {
        listing: { select: { slug: true, device: { select: { model: true, capacity: true } } } },
        shop: { select: { ownerId: true, name: true, whatsapp: true, layawayCollector: true } },
        installments: { orderBy: { sequence: "asc" } },
        refunds: { orderBy: { createdAt: "desc" } },
        events: { orderBy: { createdAt: "desc" }, take: 50 },
        invoice: true,
      },
    });
    if (!plan || (plan.buyerId !== actor.id && plan.shop.ownerId !== actor.id && !actor.roles.includes("ADMIN"))) {
      throw new NotFoundException("Réservation introuvable.");
    }
    return {
      ...plan,
      ...(plan.buyerId === actor.id && plan.pickupOtpEncrypted && plan.pickupOtpExpiresAt && plan.pickupOtpExpiresAt > new Date()
        ? { pickupCode: this.crypto.decrypt(plan.pickupOtpEncrypted) }
        : {}),
      pickupOtpEncrypted: undefined,
      shop: { name: plan.shop.name, whatsapp: plan.shop.whatsapp, layawayCollector: plan.shop.layawayCollector },
      listing: { slug: plan.listing.slug, model: plan.listing.device.model, capacity: plan.listing.device.capacity },
    };
  }

  async listShopPlans(shopId: string, actor: AuthenticatedUser) {
    await this.requireShopAccess(shopId, actor);
    return this.prisma.layawayPlan.findMany({
      where: { shopId, status: { in: ACTIVE_STATUSES } },
      include: {
        listing: { select: { slug: true, device: { select: { model: true, capacity: true } } } },
        buyer: { select: { phone: true } },
        installments: { orderBy: { sequence: "asc" } },
        refunds: { where: { status: { in: ["REQUESTED", "IN_PROGRESS", "ESCALATED"] } } },
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    });
  }

  async listAdminIssues(actor: AuthenticatedUser) {
    this.requireAdmin(actor);
    const [refunds, disputes, risks] = await Promise.all([
      this.prisma.layawayRefund.findMany({ where: { status: { in: ["REQUESTED", "IN_PROGRESS", "ESCALATED"] } }, include: { layawayPlan: { select: { id: true, buyerId: true, shopId: true, paidXof: true } } }, orderBy: { requestedAt: "asc" } }),
      this.prisma.layawayDispute.findMany({ where: { status: "OPEN" }, include: { layawayPlan: { select: { id: true, buyerId: true, shopId: true, priceXof: true, paidXof: true } } }, orderBy: { createdAt: "asc" } }),
      this.prisma.layawayRiskAlert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "asc" } }),
    ]);
    return { refunds, disputes, risks };
  }

  async cancelByBuyer(planId: string, actor: AuthenticatedUser) {
    const plan = await this.requirePlan(planId);
    if (plan.buyerId !== actor.id) throw new ForbiddenException("Cette réservation ne vous appartient pas.");
    if (!["PENDING_FIRST_PAYMENT", "ACTIVE", "LATE"].includes(plan.status)) throw new BadRequestException("Cette réservation ne peut plus être annulée par le client.");
    const settings = await this.settings();
    const { feeXof } = calculateBuyerCancellationRefund(plan.paidXof, settings.buyerCancellationFeeBps, settings.buyerCancellationFeeCapXof);
    return this.cancelPlan(plan, "CANCELLED_BY_BUYER", actor.id, "Annulation demandée par le client.", feeXof, 0);
  }

  async cancelBySeller(planId: string, reason: string, actor: AuthenticatedUser) {
    if (reason.trim().length < 8 || reason.length > 500) throw new BadRequestException("Une justification de 8 à 500 caractères est requise.");
    const plan = await this.requirePlan(planId);
    await this.requireShopAccess(plan.shopId, actor);
    if (!["PENDING_FIRST_PAYMENT", "ACTIVE", "LATE", "READY_FOR_PICKUP"].includes(plan.status)) throw new BadRequestException("Cette réservation ne peut pas être annulée par la boutique.");
    const settings = await this.settings();
    return this.cancelPlan(plan, "CANCELLED_BY_SELLER", actor.id, reason, 0, settings.sellerCancellationFeeXof);
  }

  async cancelByAdmin(planId: string, reason: string, actor: AuthenticatedUser) {
    this.requireAdmin(actor);
    if (reason.trim().length < 8 || reason.length > 500) throw new BadRequestException("Une justification de 8 à 500 caractères est requise.");
    const plan = await this.requirePlan(planId);
    if (!["DRAFT", "PENDING_FIRST_PAYMENT", "ACTIVE", "LATE", "COMPLETED", "READY_FOR_PICKUP", "DISPUTED"].includes(plan.status)) {
      throw new BadRequestException("Cette réservation ne peut pas être annulée par l’administration.");
    }
    const result = await this.cancelPlan(plan, "CANCELLED_BY_ADMIN", actor.id, reason.trim(), 0, 0);
    await this.prisma.layawayDispute.updateMany({
      where: { layawayPlanId: planId, status: "OPEN" },
      data: { status: "RESOLVED_REFUND", resolutionNotes: reason.trim(), resolvedById: actor.id, resolvedAt: new Date() },
    });
    return result;
  }

  async extendOnce(planId: string, actor: AuthenticatedUser) {
    const plan = await this.requirePlan(planId);
    if (plan.buyerId !== actor.id) throw new ForbiddenException("Cette réservation ne vous appartient pas.");
    if (plan.status !== "LATE" || plan.extensionUsed) throw new BadRequestException("Une prolongation unique n’est disponible que pour une réservation en retard.");
    const settings = await this.settings();
    const dueAt = new Date(plan.dueAt.getTime() + settings.extensionDays * DAY_MS);
    const graceEndsAt = new Date(plan.graceEndsAt.getTime() + settings.extensionDays * DAY_MS);
    const unpaidInstallments = await this.prisma.installment.findMany({
      where: { layawayPlanId: planId, status: { in: ["PENDING", "PARTIALLY_PAID", "OVERDUE"] } },
      select: { id: true, dueAt: true },
    });
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.layawayPlan.updateMany({
        where: { id: planId, status: "LATE", extensionUsed: false },
        data: { dueAt, graceEndsAt, extensionUsed: true, status: "ACTIVE" },
      });
      if (updated.count !== 1) throw new ConflictException("La réservation a déjà été prolongée ou a changé d’état.");
      for (const installment of unpaidInstallments) {
        await transaction.installment.updateMany({
          where: { id: installment.id, status: { in: ["PENDING", "PARTIALLY_PAID", "OVERDUE"] } },
          data: { dueAt: new Date(installment.dueAt.getTime() + settings.extensionDays * DAY_MS) },
        });
      }
      await transaction.layawayEvent.create({ data: { layawayPlanId: planId, actorId: actor.id, type: "SINGLE_EXTENSION_USED", fromStatus: "LATE", toStatus: "ACTIVE", details: { extensionDays: settings.extensionDays, dueAt: dueAt.toISOString() } } });
      await transaction.marketplaceListing.update({ where: { id: plan.listingId }, data: { reservedUntil: graceEndsAt } });
    });
    return this.getPlan(planId, actor);
  }

  async renewPickupCode(planId: string, actor: AuthenticatedUser) {
    const plan = await this.requirePlan(planId);
    await this.requireShopAccess(plan.shopId, actor);
    if (plan.status !== "READY_FOR_PICKUP") throw new BadRequestException("Le code ne peut être renouvelé que pour un téléphone prêt au retrait.");
    const code = randomInt(0, 10 ** 6).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + 7 * DAY_MS);
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.layawayPlan.updateMany({
        where: { id: planId, status: "READY_FOR_PICKUP" },
        data: {
          pickupOtpHash: this.crypto.hashSecret(`layaway-pickup:${planId}:${code}`),
          pickupOtpEncrypted: this.crypto.encrypt(code),
          pickupOtpExpiresAt: expiresAt,
        },
      });
      if (updated.count !== 1) throw new ConflictException("La réservation a changé d’état.");
      await transaction.layawayEvent.create({ data: { layawayPlanId: planId, actorId: actor.id, type: "PICKUP_CODE_RENEWED", details: { expiresAt: expiresAt.toISOString() } } });
      const buyer = await transaction.user.findUnique({ where: { id: plan.buyerId }, select: { phone: true } });
      if (buyer?.phone) {
        await transaction.layawayNotification.createMany({
          data: ["SMS", "WHATSAPP"].map((channel) => ({
            layawayPlanId: planId,
            idempotencyKey: `pickup-code-renewed:${planId}:${Date.now()}:${channel}`,
            channel: channel as "SMS" | "WHATSAPP",
            recipient: buyer.phone!,
            message: `Votre code de retrait a été renouvelé et expire dans 7 jours. Consultez ${this.config.WEB_ORIGIN}/compte/reservations.`,
            scheduledFor: new Date(),
          })),
          skipDuplicates: true,
        });
      }
    });
    return { id: planId, status: "READY_FOR_PICKUP", pickupCode: code, expiresAt };
  }

  async openDispute(planId: string, reason: string, files: Express.Multer.File[], actor: AuthenticatedUser) {
    const plan = await this.requirePlan(planId);
    if (plan.buyerId !== actor.id && !(await this.isShopMember(plan.shopId, actor.id)) && !actor.roles.includes("ADMIN")) {
      throw new ForbiddenException("Vous ne pouvez pas signaler cette réservation.");
    }
    if (!reason.trim() || reason.trim().length > 1000) throw new BadRequestException("Une description de litige de 1 à 1 000 caractères est requise.");
    const evidenceKeys = await this.saveEvidence(planId, files, "dispute");
    await this.openDisputeWithEvidence(plan, reason.trim(), evidenceKeys, actor);
    return { id: planId, status: "DISPUTED" };
  }

  private async openDisputeWithEvidence(
    plan: Awaited<ReturnType<LayawayService["requirePlan"]>>,
    reason: string,
    evidenceKeys: string[],
    actor: AuthenticatedUser,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      if (plan.status !== "DISPUTED") await this.transition(transaction, plan, "DISPUTED", actor.id, "DISPUTE_OPENED", { reason, evidenceCount: evidenceKeys.length });
      await transaction.layawayDispute.upsert({
        where: { layawayPlanId: plan.id },
        create: { layawayPlanId: plan.id, openedById: actor.id, reason, evidenceKeys },
        update: { openedById: actor.id, reason, evidenceKeys, status: "OPEN" },
      });
    });
  }

  async handover(planId: string, pickupCode: string, imei: string, photo: Express.Multer.File, actor: AuthenticatedUser) {
    const plan = await this.prisma.layawayPlan.findUnique({
      where: { id: planId },
      include: { listing: { include: { device: true, certificate: true } }, shop: true, buyer: true },
    });
    if (!plan) throw new NotFoundException("Réservation introuvable.");
    await this.requireShopAccess(plan.shopId, actor);
    if (plan.status !== "READY_FOR_PICKUP") throw new BadRequestException("Le solde doit être entièrement payé avant la remise.");
    if (!plan.pickupOtpHash || !plan.pickupOtpExpiresAt || plan.pickupOtpExpiresAt <= new Date()) {
      throw new BadRequestException("Le code de retrait a expiré. Demandez à la boutique de le renouveler.");
    }
    if (!/^\d{6}$/.test(pickupCode) || !constantTimeEquals(this.crypto.hashSecret(`layaway-pickup:${plan.id}:${pickupCode}`), plan.pickupOtpHash)) {
      throw new BadRequestException("Code de retrait invalide.");
    }
    if (!photo || !photo.mimetype.startsWith("image/") || photo.size > 8 * 1024 * 1024) throw new BadRequestException("Une photo de remise (8 Mo maximum) est obligatoire.");
    const normalizedImei = imei.replace(/\D/g, "");
    if (!/^\d{15}$/.test(normalizedImei)) throw new BadRequestException("L’IMEI doit contenir 15 chiffres.");
    const evidenceKeys = await this.saveEvidence(planId, [photo], "handover");
    const live = await this.imeiVerification.verify(normalizedImei, { model: plan.listing.device.model, forceRefresh: true });
    const registry = await this.prisma.imeiRegistryEntry.findUnique({ where: { imeiHash: plan.listing.device.imeiHash } });
    const consent = plan.consentSnapshot as { certificate?: { id?: string; code?: string } } | null;
    const certificate = plan.listing.certificate;
    const certificateMatches = certificate?.status === "ACTIVE" || certificate?.status === "EXPIRED";
    const certificateUnrevoked = certificate?.status !== "REVOKED" && certificate?.status !== "SUPERSEDED";
    const certificateIdentityMatches = Boolean(certificate
      && certificate.id === consent?.certificate?.id
      && certificate.code === consent?.certificate?.code
      && certificate.imeiHash === this.crypto.hashImei(normalizedImei)
      && certificate.model === plan.listing.device.model);
    if (!certificateMatches || !certificateUnrevoked || !certificateIdentityMatches || registry?.status !== "UNDER_RESERVATION" || live.verdict !== "TRUSTED") {
      await this.openDisputeWithEvidence(plan, "Vérification finale IMEI ou certificat non conforme.", evidenceKeys, actor);
      return { handedOver: false, status: "DISPUTED", message: "La remise est bloquée. Une revue admin est ouverte." };
    }

    const invoice = await this.invoiceProvider.issue({ orderId: plan.id, amountXof: plan.priceXof, shopName: plan.shop.name });
    await this.prisma.$transaction(async (transaction) => {
      await this.transition(transaction, plan, "HANDED_OVER", actor.id, "HANDOVER_CONFIRMED", { imeiVerifiedAt: new Date().toISOString(), evidenceKeys });
      await transaction.layawayPlan.update({
        where: { id: planId },
        data: { imeiVerifiedAt: new Date(), handedOverAt: new Date(), pickupOtpHash: null, pickupOtpEncrypted: null, pickupOtpExpiresAt: null },
      });
      await transaction.marketplaceListing.update({ where: { id: plan.listingId }, data: { status: "SOLD", reservedUntil: null } });
      await transaction.imeiRegistryEntry.updateMany({ where: { imeiHash: plan.listing.device.imeiHash, status: "UNDER_RESERVATION" }, data: { status: "SOLD", reason: "Réservation Fiducia remise au client.", changedById: actor.id } });
      await transaction.layawayInvoice.upsert({
        where: { layawayPlanId: planId },
        create: { layawayPlanId: planId, providerRef: invoice.reference, invoiceNumber: invoice.invoiceNumber },
        update: {},
      });
      if (plan.shop.layawayCollector !== "SELLER") {
        await this.postLedger(transaction, planId, `layaway-release:${planId}`, "Déblocage des fonds après remise du téléphone", [
          { account: "CUSTOMER_FUNDS_HELD", side: "DEBIT", amountXof: plan.paidXof },
          { account: "SELLER_PAYABLE", side: "CREDIT", amountXof: plan.paidXof },
        ]);
      }
      if (plan.buyer.phone) {
        await transaction.layawayNotification.createMany({
          data: ["SMS", "WHATSAPP"].map((channel) => ({
            layawayPlanId: planId,
            idempotencyKey: `handover-review:${planId}:${channel}`,
            channel: channel as "SMS" | "WHATSAPP",
            recipient: plan.buyer.phone!,
            message: "Votre téléphone a été remis. Vous pouvez maintenant noter votre expérience Fiducia.",
            scheduledFor: new Date(),
          })),
          skipDuplicates: true,
        });
      }
    });
    return { handedOver: true, status: "HANDED_OVER", invoiceNumber: invoice.invoiceNumber };
  }

  async sellerRefunds(shopId: string, actor: AuthenticatedUser) {
    await this.requireShopAccess(shopId, actor);
    return this.prisma.layawayRefund.findMany({
      where: { layawayPlan: { shopId }, status: { in: ["REQUESTED", "IN_PROGRESS", "ESCALATED"] } },
      include: { layawayPlan: { select: { id: true, paidXof: true, buyerId: true } } },
      orderBy: { requestedAt: "asc" },
    });
  }

  async startRefund(refundId: string, actor: AuthenticatedUser) {
    const refund = await this.prisma.layawayRefund.findUnique({ where: { id: refundId }, include: { layawayPlan: true } });
    if (!refund) throw new NotFoundException("Demande de remboursement introuvable.");
    await this.requireShopAccess(refund.layawayPlan.shopId, actor);
    const changed = await this.prisma.layawayRefund.updateMany({
      where: { id: refundId, status: "REQUESTED" },
      data: { status: "IN_PROGRESS" },
    });
    if (!changed.count) throw new ConflictException("Cette demande n’est plus en attente.");
    await this.prisma.layawayEvent.create({ data: { layawayPlanId: refund.layawayPlanId, actorId: actor.id, type: "SELLER_REFUND_STARTED", details: { refundId } } });
    return { id: refundId, status: "IN_PROGRESS" };
  }

  async recordRefund(refundId: string, externalReference: string, actor: AuthenticatedUser, adminResolution?: { notes: string }) {
    if (!externalReference.trim() || externalReference.length > 160) throw new BadRequestException("Une référence de remboursement valide est requise.");
    const refund = await this.prisma.layawayRefund.findUnique({ where: { id: refundId }, include: { layawayPlan: { include: { shop: true } } } });
    if (!refund) throw new NotFoundException("Demande de remboursement introuvable.");
    if (!actor.roles.includes("ADMIN")) await this.requireShopAccess(refund.layawayPlan.shopId, actor);
    if (!["REQUESTED", "IN_PROGRESS", "ESCALATED"].includes(refund.status)) throw new ConflictException("Cette demande de remboursement est déjà clôturée.");
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.layawayRefund.updateMany({
        where: { id: refundId, status: refund.status },
        data: { status: "REFUNDED", externalReference: externalReference.trim(), refundedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException("La demande de remboursement a déjà été traitée.");
      const lines: LedgerLine[] = [
        ...(refund.layawayPlan.shop.layawayCollector === "SELLER"
          ? [{ account: "SELLER_PAYABLE" as const, side: "DEBIT" as const, amountXof: refund.refundAmountXof }]
          : [{ account: "CUSTOMER_FUNDS_HELD" as const, side: "DEBIT" as const, amountXof: refund.amountPaidXof }]),
        { account: "PROVIDER_CLEARING", side: "CREDIT", amountXof: refund.refundAmountXof },
        ...(refund.layawayPlan.shop.layawayCollector !== "SELLER" && refund.feeXof > 0
          ? [{ account: "SELLER_PAYABLE" as const, side: "CREDIT" as const, amountXof: refund.feeXof }]
          : []),
      ];
      await this.postLedger(transaction, refund.layawayPlanId, `layaway-refund:${refundId}`, "Remboursement exécuté par la boutique", lines);
      const plan = await transaction.layawayPlan.findUniqueOrThrow({ where: { id: refund.layawayPlanId } });
      if (canTransitionLayaway(plan.status, "REFUNDED")) {
        await this.transition(transaction, plan, "REFUNDED", actor.id, "REFUND_RECORDED", { externalReference: externalReference.trim(), refundAmountXof: refund.refundAmountXof, adminNotes: adminResolution?.notes });
      }
    });
    await this.createRefundLoopAlert(refund.layawayPlan, actor.id);
    return { id: refundId, status: "REFUNDED" };
  }

  async resolveDispute(planId: string, resolution: "REFUND" | "PARTIAL_REFUND" | "SETTLE_TO_SELLER", amountXof: number | undefined, notes: string, actor: AuthenticatedUser) {
    this.requireAdmin(actor);
    const plan = await this.requirePlan(planId);
    if (plan.status !== "DISPUTED") throw new BadRequestException("Seule une réservation litigieuse peut être résolue.");
    const dispute = await this.prisma.layawayDispute.findUnique({ where: { layawayPlanId: planId } });
    if (!dispute || dispute.status !== "OPEN") throw new ConflictException("Ce litige a déjà été résolu.");
    if (notes.trim().length < 8 || notes.length > 1000) throw new BadRequestException("Une justification de résolution de 8 à 1 000 caractères est requise.");
    if (resolution === "SETTLE_TO_SELLER") {
      await this.prisma.$transaction(async (transaction) => {
        if (plan.shopId && (await transaction.shop.findUniqueOrThrow({ where: { id: plan.shopId } })).layawayCollector !== "SELLER" && plan.paidXof > 0) {
          await this.postLedger(transaction, planId, `layaway-settle:${planId}`, "Règlement admin au vendeur après litige", [
            { account: "CUSTOMER_FUNDS_HELD", side: "DEBIT", amountXof: plan.paidXof },
            { account: "SELLER_PAYABLE", side: "CREDIT", amountXof: plan.paidXof },
          ]);
        }
        const closed = await transaction.layawayDispute.updateMany({
          where: { layawayPlanId: planId, status: "OPEN" },
          data: { status: "RESOLVED_SELLER", resolutionNotes: notes.trim(), resolvedById: actor.id, resolvedAt: new Date() },
        });
        if (closed.count !== 1) throw new ConflictException("Ce litige a déjà été résolu.");
        await this.transition(transaction, plan, "CANCELLED_BY_ADMIN", actor.id, "DISPUTE_RESOLVED_TO_SELLER", { notes: notes.trim() });
        await this.releaseReservation(transaction, plan, actor.id);
      });
      return { id: planId, resolution: "SETTLE_TO_SELLER" };
    }
    const refundAmountXof = resolution === "REFUND" ? plan.paidXof : amountXof;
    if (!Number.isSafeInteger(refundAmountXof) || !refundAmountXof || refundAmountXof < 1 || refundAmountXof > plan.paidXof) {
      throw new BadRequestException("Montant de résolution de remboursement invalide.");
    }
    const settings = await this.settings();
    const refund = await this.prisma.$transaction(async (transaction) => {
      const shop = await transaction.shop.findUniqueOrThrow({ where: { id: plan.shopId } });
      const createdRefund = await transaction.layawayRefund.create({
        data: { layawayPlanId: planId, requestedById: actor.id, amountPaidXof: refundAmountXof, refundAmountXof, reason: `Résolution admin: ${notes.trim()}`, status: "REQUESTED" },
      });
      if (resolution === "PARTIAL_REFUND" && shop.layawayCollector !== "SELLER" && plan.paidXof > refundAmountXof) {
        const sellerSettlementXof = plan.paidXof - refundAmountXof;
        await this.postLedger(transaction, planId, `layaway-partial-settle:${planId}`, "Solde versé au vendeur après résolution partielle du litige", [
          { account: "CUSTOMER_FUNDS_HELD", side: "DEBIT", amountXof: sellerSettlementXof },
          { account: "SELLER_PAYABLE", side: "CREDIT", amountXof: sellerSettlementXof },
        ]);
      }
      const closed = await transaction.layawayDispute.updateMany({
        where: { layawayPlanId: planId, status: "OPEN" },
        data: { status: resolution === "REFUND" ? "RESOLVED_REFUND" : "RESOLVED_PARTIAL_REFUND", resolutionNotes: notes.trim(), resolvedById: actor.id, resolvedAt: new Date() },
      });
      if (closed.count !== 1) throw new ConflictException("Ce litige a déjà été résolu.");
      await transaction.layawayPlan.update({
        where: { id: planId },
        data: { sellerRefundDeadlineAt: new Date(Date.now() + settings.sellerRefundSlaHours * 60 * 60_000) },
      });
      return createdRefund;
    });
    return { id: planId, resolution, refundId: refund.id };
  }

  async downloadEvidence(planId: string, key: string, actor: AuthenticatedUser) {
    const plan = await this.prisma.layawayPlan.findUnique({ where: { id: planId }, include: { dispute: true, shop: { select: { ownerId: true } } } });
    if (!plan || (plan.buyerId !== actor.id && plan.shop.ownerId !== actor.id && !actor.roles.includes("ADMIN"))) throw new NotFoundException("Pièce de réservation introuvable.");
    const allowed = plan.dispute?.evidenceKeys.includes(key) || key.startsWith(`layaway/${planId}/handover/`);
    if (!allowed) throw new NotFoundException("Pièce de réservation introuvable.");
    return this.crypto.decryptBuffer(await this.storage.downloadPrivate(key));
  }

  private async cancelPlan(
    plan: Awaited<ReturnType<LayawayService["requirePlan"]>>,
    next: "CANCELLED_BY_BUYER" | "CANCELLED_BY_SELLER" | "CANCELLED_BY_ADMIN",
    actorId: string,
    reason: string,
    feeXof: number,
    sellerPenaltyXof: number,
  ) {
    const refundAmountXof = Math.max(0, plan.paidXof - feeXof);
    const settings = await this.settings();
    const deadline = new Date(Date.now() + settings.sellerRefundSlaHours * 60 * 60_000);
    const refund = await this.prisma.$transaction(async (transaction) => {
      const shopSettings = await transaction.shop.findUniqueOrThrow({ where: { id: plan.shopId }, select: { layawayCollector: true } });
      const createdRefund = refundAmountXof > 0 ? await transaction.layawayRefund.create({
        data: {
          layawayPlanId: plan.id,
          requestedById: actorId,
          amountPaidXof: plan.paidXof,
          feeXof,
          refundAmountXof,
          sellerPenaltyXof,
          reason,
        },
      }) : null;
      await this.transition(transaction, plan, next, actorId, next, { reason, feeXof, sellerPenaltyXof, refundId: createdRefund?.id });
      await transaction.layawayPlan.update({ where: { id: plan.id }, data: { sellerRefundDeadlineAt: createdRefund ? deadline : null } });
      await this.releaseReservation(transaction, plan, actorId);
      if (!createdRefund && plan.paidXof > 0 && shopSettings.layawayCollector !== "SELLER") {
        await this.postLedger(transaction, plan.id, `layaway-cancellation-fee:${plan.id}`, "Frais d’annulation retenus après annulation", [
          { account: "CUSTOMER_FUNDS_HELD", side: "DEBIT", amountXof: plan.paidXof },
          { account: "SELLER_PAYABLE", side: "CREDIT", amountXof: plan.paidXof },
        ]);
      }
      if (sellerPenaltyXof > 0) {
        const shop = await transaction.shop.update({
          where: { id: plan.shopId },
          data: { layawaySellerCancellations: { increment: 1 } },
          select: { layawaySellerCancellations: true },
        });
        await this.postLedger(transaction, plan.id, `layaway-seller-penalty:${plan.id}`, "Pénalité vendeur pour annulation d’une réservation", [
          { account: "SELLER_PAYABLE", side: "DEBIT", amountXof: sellerPenaltyXof },
          { account: "PLATFORM_REVENUE", side: "CREDIT", amountXof: sellerPenaltyXof },
        ]);
        if (shop.layawaySellerCancellations >= 3) {
          await transaction.layawayRiskAlert.create({
            data: { layawayPlanId: plan.id, buyerId: plan.buyerId, shopId: plan.shopId, kind: "SELLER_CANCELLATION_PATTERN", details: { cancellationCount: shop.layawaySellerCancellations } },
          });
        }
      }
      return createdRefund;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.createRefundLoopAlert(plan, actorId);
    return { id: plan.id, status: next, refund: refund ? { id: refund.id, amountXof: refundAmountXof, feeXof, sellerPenaltyXof, dueAt: deadline } : null };
  }

  private async releaseReservation(
    transaction: Prisma.TransactionClient,
    plan: { listingId: string; shopId: string; listing?: { expiresAt: Date | null; device?: { imeiHash: string } } },
    actorId: string | null,
  ) {
    await transaction.marketplaceListing.updateMany({
      where: { id: plan.listingId, status: "RESERVED" },
      data: {
        status: plan.listing?.expiresAt && plan.listing.expiresAt <= new Date() ? "EXPIRED" : "PUBLISHED",
        reservedUntil: null,
      },
    });
    if (plan.listing?.device?.imeiHash) {
      await transaction.imeiRegistryEntry.updateMany({
        where: { imeiHash: plan.listing.device.imeiHash, status: "UNDER_RESERVATION" },
        data: { status: "CERTIFIED", reason: "Réservation annulée; téléphone de nouveau disponible.", changedById: actorId },
      });
    }
  }

  private async transition(
    transaction: Prisma.TransactionClient,
    plan: { id: string; status: LayawayPlanStatus },
    to: LayawayPlanStatus,
    actorId: string | null,
    type: string,
    details?: unknown,
  ) {
    assertLayawayTransition(plan.status, to);
    const changed = await transaction.layawayPlan.updateMany({ where: { id: plan.id, status: plan.status }, data: { status: to } });
    if (changed.count !== 1) throw new ConflictException("La réservation a changé d’état.");
    await transaction.layawayEvent.create({
      data: {
        layawayPlanId: plan.id,
        actorId,
        type,
        fromStatus: plan.status,
        toStatus: to,
        ...(details ? { details: details as Prisma.InputJsonValue } : {}),
      },
    });
  }

  private async postLedger(transaction: Prisma.TransactionClient, layawayPlanId: string, idempotencyKey: string, description: string, lines: LedgerLine[]) {
    assertBalancedLedger(lines);
    await transaction.ledgerTransaction.create({
      data: { idempotencyKey, layawayPlanId, description, entries: { create: lines } },
    });
  }

  async processScheduledJobs() {
    await this.scheduleReminders();
    await this.sendDueNotifications();
    await this.markLatePlans();
    await this.expirePlans();
    await this.escalateRefunds();
  }

  private async scheduleReminders() {
    const plans = await this.prisma.layawayPlan.findMany({
      where: { status: { in: ["ACTIVE", "LATE"] } },
      include: { buyer: { select: { phone: true } }, installments: true },
    });
    for (const plan of plans) {
      if (!plan.buyer.phone) continue;
      for (const installment of plan.installments) {
        if (installment.status === "PAID") continue;
        for (const daysOffset of [-5, -2, 0, 2]) {
          const scheduledFor = new Date(installment.dueAt.getTime() + daysOffset * DAY_MS);
          const idempotencyKey = `installment-reminder:${installment.id}:${daysOffset}`;
          const message = `Rappel Fiducia : échéance ${installment.sequence} de ${installment.amountDueXof - installment.amountPaidXof} XOF, reste à payer ${plan.priceXof - plan.paidXof} XOF. Paiement : ${this.config.WEB_ORIGIN}/compte/reservations`;
          await this.prisma.layawayNotification.createMany({
            data: ["SMS", "WHATSAPP"].map((channel) => ({
              layawayPlanId: plan.id,
              installmentId: installment.id,
              idempotencyKey: `${idempotencyKey}:${channel}`,
              channel: channel as "SMS" | "WHATSAPP",
              recipient: plan.buyer.phone!,
              message,
              scheduledFor,
            })),
            skipDuplicates: true,
          });
        }
      }
    }
  }

  private async sendDueNotifications() {
    const due = await this.prisma.layawayNotification.findMany({ where: { status: "QUEUED", scheduledFor: { lte: new Date() } }, take: 100, orderBy: { scheduledFor: "asc" } });
    for (const notice of due) {
      await this.prisma.layawayNotification.updateMany({
        where: { id: notice.id, status: "QUEUED" },
        data: { status: "SENT", sentAt: new Date() },
      });
      this.logger.log(`Mock ${notice.channel} envoyé pour réservation ${notice.layawayPlanId}.`);
    }
  }

  private async markLatePlans() {
    const now = new Date();
    const due = await this.prisma.layawayPlan.findMany({
      where: {
        status: "ACTIVE",
        installments: { some: { status: { in: ["PENDING", "PARTIALLY_PAID"] }, dueAt: { lt: now } } },
      },
    });
    for (const plan of due) {
      await this.prisma.$transaction(async (transaction) => {
        await this.transition(transaction, plan, "LATE", null, "PAYMENT_BECAME_LATE", { dueAt: plan.dueAt.toISOString() });
      });
    }
  }

  private async expirePlans() {
    const now = new Date();
    const due = await this.prisma.layawayPlan.findMany({
      where: { status: { in: ["PENDING_FIRST_PAYMENT", "ACTIVE", "LATE"] }, graceEndsAt: { lt: now } },
      include: { listing: { include: { device: true } } },
    });
    const settings = await this.settings();
    for (const plan of due) {
      await this.prisma.$transaction(async (transaction) => {
        await this.transition(transaction, plan, "EXPIRED_UNPAID", null, "GRACE_PERIOD_EXPIRED", { expiredAt: now.toISOString(), paidXof: plan.paidXof });
        await this.releaseReservation(transaction, plan, null);
        if (plan.paidXof > 0) {
          const { feeXof, refundAmountXof } = calculateBuyerCancellationRefund(plan.paidXof, settings.buyerCancellationFeeBps, settings.buyerCancellationFeeCapXof);
          if (refundAmountXof > 0) {
            const refund = await transaction.layawayRefund.create({
              data: {
                layawayPlanId: plan.id,
                requestedById: plan.buyerId,
                amountPaidXof: plan.paidXof,
                feeXof,
                refundAmountXof,
                reason: "Expiration après la période de grâce.",
              },
            });
            await transaction.layawayPlan.update({ where: { id: plan.id }, data: { sellerRefundDeadlineAt: new Date(now.getTime() + settings.sellerRefundSlaHours * 60 * 60_000) } });
            await transaction.layawayEvent.create({ data: { layawayPlanId: plan.id, type: "EXPIRY_REFUND_REQUESTED", details: { refundId: refund.id, refundAmountXof, feeXof } } });
          }
        }
      });
    }
  }

  private async escalateRefunds() {
    const late = await this.prisma.layawayRefund.findMany({
      where: { status: { in: ["REQUESTED", "IN_PROGRESS"] }, layawayPlan: { sellerRefundDeadlineAt: { lte: new Date() } } },
      include: { layawayPlan: true },
    });
    for (const refund of late) {
      const result = await this.prisma.layawayRefund.updateMany({ where: { id: refund.id, status: refund.status }, data: { status: "ESCALATED", escalatedAt: new Date() } });
      if (!result.count) continue;
      await this.prisma.layawayEvent.create({ data: { layawayPlanId: refund.layawayPlanId, type: "SELLER_REFUND_ESCALATED", details: { refundId: refund.id, deadline: refund.layawayPlan.sellerRefundDeadlineAt?.toISOString() } } });
      await this.prisma.layawayRiskAlert.create({ data: { layawayPlanId: refund.layawayPlanId, buyerId: refund.layawayPlan.buyerId, shopId: refund.layawayPlan.shopId, kind: "SELLER_REFUND_SLA_BREACH", details: { refundId: refund.id } } });
    }
  }

  private async createRefundLoopAlert(plan: { id: string; buyerId: string; shopId: string }, actorId: string) {
    const recent = await this.prisma.layawayRefund.count({
      where: { layawayPlan: { buyerId: plan.buyerId }, createdAt: { gte: new Date(Date.now() - 90 * DAY_MS) } },
    });
    if (recent >= 3) {
      await this.prisma.layawayRiskAlert.create({
        data: { layawayPlanId: plan.id, buyerId: plan.buyerId, shopId: plan.shopId, kind: "REPEATED_REFUND", details: { recentRefundCount: recent, requestedById: actorId } },
      });
    }
  }

  private async saveEvidence(planId: string, files: Express.Multer.File[], category: "dispute" | "handover") {
    if (files.length > 5) throw new BadRequestException("Cinq pièces maximum sont autorisées.");
    const keys: string[] = [];
    for (const [index, file] of files.entries()) {
      if (!file.mimetype.startsWith("image/") || file.size > 8 * 1024 * 1024) throw new BadRequestException("Les pièces doivent être des images de 8 Mo maximum.");
      const body = await sharp(file.buffer, { failOn: "error" }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
      const key = `layaway/${planId}/${category}/${randomUUID()}-${index}.webp.enc`;
      await this.storage.uploadPrivate(key, this.crypto.encryptBuffer(body));
      keys.push(key);
    }
    return keys;
  }

  private async settings() {
    const existing = await this.prisma.layawaySettings.findUnique({ where: { id: "default" } });
    return existing ?? this.prisma.layawaySettings.create({ data: { id: "default" } });
  }

  private async requirePlan(planId: string) {
    const plan = await this.prisma.layawayPlan.findUnique({ where: { id: planId }, include: { listing: { include: { device: true } } } });
    if (!plan) throw new NotFoundException("Réservation introuvable.");
    return plan;
  }

  private async requireShopAccess(shopId: string, actor: AuthenticatedUser) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }] },
      select: { id: true },
    });
    if (!shop) throw new ForbiddenException("Vous n’êtes pas membre de cette boutique.");
  }

  private async isShopMember(shopId: string, userId: string) {
    return Boolean(await this.prisma.shop.findFirst({
      where: { id: shopId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: { id: true },
    }));
  }

  private requireAdmin(actor: AuthenticatedUser) {
    if (!actor.roles.includes(UserRole.ADMIN)) throw new ForbiddenException("Action réservée à l’administration.");
  }

  private safePlan<T extends { pickupOtpEncrypted?: string | null }>(plan: T) {
    const { pickupOtpEncrypted: _secret, ...safe } = plan;
    return safe;
  }
}

function validateSettings(input: Record<string, unknown>) {
  const integerLimits: Record<string, [number, number]> = {
    flexMinFirstPaymentPercent: [1, 90],
    flexDefaultDurationDays: [60, 90],
    gracePeriodDays: [1, 30],
    extensionDays: [1, 30],
    buyerActivePlanLimit: [1, 10],
    newAccountExposureCapXof: [1, 100_000_000],
    newAccountAgeDays: [1, 365],
    buyerCancellationFeeBps: [0, 10_000],
    buyerCancellationFeeCapXof: [0, 1_000_000],
    sellerCancellationFeeXof: [0, 1_000_000],
    sellerRefundSlaHours: [1, 720],
  };
  for (const [key, [minimum, maximum]] of Object.entries(integerLimits)) {
    const value = input[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)) {
      throw new BadRequestException(`${key} doit être un entier compris entre ${minimum} et ${maximum}.`);
    }
  }
  if (input.flexDefaultDurationDays !== undefined && input.flexDefaultDurationDays !== 60 && input.flexDefaultDurationDays !== 90) {
    throw new BadRequestException("La durée FLEX par défaut doit être de 60 ou 90 jours.");
  }
  if (input.shopActivePlanLimit !== undefined && input.shopActivePlanLimit !== null
    && (!Number.isSafeInteger(input.shopActivePlanLimit) || (input.shopActivePlanLimit as number) < 1 || (input.shopActivePlanLimit as number) > 10_000)) {
    throw new BadRequestException("Le plafond boutique doit être un entier positif ou null pour illimité.");
  }
  const fixedPercentages = input.fixed3Percentages;
  if (fixedPercentages !== undefined && (!Array.isArray(fixedPercentages)
    || fixedPercentages.length !== 3
    || fixedPercentages.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 98)
    || fixedPercentages.reduce((sum, value) => sum + Number(value), 0) !== 100)) {
    throw new BadRequestException("FIXED_3 doit comporter trois pourcentages entiers positifs totalisant 100.");
  }
  const flexDays = input.flexAllowedDurationDays;
  if (flexDays !== undefined && (!Array.isArray(flexDays) || flexDays.length === 0 || new Set(flexDays).size !== flexDays.length || flexDays.some((value) => value !== 60 && value !== 90))) {
    throw new BadRequestException("Les durées FLEX autorisées sont 60 et/ou 90 jours.");
  }
  if (Array.isArray(flexDays) && Number.isSafeInteger(input.flexDefaultDurationDays)
    && !flexDays.includes(Number(input.flexDefaultDurationDays))) {
    throw new BadRequestException("La durée FLEX par défaut doit faire partie des durées autorisées.");
  }
  for (const value of ["fixed3Enabled", "flexEnabled", "guaranteeEnabled"]) {
    if (input[value] !== undefined && typeof input[value] !== "boolean") throw new BadRequestException(`${value} doit être booléen.`);
  }
}

function constantTimeEquals(first: string, second: string) {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}
