import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG, AppConfig } from "../config/config";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../database/prisma.service";
import { InspectionEvaluation } from "../inspection/inspection.service";
import { SigningProvider } from "./signing.provider";

export type CertificateStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "SUPERSEDED";
export type RiskLevel = "TRUSTED" | "REVIEW" | "BLOCKED" | "STOLEN";

export interface IssueCertificateInput {
  imei: string;
  model: string;
  capacity: string;
  color: string;
  riskLevel: RiskLevel;
  sourcesConsulted: string[];
  reportTime: string;
  shopId: string;
  shopName: string;
  validatedByAgent: boolean;
  inspection: InspectionEvaluation;
}

export interface CertificateRecord {
  id: string;
  code: string;
  imei: string;
  model: string;
  capacity: string;
  color: string;
  riskLevel: RiskLevel;
  sourcesConsulted: string[];
  issuedAt: string;
  expiresAt: string;
  status: CertificateStatus;
  signature: string;
  signingKeyId?: string;
  signatureValid: boolean;
  revocationReason?: string;
  shopId: string;
  shopName: string;
}

export interface IssuePersistedCertificateInput {
  verificationReportId: string;
  inspectionId: string;
  shopId: string;
  model: string;
  capacity: string;
  color: string;
}

export class CertificateService {
  private readonly certificates = new Map<string, CertificateRecord>();

  constructor(
    private readonly dependencies: {
      signingProvider: SigningProvider;
      inspectionService?: { evaluate: (input: any) => InspectionEvaluation };
      prisma?: PrismaService;
      crypto?: CryptoService;
      audit?: AuditService;
      config?: AppConfig;
    },
  ) {}

  async issueFromReport(input: IssuePersistedCertificateInput, actor: AuthenticatedUser): Promise<{
    id: string;
    code: string;
    status: string;
    issuedAt: Date;
    expiresAt: Date;
    maskedImei: string;
    model: string;
    capacity: string;
    color: string;
    legalNotice: string;
  }> {
    const prisma = this.requirePrisma();
    const report = await prisma.verificationReport.findUnique({ where: { id: input.verificationReportId } });
    if (!report) throw new NotFoundException("Rapport de vérification introuvable.");

    const now = new Date();
    const ageMs = now.getTime() - report.checkedAt.getTime();
    if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) throw new BadRequestException("Le rapport de vérification doit dater de moins de 24 heures.");
    if (report.verdict !== "TRUSTED" && report.verdict !== "WARNING") throw new BadRequestException("Ce verdict ne permet pas l’émission d’un certificat.");
    if (report.verdict === "WARNING" && !actor.roles.includes("AGENT")) throw new ForbiddenException("Un agent doit valider un rapport avec avertissement.");

    const inspection = await prisma.inspection.findUnique({ where: { id: input.inspectionId }, include: { photos: true } });
    if (!inspection || inspection.imeiHash !== report.imeiHash || inspection.shopId !== input.shopId || inspection.verdict !== "PASS") {
      throw new BadRequestException("Une inspection réussie pour le même IMEI et la même boutique est requise.");
    }
    const photoKinds = new Set(inspection.photos.map((photo) => photo.kind));
    if (!["FRONT", "BACK", "SETTINGS_IMEI_SERIAL"].every((kind) => photoKinds.has(kind as typeof inspection.photos[number]["kind"]))) {
      throw new BadRequestException("Les trois photos obligatoires de l’inspection sont requises.");
    }

    const shop = await prisma.shop.findUnique({ where: { id: input.shopId } });
    if (!shop || shop.status !== "VERIFIED") throw new BadRequestException("La boutique doit être vérifiée avant l’émission.");
    const isAgent = actor.roles.includes("AGENT");
    const isMember = shop.ownerId === actor.id || Boolean(await prisma.shopMember.findUnique({ where: { shopId_userId: { shopId: shop.id, userId: actor.id } } }));
    if (!isAgent && !isMember) throw new ForbiddenException("Vous n’êtes pas membre de cette boutique.");

    const registryEntry = await prisma.imeiRegistryEntry.findUnique({ where: { imeiHash: report.imeiHash } });
    if (registryEntry?.status === "REPORTED_STOLEN" || registryEntry?.status === "BLOCKED" || registryEntry?.status === "SOLD" || registryEntry?.status === "UNDER_RESERVATION") {
      throw new BadRequestException("L’IMEI est bloqué dans le registre interne.");
    }
    let lienLenderId: string | null = null;
    if (registryEntry?.status === "UNDER_LIEN") {
      const lenderMembership = registryEntry.lenderId && actor.roles.includes("FINANCE_PARTNER")
        ? await prisma.lenderMember.findUnique({ where: { userId_lenderId: { userId: actor.id, lenderId: registryEntry.lenderId } } })
        : null;
      if (!lenderMembership) throw new BadRequestException("Un appareil sous contrat de financement ne peut pas être certifié par ce vendeur.");
      lienLenderId = registryEntry.lenderId;
    }

