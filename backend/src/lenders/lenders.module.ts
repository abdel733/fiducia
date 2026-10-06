import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LendersController } from "./lenders.controller";
import { LendersService } from "./lenders.service";

@Module({ imports: [AuthModule], controllers: [LendersController], providers: [LendersService] })
export class LendersModule {}