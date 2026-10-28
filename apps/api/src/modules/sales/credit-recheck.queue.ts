import { Inject, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { actor } from "../../common/context.js";
import { ENV, type Env } from "../../config/env.js";
import { UnitOfWork } from "../../db/unit-of-work.js";

export const CREDIT_QUEUE = "erp-credit";

export interface CreditRecheckJob {
  companyId: string;
  /** Null: every held order of the company. */
  customerId: string | null;
}

/**
 * Asks for a credit re-check of a customer's held orders once the current transaction commits
 * (credit note posted, invoice or order cancelled, credit policy changed). Jobs for the same
 * customer within a few seconds collapse into one. The consumer lives in the sales module.
 */
@Injectable()
export class CreditRecheckQueue implements OnModuleDestroy {
  readonly queue: Queue<CreditRecheckJob>;

  constructor(
    private readonly uow: UnitOfWork,
    @Inject(ENV) env: Env,
  ) {
    this.queue = new Queue(CREDIT_QUEUE, {
      connection: { url: env.REDIS_URL },
      prefix: env.QUEUE_PREFIX,
    });
  }

  enqueueAfterCommit(customerId: string) {
    const job: CreditRecheckJob = { companyId: actor().companyId, customerId };
    this.uow.afterCommit(async () => {
      await this.queue.add("credit.recheck", job, {
        jobId: `recheck-${customerId}`,
        delay: 2_000,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
      });
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}

/** The enqueue side only, so the customers module can use it without the sales module. */
@Module({ providers: [CreditRecheckQueue], exports: [CreditRecheckQueue] })
export class CreditRecheckModule {}
