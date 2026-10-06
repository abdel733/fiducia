import { describe, expect, it } from "vitest";
import { validateEnvironment } from "../src/env";

describe("environment validation", () => {
  it("loads the local defaults with a versioned AES key", () => {
    const config = validateEnvironment({});
    expect(config.DATA_ENCRYPTION_KEYS.v1).toBeTruthy();
    expect(config.DATA_ENCRYPTION_ACTIVE_KEY_VERSION).toBe("v1");
  });

  it("rejects an active encryption version without a key", () => {
    expect(() => validateEnvironment({ DATA_ENCRYPTION_ACTIVE_KEY_VERSION: "v2" })).toThrow(/must exist/);
  });

  it("rejects malformed environment values", () => {
    expect(() => validateEnvironment({ API_PORT: "70000" })).toThrow(/Invalid environment/);
  });

  it("rejects development defaults in production", () => {
    expect(() => validateEnvironment({ NODE_ENV: "production" })).toThrow(/forbidden in production/);
  });
});