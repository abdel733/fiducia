import { ExecutionContext, ForbiddenException, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Reflector } from "@nestjs/core";
import { AuditService } from "../src/audit/audit.service";
import { CryptoService } from "../src/crypto/crypto.service";
import { validateEnvironment } from "@fiducia/config";
import { PrismaService } from "../src/database/prisma.service";
import { RolesGuard } from "../src/auth/roles.guard";
import { canTransitionShopStatus, ShopsService } from "../src/shops/shops.service";
import { StorageProvider } from "../src/storage/storage.provider";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { MarketplaceService } from "../src/marketplace/marketplace.service";

describe("resource authorization", () => {
  it("denies a buyer an admin-only action", () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([UserRole.ADMIN]) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const context = {
      getHandler: jest.fn(), getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { id: "buyer-1", roles: [UserRole.BUYER] } }) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("hides a shop that does not belong to the requesting user", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new ShopsService(
      { shop: { findFirst } } as unknown as PrismaService,
      {} as StorageProvider,
      new CryptoService(validateEnvironment({})),
      {} as AuditService,
    );
    await expect(service.getForMember("buyer-1", "shop-secret")).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "shop-secret", OR: [{ ownerId: "buyer-1" }, { members: { some: { userId: "buyer-1" } } }] } }));
  });

  it("denies listing access when the user is not a member of the shop", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new MarketplaceService(
      { shop: { findFirst } } as unknown as PrismaService,
      {} as CryptoService,
      {} as StorageProvider,
      {} as AuditService,
    );
    await expect(service.listShopListings("shop-secret", { id: "buyer-1", roles: [UserRole.BUYER] } as AuthenticatedUser)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "shop-secret", OR: [{ ownerId: "buyer-1" }, { members: { some: { userId: "buyer-1" } } }] } }));
  });

  it("allows only reviewed shop-status transitions", () => {
    expect(canTransitionShopStatus("PENDING", "VERIFIED")).toBe(true);
    expect(canTransitionShopStatus("PENDING", "REJECTED")).toBe(true);
    expect(canTransitionShopStatus("VERIFIED", "PENDING")).toBe(false);
    expect(canTransitionShopStatus("SUSPENDED", "VERIFIED")).toBe(true);
  });
});