import { createPrivateKey, createPublicKey } from "node:crypto";
import { CertificateService } from "../src/certificates/certificate.service";
import { SigningProvider } from "../src/certificates/signing.provider";
import { TheftReportService } from "../src/theft-reports/theft-report.service";
import { InspectionService } from "../src/inspection/inspection.service";
import { validateEnvironment } from "@fiducia/config";

describe("Part 3 foundations", () => {
  it("issues a signed certificate only for a recent trusted report validated by an agent", () => {
    const signing = new SigningProvider();
    const inspection = new InspectionService();
    const certificates = new CertificateService({ signingProvider: signing, inspectionService: inspection });

    const inspectionResult = inspection.evaluate({
      screenOriginal: true,
      batteryPercent: 92,
      faceId: true,
      cameras: true,
      buttons: true,
      speakers: true,
      ports: true,
      repairTraces: false,
      photos: ["front", "back", "settings-imei-serial"],
    });

    const cert = certificates.issue({
      imei: "490154203237518",
      model: "iPhone 13",
      capacity: "128 Go",
      color: "Bleu",
      riskLevel: "TRUSTED",
      sourcesConsulted: ["mock"],
      reportTime: new Date().toISOString(),
      shopId: "shop-1",
      shopName: "Atelier Mobile",
      validatedByAgent: true,
      inspection: inspectionResult,
    });

    expect(cert.status).toBe("ACTIVE");
    expect(cert.code).toMatch(/^FD-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(cert.signatureValid).toBe(true);
  });

  it("revokes a certificate when a theft report is verified", () => {
    const signing = new SigningProvider();
    const inspection = new InspectionService();
    const certificates = new CertificateService({ signingProvider: signing, inspectionService: inspection });
    const theftReports = new TheftReportService({ certificateService: certificates });

    const certificate = certificates.issue({
      imei: "490154203237518",
      model: "iPhone 13",
      capacity: "128 Go",
      color: "Bleu",
      riskLevel: "TRUSTED",
      sourcesConsulted: ["mock"],
      reportTime: new Date().toISOString(),
      shopId: "shop-1",
      shopName: "Atelier Mobile",
      validatedByAgent: true,
      inspection: inspection.evaluate({ screenOriginal: true, batteryPercent: 90, faceId: true, cameras: true, buttons: true, speakers: true, ports: true, repairTraces: false, photos: ["front", "back", "settings-imei-serial"] }),
    });

    const report = theftReports.verifyTheft({
      id: "report-1",
      imei: "490154203237518",
      date: new Date().toISOString(),
      place: "Cotonou",
      policeReceipt: true,
      buyerName: "Client A",
    });

    expect(report.status).toBe("VERIFIED");
    expect(certificate.status).toBe("REVOKED");
    expect(certificate.revocationReason).toBe("Reported stolen");
  });

  it("does not pass an inspection when the settings photo is missing", () => {
    const inspection = new InspectionService().evaluate({
      screenOriginal: true,
      batteryPercent: 92,
      faceId: true,
      cameras: true,
      buttons: true,
      speakers: true,
      ports: true,
      repairTraces: false,
      photos: ["front", "back"],
    });

    expect(inspection.passed).toBe(false);
    expect(inspection.requiredPhotos).toEqual(["front", "back", "settings-imei-serial"]);
  });

  it("rejects battery percentages outside the physical range", () => {
    expect(() => new InspectionService().evaluate({
      screenOriginal: true,
      batteryPercent: 101,
      faceId: true,
      cameras: true,
      buttons: true,
      speakers: true,
      ports: true,
      repairTraces: false,
      photos: ["front", "back", "settings-imei-serial"],
    })).toThrow("Battery percentage must be an integer between 0 and 100");
  });

  it("rejects a falsified signature", () => {
    const signing = new SigningProvider();
    const signature = signing.sign("signed payload");

    expect(signing.verify("modified payload", signature)).toBe(false);
    expect(signing.verify("signed payload", `${signature.slice(0, -2)}00`)).toBe(false);
  });

  it("verifies certificates signed by a retained key after key rotation", () => {
    const privateKeyPrefix = Buffer.from("302e020100300506032b657004220420", "hex");
    const retiredSeed = Buffer.alloc(32, 1);
    const retiredPrivateKey = createPrivateKey({ key: Buffer.concat([privateKeyPrefix, retiredSeed]), format: "der", type: "pkcs8" });
    const retiredPublicKey = createPublicKey(retiredPrivateKey).export({ format: "der", type: "spki" }) as Buffer;
    const signingV1 = new SigningProvider(validateEnvironment({
      NODE_ENV: "test",
      CERTIFICATE_SIGNING_ACTIVE_KEY_ID: "v1",
      CERTIFICATE_SIGNING_PRIVATE_KEYS: JSON.stringify({ v1: retiredSeed.toString("base64") }),
      CERTIFICATE_SIGNING_PUBLIC_KEYS: "{}",
    }));
    const oldSignature = signingV1.sign("certificate snapshot");
    const newSeed = Buffer.alloc(32, 2).toString("base64");
    const signingV2 = new SigningProvider(validateEnvironment({
      NODE_ENV: "test",
      CERTIFICATE_SIGNING_ACTIVE_KEY_ID: "v2",
      CERTIFICATE_SIGNING_PRIVATE_KEYS: JSON.stringify({ v2: newSeed }),
      CERTIFICATE_SIGNING_PUBLIC_KEYS: JSON.stringify({ v1: retiredPublicKey.subarray(-32).toString("base64") }),
    }));

    expect(signingV2.verify("certificate snapshot", oldSignature, "v1")).toBe(true);
    expect(signingV2.verify("tampered snapshot", oldSignature, "v1")).toBe(false);
    expect(signingV2.verify("certificate snapshot", oldSignature, "v2")).toBe(false);
  });
});
