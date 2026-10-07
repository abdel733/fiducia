import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CryptoModule } from "../crypto/crypto.module";
import { ImeiModule } from "../imei/imei.module";
import { PrismaModule } from "../database/prisma.module";
import { StorageModule } from "../storage/storage.module";
import { PaymentsModule } from "./payments.module";
import { LayawayController } from "./layaway.controller";
import { LayawayService } from "./layaway.service";

@Module({
  imports: [AuthModule, CryptoModule, ImeiModule, PrismaModule, StorageModule, PaymentsModule],
  controllers: [LayawayController],
  providers: [LayawayService],
  exports: [LayawayService],
})
export class LayawayModule {}
