import type { LabelJobStatus } from "@erp/contracts";
import { batches, goodsReceipts, labelPrints, rolls } from "@erp/db";
import {
  LABEL_QUEUE,
  type LabelData,
  type LabelJobData,
  type LabelJobResult,
  LabelLayoutError,
  labelFileKey,
  renderLabels,
} from "@erp/labels";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import { actor, ctx } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, reasonRequired, validationError } from "../../common/errors.js";
import { ENV, type Env } from "../../config/env.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { REDIS } from "../../redis/redis.module.js";
import { SettingsService } from "../settings/settings.service.js";
import type { LabelRequestDto } from "./inventory.dto.js";

/** Up to this many labels render on request; larger batches go to the worker. */
export const MAX_DIRECT_LABELS = 300;
const MAX_JOB_LABELS = 5000;

/**
 * Roll labels (ADR-0006/0007). Small batches render on request; large ones (a whole container)
 * are queued for the worker and downloaded when ready. Rendering lives in @erp/labels so both
 * paths print identical labels. Every print is logged to `label_prints`; reprints need a reason.
 */
@Injectable()
export class LabelsService implements OnModuleDestroy {
  private readonly queue: Queue<LabelJobData, LabelJobResult>;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Env,
  ) {
    this.queue = new Queue(LABEL_QUEUE, { connection: { url: env.REDIS_URL } });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async render(
    dto: LabelRequestDto,
  ): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    const reason = this.reason(dto);
    const labels = await this.load(dto, MAX_DIRECT_LABELS);
    const layout = await this.settings.value("labels.roll");
    let rendered;
    try {
      rendered = await renderLabels(labels, layout);
    } catch (error) {
      if (error instanceof LabelLayoutError) throw validationError(error.message);
      throw error;
    }
    await this.uow.run(async (tx) => {
      await tx.insert(labelPrints).values(
        labels.map((l) => ({
          rollId: l.id,
          reprint: dto.reprint,
          reason,
          format: layout.output === "ZPL" ? "ZPL" : `PDF-${layout.layout}`,
          createdBy: actor().userId,
        })),
      );
    });
    return {
      body: Buffer.from(rendered.body),
      contentType: rendered.contentType,
      fileName: `roll-labels-${stamp()}.${rendered.extension}`,
    };
  }

  /** Queues a large batch; the worker renders it, logs the prints and keeps the file for an hour. */
  async enqueue(dto: LabelRequestDto): Promise<{ jobId: string; count: number }> {
    const reason = this.reason(dto);
    const labels = await this.load(dto, MAX_JOB_LABELS);
    const layout = await this.settings.value("labels.roll");
    const job = await this.queue.add(
      "labels.render",
      {
        companyId: actor().companyId,
        userId: actor().userId,
        labels,
        layout,
        reprint: dto.reprint,
        reason,
      },
      { removeOnComplete: { age: 3600 }, removeOnFail: { age: 86_400 }, attempts: 2 },
    );
    return { jobId: job.id!, count: labels.length };
  }

  async status(jobId: string): Promise<LabelJobStatus> {
    const job = await this.ownJob(jobId);
    const state = await job.getState();
    const progress = typeof job.progress === "number" ? job.progress : 0;
    return {
      jobId,
      state:
        (["waiting", "active", "completed", "failed", "delayed"] as const).find(
          (s) => s === state,
        ) ?? "unknown",
      done: state === "completed" ? job.data.labels.length : progress,
      count: job.data.labels.length,
      fileName: job.returnvalue?.fileName ?? null,
      error:
        state === "failed" ? "Label rendering failed. Try again, or print fewer labels." : null,
    };
  }

  async file(jobId: string): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    const job = await this.ownJob(jobId);
    const body = await this.redis.getBuffer(labelFileKey(jobId));
    if (!body || !job.returnvalue) throw notFound("Label file (it may have expired — print again)");
    return { body, contentType: job.returnvalue.contentType, fileName: job.returnvalue.fileName };
  }

  /** Jobs are only visible to the company that queued them. */
  private async ownJob(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job || job.data.companyId !== actor().companyId) throw notFound("Label job");
    return job;
  }

  private reason(dto: LabelRequestDto): string | null {
    const reason = ctx().reason?.trim() ?? null;
    if (dto.reprint && !reason) throw reasonRequired();
    return reason;
  }

  private async load(dto: LabelRequestDto, max: number): Promise<LabelData[]> {
    const filters = [eq(rolls.companyId, actor().companyId)];
    if (dto.grnId) filters.push(eq(rolls.grnId, dto.grnId));
    if (dto.rollIds.length) filters.push(inArray(rolls.id, dto.rollIds));
    const rows = await this.uow.db
      .select({
        roll: rolls,
        batchSeq: batches.batchSeq,
        ref: batches.supplierBatchRef,
        grnDate: goodsReceipts.date,
      })
      .from(rolls)
      .innerJoin(batches, eq(batches.id, rolls.batchId))
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, rolls.grnId))
      .where(and(...filters))
      .orderBy(asc(rolls.barcode));
    if (rows.length === 0) throw notFound("Rolls");
    if (dto.rollIds.length && rows.length !== new Set(dto.rollIds).size) throw notFound("Roll");
    if (rows.length > max) {
      throw validationError(
        max === MAX_DIRECT_LABELS
          ? `${rows.length} labels is a big batch — use background printing (labels/jobs).`
          : `Print at most ${max} labels at a time.`,
      );
    }
    return rows.map(({ roll, batchSeq, ref, grnDate }) => ({
      id: roll.id,
      barcode: roll.barcode,
      description: roll.description,
      gsm: roll.gsm,
      widthIn: trimDecimal(roll.widthIn),
      lengthM: roll.currentLengthM,
      lot: `${String(batchSeq).padStart(4, "0")}${ref ? ` (${ref})` : ""}`,
      received: grnDate.split("-").reverse().join("-"),
    }));
  }
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
