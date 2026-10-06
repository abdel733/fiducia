import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { LenderStatus } from "@prisma/client";
import { CryptoService } from "../crypto/crypto.service";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { StorageProvider } from "../storage/storage.provider";
import { RegisterLenderDto } from "./lenders.dto";

@Injectable()
export class LendersService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageProvider, private readonly crypto: CryptoService, private readonly audit: AuditService) {}

  async uploadLicense(userId: string, file: Express.Multer.File) {
    const mimeType = detectDocumentType(file.buffer);
    if (!mimeType) throw new BadRequestException("Only valid PDF, JPEG, or PNG documents are accepted");
    const key = `lenders/${userId}/licenses/${randomUUID()}.enc`;
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    await this.storage.uploadPrivate(key, this.crypto.encryptBuffer(file.buffer));
    const document = await this.prisma.kycDocument.create({
      data: { ownerUserId: userId, kind: "LENDER_LICENSE", storageKey: key, originalName: file.originalname.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120), mimeType, sizeBytes: file.size, sha256, verifiedAt: new Date() },
      select: { id: true, kind: true, originalName: true, createdAt: true },
    });
    return { document };
  }

  async register(userId: string, input: RegisterLenderDto) {
    const accreditation = await this.prisma.kycDocument.findFirst({ where: { id: input.accreditationDocumentId, ownerUserId: userId, kind: "LENDER_LICENSE", verifiedAt: { not: null } }, select: { storageKey: true } });
    if (!accreditation) throw new ForbiddenException("A verified accreditation document is required");
    if (new Date(input.validUntil) <= new Date()) throw new BadRequestException("Accreditation has expired");
    const organization = await this.prisma.$transaction(async (tx) => {
      const lender = await tx.lenderOrganization.create({ data: { name: input.name, type: input.type, accreditationNumber: input.accreditationNumber, accreditationDocumentKey: accreditation.storageKey, validUntil: new Date(input.validUntil) } });
      await tx.lenderMember.create({ data: { lenderId: lender.id, userId } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { roles: true } });
      if (!user.roles.includes("FINANCE_PARTNER")) await tx.user.update({ where: { id: userId }, data: { roles: { push: "FINANCE_PARTNER" } } });
      return lender;
    });
    await this.audit.record({ actorId: userId, action: "LENDER_REGISTERED", resourceType: "LenderOrganization", resourceId: organization.id, metadata: { type: organization.type, status: organization.status } });
    return organization;
  }

  async listMine(userId: string) {
    return this.prisma.lenderOrganization.findMany({ where: { members: { some: { userId } } }, select: { id: true, name: true, type: true, accreditationNumber: true, validUntil: true, status: true } });
  }

  async updateStatus(actorId: string, lenderId: string, status: LenderStatus) {
    const lender = await this.prisma.lenderOrganization.update({ where: { id: lenderId }, data: { status }, select: { id: true, status: true } }).catch(() => null);
    if (!lender) throw new NotFoundException("Lender not found");
    await this.audit.record({ actorId, action: "LENDER_STATUS_CHANGED", resourceType: "LenderOrganization", resourceId: lenderId, metadata: { status } });
    return lender;
  }
}

function detectDocumentType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}