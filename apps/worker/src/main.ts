import { parseSetting } from "@erp/contracts";
import { createDb, settings } from "@erp/db";
import { DOCUMENT_QUEUE, type DocumentJobData, type DocumentJobResult } from "@erp/documents";
import { closePdfBrowser, htmlToPdf } from "@erp/documents/pdf";
import { LABEL_QUEUE, type LabelJobData, type LabelJobResult } from "@erp/labels";
import { eq } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { pino } from "pino";
import { z } from "zod";
import { handlers } from "./jobs/handlers.js";
import { processLabelJob } from "./jobs/labels.js";
import { type JobName, TZ, buildSchedule } from "./schedule.js";

const env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    LOG_LEVEL: z.string().default("info"),
  })
  .parse(process.env);

const log = pino({
  level: env.LOG_LEVEL,
  base: { service: "worker" },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { singleLine: true } }
      : undefined,
});

const QUEUE = "erp-system";
// BullMQ workers need maxRetriesPerRequest: null on their blocking connection.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const redis = new Redis(env.REDIS_URL);
const db = createDb(env.DATABASE_URL, { max: 3 });

const queue = new Queue(QUEUE, { connection });
// Refresh cadence from Settings → analytics.refresh (single company; restart to apply changes).
const [stored] = await db.db
  .select({ value: settings.value })
  .from(settings)
  .where(eq(settings.key, "analytics.refresh"))
  .limit(1);
const refresh = parseSetting(
  "analytics.refresh",
  stored?.value ?? {
    businessMinutes: 3,
    offHoursMinutes: 30,
    businessStart: "08:00",
    businessEnd: "20:00",
  },
);
for (const entry of buildSchedule({
  businessMinutes: refresh.businessMinutes,
  offHoursMinutes: refresh.offHoursMinutes,
  businessStartHour: Number(refresh.businessStart.slice(0, 2)),
  businessEndHour: Number(refresh.businessEnd.slice(0, 2)),
})) {
  await queue.upsertJobScheduler(
    entry.id,
    { pattern: entry.pattern, tz: TZ },
    { name: entry.job, opts: { removeOnComplete: 100, removeOnFail: 500 } },
  );
}

const worker = new Worker(
  QUEUE,
  async (job) => {
    const handler = handlers[job.name as JobName];
    if (!handler) throw new Error(`No handler for job ${job.name}`);
    return handler({ db, redis, log: log.child({ job: job.name }) });
  },
  { connection, concurrency: 2 },
);

// Large label batches queued by the API (Stage 2); one at a time, they are CPU-heavy.
const labelWorker = new Worker<LabelJobData, LabelJobResult>(
  LABEL_QUEUE,
  (job) => processLabelJob(job, { db, redis, log: log.child({ job: "labels.render" }) }),
  { connection, concurrency: 1 },
);
labelWorker.on("failed", (job, error) =>
  log.error({ job: job?.id, err: error }, "label job failed"),
);

// Invoice / note / challan / proforma PDFs (Stage 3): the API sends finished HTML and waits.
const documentWorker = new Worker<DocumentJobData, DocumentJobResult>(
  DOCUMENT_QUEUE,
  async (job) => ({ pdfBase64: Buffer.from(await htmlToPdf(job.data.html)).toString("base64") }),
  { connection, concurrency: 2 },
);
documentWorker.on("failed", (job, error) =>
  log.error({ job: job?.id, err: error }, "document job failed"),
);

worker.on("completed", (job, result) => {
  if (job.name !== "system.heartbeat") log.info({ job: job.name, result }, "job completed");
});
worker.on("failed", (job, error) => log.error({ job: job?.name, err: error }, "job failed"));
log.info("worker started");

const shutdown = async () => {
  log.info("worker shutting down");
  await worker.close();
  await labelWorker.close();
  await documentWorker.close();
  await closePdfBrowser();
  await queue.close();
  await db.close();
  redis.disconnect();
  connection.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
