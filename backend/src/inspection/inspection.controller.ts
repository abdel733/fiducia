import { Body, Controller, Post, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { InspectionChecklistInput } from "./inspection.service";
import { InspectionPhotoFiles, InspectionWorkflowService } from "./inspection-workflow.service";

@ApiTags("inspections")
@Controller("inspections")
export class InspectionController {
  constructor(private readonly workflow: InspectionWorkflowService) {}

  @Post()
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileFieldsInterceptor([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "settings-imei-serial", maxCount: 1 },
  ], { limits: { fileSize: 8 * 1024 * 1024, files: 3 } }))
  @ApiConsumes("multipart/form-data")
  create(
    @Body() body: InspectionChecklistInput & { shopId: string; verificationReportId: string },
    @UploadedFiles() files: InspectionPhotoFiles,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.workflow.create(body, files, actor);
  }
}
