import { ConflictException } from "@nestjs/common";
import { LayawayPlanStatus } from "@prisma/client";

const allowedTransitions: Partial<Record<LayawayPlanStatus, LayawayPlanStatus[]>> = {
  DRAFT: ["PENDING_FIRST_PAYMENT", "CANCELLED_BY_ADMIN"],
  PENDING_FIRST_PAYMENT: ["ACTIVE", "LATE", "EXPIRED_UNPAID", "CANCELLED_BY_BUYER", "CANCELLED_BY_SELLER", "CANCELLED_BY_ADMIN", "DISPUTED"],
  ACTIVE: ["LATE", "COMPLETED", "EXPIRED_UNPAID", "CANCELLED_BY_BUYER", "CANCELLED_BY_SELLER", "CANCELLED_BY_ADMIN", "DISPUTED"],
  LATE: ["ACTIVE", "COMPLETED", "EXPIRED_UNPAID", "CANCELLED_BY_BUYER", "CANCELLED_BY_SELLER", "CANCELLED_BY_ADMIN", "DISPUTED"],
  COMPLETED: ["READY_FOR_PICKUP", "DISPUTED", "CANCELLED_BY_ADMIN"],
  READY_FOR_PICKUP: ["HANDED_OVER", "DISPUTED", "CANCELLED_BY_SELLER", "CANCELLED_BY_ADMIN"],
  DISPUTED: ["CANCELLED_BY_ADMIN", "REFUNDED", "HANDED_OVER"],
  EXPIRED_UNPAID: ["REFUNDED"],
  CANCELLED_BY_BUYER: ["REFUNDED"],
  CANCELLED_BY_SELLER: ["REFUNDED"],
  CANCELLED_BY_ADMIN: ["REFUNDED"],
};

export function canTransitionLayaway(from: LayawayPlanStatus, to: LayawayPlanStatus): boolean {
  return allowedTransitions[from]?.includes(to) ?? false;
}

export function assertLayawayTransition(from: LayawayPlanStatus, to: LayawayPlanStatus): void {
  if (!canTransitionLayaway(from, to)) throw new ConflictException(`Transition de réservation interdite : ${from} → ${to}.`);
}
