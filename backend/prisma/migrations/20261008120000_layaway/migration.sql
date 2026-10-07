-- CreateEnum
CREATE TYPE "LayawayPlanType" AS ENUM ('FIXED_3', 'FLEX');

-- CreateEnum
CREATE TYPE "LayawayPlanStatus" AS ENUM ('DRAFT', 'PENDING_FIRST_PAYMENT', 'ACTIVE', 'LATE', 'COMPLETED', 'READY_FOR_PICKUP', 'HANDED_OVER', 'EXPIRED_UNPAID', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER', 'CANCELLED_BY_ADMIN', 'DISPUTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "LayawayRefundStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'REFUNDED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "LayawayDisputeStatus" AS ENUM ('OPEN', 'RESOLVED_REFUND', 'RESOLVED_PARTIAL_REFUND', 'RESOLVED_SELLER');

-- CreateEnum
CREATE TYPE "LayawayNotificationChannel" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "LayawayNotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- AlterEnum
ALTER TYPE "ImeiRegistryStatus" ADD VALUE 'UNDER_RESERVATION';

-- AlterEnum
ALTER TYPE "MarketplaceListingStatus" ADD VALUE 'RESERVED';

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "layawaySellerCancellations" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MarketplaceListing" ADD COLUMN     "reservedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "installmentId" TEXT,
ADD COLUMN     "layawayPlanId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LedgerTransaction" ADD COLUMN     "layawayPlanId" TEXT;

-- CreateTable
CREATE TABLE "LayawaySettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "fixed3Enabled" BOOLEAN NOT NULL DEFAULT true,
    "fixed3Percentages" INTEGER[] DEFAULT ARRAY[40, 30, 30]::INTEGER[],
    "flexEnabled" BOOLEAN NOT NULL DEFAULT true,
    "flexMinFirstPaymentPercent" INTEGER NOT NULL DEFAULT 45,
    "flexDefaultDurationDays" INTEGER NOT NULL DEFAULT 60,
    "flexAllowedDurationDays" INTEGER[] DEFAULT ARRAY[60, 90]::INTEGER[],
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 7,
    "extensionDays" INTEGER NOT NULL DEFAULT 7,
    "buyerActivePlanLimit" INTEGER NOT NULL DEFAULT 1,
    "shopActivePlanLimit" INTEGER,
    "newAccountExposureCapXof" INTEGER NOT NULL DEFAULT 300000,
    "newAccountAgeDays" INTEGER NOT NULL DEFAULT 30,
    "buyerCancellationFeeBps" INTEGER NOT NULL DEFAULT 500,
    "buyerCancellationFeeCapXof" INTEGER NOT NULL DEFAULT 10000,
    "sellerCancellationFeeXof" INTEGER NOT NULL DEFAULT 10000,
    "sellerRefundSlaHours" INTEGER NOT NULL DEFAULT 48,
    "guaranteeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayawaySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayawayPlan" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "type" "LayawayPlanType" NOT NULL,
    "status" "LayawayPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "priceXof" INTEGER NOT NULL,
    "paidXof" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "startedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "graceEndsAt" TIMESTAMP(3) NOT NULL,
    "extensionUsed" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "consentPolicyVersion" TEXT,
    "consentSnapshot" JSONB,
    "pickupOtpHash" TEXT,
    "pickupOtpEncrypted" TEXT,
    "pickupOtpExpiresAt" TIMESTAMP(3),
    "imeiVerifiedAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "sellerRefundDeadlineAt" TIMESTAMP(3),
    "lastReminderAt" TIMESTAMP(3),
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayawayPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "layawayPlanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amountDueXof" INTEGER NOT NULL,
    "amountPaidXof" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayawayEvent" (
    "id" TEXT NOT NULL,
    "layawayPlanId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "fromStatus" "LayawayPlanStatus",
    "toStatus" "LayawayPlanStatus",
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LayawayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayawayRefund" (
    "id" TEXT NOT NULL,
    "layawayPlanId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "amountPaidXof" INTEGER NOT NULL,
    "feeXof" INTEGER NOT NULL DEFAULT 0,
    "refundAmountXof" INTEGER NOT NULL,
    "sellerPenaltyXof" INTEGER NOT NULL DEFAULT 0,
    "status" "LayawayRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "externalReference" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayawayRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayawayDispute" (
    "id" TEXT NOT NULL,
    "layawayPlanId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "LayawayDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNotes" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayawayDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayawayNotification" (
    "id" TEXT NOT NULL,
    "layawayPlanId" TEXT NOT NULL,
    "installmentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "channel" "LayawayNotificationChannel" NOT NULL,
    "status" "LayawayNotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LayawayNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayawayRiskAlert" (
    "id" TEXT NOT NULL,
    "layawayPlanId" TEXT,
    "buyerId" TEXT,
    "shopId" TEXT,
    "kind" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LayawayRiskAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayawayInvoice" (
    "id" TEXT NOT NULL,
    "layawayPlanId" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LayawayInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LayawayPlan_buyerId_status_createdAt_idx" ON "LayawayPlan"("buyerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LayawayPlan_shopId_status_dueAt_idx" ON "LayawayPlan"("shopId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "LayawayPlan_status_graceEndsAt_idx" ON "LayawayPlan"("status", "graceEndsAt");

-- CreateIndex
CREATE INDEX "Installment_status_dueAt_idx" ON "Installment"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_layawayPlanId_sequence_key" ON "Installment"("layawayPlanId", "sequence");

-- CreateIndex
CREATE INDEX "LayawayEvent_layawayPlanId_createdAt_idx" ON "LayawayEvent"("layawayPlanId", "createdAt");

-- CreateIndex
CREATE INDEX "LayawayRefund_status_createdAt_idx" ON "LayawayRefund"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LayawayRefund_layawayPlanId_createdAt_idx" ON "LayawayRefund"("layawayPlanId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LayawayDispute_layawayPlanId_key" ON "LayawayDispute"("layawayPlanId");

-- CreateIndex
CREATE INDEX "LayawayDispute_status_createdAt_idx" ON "LayawayDispute"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LayawayNotification_idempotencyKey_key" ON "LayawayNotification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LayawayNotification_status_scheduledFor_idx" ON "LayawayNotification"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "LayawayRiskAlert_kind_resolvedAt_createdAt_idx" ON "LayawayRiskAlert"("kind", "resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LayawayInvoice_layawayPlanId_key" ON "LayawayInvoice"("layawayPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "LayawayInvoice_providerRef_key" ON "LayawayInvoice"("providerRef");

-- CreateIndex
CREATE INDEX "PaymentIntent_layawayPlanId_createdAt_idx" ON "PaymentIntent"("layawayPlanId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_layawayPlanId_fkey" FOREIGN KEY ("layawayPlanId") REFERENCES "LayawayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayPlan" ADD CONSTRAINT "LayawayPlan_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayPlan" ADD CONSTRAINT "LayawayPlan_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayPlan" ADD CONSTRAINT "LayawayPlan_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_layawayPlanId_fkey" FOREIGN KEY ("layawayPlanId") REFERENCES "LayawayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayEvent" ADD CONSTRAINT "LayawayEvent_layawayPlanId_fkey" FOREIGN KEY ("layawayPlanId") REFERENCES "LayawayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayEvent" ADD CONSTRAINT "LayawayEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayRefund" ADD CONSTRAINT "LayawayRefund_layawayPlanId_fkey" FOREIGN KEY ("layawayPlanId") REFERENCES "LayawayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayRefund" ADD CONSTRAINT "LayawayRefund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayDispute" ADD CONSTRAINT "LayawayDispute_layawayPlanId_fkey" FOREIGN KEY ("layawayPlanId") REFERENCES "LayawayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayNotification" ADD CONSTRAINT "LayawayNotification_layawayPlanId_fkey" FOREIGN KEY ("layawayPlanId") REFERENCES "LayawayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayNotification" ADD CONSTRAINT "LayawayNotification_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayawayInvoice" ADD CONSTRAINT "LayawayInvoice_layawayPlanId_fkey" FOREIGN KEY ("layawayPlanId") REFERENCES "LayawayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_layawayPlanId_fkey" FOREIGN KEY ("layawayPlanId") REFERENCES "LayawayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

