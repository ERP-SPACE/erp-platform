import { type DbHandle, labelPrints } from "@erp/db";
import {
  LABEL_FILE_TTL_SECONDS,
  type LabelJobData,
  type LabelJobResult,
  labelFileKey,
  renderLabels,
} from "@erp/labels";
import type { Logger } from "pino";

/** The slice of a BullMQ job the processor needs (keeps it testable without Redis). */
export interface LabelJob {
  id?: string;
  data: LabelJobData;
  updateProgress(progress: number): Promise<unknown>;
}

export interface LabelJobDeps {
  db: Pick<DbHandle, "db">;
  redis: { set(key: string, value: Buffer, mode: "EX", seconds: number): Promise<unknown> };
  log: Logger;
}

/**
 * Renders a large label batch (a whole container's GRN) off the request path. The file waits in
 * Redis for an hour under `labelFileKey(jobId)`; the prints are logged once the file exists.
 */
export async function processLabelJob(job: LabelJob, deps: LabelJobDeps): Promise<LabelJobResult> {
  const { labels, layout, reprint, reason, userId } = job.data;
  const rendered = await renderLabels(labels, layout, (done) => void job.updateProgress(done));
  const body = Buffer.from(rendered.body);
  await deps.redis.set(labelFileKey(job.id!), body, "EX", LABEL_FILE_TTL_SECONDS);
  const format = layout.output === "ZPL" ? "ZPL" : `PDF-${layout.layout}`;
  for (let i = 0; i < labels.length; i += 500) {
    await deps.db.db
      .insert(labelPrints)
      .values(
        labels
          .slice(i, i + 500)
          .map((l) => ({ rollId: l.id, reprint, reason, format, createdBy: userId })),
      );
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  deps.log.info({ jobId: job.id, labels: labels.length, bytes: body.length }, "labels rendered");
  return {
    count: labels.length,
    bytes: body.length,
    contentType: rendered.contentType,
    fileName: `roll-labels-${stamp}.${rendered.extension}`,
  };
}
