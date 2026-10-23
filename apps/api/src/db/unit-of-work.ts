import { AsyncLocalStorage } from "node:async_hooks";
import type { Db, DbHandle, Tx } from "@erp/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { requestContext } from "../common/context.js";
import { DB } from "./tokens.js";

interface TxScope {
  tx: Tx;
  afterCommit: (() => Promise<void> | void)[];
}

/**
 * One database transaction per business command (CLAUDE.md rule 1).
 * Sets app.user_id / app.request_id / app.reason / app.company_id with SET LOCAL semantics so the
 * audit trigger can attribute every row change. Callbacks registered with `afterCommit`
 * (e.g. realtime events) run only once the transaction has committed.
 */
@Injectable()
export class UnitOfWork {
  private readonly logger = new Logger(UnitOfWork.name);
  private readonly scope = new AsyncLocalStorage<TxScope>();

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Read-only access outside a transaction. */
  get db(): Db {
    return this.handle.db;
  }

  async run<T>(work: (tx: Tx) => Promise<T>, options: { reason?: string } = {}): Promise<T> {
    const existing = this.scope.getStore();
    if (existing) return work(existing.tx); // nested call joins the outer transaction

    const request = requestContext.getStore();
    const afterCommit: TxScope["afterCommit"] = [];
    const result = await this.handle.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT set_config('app.user_id', ${request?.actor?.userId ?? ""}, true),
               set_config('app.company_id', ${request?.actor?.companyId ?? ""}, true),
               set_config('app.request_id', ${request?.requestId ?? ""}, true),
               set_config('app.reason', ${options.reason ?? request?.reason ?? ""}, true)
      `);
      return this.scope.run({ tx, afterCommit }, () => work(tx));
    });

    for (const callback of afterCommit) {
      try {
        await callback();
      } catch (error) {
        this.logger.error(error, "after-commit callback failed");
      }
    }
    return result;
  }

  /** Register work to run after the current transaction commits (no-op if it rolls back). */
  afterCommit(callback: () => Promise<void> | void): void {
    const scope = this.scope.getStore();
    if (!scope) throw new Error("afterCommit() called outside UnitOfWork.run()");
    scope.afterCommit.push(callback);
  }
}
