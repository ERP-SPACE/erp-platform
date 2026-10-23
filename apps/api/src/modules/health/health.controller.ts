import type { DbHandle } from "@erp/db";
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Redis } from "ioredis";
import { Public } from "../../auth/decorators.js";
import { DB } from "../../db/tokens.js";
import { REDIS } from "../../redis/redis.module.js";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up. */
  @Public()
  @Get("healthz")
  health() {
    return { status: "ok" };
  }

  /** Readiness: dependencies answer. */
  @Public()
  @Get("readyz")
  async ready() {
    const checks = await Promise.allSettled([this.handle.pool.query("SELECT 1"), this.redis.ping()]);
    const [database, redis] = checks.map((c) => (c.status === "fulfilled" ? "ok" : "down"));
    if (database !== "ok" || redis !== "ok") {
      throw new ServiceUnavailableException({ database, redis });
    }
    return { status: "ok", database, redis };
  }
}
