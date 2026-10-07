import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { MarketplaceListingStatus, MarketplaceReportSeverity, MarketplaceReportSubject, MarketplaceReportStatus, PaymentOptionKind, Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { AuthenticatedUser } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../database/prisma.service";
import { StorageProvider } from "../storage/storage.provider";
import { isValidImei } from "@fiducia/shared";

export interface CreateListingInput {
  imei: string;
  serialNumber: string;
  model: string;
  capacity: string;
  color: string;
  condition: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR";
  batteryPercent: number;
  priceCashXof: number;
  paymentOptions?: PaymentOptionKind[];
}

export interface ListingSearchInput {
  q?: string;
  model?: string;
  capacity?: string;
  color?: string;
  condition?: CreateListingInput["condition"];
  minPrice?: number;
  maxPrice?: number;
  city?: string;
  certificateValid?: boolean;
  installments?: boolean;
  partnerFinancing?: boolean;
  sellerVerified?: boolean;
  cursor?: string;
  limit?: number;
}

const activeListingStatuses: MarketplaceListingStatus[] = ["PUBLISHED", "RESERVED"];
const stateTransitions: Record<MarketplaceListingStatus, MarketplaceListingStatus[]> = {
  DRAFT: ["PENDING_REVIEW", "WITHDRAWN"],
  PENDING_REVIEW: ["PUBLISHED", "WITHDRAWN", "SUSPENDED"],
  PUBLISHED: ["RESERVED", "SOLD", "WITHDRAWN", "SUSPENDED", "EXPIRED"],
  RESERVED: ["PUBLISHED", "SOLD", "WITHDRAWN", "SUSPENDED", "EXPIRED"],
  SOLD: [],
  WITHDRAWN: [],
  SUSPENDED: ["PENDING_REVIEW", "WITHDRAWN"],
  EXPIRED: [],
};

export function canTransitionListing(from: MarketplaceListingStatus, to: MarketplaceListingStatus): boolean {
  return stateTransitions[from].includes(to);
}

export function shouldReleaseListingImei(status: MarketplaceListingStatus): boolean {
  return status === "PUBLISHED" || status === "RESERVED";
}

export function getTrustedReportSeverity(requested: MarketplaceReportSeverity, roles: readonly string[]): MarketplaceReportSeverity {
  return roles.includes("ADMIN") || roles.includes("AGENT") ? requested : "MEDIUM";
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  async createDraft(shopId: string, input: CreateListingInput, actor: AuthenticatedUser) {
    this.validateListingInput(input);
    const shop = await this.requireShopAccess(shopId, actor);
    const enabled = new Set(shop.enabledPaymentOptions);
    const paymentOptions = input.paymentOptions?.length ? input.paymentOptions : [PaymentOptionKind.CASH];
    if (paymentOptions.some((option) => !enabled.has(option))) throw new BadRequestException("Cette boutique n’a pas activé toutes les options de paiement demandées.");

    const imeiHash = this.crypto.hashImei(input.imei);
    const existingDevice = await this.prisma.device.findUnique({ where: { imeiHash } });
    if (existingDevice && existingDevice.shopId !== shopId) throw new ConflictException("Cet appareil est déjà enregistré dans une autre boutique.");

    const device = existingDevice ?? await this.prisma.device.create({
      data: {
        imeiEncrypted: this.crypto.encrypt(input.imei),
        imeiHash,
        serialEncrypted: this.crypto.encrypt(input.serialNumber),
        serialHash: this.crypto.hashSecret(input.serialNumber),
        model: input.model.trim(),
        capacity: input.capacity.trim(),
        color: input.color.trim(),
        condition: input.condition,
        batteryPercent: input.batteryPercent,
        shopId,
      },
    });

    try {
      return await this.prisma.marketplaceListing.create({
        data: {
          shopId,
          createdById: actor.id,
          deviceId: device.id,
          priceCashXof: input.priceCashXof,
          paymentOptions,
        },
        include: { device: { select: { model: true, capacity: true, color: true, condition: true, batteryPercent: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Une annonce existe déjà pour cet appareil.");
      }
      throw error;
    }
  }

  async addPhoto(listingId: string, actor: AuthenticatedUser, file: Express.Multer.File) {
    if (!file || !file.mimetype.startsWith("image/") || file.size > 8 * 1024 * 1024) throw new BadRequestException("Photo invalide (8 Mo maximum).");
    const listing = await this.requireListingAccess(listingId, actor);
    if (listing.status !== "DRAFT") throw new BadRequestException("Les photos ne peuvent être modifiées qu’au brouillon.");
    const metadata = await sharp(file.buffer, { failOn: "error" }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
    const position = await this.prisma.listingPhoto.count({ where: { listingId } });
    if (position >= 8) throw new BadRequestException("Huit photos maximum par annonce.");
    const photoId = `listing-photo-${crypto.randomUUID()}`;
    const storageKey = `marketplace/${listingId}/${photoId}.webp`;
    await this.storage.uploadPublicAsset(storageKey, metadata.data, "image/webp");
    return this.prisma.listingPhoto.create({
      data: { id: photoId, listingId, storageKey, mimeType: "image/webp", width: metadata.info.width, height: metadata.info.height, position },
      select: { id: true, width: true, height: true, position: true },
    });
  }

  async submitForReview(listingId: string, actor: AuthenticatedUser) {
    const listing = await this.requireListingAccess(listingId, actor);
    if (listing.status !== "DRAFT") throw new BadRequestException("Seul un brouillon peut être soumis à la modération.");
    const [photos, certificate] = await Promise.all([
      this.prisma.listingPhoto.count({ where: { listingId } }),
      this.prisma.certificate.findFirst({ where: { imeiHash: listing.device.imeiHash, status: "ACTIVE", expiresAt: { gt: new Date() } }, orderBy: { issuedAt: "desc" } }),
    ]);
    if (photos < 1) throw new BadRequestException("Ajoute au moins une photo du téléphone.");
    if (!certificate) throw new BadRequestException("Un certificat actif est requis pour soumettre l’annonce.");
    return this.prisma.marketplaceListing.update({
      where: { id: listingId },
      data: { status: "PENDING_REVIEW", certificateId: certificate.id },
    });
  }

  async checkListingCertificate(listingId: string, actor: AuthenticatedUser) {
    const listing = await this.requireListingAccess(listingId, actor);
    const certificate = await this.prisma.certificate.findFirst({
      where: { imeiHash: listing.device.imeiHash },
      orderBy: { issuedAt: "desc" },
      select: { code: true, status: true, expiresAt: true, issuedAt: true, sourcesConsulted: true },
    });
    const valid = Boolean(certificate && certificate.status === "ACTIVE" && certificate.expiresAt > new Date());
    return { valid, certificate };
  }

  async checkShopImeiCertificate(shopId: string, imei: string, actor: AuthenticatedUser) {
    await this.requireShopAccess(shopId, actor);
    if (!isValidImei(imei)) throw new BadRequestException("L’IMEI doit contenir 15 chiffres et avoir une clé de contrôle valide.");
    const certificate = await this.prisma.certificate.findFirst({
      where: { imeiHash: this.crypto.hashImei(imei) },
      orderBy: { issuedAt: "desc" },
      select: { code: true, status: true, expiresAt: true, issuedAt: true, sourcesConsulted: true },
    });
    const valid = Boolean(certificate && certificate.status === "ACTIVE" && certificate.expiresAt > new Date());
    return { valid, certificate };
  }

  async listShopListings(shopId: string, actor: AuthenticatedUser) {
    await this.requireShopAccess(shopId, actor);
    return this.prisma.marketplaceListing.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        status: true,
        priceCashXof: true,
        createdAt: true,
        publishedAt: true,
        suspendedReason: true,
        device: { select: { model: true, capacity: true } },
        _count: { select: { purchases: true } },
      },
    });
  }

  async moderateListing(listingId: string, target: "PUBLISHED" | "REJECTED", actor: AuthenticatedUser, reason?: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({ where: { id: listingId }, include: { device: true, shop: true } });
    if (!listing) throw new NotFoundException("Annonce introuvable.");
    if (listing.status !== "PENDING_REVIEW") throw new BadRequestException("L’annonce n’est pas en attente de modération.");
    if (target === "REJECTED") {
      const updated = await this.prisma.marketplaceListing.update({ where: { id: listingId }, data: { status: "WITHDRAWN", suspendedReason: reason ?? "Annonce refusée par la modération" } });
      await this.audit.record({ actorId: actor.id, action: "marketplace.listing.rejected", resourceType: "MarketplaceListing", resourceId: listingId, metadata: { reason: reason ?? "" } });
      return updated;
    }
    if (listing.shop.status !== "VERIFIED") throw new BadRequestException("La boutique doit être vérifiée avant publication.");
    const certificate = listing.certificateId ? await this.prisma.certificate.findUnique({ where: { id: listing.certificateId } }) : null;
    if (!certificate || certificate.status !== "ACTIVE" || certificate.expiresAt <= new Date() || certificate.imeiHash !== listing.device.imeiHash) {
      throw new BadRequestException("Un certificat actif correspondant à l’IMEI est requis.");
    }
    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        await transaction.device.update({ where: { id: listing.deviceId }, data: { activeListingHash: listing.device.imeiHash } });
        return transaction.marketplaceListing.update({ where: { id: listingId }, data: { status: "PUBLISHED", publishedAt: new Date(), suspendedReason: null } });
      });
      await this.audit.record({ actorId: actor.id, action: "marketplace.listing.published", resourceType: "MarketplaceListing", resourceId: listingId, metadata: { shopId: listing.shopId } });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Une autre annonce active existe déjà pour cet IMEI.");
      throw error;
    }
  }

  async transition(listingId: string, target: MarketplaceListingStatus, actor: AuthenticatedUser, reservedUntil?: Date) {
    const listing = await this.requireListingAccess(listingId, actor);
    if (!canTransitionListing(listing.status, target)) throw new BadRequestException(`Transition ${listing.status} → ${target} interdite.`);
    if (target === "PUBLISHED") throw new ForbiddenException("La publication requiert une décision de modération.");
    if (target === "RESERVED" && (!reservedUntil || reservedUntil <= new Date())) throw new BadRequestException("La date de fin de réservation doit être future.");
    const clearActive = ["SOLD", "WITHDRAWN", "SUSPENDED", "EXPIRED"].includes(target);
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.marketplaceListing.update({
        where: { id: listingId },
        data: { status: target, reservedUntil: target === "RESERVED" ? reservedUntil : null },
      });
      if (clearActive && shouldReleaseListingImei(listing.status)) {
        await transaction.device.updateMany({
          where: { id: listing.deviceId, activeListingHash: listing.device.imeiHash },
          data: { activeListingHash: null },
        });
      }
      return updated;
    });
  }

  async listPublic(filters: ListingSearchInput) {
    const limit = Math.min(48, Math.max(1, filters.limit ?? 24));
    const now = new Date();
    const expiredListings = await this.prisma.marketplaceListing.findMany({
      where: {
        status: { in: activeListingStatuses },
        OR: [
          { certificate: null },
          { certificate: { is: { status: { not: "ACTIVE" } } } },
          { certificate: { is: { expiresAt: { lte: now } } } },
        ],
      },
      select: { id: true },
    });
    for (const listing of expiredListings) await this.suspendListing(listing.id, "Certificat expiré ou révoqué");
    const where: Prisma.MarketplaceListingWhereInput = {
      status: { in: activeListingStatuses },
      shop: { status: "VERIFIED" },
      device: {
        model: filters.model ? { contains: filters.model, mode: "insensitive" } : undefined,
        capacity: filters.capacity ? { contains: filters.capacity, mode: "insensitive" } : undefined,
        color: filters.color ? { contains: filters.color, mode: "insensitive" } : undefined,
        condition: filters.condition,
      },
      priceCashXof: { gte: filters.minPrice, lte: filters.maxPrice },
      certificate: filters.certificateValid ? { is: { status: "ACTIVE", expiresAt: { gt: now } } } : undefined,
      paymentOptions: filters.installments ? { hasSome: ["INSTALLMENT_A", "INSTALLMENT_B"] } : undefined,
      AND: [
        filters.partnerFinancing ? { paymentOptions: { has: "PARTNER_FINANCING" } } : {},
        filters.city ? { shop: { city: { contains: filters.city, mode: "insensitive" } } } : {},
        filters.q ? { OR: [
          { device: { model: { contains: filters.q, mode: "insensitive" } } },
          { device: { capacity: { contains: filters.q, mode: "insensitive" } } },
          { device: { color: { contains: filters.q, mode: "insensitive" } } },
          { shop: { name: { contains: filters.q, mode: "insensitive" } } },
        ] } : {},
      ],
    };
    if (filters.cursor && !await this.prisma.marketplaceListing.findUnique({ where: { id: filters.cursor }, select: { id: true } })) {
      throw new BadRequestException("Curseur de pagination inconnu.");
    }
    const records = await this.prisma.marketplaceListing.findMany({
      where,
      take: limit + 1,
      cursor: filters.cursor ? { id: filters.cursor } : undefined,
      skip: filters.cursor ? 1 : 0,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      include: {
        shop: { select: { slug: true, name: true, city: true, status: true, whatsapp: true } },
        device: { select: { model: true, capacity: true, color: true, condition: true, batteryPercent: true } },
        certificate: { select: { code: true, status: true, expiresAt: true, issuedAt: true, sourcesConsulted: true, riskLevel: true } },
        photos: { orderBy: { position: "asc" }, select: { id: true, position: true, width: true, height: true } },
        _count: { select: { reviews: true } },
      },
    });
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  }

  async getPublicListing(slug: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { slug },
      include: {
        shop: { select: { id: true, slug: true, name: true, city: true, whatsapp: true, status: true } },
        device: { select: { model: true, capacity: true, color: true, condition: true, batteryPercent: true } },
        certificate: { select: { code: true, status: true, expiresAt: true, issuedAt: true, sourcesConsulted: true, riskLevel: true } },
        photos: { orderBy: { position: "asc" }, select: { id: true, position: true, width: true, height: true } },
        reviews: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, rating: true, body: true, createdAt: true } },
      },
    });
    if (!listing || !activeListingStatuses.includes(listing.status) || listing.shop.status !== "VERIFIED") throw new NotFoundException("Annonce indisponible.");
    if (!listing.certificate || listing.certificate.status !== "ACTIVE" || listing.certificate.expiresAt <= new Date()) {
      if (listing.status !== "SUSPENDED") await this.suspendListing(listing.id, "Certificat expiré ou révoqué");
      throw new NotFoundException("Cette annonce est suspendue car son certificat n’est plus valide.");
    }
    return listing;
  }

  async getPublicShop(slug: string) {
    const now = new Date();
    const shop = await this.prisma.shop.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        city: true,
        whatsapp: true,
        status: true,
        enabledPaymentOptions: true,
        reviews: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, rating: true, body: true, createdAt: true } },
        marketplaceListings: {
          where: {
            status: { in: activeListingStatuses },
            certificate: { is: { status: "ACTIVE", expiresAt: { gt: now } } },
          },
          select: {
            id: true,
            slug: true,
            status: true,
            priceCashXof: true,
            paymentOptions: true,
            device: { select: { model: true, capacity: true, color: true, condition: true, batteryPercent: true } },
            certificate: { select: { code: true, status: true, expiresAt: true, issuedAt: true, sourcesConsulted: true, riskLevel: true } },
            photos: { orderBy: { position: "asc" }, take: 1, select: { id: true } },
            _count: { select: { reviews: true } },
          },
        },
      },
    });
    if (!shop || shop.status !== "VERIFIED") throw new NotFoundException("Boutique indisponible.");
    return {
      ...shop,
      marketplaceListings: shop.marketplaceListings.map((listing) => ({
        ...listing,
        shop: { slug: shop.slug, name: shop.name, city: shop.city, status: shop.status },
      })),
    };
  }

  async getPublicPhoto(photoId: string) {
    const photo = await this.prisma.listingPhoto.findUnique({
      where: { id: photoId },
      include: { listing: { select: { id: true, status: true, certificate: { select: { status: true, expiresAt: true } }, shop: { select: { status: true } } } } },
    });
    if (!photo || !activeListingStatuses.includes(photo.listing.status) || photo.listing.shop.status !== "VERIFIED") throw new NotFoundException("Photo indisponible.");
    if (!photo.listing.certificate || photo.listing.certificate.status !== "ACTIVE" || photo.listing.certificate.expiresAt <= new Date()) {
      await this.suspendListing(photo.listing.id, "Certificat expiré ou révoqué");
      throw new NotFoundException("Photo indisponible.");
    }
    return { photo, bytes: await this.storage.downloadPrivate(photo.storageKey) };
  }

  async createReport(input: { subjectType: MarketplaceReportSubject; listingId?: string; shopId?: string; severity: MarketplaceReportSeverity; reason: string; details?: string }, actor: AuthenticatedUser) {
    if ((input.subjectType === "LISTING" && (!input.listingId || input.shopId)) || (input.subjectType === "SHOP" && (!input.shopId || input.listingId)) || input.reason.trim().length < 4) {
      throw new BadRequestException("Indique la cible du signalement et un motif précis.");
    }
    const targetShopId = input.subjectType === "LISTING"
      ? (await this.prisma.marketplaceListing.findUnique({ where: { id: input.listingId! }, select: { shopId: true } }))?.shopId
      : input.shopId;
    if (!targetShopId) throw new NotFoundException("Cible du signalement introuvable.");
    const severity = getTrustedReportSeverity(input.severity, actor.roles);
    const createdAt = new Date();
    const report = await this.prisma.marketplaceReport.create({
      data: {
        subjectType: input.subjectType, listingId: input.listingId, shopId: input.shopId,
        reporterId: actor.id, severity, reason: input.reason.trim(), details: input.details?.trim(),
        responseDeadline: new Date(createdAt.getTime() + 48 * 60 * 60 * 1000),
      },
    });
    if (input.subjectType === "LISTING" && input.listingId && ["HIGH", "CRITICAL"].includes(severity)) {
      await this.suspendListing(input.listingId, `Signalement ${severity.toLowerCase()} en cours de revue`);
    }
    if (input.subjectType === "SHOP" && ["HIGH", "CRITICAL"].includes(severity)) {
      await this.prisma.shop.update({ where: { id: targetShopId }, data: { status: "SUSPENDED" } });
    }
    await this.prisma.shopNotification.create({
      data: {
        shopId: targetShopId,
        type: severity === "HIGH" || severity === "CRITICAL" ? "LISTING_SUSPENDED" : "MARKETPLACE_REPORT",
        title: "Signalement reçu",
        message: `Un signalement de gravité ${severity.toLowerCase()} a été reçu. Réponse attendue avant le ${report.responseDeadline?.toISOString() ?? "délai indiqué"}.`,
      },
    });
    await this.audit.record({ actorId: actor.id, action: "marketplace.report.created", resourceType: "MarketplaceReport", resourceId: report.id, metadata: { subjectType: report.subjectType, severity } });
    return { id: report.id, status: report.status, responseDeadline: report.responseDeadline };
  }

  async classifyReport(reportId: string, severity: MarketplaceReportSeverity, actor: AuthenticatedUser) {
    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity)) throw new BadRequestException("Gravité de signalement invalide.");
    const report = await this.prisma.marketplaceReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException("Signalement introuvable.");
    if (!["PENDING", "UNDER_REVIEW"].includes(report.status)) throw new BadRequestException("Ce signalement est déjà clôturé.");
    const updated = await this.prisma.marketplaceReport.update({ where: { id: reportId }, data: { severity } });
    if (["HIGH", "CRITICAL"].includes(severity)) {
      if (report.subjectType === "LISTING" && report.listingId) {
        await this.suspendListing(report.listingId, `Signalement ${severity.toLowerCase()} en cours de revue`);
      } else if (report.shopId) {
        await this.prisma.shop.update({ where: { id: report.shopId }, data: { status: "SUSPENDED" } });
        await this.prisma.shopNotification.create({ data: { shopId: report.shopId, type: "MARKETPLACE_REPORT", title: "Boutique suspendue", message: `Signalement ${severity.toLowerCase()} en cours de revue.` } });
      }
    }
    await this.audit.record({ actorId: actor.id, action: "marketplace.report.classified", resourceType: "MarketplaceReport", resourceId: reportId, metadata: { severity } });
    return { id: updated.id, severity: updated.severity, status: updated.status };
  }

  async respondToReport(reportId: string, response: string, actor: AuthenticatedUser) {
    if (response.trim().length < 10 || response.length > 4000) throw new BadRequestException("La réponse doit contenir entre 10 et 4 000 caractères.");
    const report = await this.prisma.marketplaceReport.findUnique({ where: { id: reportId }, include: { listing: { select: { shopId: true } } } });
    if (!report) throw new NotFoundException("Signalement introuvable.");
    const shopId = report.shopId ?? report.listing?.shopId;
    if (!shopId) throw new NotFoundException("Boutique liée au signalement introuvable.");
    await this.requireShopAccess(shopId, actor);
    if (!["PENDING", "UNDER_REVIEW"].includes(report.status) || (report.responseDeadline && report.responseDeadline <= new Date())) {
      throw new BadRequestException("Le délai de réponse est dépassé ou le signalement est clôturé.");
    }
    const updated = await this.prisma.marketplaceReport.updateMany({
      where: { id: reportId, status: { in: ["PENDING", "UNDER_REVIEW"] } },
      data: { sellerResponse: response.trim(), responseAt: new Date(), status: "UNDER_REVIEW" },
    });
    if (updated.count !== 1) throw new ConflictException("Le signalement a été modifié simultanément.");
    await this.audit.record({ actorId: actor.id, action: "marketplace.report.responded", resourceType: "MarketplaceReport", resourceId: reportId });
    return { id: reportId, status: "UNDER_REVIEW" as const };
  }

  async reviewReport(reportId: string, decision: "RESOLVED" | "REJECTED", resolution: string, actor: AuthenticatedUser) {
    if (resolution.trim().length < 5) throw new BadRequestException("Un motif de décision est obligatoire.");
    const report = await this.prisma.marketplaceReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException("Signalement introuvable.");
    if (!["PENDING", "UNDER_REVIEW"].includes(report.status)) throw new BadRequestException("Ce signalement est déjà clôturé.");
    const result = await this.prisma.marketplaceReport.updateMany({
      where: { id: reportId, status: { in: ["PENDING", "UNDER_REVIEW"] } },
      data: { status: decision, resolution: resolution.trim(), reviewedById: actor.id, reviewedAt: new Date() },
    });
    if (result.count !== 1) throw new ConflictException("Le signalement a été modifié simultanément.");
    await this.audit.record({ actorId: actor.id, action: `marketplace.report.${decision.toLowerCase()}`, resourceType: "MarketplaceReport", resourceId: reportId, metadata: { resolution: resolution.trim() } });
    return { id: reportId, status: decision };
  }

  async listReportQueue() {
    return this.prisma.marketplaceReport.findMany({
      where: { status: { in: ["PENDING", "UNDER_REVIEW"] } },
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
      include: {
        listing: { select: { id: true, slug: true, status: true, suspendedReason: true } },
        shop: { select: { id: true, slug: true, name: true, status: true } },
        reporter: { select: { id: true, phone: true } },
      },
    });
  }

  async listShopNotifications(shopId: string, actor: AuthenticatedUser) {
    await this.requireShopAccess(shopId, actor);
    return this.prisma.shopNotification.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  async reviewPurchase(purchaseId: string, input: { rating: number; body?: string }, actor: AuthenticatedUser) {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new BadRequestException("La note doit être comprise entre 1 et 5.");
    const purchase = await this.prisma.purchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.buyerId !== actor.id || purchase.status !== "COMPLETED" || !purchase.completedAt) throw new ForbiddenException("Un avis est possible uniquement après un achat terminé.");
    return this.prisma.review.create({
      data: { purchaseId, listingId: purchase.listingId, shopId: purchase.shopId, authorId: actor.id, rating: input.rating, body: input.body?.trim() },
    });
  }

  async importStock(shopId: string, filename: string, buffer: Buffer, actor: AuthenticatedUser) {
    await this.requireShopAccess(shopId, actor);
    const rows: Record<string, unknown>[] = [];
    if (filename.toLowerCase().endsWith(".xlsx")) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as never);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new BadRequestException("Le fichier Excel ne contient aucune feuille.");
      const headers = worksheet.getRow(1).values as (string | undefined)[];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        rows.push(Object.fromEntries(headers.slice(1).map((header, index) => [String(header ?? "").trim(), row.getCell(index + 1).value])));
      });
    } else if (filename.toLowerCase().endsWith(".csv")) {
      const parsedRows = parse(buffer.toString("utf8"), { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: false }) as Record<string, unknown>[];
      rows.push(...parsedRows);
    } else {
      throw new BadRequestException("Formats acceptés : CSV ou XLSX.");
    }
    const results: { row: number; listingId?: string; error?: string }[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        const input: CreateListingInput = {
          imei: String(row.imei ?? ""), serialNumber: String(row.serialNumber ?? ""),
          model: String(row.model ?? ""), capacity: String(row.capacity ?? ""), color: String(row.color ?? ""),
          condition: String(row.condition ?? "GOOD") as CreateListingInput["condition"],
          batteryPercent: Number(row.batteryPercent), priceCashXof: Number(row.priceCashXof),
          paymentOptions: String(row.paymentOptions ?? "CASH").split("|").map((value) => value.trim()) as PaymentOptionKind[],
        };
        const listing = await this.createDraft(shopId, input, actor);
        results.push({ row: index + 2, listingId: listing.id });
      } catch (error) {
        results.push({ row: index + 2, error: error instanceof Error ? error.message : "Ligne invalide." });
      }
    }
    return { totalRows: rows.length, imported: results.filter((result) => result.listingId).length, errors: results.filter((result) => result.error), results };
  }

  private async suspendListing(listingId: string, reason: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      include: { device: { select: { imeiHash: true } } },
    });
    if (!listing || !["PUBLISHED", "RESERVED", "PENDING_REVIEW"].includes(listing.status)) return;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.marketplaceListing.update({ where: { id: listingId }, data: { status: "SUSPENDED", suspendedReason: reason } });
      if (shouldReleaseListingImei(listing.status)) {
        await transaction.device.updateMany({
          where: { id: listing.deviceId, activeListingHash: listing.device.imeiHash },
          data: { activeListingHash: null },
        });
      }
    });
    await this.prisma.shopNotification.create({
      data: { shopId: listing.shopId, type: "LISTING_SUSPENDED", title: "Annonce suspendue", message: reason },
    });
    await this.audit.record({ action: "marketplace.listing.suspended", resourceType: "MarketplaceListing", resourceId: listingId, metadata: { reason } });
  }

  private async requireShopAccess(shopId: string, actor: AuthenticatedUser) {
    const shop = await this.prisma.shop.findFirst({ where: { id: shopId, OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }] } });
    if (!shop && !actor.roles.includes("AGENT")) throw new ForbiddenException("Vous n’êtes pas membre de cette boutique.");
    if (!shop) {
      const agentShop = await this.prisma.shop.findUnique({ where: { id: shopId } });
      if (!agentShop) throw new NotFoundException("Boutique introuvable.");
      return agentShop;
    }
    return shop;
  }

  private async requireListingAccess(listingId: string, actor: AuthenticatedUser) {
    const listing = await this.prisma.marketplaceListing.findUnique({ where: { id: listingId }, include: { device: true } });
    if (!listing) throw new NotFoundException("Annonce introuvable.");
    if (actor.roles.includes("AGENT")) return listing;
    await this.requireShopAccess(listing.shopId, actor);
    return listing;
  }

  private validateListingInput(input: CreateListingInput) {
    if (!isValidImei(input.imei)) throw new BadRequestException("L’IMEI doit contenir 15 chiffres et avoir une clé de contrôle valide.");
    if (!input.serialNumber.trim() || !input.model.trim() || !input.capacity.trim() || !input.color.trim()) throw new BadRequestException("IMEI, numéro de série, modèle, capacité et couleur sont obligatoires.");
    if (!Number.isInteger(input.batteryPercent) || input.batteryPercent < 0 || input.batteryPercent > 100) throw new BadRequestException("La batterie doit être entre 0 et 100 %.");
    if (!Number.isSafeInteger(input.priceCashXof) || input.priceCashXof <= 0) throw new BadRequestException("Le prix comptant doit être un entier XOF positif.");
    if (!["NEW", "LIKE_NEW", "GOOD", "FAIR"].includes(input.condition)) throw new BadRequestException("État de l’appareil invalide.");
  }
}