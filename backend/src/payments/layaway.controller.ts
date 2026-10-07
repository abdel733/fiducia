import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { Response } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { LayawayPlanType } from "@prisma/client";
import { PaymentsService } from "./payments.service";
import { LayawayService } from "./layaway.service";

class CreateLayawayDto {
  @IsString() @MaxLength(160) listingSlug!: string;
  @IsIn(["FIXED_3", "FLEX"]) type!: LayawayPlanType;
  @IsOptional() @IsInt() @IsIn([60, 90]) durationDays?: number;
  @IsInt() @Min(1) firstPaymentXof!: number;
  @IsBoolean() acceptedPolicy!: boolean;
  @IsString() @IsIn(["layaway-v1"]) acceptedPolicyVersion!: string;
}

class LayawayPaymentDto {
  @IsInt() @Min(1) amountXof!: number;
}

class VerifyLayawayPaymentDto {
  @IsString() @MaxLength(200) transactionId!: string;
}

class CancelSellerDto {
  @IsString() @MinLength(8) @MaxLength(500) reason!: string;
}

class DisputeDto {
  @IsString() @MinLength(8) @MaxLength(1000) reason!: string;
}

class HandoverDto {
  @IsString() @MaxLength(6) pickupCode!: string;
  @IsString() @MaxLength(20) imei!: string;
}

class RefundReferenceDto {
  @IsString() @MinLength(1) @MaxLength(160) externalReference!: string;
}

class ResolveDisputeDto {
  @IsIn(["REFUND", "PARTIAL_REFUND", "SETTLE_TO_SELLER"]) resolution!: "REFUND" | "PARTIAL_REFUND" | "SETTLE_TO_SELLER";
  @IsOptional() @IsInt() @Min(1) amountXof?: number;
  @IsString() @MinLength(8) @MaxLength(1000) notes!: string;
}

class UpdateLayawaySettingsDto {
  @IsOptional() @IsBoolean() fixed3Enabled?: boolean;
  @IsOptional() @IsArray() fixed3Percentages?: number[];
  @IsOptional() @IsBoolean() flexEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(90) flexMinFirstPaymentPercent?: number;
  @IsOptional() @IsInt() @IsIn([60, 90]) flexDefaultDurationDays?: number;
  @IsOptional() @IsArray() flexAllowedDurationDays?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(30) gracePeriodDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) extensionDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) buyerActivePlanLimit?: number;
  @IsOptional() shopActivePlanLimit?: number | null;
  @IsOptional() @IsInt() @Min(1) newAccountExposureCapXof?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) newAccountAgeDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) buyerCancellationFeeBps?: number;
  @IsOptional() @IsInt() @Min(0) buyerCancellationFeeCapXof?: number;
  @IsOptional() @IsInt() @Min(0) sellerCancellationFeeXof?: number;
  @IsOptional() @IsInt() @Min(1) @Max(720) sellerRefundSlaHours?: number;
  @IsOptional() @IsBoolean() guaranteeEnabled?: boolean;
}

@ApiTags("layaway")
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller("layaway")
export class LayawayController {
  constructor(private readonly layaway: LayawayService, private readonly payments: PaymentsService) {}

  @Get("quote/:listingSlug")
  quote(@Param("listingSlug") listingSlug: string) {
    return this.layaway.quote(listingSlug);
  }

  @Post("plans")
  createPlan(@Body() body: CreateLayawayDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.createPlan(body, actor);
  }

  @Get("plans/mine")
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.getMyPlans(actor);
  }

  @Get("plans/:planId")
  getPlan(@Param("planId") planId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.getPlan(planId, actor);
  }

  @Post("plans/:planId/payment-intents")
  createPaymentIntent(@Param("planId") planId: string, @Body() body: LayawayPaymentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createLayawayPaymentIntent(planId, body.amountXof, actor);
  }

  @Post("payment-intents/:intentId/verify")
  verifyPayment(@Param("intentId") intentId: string, @Body() body: VerifyLayawayPaymentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.verifyPayment(intentId, body.transactionId, actor);
  }

  @Post("plans/:planId/cancel")
  cancelByBuyer(@Param("planId") planId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.cancelByBuyer(planId, actor);
  }

  @Post("plans/:planId/extend")
  extendOnce(@Param("planId") planId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.extendOnce(planId, actor);
  }

  @Post("plans/:planId/renew-pickup-code")
  renewPickupCode(@Param("planId") planId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.renewPickupCode(planId, actor);
  }

  @Post("plans/:planId/disputes")
  @UseInterceptors(FilesInterceptor("evidence", 5, { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  openDispute(
    @Param("planId") planId: string,
    @Body() body: DisputeDto,
    @UploadedFiles() evidence: Express.Multer.File[],
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.layaway.openDispute(planId, body.reason, evidence ?? [], actor);
  }

  @Post("plans/:planId/handover")
  @UseInterceptors(FileInterceptor("photo", { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  handover(
    @Param("planId") planId: string,
    @Body() body: HandoverDto,
    @UploadedFile() photo: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.layaway.handover(planId, body.pickupCode, body.imei, photo, actor);
  }

  @Post("plans/:planId/seller-cancel")
  sellerCancel(@Param("planId") planId: string, @Body() body: CancelSellerDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.cancelBySeller(planId, body.reason, actor);
  }

  @Post("admin/plans/:planId/cancel")
  adminCancel(@Param("planId") planId: string, @Body() body: CancelSellerDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.cancelByAdmin(planId, body.reason, actor);
  }

  @Get("shops/:shopId/plans")
  shopPlans(@Param("shopId") shopId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.listShopPlans(shopId, actor);
  }

  @Get("shops/:shopId/refunds")
  shopRefunds(@Param("shopId") shopId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.sellerRefunds(shopId, actor);
  }

  @Post("refunds/:refundId/complete")
  completeRefund(@Param("refundId") refundId: string, @Body() body: RefundReferenceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.recordRefund(refundId, body.externalReference, actor);
  }

  @Post("refunds/:refundId/start")
  startRefund(@Param("refundId") refundId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.startRefund(refundId, actor);
  }

  @Get("admin/settings")
  adminSettings(@CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.getAdminSettings(actor);
  }

  @Patch("admin/settings")
  updateSettings(@Body() body: UpdateLayawaySettingsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.updateSettings(body, actor);
  }

  @Get("admin/issues")
  adminIssues(@CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.listAdminIssues(actor);
  }

  @Post("admin/plans/:planId/resolve")
  resolveDispute(@Param("planId") planId: string, @Body() body: ResolveDisputeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.layaway.resolveDispute(planId, body.resolution, body.amountXof, body.notes, actor);
  }

  @Get("plans/:planId/evidence")
  async evidence(@Param("planId") planId: string, @Query("key") key: string, @CurrentUser() actor: AuthenticatedUser, @Res() response: Response) {
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("Cache-Control", "private, no-store");
    response.send(await this.layaway.downloadEvidence(planId, key, actor));
  }
}
