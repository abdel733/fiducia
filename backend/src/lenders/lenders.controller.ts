import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { LenderStatusDto, RegisterLenderDto } from "./lenders.dto";
import { LendersService } from "./lenders.service";

@ApiTags("lenders")
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller("lenders")
export class LendersController {
  constructor(private readonly lenders: LendersService) {}

  @Post("accreditation")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  @ApiOperation({ summary: "Upload and encrypt a lender accreditation document" })
  uploadLicense(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("An accreditation file is required");
    return this.lenders.uploadLicense(user.id, file);
  }

  @Post()
  register(@CurrentUser() user: AuthenticatedUser, @Body() body: RegisterLenderDto) {
    return this.lenders.register(user.id, body);
  }

  @Get("mine")
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.lenders.listMine(user.id);
  }

  @Patch(":lenderId/status")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param("lenderId") lenderId: string, @Body() body: LenderStatusDto) {
    return this.lenders.updateStatus(user.id, lenderId, body.status);
  }
}