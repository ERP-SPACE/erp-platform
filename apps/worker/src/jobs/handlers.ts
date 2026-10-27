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
   * Refreshes the analytics materialized views (ADR-0005). The worker connects as erp_app, which
   * can't refresh views itself; each refresh function is SECURITY DEFINER (migration 0005).
   */
  async "analytics.refresh"({ db, redis }) {
    for (const fn of ANALYTICS_REFRESH_FUNCTIONS) {
      await db.db.execute(sql.raw(`SELECT ${fn}()`));
    }
    await redis.set("erp:analytics:refreshed-at", new Date().toISOString());
    return { refreshed: ANALYTICS_REFRESH_FUNCTIONS.length };
  },
};

/** Stage 2: stock by SKU / batch / supplier. Stage 5 adds its own. */
export const ANALYTICS_REFRESH_FUNCTIONS: readonly string[] = ["public.refresh_stock_views"];
