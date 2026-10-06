import { validateEnvironment } from "@fiducia/config";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import Redis from "ioredis";
import { AuditService } from "../src/audit/audit.service";
import { CryptoService } from "../src/crypto/crypto.service";
import { PrismaService } from "../src/database/prisma.service";
import { AuthService } from "../src/auth/auth.service";
import { SmsProvider } from "../src/auth/sms-provider";

describe("AuthService OTP", () => {
  const config = validateEnvironment({ NODE_ENV: "test", OTP_LOGS_ENABLED: "false" });
  const challengeCreate = jest.fn();
  const challengeFind = jest.fn();
  const challengeUpdate = jest.fn();
  const redisEval = jest.fn();
  const sentCodes: string[] = [];
  const sms = { sendOtp: jest.fn(async (_phone: string, code: string) => { sentCodes.push(code); }) };
  const prisma = { otpChallenge: { create: challengeCreate, findFirst: challengeFind, updateMany: challengeUpdate } };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    sentCodes.length = 0;
    redisEval.mockResolvedValue(1);
    service = new AuthService(
      prisma as unknown as PrismaService,
      {} as JwtService,
      config,
      { eval: redisEval } as unknown as Redis,
      sms as unknown as SmsProvider,
      { record: jest.fn() } as unknown as AuditService,
      new CryptoService(config),
    );
  });

  it("generates a six-digit code, stores only its HMAC, and applies a five-minute expiry", async () => {
    challengeCreate.mockResolvedValue({ id: "challenge-1" });
    await service.requestOtp("+22997000000", "127.0.0.1");

    expect(sentCodes[0]).toMatch(/^\d{6}$/);
    expect(challengeCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phone: "+22997000000" }) }));
    const data = challengeCreate.mock.calls[0]![0].data as { codeHash: string; expiresAt: Date };
    expect(data.codeHash).not.toBe(sentCodes[0]);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(redisEval).toHaveBeenCalledTimes(2);
  });

  it("limits OTP requests by phone and by IP", async () => {
    redisEval.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    await expect(service.requestOtp("+22997000000", "127.0.0.1")).rejects.toMatchObject({ status: 429 });
    expect(challengeCreate).not.toHaveBeenCalled();
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it("increments failed attempts and rejects invalid codes", async () => {
    challengeFind.mockResolvedValue({ id: "challenge-1", codeHash: "not-the-code", attempts: 0, expiresAt: new Date(Date.now() + 60_000) });
    challengeUpdate.mockResolvedValue({ count: 1 });
    await expect(service.verifyOtp({ phone: "+22997000000", code: "000000", consentVersion: "v1", ip: "127.0.0.1" })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(challengeUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { attempts: { increment: 1 } } }));
  });
});