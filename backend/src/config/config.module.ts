import { Global, Module } from "@nestjs/common";
import { appConfigProvider } from "./config";

@Global()
@Module({ providers: [appConfigProvider], exports: [appConfigProvider] })
export class ConfigModule {}