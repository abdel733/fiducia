export const IMEI_TAC_LENGTH = 8;

export function normalizeImei(value: string): string {
  const normalized = value.replace(/\s+/g, "").replace(/[-.]/g, "");
  if (!/^\d{15}$/.test(normalized)) {
    throw new RangeError("IMEI must contain exactly 15 digits");
  }
  return normalized;
}

export function getImeiTac(imei: string): string {
  return normalizeImei(imei).slice(0, IMEI_TAC_LENGTH);
}

export function maskImei(imei: string): string {
  const normalized = normalizeImei(imei);
  return `${normalized.slice(0, 11)}****`;
}
