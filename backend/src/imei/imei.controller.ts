import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../database/prisma.service";
import { ImeiRegistry } from "./imei-registry.service";
import { ImeiVerificationService } from "./imei-verification.service";

class VerifyImeiDto {
  imei: string;
  tac?: string;
  model?: string;
}

@ApiTags("imei")
@Controller("imei")
export class ImeiController {
  constructor(
    private readonly service: ImeiVerificationService,
    private readonly registry: ImeiRegistry,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  @Post("verify")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Check an IMEI through the verification engine" })
  async verify(@Body() body: VerifyImeiDto, @CurrentUser() user: AuthenticatedUser) {
    const report = await this.service.verify(body.imei, { tac: body.tac, model: body.model });
    const record = await this.persistReport(body.imei, report);
    const { imeiHash: _imeiHash, ...safeReport } = report;
    const registryStatus = await this.getRegistryStatus(body.imei);
    return {
      report: {
        ...safeReport,
        id: record.id,
        verdict: registryStatus === "REPORTED_STOLEN" || registryStatus === "BLOCKED" ? "REJECTED" : registryStatus === "UNDER_LIEN" ? "UNDER_LIEN" : report.verdict,
      },
      actor: { id: user.id, roles: user.roles },
      registry: registryStatus,
    };
  }

  @Post("verify/public")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Simplified public IMEI check with limited result detail" })
  async verifyPublic(@Body() body: VerifyImeiDto, @Req() request: Request) {
    const report = await this.service.verify(body.imei, { tac: body.tac, model: body.model, publicMode: true });
    const registryStatus = await this.getRegistryStatus(body.imei);
    const verdict = registryStatus === "REPORTED_STOLEN" || registryStatus === "BLOCKED"
      ? "REJECTED"
      : registryStatus === "UNDER_LIEN"
        ? "UNDER_LIEN"
        : report.verdict;
    return {
      maskedImei: report.maskedImei,
      verdict,
      reasons: report.reasons.slice(0, 2),
      sourcesConsulted: report.sourcesConsulted,
      checkedAt: report.checkedAt,
    };
  }

  private async persistReport(imei: string, report: Awaited<ReturnType<ImeiVerificationService["verify"]>>) {
    return this.prisma.verificationReport.create({
      data: {
        imeiHash: this.crypto.hashImei(imei),
        maskedImei: report.maskedImei,
        verdict: report.verdict,
        sourcesConsulted: report.sourcesConsulted,
        coverageScore: report.coverageScore,
        checkedAt: new Date(report.checkedAt),
      },
    });
  }

  private async getRegistryStatus(imei: string) {
    const stored = await this.prisma.imeiRegistryEntry.findUnique({ where: { imeiHash: this.crypto.hashImei(imei) } });
    return stored?.status ?? this.registry.getStatus(imei)?.status ?? null;
  }

  @Get(":hash/history")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the historical registry entries for an IMEI hash" })
  async history(@Param("hash") hash: string, @CurrentUser() user: AuthenticatedUser) {
    if (!user.roles.includes("ADMIN")) {
      return { hash, history: [] };
    }
    const history = this.registry.getByHash(hash);
    return { hash, history };
  }
}
