import { DOC_TYPES, type DocType, docTypeSchema } from "@erp/contracts";
import { type Tx, documentSequences, documentSeries, user } from "@erp/db";
import { fyCode, formatDocNo, istToday, validateGstSeries } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { notFound, validationError } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";

const NO_RESET_FY = "0000";

/**
 * Document numbering (ADR-0003). `allocate` is the only way any module obtains a number:
 * the UPDATE … RETURNING row lock serialises concurrent allocators, and a rollback returns
 * the number, so series stay gapless.
 */
@Injectable()
export class SeriesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
  ) {}

  async list(date = istToday()) {
    const fy = fyCode(date);
    const rows = await this.uow.db
      .select({
        series: documentSeries,
        currentSeq: documentSequences.currentSeq,
        updatedByName: user.name,
      })
      .from(documentSeries)
      .leftJoin(
        documentSequences,
        and(
          eq(documentSequences.seriesId, documentSeries.id),
          eq(
            documentSequences.fy,
            sql`CASE WHEN ${documentSeries.resetOnFy} THEN ${fy} ELSE ${NO_RESET_FY} END`,
          ),
        ),
      )
      .leftJoin(user, eq(user.id, documentSeries.updatedBy))
      .where(eq(documentSeries.companyId, actor().companyId))
      .orderBy(documentSeries.entityType);

    return rows
      .filter((r) => r.series.entityType in DOC_TYPES)
      .map(({ series, currentSeq, updatedByName }) => {
        const type = series.entityType as DocType;
        const used = currentSeq ?? 0;
        return {
          entityType: type,
          label: DOC_TYPES[type].label,
          gst: DOC_TYPES[type].gst,
          prefixTemplate: series.prefixTemplate,
          padding: series.padding,
          resetOnFy: series.resetOnFy,
          numberedOn: series.numberedOn,
          version: series.version,
          usedThisYear: used,
          nextNumber: formatDocNo(series, date, used + 1),
          updatedAt: series.updatedAt.toISOString(),
          updatedByName,
        };
      });
  }

  async preview(type: string, date = istToday()) {
    const entityType = docTypeSchema.parse(type);
    const series = await this.find(this.uow.db, entityType);
    const fy = series.resetOnFy ? fyCode(date) : NO_RESET_FY;
    const [counter] = await this.uow.db
      .select({ currentSeq: documentSequences.currentSeq })
      .from(documentSequences)
      .where(and(eq(documentSequences.seriesId, series.id), eq(documentSequences.fy, fy)));
    return {
      entityType,
      date,
      nextNumber: formatDocNo(series, date, (counter?.currentSeq ?? 0) + 1),
    };
  }

  async update(
    type: string,
    input: { prefixTemplate: string; padding: number; resetOnFy: boolean; version: number },
  ) {
    const entityType = docTypeSchema.parse(type);
    const format = { prefixTemplate: input.prefixTemplate, padding: input.padding };
    const today = istToday();
    // Formatting errors surface here as INVALID_SERIES before anything is written.
    formatDocNo(format, today, 1);
    if (DOC_TYPES[entityType].gst) {
      const errors = validateGstSeries(format, today);
      if (errors.length) {
        throw validationError(
          "This series would produce invalid GST document numbers.",
          errors.map((message) => ({ path: "prefixTemplate", message })),
        );
      }
    }

    await this.uow.run(async (tx) => {
      const series = await this.find(tx, entityType);
      const saved = await updateVersioned(
        tx,
        documentSeries,
        eq(documentSeries.id, series.id),
        input.version,
        {
          prefixTemplate: input.prefixTemplate,
          padding: input.padding,
          resetOnFy: input.resetOnFy,
        },
        `${entityType} series`,
      );
      this.bus.publishAfterCommit("series.changed", { entityType, version: saved.version });
    });
    return (await this.list(today)).find((item) => item.entityType === entityType)!;
  }

  /** Allocate the next number inside the caller's transaction (must be inside UnitOfWork.run). */
  async allocate(tx: Tx, type: DocType, date: string): Promise<string> {
    const series = await this.find(tx, type);
    const fy = series.resetOnFy ? fyCode(date) : NO_RESET_FY;
    await tx
      .insert(documentSequences)
      .values({ seriesId: series.id, fy, currentSeq: 0 })
      .onConflictDoNothing();
    const [row] = await tx
      .update(documentSequences)
      .set({ currentSeq: sql`${documentSequences.currentSeq} + 1`, updatedAt: new Date() })
      .where(and(eq(documentSequences.seriesId, series.id), eq(documentSequences.fy, fy)))
      .returning({ seq: documentSequences.currentSeq });
    return formatDocNo(series, date, row!.seq);
  }

  private async find(db: Pick<Tx, "select">, type: DocType) {
    const [series] = await db
      .select()
      .from(documentSeries)
      .where(
        and(eq(documentSeries.companyId, actor().companyId), eq(documentSeries.entityType, type)),
      );
    if (!series) throw notFound(`${type} series`);
    return series;
  }
}
