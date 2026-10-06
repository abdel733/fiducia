import { Module } from "@nestjs/common";
import { CertificateModule } from "../certificates/certificate.module";
import { TheftReportController } from "./theft-report.controller";
import { TheftReportService } from "./theft-report.service";

@Module({
  imports: [CertificateModule],
  controllers: [TheftReportController],
  providers: [TheftReportService],
  exports: [TheftReportService],
})
export class TheftReportModule {}
