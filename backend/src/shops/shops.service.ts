import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ShopStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../database/prisma.service";
import { StorageProvider } from "../storage/storage.provider";
import { CreateShopDto, KycUploadDto } from "./shops.dto";

@Injectable()
export class ShopsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageProvider, private readonly crypto: CryptoService, private readonly audit: AuditService) {}

  async create(userId: string, input: CreateShopDto) {
    const slugBase = input.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "boutique";
    const slug = `${slugBase}-${randomBytes(3).toString("hex")}`;
    const shop = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shop.create({ data: { ...input, slug, ownerId: userId } });
      await tx.shopMember.create({ data: { shopId: created.id, userId, role: "OWNER" } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { roles: true } });
      if (!user.roles.includes("SELLER")) await tx.user.update({ where: { id: userId }, data: { roles: { push: "SELLER" } } });
      return created;
    });
    await this.audit.record({ actorId: userId, action: "SHOP_CREATED", resourceType: "Shop", resourceId: shop.id, metadata: { status: shop.status } });
    return shop;
  }

  async getForMember(userId: string, shopId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: { id: true, slug: true, name: true, city: true, address: true, whatsapp: true, logoKey: true, status: true, enabledPaymentOptions: true, ifu: true, rccm: true, createdAt: true },
    });
    if (!shop) throw new NotFoundException("Shop not found");
    return shop;
  }

  async listMine(userId: string) {
    return this.prisma.shop.findMany({ where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] }, select: { id: true, slug: true, name: true, city: true, status: true, enabledPaymentOptions: true, createdAt: true } });
  }

  async updatePaymentOptions(userId: string, shopId: string, options: import("@prisma/client").PaymentOptionKind[]) {
    const shop = await this.prisma.shop.findFirst({ where: { id: shopId, ownerId: userId } });
    if (!shop) throw new ForbiddenException("Seul le propriétaire peut modifier les options de paiement.");
    if (!options.includes("CASH") || new Set(options).size !== options.length) throw new BadRequestException("Le paiement comptant reste activé et les options ne peuvent pas être dupliquées.");
    const updated = await this.prisma.shop.update({ where: { id: shopId }, data: { enabledPaymentOptions: options }, select: { id: true, enabledPaymentOptions: true } });
    await this.audit.record({ actorId: userId, action: "SHOP_PAYMENT_OPTIONS_UPDATED", resourceType: "Shop", resourceId: shopId, metadata: { options: options.join(",") } });
    return updated;
  }

  async uploadLogo(userId: string, shopId: string, file: Express.Multer.File) {
    await this.getForMember(userId, shopId);
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException("Shop logo exceeds the 2 MiB limit");
    const mimeType = detectImageType(file.buffer);
    if (!mimeType) throw new BadRequestException("Shop logo must be a valid JPEG or PNG image");
    const shop = await this.prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { logoKey: true } });
    const key = `shops/${shopId}/logos/${randomUUID()}`;
    await this.storage.uploadPublicAsset(key, file.buffer, mimeType);
    await this.prisma.shop.update({ where: { id: shopId }, data: { logoKey: key } });
    if (shop.logoKey) await this.storage.delete(shop.logoKey);
    return { status: "UPLOADED" as const };
  }

  async getLogoUrl(shopId: string) {
    const shop = await this.prisma.shop.findFirst({ where: { id: shopId, status: "VERIFIED", logoKey: { not: null } }, select: { logoKey: true } });
    if (!shop?.logoKey) throw new NotFoundException("Shop logo not found");
    return { url: await this.storage.createDownloadUrl(shop.logoKey), expiresIn: 300 };
  }

  async createKycUpload(userId: string, shopId: string, input: KycUploadDto, file: Express.Multer.File) {
    await this.getForMember(userId, shopId);
    const mimeType = detectDocumentType(file.buffer);
    if (!mimeType) throw new BadRequestException("Only valid PDF, JPEG, or PNG documents are accepted");
    const key = `shops/${shopId}/kyc/${randomUUID()}.enc`;
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    await this.storage.uploadPrivate(key, this.crypto.encryptBuffer(file.buffer));
    let document;
    try {
      document = await this.prisma.kycDocument.create({
        data: { ownerUserId: userId, shopId, kind: input.kind, storageKey: key, originalName: file.originalname.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120), mimeType, sizeBytes: file.size, sha256, verifiedAt: new Date() },
        select: { id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
      });
    } catch (error) {
      await this.storage.delete(key);
      throw error;
    }
    await this.audit.record({ actorId: userId, action: "SHOP_KYC_UPLOAD_CREATED", resourceType: "KycDocument", resourceId: document.id, metadata: { kind: input.kind } });
    return { document, status: "UPLOADED" as const };
  }

  async downloadKyc(userId: string, shopId: string, documentId: string) {
    await this.getForMember(userId, shopId);
    const document = await this.prisma.kycDocument.findFirst({ where: { id: documentId, shopId, verifiedAt: { not: null } } });
    if (!document) throw new NotFoundException("Document not found");
    try {
      return { document, body: this.crypto.decryptBuffer(await this.storage.downloadPrivate(document.storageKey)) };
    } catch {
      throw new BadRequestException("Stored document could not be decrypted");
    }
  }

  async createInvitation(userId: string, shopId: string, phone: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { ownerId: true } });
    if (!shop) throw new NotFoundException("Shop not found");
    if (shop.ownerId !== userId) throw new ForbiddenException();
    const token = randomBytes(32).toString("base64url");
    const invitation = await this.prisma.shopInvitation.create({ data: { shopId, invitedById: userId, phone, tokenHash: this.crypto.hashSecret(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) } });
    await this.audit.record({ actorId: userId, action: "SHOP_INVITATION_CREATED", resourceType: "ShopInvitation", resourceId: invitation.id });
    return { id: invitation.id, token, expiresAt: invitation.expiresAt };
  }

  async acceptInvitation(userId: string, token: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true, roles: true } });
    const tokenHash = this.crypto.hashSecret(token);
    const invitation = await this.prisma.shopInvitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date() || invitation.phone !== user.phone) throw new NotFoundException("Invitation not found");
    await this.prisma.$transaction(async (tx) => {
      const accepted = await tx.shopInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (accepted.count !== 1) throw new NotFoundException("Invitation not found");
      await tx.shopMember.create({ data: { shopId: invitation.shopId, userId, role: "SHOP_STAFF" } });
      if (!user.roles.includes("SHOP_STAFF")) await tx.user.update({ where: { id: userId }, data: { roles: { push: "SHOP_STAFF" } } });
    });
    await this.audit.record({ actorId: userId, action: "SHOP_INVITATION_ACCEPTED", resourceType: "ShopInvitation", resourceId: invitation.id });
    return { shopId: invitation.shopId, role: "SHOP_STAFF" as const };
  }

  async updateStatus(actorId: string, shopId: string, status: ShopStatus) {
    const current = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { status: true } });
    if (!current) throw new NotFoundException("Shop not found");
    if (current.status === status) return { id: shopId, status };
    if (!canTransitionShopStatus(current.status, status)) throw new ConflictException(`Invalid shop status transition: ${current.status} -> ${status}`);
    const changed = await this.prisma.shop.updateMany({ where: { id: shopId, status: current.status }, data: { status } });
    if (changed.count !== 1) throw new ConflictException("Shop status changed concurrently");
    await this.audit.record({ actorId, action: "SHOP_STATUS_CHANGED", resourceType: "Shop", resourceId: shopId, metadata: { status } });
    return { id: shopId, status };
  }
}

function detectDocumentType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

function detectImageType(buffer: Buffer): string | null {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

export function canTransitionShopStatus(from: ShopStatus, to: ShopStatus): boolean {
  const allowed: Record<ShopStatus, ShopStatus[]> = {
    PENDING: ["VERIFIED", "REJECTED"],
    VERIFIED: ["SUSPENDED"],
    REJECTED: ["PENDING"],
    SUSPENDED: ["VERIFIED", "REJECTED"],
  };
  return allowed[from].includes(to);
}