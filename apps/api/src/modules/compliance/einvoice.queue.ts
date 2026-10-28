import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { ENV, type Env } from "../../config/env.js";
import { actor } from "../../common/context.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import type { EDocType } from "./einvoice-documents.js";
import { EInvoiceService } from "./einvoice.service.js";

export const EINVOICE_QUEUE = "einvoice";

interface IrnJob {
  docType: EDocType;
  id: string;
  companyId: string;
  userId: string | null;
}

/**
 * The IRN queue (ADR-0011). Posting enqueues the document after commit; the consumer reports it
 * and retries outages with exponential backoff (30 s → ~1 h over 8 tries). A sweep every
 * 15 minutes re-queues anything still Pending — e.g. after Redis lost a job or the API restarted.
 * The consumer runs in the API process (EINVOICE_QUEUE=true) so it shares the provider session.
 */
@Injectable()
export class EInvoiceQueue implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EInvoiceQueue.name);
  private readonly queue: Queue<IrnJob | Record<string, never>>;
  private worker: Worker<IrnJob | Record<string, never>> | null = null;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly service: EInvoiceService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.queue = new Queue(EINVOICE_QUEUE, { connection: { url: env.REDIS_URL } });
  }

  /** Queues a just-posted document once the current transaction commits. */
  enqueueAfterCommit(docType: EDocType, id: string) {
    const job: IrnJob = { docType, id, companyId: actor().companyId, userId: actor().userId };
    this.uow.afterCommit(() => this.add(job));
  }

  private async add(job: IrnJob) {
    await this.queue.add("irn.generate", job, {
      // One live job per document; a later enqueue after completion is allowed.
      jobId: `${job.docType}-${job.id}`,
      attempts: 8,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      // Failed jobs are dropped so the sweep can queue the document again (it stays Pending).
      removeOnFail: true,
    });
  }

  async onApplicationBootstrap() {
    if (!this.env.EINVOICE_QUEUE) return;
    await this.queue.upsertJobScheduler(
      "einvoice-sweep",
      { every: 15 * 60_000 },
      { name: "irn.sweep", data: {} },
    );
    this.worker = new Worker<IrnJob | Record<string, never>>(
      EINVOICE_QUEUE,
      async (job) => {
        if (job.name === "irn.sweep") {
          const pending = await this.service.pendingJobs();
          for (const p of pending) await this.add(p);
          return { queued: pending.length };
        }
        const r = await this.service.generateAsSystem(job.data as IrnJob);
        // Throwing hands the retry to BullMQ's backoff; permanent failures wait for a person.
        if (r.outcome === "Failed" && r.retryable) throw new Error(r.error);
        return r;
      },
      { connection: { url: this.env.REDIS_URL, maxRetriesPerRequest: null }, concurrency: 1 },
    );
    this.worker.on("failed", (job, error) =>
      this.logger.warn(
        { job: job?.id, attempts: job?.attemptsMade, err: error.message },
        "IRN attempt failed",
      ),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }
}
