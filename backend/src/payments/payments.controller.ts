import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";
import { Response } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { PaymentsService } from "./payments.service";

class CreateOrderDto {
  @IsString() @MaxLength(160) listingSlug!: string;
  @IsBoolean() acceptedRefundPolicy!: boolean;
}

class VerifyPaymentDto {
  @IsString() @MaxLength(200) transactionId!: string;
}

class RefundDto {
  @IsInt() @Min(1) amountXof!: number;
}

class PickupImeiDto {
  @Matches(/^\d{15}$/) imei!: string;
}

class PickupCodeDto {
  @Matches(/^\d{6}$/) pickupCode!: string;
}

class KkiapayCredentialsDto {
  @IsString() @MinLength(1) @MaxLength(200) publicKey!: string;
  @IsString() @MinLength(1) @MaxLength(200) privateKey!: string;
  @IsString() @MinLength(1) @MaxLength(200) secretKey!: string;
  @IsString() @MinLength(1) @MaxLength(200) sandboxTransactionId!: string;
}

class PayoutDto {
  @IsString() @MaxLength(160) externalReference!: string;
  @IsInt() @Min(1) amountXof!: number;
}

class PayoutReconciliationDto {
  @IsString() @MinLength(1) @MaxLength(160) externalReference!: string;
  @IsInt() @Min(1) amountXof!: number;
}

class LedgerReversalDto {
  @IsString() @MinLength(8) @MaxLength(500) reason!: string;
}

@ApiTags("payments")
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("orders")
  createOrder(@Body() body: CreateOrderDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createOrder(body.listingSlug, body.acceptedRefundPolicy, actor);
  }

  @Get("orders/mine")
  listMyOrders(@CurrentUser() actor: AuthenticatedUser) {
    return this.payments.listMyOrders(actor);
  }

  @Get("orders/:orderId")
  getOrder(@Param("orderId") orderId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.getOrder(orderId, actor);
  }

  @Post("orders/:orderId/payment-intents")
  createPaymentIntent(@Param("orderId") orderId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.createPaymentIntent(orderId, actor);
  }

  @Post("payment-intents/:intentId/verify")
  verifyPayment(@Param("intentId") intentId: string, @Body() body: VerifyPaymentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.verifyPayment(intentId, body.transactionId, actor);
  }

  @Post("orders/:orderId/cancel")
  cancelOrder(@Param("orderId") orderId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.cancelOrder(orderId, actor);
  }

  @Post("orders/:orderId/dispute")
  disputeOrder(@Param("orderId") orderId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.disputeOrder(orderId, actor);
  }

  @Post("orders/:orderId/refunds")
  requestRefund(@Param("orderId") orderId: string, @Body() body: RefundDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.requestRefund(orderId, body.amountXof, actor);
  }

  @Post("orders/:orderId/ready")
  markReady(@Param("orderId") orderId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.markReadyForPickup(orderId, actor);
  }

  @Post("orders/:orderId/verify-imei")
  verifyPickupImei(@Param("orderId") orderId: string, @Body() body: PickupImeiDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.verifyPickupImei(orderId, body.imei, actor);
  }

  @Post("orders/:orderId/complete")
  completeHandover(@Param("orderId") orderId: string, @Body() body: PickupCodeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.completeHandover(orderId, body.pickupCode, actor);
  }

  @Get("shops/:shopId/orders")
  listShopOrders(@Param("shopId") shopId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.listShopOrders(shopId, actor);
  }

  @Put("shops/:shopId/kkiapay")
  configureKkiapay(@Param("shopId") shopId: string, @Body() body: KkiapayCredentialsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.configureKkiapay(shopId, body, actor);
  }

  @Get("admin/refunds/failed")
  listFailedRefunds(@CurrentUser() actor: AuthenticatedUser) {
    return this.payments.listFailedRefunds(actor);
  }

  @Get("admin/reconciliation-issues")
  listReconciliationIssues(@CurrentUser() actor: AuthenticatedUser) {
    return this.payments.listReconciliationIssues(actor);
  }

  @Post("admin/refunds/:refundId/retry")
  retryRefund(@Param("refundId") refundId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.retryRefund(refundId, actor);
  }

  @Get("admin/payouts.csv")
  async exportPayoutCsv(@CurrentUser() actor: AuthenticatedUser, @Res() response: Response) {
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="fiducia-payouts.csv"');
    response.send(await this.payments.exportPayoutCsv(actor));
  }

  @Post("admin/payouts/:shopId")
  recordPayout(@Param("shopId") shopId: string, @Body() body: PayoutDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.recordPayout(shopId, body.externalReference, body.amountXof, actor);
  }

  @Post("admin/payouts/:payoutBatchId/reconcile")
  reconcilePayout(@Param("payoutBatchId") payoutBatchId: string, @Body() body: PayoutReconciliationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.reconcilePayout(payoutBatchId, body.amountXof, body.externalReference, actor);
  }

  @Post("admin/ledger/:transactionId/reverse")
  reverseLedgerTransaction(@Param("transactionId") transactionId: string, @Body() body: LedgerReversalDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.reverseLedgerTransaction(transactionId, body.reason, actor);
  }
}

@ApiTags("payments")
@Controller("payments/webhooks")
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("kkiapay")
  @HttpCode(202)
  async handleKkiapay(@Headers("x-kkiapay-secret") secret: string | undefined, @Body() body: unknown) {
    return this.payments.acceptWebhook(secret, body);
  }
}
