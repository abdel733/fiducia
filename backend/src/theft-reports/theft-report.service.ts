import { CertificateService } from "../certificates/certificate.service";

export type TheftReportStatus = "PENDING" | "VERIFIED" | "REJECTED";

export interface TheftReportInput {
  id?: string;
  imei: string;
  date: string;
  place: string;
  policeReceipt: boolean;
  buyerName?: string;
  notes?: string;
}

export interface TheftReportRecord {
  id: string;
  imei: string;
  date: string;
  place: string;
  policeReceipt: boolean;
  buyerName?: string;
  notes?: string;
  status: TheftReportStatus;
  reviewedAt?: string;
  reviewedBy?: string;
}

export class TheftReportService {
  constructor(
    private readonly dependencies: {
      certificateService?: CertificateService;
    } = {},
  ) {}

  verifyTheft(input: TheftReportInput): TheftReportRecord {
    const report: TheftReportRecord = {
      id: input.id ?? `theft-${Date.now()}`,
      imei: input.imei,
      date: input.date,
      place: input.place,
      policeReceipt: input.policeReceipt,
      buyerName: input.buyerName,
      notes: input.notes,
      status: "VERIFIED",
      reviewedAt: new Date().toISOString(),
      reviewedBy: "admin",
    };

    this.dependencies.certificateService?.revokeByImei(input.imei, "Reported stolen");
    return report;
  }
}
