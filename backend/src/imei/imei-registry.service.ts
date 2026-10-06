import { createHash } from "node:crypto";
import { normalizeImei } from "@fiducia/shared";

export type ImeiRegistryStatus = "CERTIFIED" | "REPORTED_STOLEN" | "BLOCKED" | "UNDER_RESERVATION" | "UNDER_LIEN" | "SOLD";

export interface ImeiRegistryChange {
  status: ImeiRegistryStatus;
  changedAt: string;
  reason: string;
  actor?: string;
}

export interface ImeiRegistryEntry {
  status: ImeiRegistryStatus;
  history: ImeiRegistryChange[];
}

export class ImeiRegistry {
  private readonly registry = new Map<string, ImeiRegistryEntry>();
  private readonly registryByHash = new Map<string, ImeiRegistryEntry>();

  setStatus(imei: string, status: ImeiRegistryStatus, reason: string, actor?: string): ImeiRegistryEntry {
    const normalized = normalizeImei(imei);
    const hash = createHash("sha256").update(normalized).digest("hex");
    const history = this.registry.get(normalized)?.history ?? [];
    const entry = { status, history: [...history, { status, changedAt: new Date().toISOString(), reason, actor }] };
    this.registry.set(normalized, entry);
    this.registryByHash.set(hash, entry);
    return entry;
  }

  getStatus(imei: string): ImeiRegistryEntry | undefined {
    return this.registry.get(normalizeImei(imei));
  }

  getByHash(hash: string): ImeiRegistryChange[] {
    return this.registryByHash.get(hash)?.history ?? [];
  }

  getHistory(imei: string): ImeiRegistryChange[] {
    return this.getStatus(imei)?.history ?? [];
  }
}
