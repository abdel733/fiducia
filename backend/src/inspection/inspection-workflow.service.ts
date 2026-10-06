import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import sharp from "sharp";
import { AuthenticatedUser } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../database/prisma.service";
import { StorageProvider } from "../storage/storage.provider";
import { InspectionChecklistInput, InspectionService, REQUIRED_INSPECTION_PHOTOS } from "./inspection.service";

export type InspectionPhotoFiles = Partial<Record<(typeof REQUIRED_INSPECTION_PHOTOS)[number], Express.Multer.File[]>>;

@Injectable()
export class InspectionWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
    private readonly evaluator: InspectionService,
  ) {}

  async create(input: InspectionChecklistInput & { shopId: string; verificationReportId: string }, files: InspectionPhotoFiles, actor: AuthenticatedUser) {
    const isAgent = actor.roles.includes("AGENT");
    const shop = await this.prisma.shop.findFirst({
      where: isAgent ? { id: input.shopId } : { id: input.shopId, OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }] },
      select: { id: true },
    });
    if (!shop) throw new ForbiddenException("L’inspection est réservée au vendeur de la boutique ou à un agent partenaire.");

    const report = await this.prisma.verificationReport.findUnique({ where: { id: input.verificationReportId } });
    if (!report) throw new NotFoundException("Rapport IMEI introuvable.");
    const now = new Date();
    if (report.checkedAt > now || now.getTime() - report.checkedAt.getTime() > 24 * 60 * 60 * 1000) {
      throw new BadRequestException("La vérification IMEI doit dater de moins de 24 heures.");
    }
    if (report.verdict !== "TRUSTED" && report.verdict !== "WARNING") throw new BadRequestException("Un verdict IMEI refusé ne peut pas être inspecté pour certification.");
    if (report.verdict === "WARNING" && !isAgent) throw new ForbiddenException("Un agent partenaire doit valider un IMEI avec avertissement.");
    if (report.inspectionId) throw new ConflictException("Ce rapport IMEI est déjà associé à une inspection.");

    const photoFiles = new Map<string, Express.Multer.File>();
    for (const kind of REQUIRED_INSPECTION_PHOTOS) {
      const file = files[kind]?.[0];
      if (!file || !file.mimetype.startsWith("image/") || file.size > 8 * 1024 * 1024) {
        throw new BadRequestException(`La photo ${kind} est obligatoire et doit faire 8 Mo maximum.`);
      }
      photoFiles.set(kind, file);
    }

    const evaluation = this.evaluator.evaluate({ ...input, photos: [...photoFiles.keys()] });
    const inspectionId = `inspection-${randomUUID()}`;
    const uploaded: { kind: string; key: string; mimeType: string; size: number; sha256: string }[] = [];
    try {
      for (const [kind, file] of photoFiles) {
        const result = await sharp(file.buffer, { failOn: "error" }).rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
        const key = `inspections/${inspectionId}/${kind}.webp.enc`;
        await this.storage.uploadPrivate(key, this.crypto.encryptBuffer(result));
        uploaded.push({ kind, key, mimeType: "image/webp", size: result.length, sha256: createHash("sha256").update(result).digest("hex") });
      }

      const inspection = await this.prisma.$transaction(async (transaction) => {
        const reserved = await transaction.verificationReport.updateMany({
          where: { id: report.id, inspectionId: null, checkedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
          data: { inspectionId },
        });
        if (reserved.count !== 1) throw new ConflictException("Le rapport a déjà été utilisé ou vient d’expirer.");
        return transaction.inspection.create({
          data: {
            id: inspectionId,
            imeiHash: report.imeiHash,
            maskedImei: report.maskedImei,
            shopId: shop.id,
            inspectorId: actor.id,
            inspectorRole: isAgent ? "AGENT" : actor.roles.includes("SHOP_STAFF") ? "SHOP_STAFF" : "SELLER",
            score: evaluation.score,
            verdict: evaluation.verdict,
            screenOriginal: input.screenOriginal,
            batteryPercent: input.batteryPercent,
            faceId: input.faceId ?? null,
            touchId: input.touchId ?? null,
            cameras: input.cameras,
            buttons: input.buttons,
            speakers: input.speakers,
            ports: input.ports,
            repairTraces: input.repairTraces,
            notes: input.notes?.slice(0, 2000),
            checklist: { ...evaluation.checks, requiredPhotos: evaluation.requiredPhotos },
            photos: { create: uploaded.map((photo) => ({ kind: photo.kind === "settings-imei-serial" ? "SETTINGS_IMEI_SERIAL" : photo.kind.toUpperCase(), storageKey: photo.key, mimeType: photo.mimeType, sizeBytes: photo.size, sha256: photo.sha256 })) },
          },
          select: { id: true, score: true, verdict: true, maskedImei: true, createdAt: true, photos: { select: { kind: true } } },
        });
      });
      await this.audit.record({ actorId: actor.id, action: "inspection.created", resourceType: "Inspection", resourceId: inspection.id, metadata: { shopId: shop.id, verdict: inspection.verdict, score: inspection.score } });
      return { ...inspection, summary: evaluation.summary, requiredPhotos: evaluation.requiredPhotos };
    } catch (error) {
      await Promise.all(uploaded.map((photo) => this.storage.delete(photo.key).catch(() => undefined)));
      throw error;
    }
  }
}