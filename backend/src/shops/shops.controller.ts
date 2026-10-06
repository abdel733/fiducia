import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { UserRole } from "@prisma/client";
import { AcceptShopInvitationDto, CreateShopDto, InviteShopMemberDto, KycUploadDto, ShopStatusDto } from "./shops.dto";
import { ShopsService } from "./shops.service";

@ApiTags("shops")
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller("shops")
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Post()
  @ApiOperation({ summary: "Create a shop in PENDING verification state" })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateShopDto) {
    return this.shops.create(user.id, body);
  }

  @Get("mine")
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.shops.listMine(user.id);
  }

  @Post("invitations/accept")
  acceptInvitation(@CurrentUser() user: AuthenticatedUser, @Body() body: AcceptShopInvitationDto) {
    return this.shops.acceptInvitation(user.id, body.token);
  }

  @Post(":shopId/logo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  uploadLogo(@CurrentUser() user: AuthenticatedUser, @Param("shopId") shopId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("A logo file is required");
    return this.shops.uploadLogo(user.id, shopId, file);
  }

  @Get(":shopId")
  @ApiOperation({ summary: "Get a shop only if the caller is a member" })
  getOne(@CurrentUser() user: AuthenticatedUser, @Param("shopId") shopId: string) {
    return this.shops.getForMember(user.id, shopId);
  }

  @Post(":shopId/invitations")
  invite(@CurrentUser() user: AuthenticatedUser, @Param("shopId") shopId: string, @Body() body: InviteShopMemberDto) {
    return this.shops.createInvitation(user.id, shopId, body.phone);
  }

  @Patch(":shopId/payment-options")
  updatePaymentOptions(@CurrentUser() user: AuthenticatedUser, @Param("shopId") shopId: string, @Body() body: { options: import("@prisma/client").PaymentOptionKind[] }) {
    return this.shops.updatePaymentOptions(user.id, shopId, body.options);
  }

  @Post(":shopId/documents")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { kind: { type: "string" }, file: { type: "string", format: "binary" } }, required: ["kind", "file"] } })
  @ApiOperation({ summary: "Upload and encrypt a private KYC document" })
  uploadKyc(@CurrentUser() user: AuthenticatedUser, @Param("shopId") shopId: string, @Body() body: KycUploadDto, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("A document file is required");
    return this.shops.createKycUpload(user.id, shopId, body, file);
  }

  @Get(":shopId/documents/:documentId")
  async downloadKyc(@CurrentUser() user: AuthenticatedUser, @Param("shopId") shopId: string, @Param("documentId") documentId: string, @Res() response: Response) {
    const { document, body } = await this.shops.downloadKyc(user.id, shopId, documentId);
    response.setHeader("Content-Type", document.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename="${document.originalName.replace(/["\\\r\n]/g, "_")}"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(body);
  }

  @Patch(":shopId/status")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param("shopId") shopId: string, @Body() body: ShopStatusDto) {
    return this.shops.updateStatus(user.id, shopId, body.status);
  }
}