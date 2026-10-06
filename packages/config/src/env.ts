import { z } from "zod";

const encryptionKeySet = z.string().transform((value, context) => {
  try {
    return z.record(z.string().regex(/^[A-Za-z0-9_-]+$/), z.string()).parse(JSON.parse(value));
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a JSON object of base64 keys" });
    return z.NEVER;
  }
});

const signingKeySet = z.string().transform((value, context) => {
  try {
    return z.record(z.string().regex(/^[A-Za-z0-9_-]+$/), z.string()).parse(JSON.parse(value));
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a JSON object of versioned Ed25519 keys" });
    return z.NEVER;
  }
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SMS_PROVIDER: z.enum(["mock"]).default("mock"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().url().default("postgresql://fiducia:fiducia_local@localhost:5432/fiducia?schema=public"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32).default("local-only-access-secret-change-before-deployment"),
  JWT_REFRESH_SECRET: z.string().min(32).default("local-only-refresh-secret-change-before-deployment"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).default(2592000),
  OTP_LOGS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  OTP_HASH_KEY: z.string().min(32).default("local-only-otp-hash-key-change-before-deployment"),
  DATA_ENCRYPTION_ACTIVE_KEY_VERSION: z.string().regex(/^[A-Za-z0-9_-]+$/).default("v1"),
  DATA_ENCRYPTION_KEYS: encryptionKeySet.default('{"v1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}'),
  IMEI_HASH_KEY: z.string().min(32).default("local-only-imei-hmac-key-change-before-deployment"),
  CERTIFICATE_SIGNING_ACTIVE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]+$/).default("local-v1"),
  CERTIFICATE_SIGNING_PRIVATE_KEYS: signingKeySet.default('{"local-v1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}'),
  CERTIFICATE_SIGNING_PUBLIC_KEYS: signingKeySet.default("{}"),
  CERTIFICATE_VALIDITY_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("fiducia-private"),
  S3_ACCESS_KEY: z.string().min(1).default("minioadmin"),
  S3_SECRET_KEY: z.string().min(1).default("minioadmin"),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnvironment(input: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const config = parsed.data;
  const keyVersions = Object.entries(config.DATA_ENCRYPTION_KEYS);
  if (!keyVersions.some(([version]) => version === config.DATA_ENCRYPTION_ACTIVE_KEY_VERSION)) {
    throw new Error("DATA_ENCRYPTION_ACTIVE_KEY_VERSION must exist in DATA_ENCRYPTION_KEYS");
  }
  for (const [version, encoded] of keyVersions) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) || Buffer.from(encoded, "base64").length !== 32) {
      throw new Error(`DATA_ENCRYPTION_KEYS.${version} must decode to exactly 32 bytes`);
    }
  }
  if (!config.CERTIFICATE_SIGNING_PRIVATE_KEYS[config.CERTIFICATE_SIGNING_ACTIVE_KEY_ID]) {
    throw new Error("CERTIFICATE_SIGNING_ACTIVE_KEY_ID must exist in CERTIFICATE_SIGNING_PRIVATE_KEYS");
  }
  for (const [keyId, encoded] of Object.entries(config.CERTIFICATE_SIGNING_PRIVATE_KEYS)) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) || Buffer.from(encoded, "base64").length !== 32) {
      throw new Error(`CERTIFICATE_SIGNING_PRIVATE_KEYS.${keyId} must be a base64 32-byte Ed25519 seed`);
    }
  }
  for (const [keyId, encoded] of Object.entries(config.CERTIFICATE_SIGNING_PUBLIC_KEYS)) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) || Buffer.from(encoded, "base64").length !== 32) {
      throw new Error(`CERTIFICATE_SIGNING_PUBLIC_KEYS.${keyId} must be a base64 32-byte Ed25519 public key`);
    }
  }
  if (config.NODE_ENV === "production") {
    const developmentValues = [
      "minioadmin",
      "local-only-access-secret-change-before-deployment",
      "local-only-refresh-secret-change-before-deployment",
      "local-only-otp-hash-key-change-before-deployment",
      "local-only-imei-hmac-key-change-before-deployment",
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    ];
    if ([config.S3_ACCESS_KEY, config.S3_SECRET_KEY, config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET, config.OTP_HASH_KEY, config.IMEI_HASH_KEY, ...Object.values(config.DATA_ENCRYPTION_KEYS), ...Object.values(config.CERTIFICATE_SIGNING_PRIVATE_KEYS)].some((value) => developmentValues.includes(value)) || config.OTP_LOGS_ENABLED || !config.S3_ENDPOINT.startsWith("https://") || !config.WEB_ORIGIN.startsWith("https://")) {
      throw new Error("Development credentials are forbidden in production");
    }
  }
  return config;
}