import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG, AppConfig } from "../config/config";
import { CryptoModule } from "../crypto/crypto.module";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaModule } from "../database/prisma.module";
import { PrismaService } from "../database/prisma.service";
import { InspectionModule } from "../inspection/inspection.module";
import { InspectionService } from "../inspection/inspection.service";
import { CertificateController } from "./certificate.controller";
import { CertificateService } from "./certificate.service";
import { SigningProvider } from "./signing.provider";

@Module({
  imports: [InspectionModule, PrismaModule, CryptoModule, AuditModule],
  controllers: [CertificateController],
  providers: [
    SigningProvider,
    {
      provide: CertificateService,
      useFactory: (signingProvider: SigningProvider, inspectionService: InspectionService, prisma: PrismaService, crypto: CryptoService, audit: AuditService, config: AppConfig) => new CertificateService({
        signingProvider,
        inspectionService,
        prisma,
        crypto,
        audit,
        config,
      }),
      inject: [SigningProvider, InspectionService, PrismaService, CryptoService, AuditService, APP_CONFIG],
    },
  ],
  exports: [CertificateService, SigningProvider],
})
export class CertificateModule {}
