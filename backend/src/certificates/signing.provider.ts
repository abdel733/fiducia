import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/config";
import { validateEnvironment } from "@fiducia/config";

const privateKeyPrefix = Buffer.from("302e020100300506032b657004220420", "hex");
const publicKeyPrefix = Buffer.from("302a300506032b6570032100", "hex");

@Injectable()
export class SigningProvider {
  private readonly privateKeys = new Map<string, KeyObject>();
  private readonly publicKeys = new Map<string, KeyObject>();
  readonly activeKeyId: string;

  constructor(@Optional() @Inject(APP_CONFIG) config?: AppConfig) {
    const keyConfig = config ?? validateEnvironment({ NODE_ENV: "test" });
    this.activeKeyId = keyConfig.CERTIFICATE_SIGNING_ACTIVE_KEY_ID;

    for (const [keyId, encodedSeed] of Object.entries(keyConfig.CERTIFICATE_SIGNING_PRIVATE_KEYS)) {
      const privateKey = createPrivateKey({
        key: Buffer.concat([privateKeyPrefix, Buffer.from(encodedSeed, "base64")]),
        format: "der",
        type: "pkcs8",
      });
      this.privateKeys.set(keyId, privateKey);
      this.publicKeys.set(keyId, createPublicKey(privateKey));
    }

    for (const [keyId, encodedPublicKey] of Object.entries(keyConfig.CERTIFICATE_SIGNING_PUBLIC_KEYS)) {
      this.publicKeys.set(keyId, createPublicKey({
        key: Buffer.concat([publicKeyPrefix, Buffer.from(encodedPublicKey, "base64")]),
        format: "der",
        type: "spki",
      }));
    }
  }

  sign(payload: string): string {
    const privateKey = this.privateKeys.get(this.activeKeyId);
    if (!privateKey) throw new Error(`Active signing key ${this.activeKeyId} is unavailable`);
    return sign(null, Buffer.from(payload, "utf8"), privateKey).toString("hex");
  }

  verify(payload: string, signature: string, keyId = this.activeKeyId): boolean {
    try {
      const publicKey = this.publicKeys.get(keyId);
      if (!publicKey || !/^[a-f0-9]{128}$/i.test(signature)) return false;
      return verify(null, Buffer.from(payload, "utf8"), publicKey, Buffer.from(signature, "hex"));
    } catch {
      return false;
    }
  }
}
