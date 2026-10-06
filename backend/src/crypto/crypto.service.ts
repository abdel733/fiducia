import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/config";
import { isValidImei } from "@fiducia/shared";

@Injectable()
export class CryptoService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  encrypt(plaintext: string): string {
    return this.encryptBuffer(Buffer.from(plaintext, "utf8")).toString("ascii");
  }

  encryptBuffer(plaintext: Buffer): Buffer {
    const version = this.config.DATA_ENCRYPTION_ACTIVE_KEY_VERSION;
    const key = Buffer.from(this.config.DATA_ENCRYPTION_KEYS[version]!, "base64");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.from([version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join("."), "ascii");
  }

  decrypt(envelope: string): string {
    return this.decryptBuffer(Buffer.from(envelope, "ascii")).toString("utf8");
  }

  decryptBuffer(envelope: Buffer): Buffer {
    const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] = envelope.toString("ascii").split(".");
    if (!version || !encodedIv || !encodedTag || !encodedCiphertext || extra.length > 0) throw new Error("Invalid encrypted value");
    const encodedKey = this.config.DATA_ENCRYPTION_KEYS[version];
    if (!encodedKey) throw new Error(`Encryption key version ${version} is unavailable`);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(encodedKey, "base64"), Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]);
  }

  hashImei(imei: string): string {
    if (!isValidImei(imei)) throw new RangeError("IMEI must be a valid 15-digit Luhn number");
    return this.hmac(imei, this.config.IMEI_HASH_KEY);
  }

  hashSecret(value: string, key = this.config.OTP_HASH_KEY): string {
    return this.hmac(value, key);
  }

  private hmac(value: string, key: string): string {
    return createHmac("sha256", key).update(value).digest("hex");
  }
}