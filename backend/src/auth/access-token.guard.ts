import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { APP_CONFIG, AppConfig } from "../config/config";
import { PrismaService } from "../database/prisma.service";
import { AuthenticatedUser, AccessPayload } from "./auth.types";
import { Inject } from "@nestjs/common";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const [scheme, token] = (request.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, { secret: this.config.JWT_ACCESS_SECRET });
      if (payload.tokenType !== "access") throw new UnauthorizedException();
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, phone: true, roles: true, status: true } });
      if (!user || user.status !== "ACTIVE" || !user.phone) throw new UnauthorizedException();
      request.user = { id: user.id, phone: user.phone, roles: user.roles };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}