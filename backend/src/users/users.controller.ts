import { Controller, Delete, Get, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  @ApiOperation({ summary: "Get the authenticated user's account" })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.exportAccount(user.id);
  }

  @Get("me/export")
  @ApiOperation({ summary: "Export personal account data as JSON" })
  export(@CurrentUser() user: AuthenticatedUser) {
    return this.users.exportAccount(user.id);
  }

  @Delete("me")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete personal data and revoke account access" })
  delete(@CurrentUser() user: AuthenticatedUser) {
    return this.users.requestDeletion(user.id);
  }
}