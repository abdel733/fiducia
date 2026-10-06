import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ImeiController } from "./imei.controller";
import { DailyImeiReverificationJob } from "./daily-imei-reverification.job";
import { ImeiRegistry } from "./imei-registry.service";
import { ImeiVerificationService } from "./imei-verification.service";
import { MockImeiProvider } from "./mock-imei-provider";

@Module({
  imports: [AuthModule],
  controllers: [ImeiController],
  providers: [
    ImeiRegistry,
    MockImeiProvider,
    {
      provide: ImeiVerificationService,
      useFactory: (registry: ImeiRegistry, provider: MockImeiProvider) =>
        new ImeiVerificationService({ providers: [provider], registry }),
      inject: [ImeiRegistry, MockImeiProvider],
    },
    DailyImeiReverificationJob,
  ],
  exports: [ImeiVerificationService, ImeiRegistry, DailyImeiReverificationJob],
})
export class ImeiModule {}
