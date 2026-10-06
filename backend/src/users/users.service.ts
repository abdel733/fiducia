import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { StorageProvider } from "../storage/storage.provider";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageProvider, private readonly audit: AuditService) {}

  async exportAccount(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, phone: true, roles: true, createdAt: true,
        consents: { select: { kind: true, version: true, acceptedAt: true } },
        shopMemberships: { select: { role: true, createdAt: true, shop: { select: { id: true, name: true, status: true } } } },
        lenderMemberships: { select: { lender: { select: { name: true, type: true, status: true } } } },
        kycDocuments: { select: { id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
      },
    });
    return { exportedAt: new Date().toISOString(), user };
  }

  async requestDeletion(userId: string): Promise<{ status: "DELETED" }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const documents = await this.prisma.kycDocument.findMany({ where: { ownerUserId: userId }, select: { id: true, storageKey: true } });
    await Promise.all(documents.map((document) => this.storage.delete(document.storageKey)));
    await this.prisma.$transaction(async (tx) => {
      await tx.kycDocument.deleteMany({ where: { ownerUserId: userId } });
      await tx.consent.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.shopInvitation.deleteMany({ where: { invitedById: userId } });
      await tx.shopMember.deleteMany({ where: { userId, role: "SHOP_STAFF" } });
      await tx.lenderMember.deleteMany({ where: { userId } });
      if (user.phone) await tx.otpChallenge.deleteMany({ where: { phone: user.phone } });
      await tx.user.update({ where: { id: userId }, data: { phone: null, roles: ["BUYER"], status: "DELETED", deletionRequestedAt: new Date() } });
    });
    await this.audit.record({ actorId: userId, action: "ACCOUNT_PERSONAL_DATA_DELETED", resourceType: "User", resourceId: userId });
    return { status: "DELETED" };
  }
}