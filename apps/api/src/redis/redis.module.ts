import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { ENV, type Env } from "../config/env.js";

export const REDIS = Symbol("REDIS");

export function createRedis(url: string): Redis {
  // lazyConnect: tools that build the app without serving (OpenAPI export) never open a socket.
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, enableAutoPipelining: true });
}

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === "ready") await this.redis.quit();
    else this.redis.disconnect();
  }
}

@Global()
@Module({
  providers: [{ provide: REDIS, inject: [ENV], useFactory: (env: Env) => createRedis(env.REDIS_URL) }, RedisLifecycle],
  exports: [REDIS],
})
export class RedisModule {}
