import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ShopsController } from "./shops.controller";
import { PublicShopsController } from "./public-shops.controller";
import { ShopsService } from "./shops.service";

@Module({ imports: [AuthModule], controllers: [ShopsController, PublicShopsController], providers: [ShopsService] })
export class ShopsModule {}