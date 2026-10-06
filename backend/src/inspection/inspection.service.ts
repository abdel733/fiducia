export type InspectionVerdict = "PASS" | "FAIL" | "REVIEW";
export const REQUIRED_INSPECTION_PHOTOS = ["front", "back", "settings-imei-serial"] as const;

export interface InspectionChecklistInput {
  screenOriginal: boolean;
  batteryPercent: number;
  faceId?: boolean;
  touchId?: boolean;
  cameras: boolean;
  buttons: boolean;
  speakers: boolean;
  ports: boolean;
  repairTraces: boolean;
  photos: string[];
  sellerName?: string;
  checkedBy?: "SELLER" | "AGENT";
}

export interface InspectionEvaluation {
  score: number;
  passed: boolean;
  verdict: InspectionVerdict;
  summary: string;
  requiredPhotos: string[];
  checks: Record<string, boolean | number>;
}

export class InspectionService {
  evaluate(input: InspectionChecklistInput): InspectionEvaluation {
    if (!Number.isInteger(input.batteryPercent) || input.batteryPercent < 0 || input.batteryPercent > 100) {
      throw new RangeError("Battery percentage must be an integer between 0 and 100");
    }

    const photosComplete = REQUIRED_INSPECTION_PHOTOS.every((photo) => input.photos.includes(photo));
    const biometricAvailable = Boolean(input.faceId || input.touchId);
    const checks = {
      screenOriginal: input.screenOriginal,
      batteryPercent: input.batteryPercent,
      faceId: input.faceId ?? false,
      touchId: input.touchId ?? false,
      cameras: input.cameras,
      buttons: input.buttons,
      speakers: input.speakers,
      ports: input.ports,
      repairTraces: !input.repairTraces,
      photosComplete,
    };

    let score = 0;

    if (input.screenOriginal) score += 12;
    if (input.batteryPercent >= 80) score += 15;
    else if (input.batteryPercent >= 60) score += 8;
    if (input.cameras) score += 12;
    if (input.buttons) score += 10;
    if (input.speakers) score += 10;
    if (input.ports) score += 10;
    if (biometricAvailable) score += 12;
    if (!input.repairTraces) score += 10;
    if (photosComplete) score += 9;

    score = Math.max(0, Math.min(100, score));

    const missingPhotos = REQUIRED_INSPECTION_PHOTOS.filter((photo) => !input.photos.includes(photo));
    const passed =
      input.screenOriginal &&
      !input.repairTraces &&
      input.batteryPercent >= 80 &&
      input.cameras &&
      input.buttons &&
      input.speakers &&
      input.ports &&
      missingPhotos.length === 0 &&
      biometricAvailable;

    const verdict: InspectionVerdict = passed ? "PASS" : score >= 60 ? "REVIEW" : "FAIL";

    return {
      score,
      passed,
      verdict,
      summary:
        verdict === "PASS"
          ? "Checklist complète. Les constats physiques ont été enregistrés."
          : verdict === "REVIEW"
            ? "Contrôle partiellement conforme. Une vérification humaine est recommandée avant émission d’un certificat."
            : "Contrôle insuffisant. Le téléphone ne peut pas être certifié sans revue technique.",
      requiredPhotos: [...REQUIRED_INSPECTION_PHOTOS],
      checks,
    };
  }
}
