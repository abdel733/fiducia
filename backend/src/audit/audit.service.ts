import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: { actorId?: string; action: string; resourceType: string; resourceId?: string; ipHash?: string; metadata?: Record<string, string | number | boolean | null> }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ipHash: input.ipHash,
        metadata: input.metadata ?? {},
      },
    });
  }
}