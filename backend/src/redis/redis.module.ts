import { Global, Module, OnModuleDestroy } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../config/config";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}
  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 }) },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}