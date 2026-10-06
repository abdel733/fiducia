import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import { CryptoModule } from "./crypto/crypto.module";
import { PrismaModule } from "./database/prisma.module";
import { HealthController } from "./health/health.controller";
import { ImeiModule } from "./imei/imei.module";
import { LendersModule } from "./lenders/lenders.module";
import { RedisModule } from "./redis/redis.module";
import { ShopsModule } from "./shops/shops.module";
import { StorageModule } from "./storage/storage.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    StorageModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ShopsModule,
    LendersModule,
    ImeiModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}