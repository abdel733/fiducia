import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CryptoModule } from "../crypto/crypto.module";
import { PrismaModule } from "../database/prisma.module";
import { StorageModule } from "../storage/storage.module";
import { InspectionController } from "./inspection.controller";
import { InspectionService } from "./inspection.service";
import { InspectionWorkflowService } from "./inspection-workflow.service";

@Module({
  imports: [PrismaModule, CryptoModule, StorageModule, AuditModule],
  controllers: [InspectionController],
  providers: [InspectionService, InspectionWorkflowService],
  exports: [InspectionService],
})
export class InspectionModule {}
