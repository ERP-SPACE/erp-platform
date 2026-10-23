import type { RealtimeEvent, RealtimeTopic } from "@erp/contracts";
import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { Subject } from "rxjs";
import { actor } from "../../common/context.js";
import { ENV, type Env } from "../../config/env.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { REDIS, createRedis } from "../../redis/redis.module.js";

const CHANNEL = "erp:events";

/**
 * Domain event fan-out (ADR-0005): publish → Redis pub/sub → every API instance → SSE clients.
 * Events are published only after the surrounding transaction commits.
 */
@Injectable()
export class EventBus implements OnApplicationShutdown {
  private readonly logger = new Logger(EventBus.name);
  readonly events$ = new Subject<RealtimeEvent>();
  private subscriber?: Redis;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly uow: UnitOfWork,
  ) {}

  /** Lazily subscribe so processes that never serve SSE never open the extra connection. */
  ensureSubscribed(): void {
    if (this.subscriber) return;
    this.subscriber = createRedis(this.env.REDIS_URL);
    this.subscriber.on("message", (_channel, message) => {
      try {
        this.events$.next(JSON.parse(message) as RealtimeEvent);
      } catch (error) {
        this.logger.warn(error, "dropping malformed realtime message");
      }
    });
    void this.subscriber.subscribe(CHANNEL);
  }

  /** Publish once the current UnitOfWork commits. */
  publishAfterCommit<T extends Record<string, unknown>>(topic: RealtimeTopic, data: T): void {
    const a = actor();
    const event: RealtimeEvent<T> = {
      topic,
      companyId: a.companyId,
      by: a.userId,
      at: new Date().toISOString(),
      data,
    };
    this.uow.afterCommit(async () => {
      await this.redis.publish(CHANNEL, JSON.stringify(event));
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.events$.complete();
    this.subscriber?.disconnect();
  }
}
