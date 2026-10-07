import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { MarketplaceReportSeverity, UserRole } from "@prisma/client";
import { Response } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { CreateListingInput, ListingSearchInput, MarketplaceService } from "./marketplace.service";

@ApiTags("marketplace")
@Controller("marketplace")
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get("listings")
  list(@Query() query: Record<string, string | undefined>) {
    const filters: ListingSearchInput = {
      q: query.q,
      model: query.model,
      capacity: query.capacity,
      color: query.color,
      condition: query.condition as ListingSearchInput["condition"],
      city: query.city,
      minPrice: parseOptionalInteger(query.minPrice, "minPrice"),
      maxPrice: parseOptionalInteger(query.maxPrice, "maxPrice"),
      limit: parseOptionalInteger(query.limit, "limit"),
      cursor: query.cursor,
      certificateValid: parseOptionalBoolean(query.certificateValid),
      installments: parseOptionalBoolean(query.installments),
      partnerFinancing: parseOptionalBoolean(query.partnerFinancing),
      sellerVerified: parseOptionalBoolean(query.sellerVerified),
    };
    return this.marketplace.listPublic(filters);
  }

  @Get("listings/:slug")
  getListing(@Param("slug") slug: string) {
    return this.marketplace.getPublicListing(slug);
  }

  @Get("shops/:slug")
  getShop(@Param("slug") slug: string) {
    return this.marketplace.getPublicShop(slug);
  }

  @Get("reports/queue")
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  listReportQueue() {
    return this.marketplace.listReportQueue();
  }

  @Get("photos/:photoId")
  async getPhoto(@Param("photoId") photoId: string, @Res() response: Response) {
    const { photo, bytes } = await this.marketplace.getPublicPhoto(photoId);
    response.setHeader("Content-Type", photo.mimeType);
    response.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(bytes);
  }

  @Post("shops/:shopId/listings")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  createDraft(@Param("shopId") shopId: string, @Body() input: CreateListingInput, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.createDraft(shopId, input, actor);
  }

  @Post("shops/:shopId/import")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  importStock(@Param("shopId") shopId: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) throw new BadRequestException("Le fichier CSV/XLSX est requis.");
    return this.marketplace.importStock(shopId, file.originalname, file.buffer, actor);
  }

  @Post("listings/:listingId/photos")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  addPhoto(@Param("listingId") listingId: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) throw new BadRequestException("Une photo est requise.");
    return this.marketplace.addPhoto(listingId, actor, file);
  }

  @Post("listings/:listingId/submit")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  submitForReview(@Param("listingId") listingId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.submitForReview(listingId, actor);
  }

  @Get("listings/:listingId/certificate")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  checkListingCertificate(@Param("listingId") listingId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.checkListingCertificate(listingId, actor);
  }

  @Get("shops/:shopId/listings")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  listShopListings(@Param("shopId") shopId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.listShopListings(shopId, actor);
  }

  @Post("shops/:shopId/certificate-check")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  checkShopImeiCertificate(@Param("shopId") shopId: string, @Body() body: { imei: string }, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.checkShopImeiCertificate(shopId, body.imei, actor);
  }

  @Patch("listings/:listingId/moderation")
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  moderate(@Param("listingId") listingId: string, @Body() body: { decision: "PUBLISHED" | "REJECTED"; reason?: string }, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.moderateListing(listingId, body.decision, actor, body.reason);
  }

  @Patch("listings/:listingId/withdraw")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  withdraw(@Param("listingId") listingId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.transition(listingId, "WITHDRAWN", actor);
  }

  @Post("reports")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  createReport(@Body() input: Parameters<MarketplaceService["createReport"]>[0], @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.createReport(input, actor);
  }

  @Patch("reports/:reportId/respond")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  respondToReport(@Param("reportId") reportId: string, @Body() body: { response: string }, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.respondToReport(reportId, body.response, actor);
  }

  @Patch("reports/:reportId/review")
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  reviewReport(@Param("reportId") reportId: string, @Body() body: { decision: "RESOLVED" | "REJECTED"; resolution: string }, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.reviewReport(reportId, body.decision, body.resolution, actor);
  }

  @Patch("reports/:reportId/severity")
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  classifyReport(@Param("reportId") reportId: string, @Body() body: { severity: MarketplaceReportSeverity }, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.classifyReport(reportId, body.severity, actor);
  }

  @Get("shops/:shopId/notifications")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  listShopNotifications(@Param("shopId") shopId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.listShopNotifications(shopId, actor);
  }

  @Post("purchases/:purchaseId/review")
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  reviewPurchase(@Param("purchaseId") purchaseId: string, @Body() body: { rating: number; body?: string }, @CurrentUser() actor: AuthenticatedUser) {
    return this.marketplace.reviewPurchase(purchaseId, body, actor);
  }
}

function parseOptionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new BadRequestException(`${name} doit être un entier.`);
  return parsed;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BadRequestException("Les filtres booléens acceptent uniquement true/false.");
}