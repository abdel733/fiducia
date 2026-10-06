import { createHmac, randomInt, randomUUID } from "node:crypto";
import { HttpException, HttpStatus, UnauthorizedException, Injectable, Inject } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../config/config";
import { PrismaService } from "../database/prisma.service";
import { REDIS_CLIENT } from "../redis/redis.module";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../crypto/crypto.service";
import { SmsProvider } from "./sms-provider";

const INCREMENT_WITH_EXPIRY = "local value = redis.call('INCR', KEYS[1]); if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return value";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sms: SmsProvider,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  async requestOtp(phone: string, ip: string): Promise<{ accepted: true }> {
    const phoneKey = this.crypto.hashSecret(phone);
    const ipKey = this.crypto.hashSecret(ip);
    const [phoneCount, ipCount] = await Promise.all([
      this.incrementLimit(`otp:phone:${phoneKey}`, 3),
      this.incrementLimit(`otp:ip:${ipKey}`, 10),
    ]);
    if (phoneCount > 3 || ipCount > 10) throw new HttpException("Too many OTP requests", HttpStatus.TOO_MANY_REQUESTS);

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.prisma.otpChallenge.create({
      data: { phone, codeHash: this.crypto.hashSecret(`${phone}:${code}`), ipHash: ipKey, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    await this.sms.sendOtp(phone, code);
    return { accepted: true };
  }

  async verifyOtp(input: { phone: string; code: string; consentVersion: string; ip: string }): Promise<{
    accessToken: string; refreshToken: string; expiresIn: number; user: { id: string; phone: string; roles: UserRole[] };
  }> {
    const challenge = await this.prisma.otpChallenge.findFirst({ where: { phone: input.phone, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, orderBy: { createdAt: "desc" } });
    if (!challenge) throw new UnauthorizedException("Invalid or expired OTP");
    const expected = this.crypto.hashSecret(`${input.phone}:${input.code}`);
    if (challenge.codeHash !== expected) {
      await this.prisma.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException("Invalid or expired OTP");
    }

    const ipHash = this.crypto.hashSecret(input.ip);
    const result = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new UnauthorizedException("Invalid or expired OTP");
      const user = await tx.user.upsert({
        where: { phone: input.phone },
        create: { phone: input.phone, roles: ["BUYER"] },
        update: {},
        select: { id: true, phone: true, roles: true, status: true },
      });
      if (user.status !== "ACTIVE" || !user.phone) throw new UnauthorizedException("Account unavailable");
      await tx.consent.createMany({
        data: ["TERMS", "PRIVACY", "DATA_PURPOSES"].map((kind) => ({ userId: user.id, kind: kind as "TERMS" | "PRIVACY" | "DATA_PURPOSES", version: input.consentVersion, ipHash })),
      });
      return user;
    });
    const session = await this.createSession(result.id, result.roles);
    await this.audit.record({ actorId: result.id, action: "AUTH_OTP_VERIFIED", resourceType: "User", resourceId: result.id, ipHash });
    return { ...session, user: { id: result.id, phone: result.phone!, roles: result.roles } };
  }

  async rotateRefreshToken(token: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    let payload: { sub: string; tokenType: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.config.JWT_REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }
    if (payload.tokenType !== "refresh" || !payload.jti) throw new UnauthorizedException("Invalid refresh token");
    const tokenHash = this.hashRefreshToken(token);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!existing || existing.userId !== payload.sub || existing.revokedAt || existing.expiresAt <= new Date() || existing.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Refresh token revoked or expired");
    }
    const rotated = await this.createSession(existing.userId, existing.user.roles);
    const replacement = await this.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: this.hashRefreshToken(rotated.refreshToken) } });
    const revoked = await this.prisma.refreshToken.updateMany({ where: { id: existing.id, revokedAt: null }, data: { revokedAt: new Date(), replacedBy: replacement.id } });
    if (revoked.count !== 1) {
      await this.prisma.refreshToken.update({ where: { id: replacement.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Refresh token already used");
    }
    return rotated;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(token);
    await this.prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async incrementLimit(key: string, limit: number): Promise<number> {
    return Number(await this.redis.eval(INCREMENT_WITH_EXPIRY, 1, key, 15 * 60));
  }

  private async createSession(userId: string, roles: UserRole[]): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const jti = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ sub: userId, tokenType: "access" }, { secret: this.config.JWT_ACCESS_SECRET, expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS }),
      this.jwt.signAsync({ sub: userId, tokenType: "refresh", jti }, { secret: this.config.JWT_REFRESH_SECRET, expiresIn: this.config.REFRESH_TOKEN_TTL_SECONDS }),
    ]);
    await this.prisma.refreshToken.create({ data: { userId, tokenHash: this.hashRefreshToken(refreshToken), expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000) } });
    return { accessToken, refreshToken, expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS };
  }

  private hashRefreshToken(token: string): string {
    return createHmac("sha256", this.config.JWT_REFRESH_SECRET).update(token).digest("hex");
  }
}