import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ShopsService } from "./shops.service";

@ApiTags("shops")
@Controller("shops")
export class PublicShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get(":shopId/logo-url")
  @ApiOperation({ summary: "Get a five-minute signed URL for a verified shop logo" })
  logoUrl(@Param("shopId") shopId: string) {
    return this.shops.getLogoUrl(shopId);
  }
}