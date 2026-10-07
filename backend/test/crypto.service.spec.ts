import { validateEnvironment } from "@fiducia/config";
import { CryptoService } from "../src/crypto/crypto.service";

describe("CryptoService", () => {
  const firstKey = Buffer.alloc(32, 1).toString("base64");
  const secondKey = Buffer.alloc(32, 2).toString("base64");

  it("encrypts IMEI-like values and decrypts after key rotation", () => {
    const initial = new CryptoService(validateEnvironment({ DATA_ENCRYPTION_KEYS: JSON.stringify({ v1: firstKey }), DATA_ENCRYPTION_ACTIVE_KEY_VERSION: "v1" }));
    const encrypted = initial.encrypt("490154203237518");
    const rotated = new CryptoService(validateEnvironment({ DATA_ENCRYPTION_KEYS: JSON.stringify({ v1: firstKey, v2: secondKey }), DATA_ENCRYPTION_ACTIVE_KEY_VERSION: "v2" }));

    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(rotated.decrypt(encrypted)).toBe("490154203237518");
    expect(rotated.encrypt("new-sensitive-value").startsWith("v2.")).toBe(true);
    expect(rotated.hashImei("490154203237518")).toBe(rotated.hashImei("490154203237518"));
    expect(() => rotated.hashImei("123456789012345")).toThrow(/valid 15-digit Luhn/);
  });

  it("rejects tampered ciphertext and unavailable key versions", () => {
    const crypto = new CryptoService(validateEnvironment({ DATA_ENCRYPTION_KEYS: JSON.stringify({ v1: firstKey }), DATA_ENCRYPTION_ACTIVE_KEY_VERSION: "v1" }));
    const encrypted = crypto.encrypt("sensitive");
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    const tampered = [version, iv, `${tag![0] === "A" ? "B" : "A"}${tag!.slice(1)}`, ciphertext].join(".");
    expect(() => crypto.decrypt(tampered)).toThrow();
    expect(() => crypto.decrypt("v9.a.b.c")).toThrow(/unavailable/);
  });
});