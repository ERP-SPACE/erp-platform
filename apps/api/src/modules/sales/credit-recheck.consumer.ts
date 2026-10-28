import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Worker } from "bullmq";
import { SETTINGS, parseSetting } from "@erp/contracts";
import { settings } from "@erp/db";
import { eq } from "drizzle-orm";
import { ENV, type Env } from "../../config/env.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { CreditNightlyService } from "./credit-nightly.service.js";
import { CREDIT_QUEUE, type CreditRecheckJob, CreditRecheckQueue } from "./credit-recheck.queue.js";
import { SalesOrdersService } from "./sales-orders.service.js";

/**
 * Consumes credit re-check jobs in the API (API_JOBS=true), plus a sweep every 30 minutes over
 * all held orders — catching anything a lost job missed — and the nightly credit check
 * (Settings → credit.nightlyCheck, IST; restart the API to apply a new time).
 */
@Injectable()
export class CreditRecheckConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CreditRecheckConsumer.name);
  private worker: Worker<CreditRecheckJob | Record<string, never>> | null = null;

  constructor(
    private readonly orders: SalesOrdersService,
    private readonly queue: CreditRecheckQueue,
    private readonly nightly: CreditNightlyService,
    private readonly uow: UnitOfWork,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    if (!this.env.API_JOBS) return;
    await this.queue.queue.upsertJobScheduler(
      "credit-sweep",
      { every: 30 * 60_000 },
      { name: "credit.sweep", data: { companyId: "", customerId: null } },
    );
    const [stored] = await this.uow.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "credit.nightlyCheck"))
      .limit(1);
    const nightly = parseSetting(
      "credit.nightlyCheck",
      stored?.value ?? SETTINGS["credit.nightlyCheck"].default,
    );
    if (nightly.enabled) {
      const [hh, mm] = nightly.time.split(":").map(Number);
      await this.queue.queue.upsertJobScheduler(
        "credit-nightly",
        { pattern: `${mm} ${hh} * * *`, tz: "Asia/Kolkata" },
        { name: "credit.nightly", data: { companyId: "", customerId: null } },
      );
    } else {
      await this.queue.queue.removeJobScheduler("credit-nightly");
    }
    this.worker = new Worker<CreditRecheckJob | Record<string, never>>(
      CREDIT_QUEUE,
      async (job) => {
        if (job.name === "credit.nightly") return this.nightly.run();
        const data = job.data as CreditRecheckJob;
        const r = await this.orders.recheckHeld(
          job.name === "credit.sweep"
            ? null
            : { companyId: data.companyId, customerId: data.customerId },
        );
        if (r.released) this.logger.log(r, "held orders released by credit re-check");
        return r;
      },
      {
        connection: { url: this.env.REDIS_URL, maxRetriesPerRequest: null },
        prefix: this.env.QUEUE_PREFIX,
        concurrency: 1,
      },
    );
    // Redis hiccups are reported, never thrown as unhandled 'error' events.
    this.worker.on("error", (error) => this.logger.error(error, "credit re-check queue error"));
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
