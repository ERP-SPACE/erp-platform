import { type DbHandle, idempotencyKeys } from "@erp/db";
import { lt, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { JobName } from "../schedule.js";

export interface JobDeps {
  db: DbHandle;
  redis: Redis;
  log: Logger;
}

type Handler = (deps: JobDeps) => Promise<Record<string, unknown>>;

export const handlers: Record<JobName, Handler> = {
  /** Lets /readyz and ops see the worker is alive. */
  async "system.heartbeat"({ redis }) {
    await redis.set("erp:worker:heartbeat", new Date().toISOString(), "EX", 180);
    return {};
  },

  /** Keeps monthly audit partitions two months ahead (migration 0001). */
  async "audit.ensure-partitions"({ db }) {
    const result = await db.db.execute<{ created: number }>(
      sql`SELECT audit.ensure_partitions(2) AS created`,
    );
    return { created: result.rows[0]?.created ?? 0 };
  },

  async "idempotency.purge-expired"({ db }) {
    const deleted = await db.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()))
      .returning({ key: idempotencyKeys.key });
    return { deleted: deleted.length };
  },

  /**
   * Refreshes analytics materialized views CONCURRENTLY (ADR-0005). No views exist yet; Stage 2
   * and Stage 5 register theirs in ANALYTICS_VIEWS.
   */
  async "analytics.refresh"({ db, redis }) {
    for (const view of ANALYTICS_VIEWS) {
      await db.db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`));
    }
    await redis.set("erp:analytics:refreshed-at", new Date().toISOString());
    return { refreshed: ANALYTICS_VIEWS.length };
  },
};

export const ANALYTICS_VIEWS: readonly string[] = [];
