import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AccessTokenGuard } from "./access-token.guard";
import { AuthService } from "./auth.service";
import { RefreshDto, RequestOtpDto, VerifyOtpDto } from "./auth.dto";
import { CurrentUser } from "./current-user.decorator";
import { AuthenticatedUser } from "./auth.types";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Request a six-digit sign-in OTP" })
  requestOtp(@Body() body: RequestOtpDto, @Req() request: Request) {
    return this.auth.requestOtp(body.phone, request.ip ?? "unknown");
  }

  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verify OTP, record consent, and create a session" })
  verifyOtp(@Body() body: VerifyOtpDto, @Req() request: Request) {
    return this.auth.verifyOtp({ ...body, ip: request.ip ?? "unknown" });
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate a refresh token" })
  refresh(@Body() body: RefreshDto) {
    return this.auth.rotateRefreshToken(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  logout(@Body() body: RefreshDto, @CurrentUser() _user: AuthenticatedUser) {
    return this.auth.revokeRefreshToken(body.refreshToken);
  }
}