    const competingListing = await prisma.marketplaceListing.findFirst({
      where: { device: { is: { imeiHash: report.imeiHash } }, status: { in: ["PUBLISHED", "RESERVED"] }, shopId: { not: input.shopId } },
      select: { id: true },
    });
    if (competingListing) throw new BadRequestException("Cet IMEI est déjà associé à une annonce active d’une autre boutique.");
    if (![input.model, input.capacity, input.color].every((value) => value.trim().length > 0 && value.length <= 120)) {
      throw new BadRequestException("Le modèle, la capacité et la couleur sont requis.");
    }
    if (await prisma.certificate.findUnique({ where: { verificationReportId: report.id } })) {
      throw new BadRequestException("Ce rapport a déjà servi à émettre un certificat.");
    }

    const signingKeyId = this.signingProvider.activeKeyId;
    const code = this.generateCode();
    const issuedAt = now;
    const validityDays = this.dependencies.config?.CERTIFICATE_VALIDITY_DAYS ?? 7;
    const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
    const checkedDate = new Intl.DateTimeFormat("fr-BJ", { dateStyle: "long" }).format(report.checkedAt);
    const legalNotice = `Aucun signalement trouvé dans les bases consultées le ${checkedDate}. Ce certificat n'est pas une garantie d'origine.`;
    const lienNotice = lienLenderId ? "Sous contrat de financement, non cessible jusqu'à mainlevée." : "";
    const id = `cert-${randomBytes(12).toString("hex")}`;
    const payload = JSON.stringify({
      id, code, imeiHash: report.imeiHash, maskedImei: report.maskedImei,
      model: input.model.trim(), capacity: input.capacity.trim(), color: input.color.trim(),
      riskLevel: report.verdict, sourcesConsulted: report.sourcesConsulted,
      issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), shopId: shop.id,
      shopName: shop.name, verificationReportId: report.id, inspectionId: inspection.id,
      lienLenderId, legalNotice, lienNotice,
    });
    const signature = this.signingProvider.sign(payload);
    const prismaTransaction = await prisma.$transaction(async (transaction) => {
      const certificate = await transaction.certificate.create({
        data: {
          id, code, imeiHash: report.imeiHash, maskedImei: report.maskedImei,
          model: input.model.trim(), capacity: input.capacity.trim(), color: input.color.trim(),
          riskLevel: report.verdict, sourcesConsulted: report.sourcesConsulted,
          issuedAt, expiresAt, status: "ACTIVE", signature, signingKeyId,
          shopId: shop.id, issuerId: actor.id, verificationReportId: report.id,
          inspectionId: inspection.id, lienLenderId, legalNotice,
        },
      });
      await transaction.certificate.updateMany({
        where: { imeiHash: report.imeiHash, shopId: shop.id, status: "ACTIVE", id: { not: certificate.id } },
        data: { status: "SUPERSEDED", supersededById: certificate.id },
      });
      if (!registryEntry) {
        await transaction.imeiRegistryEntry.create({
          data: { imeiHash: report.imeiHash, status: "CERTIFIED", reason: "Certificat Fiducia émis", changedById: actor.id },
        });
      }
      return certificate;
    });
    await this.dependencies.audit?.record({
      actorId: actor.id,
      action: "certificate.issued",
      resourceType: "Certificate",
      resourceId: prismaTransaction.id,
      metadata: { code: prismaTransaction.code, shopId: shop.id, riskLevel: report.verdict, signingKeyId },
    });
    return {
      id: prismaTransaction.id,
      code: prismaTransaction.code,
      status: prismaTransaction.status,
      issuedAt: prismaTransaction.issuedAt,
      expiresAt: prismaTransaction.expiresAt,
      maskedImei: prismaTransaction.maskedImei,
      model: prismaTransaction.model,
      capacity: prismaTransaction.capacity,
      color: prismaTransaction.color,
      legalNotice: prismaTransaction.legalNotice,
    };
  }

  async verifyPublicCode(code: string) {
    const prisma = this.requirePrisma();
    const certificate = await prisma.certificate.findUnique({ where: { code: code.toUpperCase() }, include: { shop: true } });
    if (!certificate) return { code: code.toUpperCase(), status: "REVOKED", signatureValid: false, valid: false };

    let status = certificate.status;
    if (status === "ACTIVE" && certificate.expiresAt.getTime() <= Date.now()) {
      const expired = await prisma.certificate.updateMany({ where: { id: certificate.id, status: "ACTIVE" }, data: { status: "EXPIRED" } });
      if (expired.count) status = "EXPIRED";
    }

    const report = await prisma.verificationReport.findUnique({ where: { id: certificate.verificationReportId } });
    const inspection = certificate.inspectionId
      ? await prisma.inspection.findUnique({ where: { id: certificate.inspectionId } })
      : null;
    const lienNotice = certificate.lienLenderId ? "Sous contrat de financement, non cessible jusqu'à mainlevée." : null;
    const payload = report ? JSON.stringify({
      id: certificate.id, code: certificate.code, imeiHash: certificate.imeiHash,
      maskedImei: certificate.maskedImei, model: certificate.model, capacity: certificate.capacity,
      color: certificate.color, riskLevel: certificate.riskLevel, sourcesConsulted: certificate.sourcesConsulted,
      issuedAt: certificate.issuedAt.toISOString(), expiresAt: certificate.expiresAt.toISOString(),
      shopId: certificate.shopId, shopName: certificate.shop.name,
      verificationReportId: certificate.verificationReportId, inspectionId: certificate.inspectionId,
      lienLenderId: certificate.lienLenderId, legalNotice: certificate.legalNotice, lienNotice: lienNotice ?? "",
    }) : "";
    const signatureValid = Boolean(report && inspection && this.signingProvider.verify(payload, certificate.signature, certificate.signingKeyId));
    const registryEntry = await prisma.imeiRegistryEntry.findUnique({ where: { imeiHash: certificate.imeiHash } });
    const valid = signatureValid && status === "ACTIVE" && registryEntry?.status !== "REPORTED_STOLEN" && registryEntry?.status !== "BLOCKED";
    return {
      code: certificate.code,
      status,
      signatureValid,
      valid,
      maskedImei: certificate.maskedImei,
      model: certificate.model,
      capacity: certificate.capacity,
      color: certificate.color,
      riskLevel: certificate.riskLevel,
      sourcesConsulted: certificate.sourcesConsulted,
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
      shopName: certificate.shop.name,
      legalNotice: certificate.legalNotice,
      lienNotice,
    };
  }

  async revokeByImeiHash(imeiHash: string, reason: string) {
    const prisma = this.requirePrisma();
    return prisma.certificate.updateMany({
      where: { imeiHash, status: "ACTIVE" },
      data: { status: "REVOKED", revocationReason: reason },
    });
  }

  private requirePrisma(): PrismaService {
    if (!this.dependencies.prisma) throw new Error("Prisma is required for persisted certificate operations");
    return this.dependencies.prisma;
  }

  private get signingProvider(): SigningProvider {
    return this.dependencies.signingProvider;
  }

  private buildPayload(record: Omit<CertificateRecord, "signature" | "signatureValid">): string {
    return JSON.stringify({
      id: record.id,
      code: record.code,
      imei: record.imei,
      model: record.model,
      capacity: record.capacity,
      color: record.color,
      riskLevel: record.riskLevel,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      status: record.status,
      shopId: record.shopId,
      shopName: record.shopName,
    });
  }

  private generateCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(8);
    const groups = [0, 4].map((start) => Array.from(bytes.subarray(start, start + 4), (byte) => alphabet[byte & 31]).join(""));
    return `FD-${groups[0]}-${groups[1]}`;
  }

  issue(input: IssueCertificateInput): CertificateRecord {
    const now = new Date();
    const reportTime = new Date(input.reportTime);
    const freshnessWindow = 24 * 60 * 60 * 1000;

    if (!input.validatedByAgent) {
      throw new Error("Le certificat ne peut être délivré sans validation d’agent.");
    }

    if (input.riskLevel === "BLOCKED" || input.riskLevel === "STOLEN") {
      throw new Error("Le risque de l’appareil ne permet pas l’émission d’un certificat.");
    }

    if (Number.isNaN(reportTime.getTime()) || now.getTime() - reportTime.getTime() > freshnessWindow) {
      throw new Error("Le contrôle doit être récent pour émettre une attestation.");
    }

    if (!input.inspection.passed) {
      throw new Error("L’inspection doit être valide pour signer un certificat.");
    }

    const record: CertificateRecord = {
      id: `cert-${randomBytes(6).toString("hex")}`,
      code: this.generateCode(),
      imei: input.imei,
      model: input.model,
      capacity: input.capacity,
      color: input.color,
      riskLevel: input.riskLevel,
      sourcesConsulted: input.sourcesConsulted,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: "ACTIVE",
      signature: "",
      signatureValid: false,
      shopId: input.shopId,
      shopName: input.shopName,
    };

    const payload = this.buildPayload(record);
    record.signature = this.signingProvider.sign(payload);
    record.signatureValid = this.signingProvider.verify(payload, record.signature);

    this.certificates.set(record.code, record);
    return record;
  }

  findByCode(code: string): CertificateRecord | undefined {
    return this.certificates.get(code);
  }

  verifyCode(code: string): { code: string; status: CertificateStatus; signatureValid: boolean; valid: boolean } {
    const record = this.certificates.get(code);
    if (!record) {
      return { code, status: "REVOKED", signatureValid: false, valid: false };
    }

    const payload = this.buildPayload(record);
    const signatureValid = this.signingProvider.verify(payload, record.signature);
    const valid = signatureValid && record.status === "ACTIVE";

    return {
      code,
      status: record.status,
      signatureValid,
      valid,
    };
  }

  revokeByImei(imei: string, reason: string): CertificateRecord[] {
    const revoked: CertificateRecord[] = [];

    for (const record of this.certificates.values()) {
      if (record.imei === imei && record.status === "ACTIVE") {
        const updated = { ...record, status: "REVOKED" as const, revocationReason: reason };
        Object.assign(record, updated);
        this.certificates.set(updated.code, updated);
        revoked.push(updated);
      }
    }

    return revoked;
  }
}
