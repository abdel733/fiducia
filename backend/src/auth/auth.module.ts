import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AccessTokenGuard } from "./access-token.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RolesGuard } from "./roles.guard";
import { MockSmsProvider, SmsProvider } from "./sms-provider";
import { APP_CONFIG, AppConfig } from "../config/config";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    RolesGuard,
    { provide: SmsProvider, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new MockSmsProvider(config) },
  ],
  exports: [AccessTokenGuard, RolesGuard, JwtModule],
})
export class AuthModule {}