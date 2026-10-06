import { z } from "zod";

export const userRoleSchema = z.enum(["BUYER", "SELLER", "SHOP_STAFF", "AGENT", "FINANCE_PARTNER", "ADMIN", "SUPPORT"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const beninPhoneSchema = z.string().regex(/^\+229[0-9]{8}$/, "Use a Benin E.164 number (+229 followed by 8 digits)");
export const consentSchema = z.object({
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  purposesAccepted: z.literal(true),
  version: z.string().min(1).max(30),
});

export function formatXof(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("XOF amounts must be non-negative safe integers");
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount) + " F CFA";
}

export function normalizeImei(imei: string): string {
  const sanitized = imei.replace(/\s+/g, "").replace(/[-.]/g, "");
  if (!/^\d{15}$/.test(sanitized)) {
    throw new RangeError("IMEI must contain exactly 15 digits");
  }
  return sanitized;
}

export function getImeiTac(imei: string): string {
  return normalizeImei(imei).slice(0, 8);
}

export function maskImei(imei: string): string {
  const normalized = normalizeImei(imei);
  return `${normalized.slice(0, 11)}****`;
}

export function isValidImei(imei: string): boolean {
  try {
    const normalized = normalizeImei(imei);
    let sum = 0;
    for (let index = 0; index < normalized.length; index += 1) {
      let digit = Number(normalized[index]);
      if (index % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    return sum % 10 === 0;
  } catch {
    return false;
  }
}

export function calculateTaeg(totalRepayment: number, principal: number, periodsPerYear: number, periods: number): number {
  if (![totalRepayment, principal, periodsPerYear, periods].every(Number.isSafeInteger) || principal <= 0 || periods <= 0 || periodsPerYear <= 0 || totalRepayment < principal) {
    throw new RangeError("TAEG inputs must be positive whole-number XOF values and periods");
  }
  return Number((((totalRepayment / principal) ** (periodsPerYear / periods) - 1) * 100).toFixed(2));
}