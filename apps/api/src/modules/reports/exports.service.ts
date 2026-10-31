import type { Readable } from "node:stream";
import {
  type ExportItem,
  type ExportRequest,
  type PivotResponse,
  REPORTS,
  type ReportColumn,
  type ReportResponse,
  exportRequest as exportRequestSchema,
  reportQuery,
} from "@erp/contracts";
import { reportExports } from "@erp/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { actor, runAsSystem } from "../../common/context.js";
import { AppError, forbidden, notFound } from "../../common/errors.js";
import { ENV, type Env } from "../../config/env.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { StorageService } from "../../storage/storage.service.js";
import { PdfService } from "../sales/pdf.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { ReportsService } from "./reports.service.js";

/** Byte-order mark so Excel opens UTF-8 CSV (₹, ″) correctly. */
const BOM = String.fromCharCode(0xfeff);

export const EXPORT_QUEUE = "erp-exports";
const MIME = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

interface ExportJob {
  exportId: string;
}

/** A table, whatever produced it: header labels, rows of cells, an optional totals row. */
interface Sheet {
  title: string;
  subtitle: string;
  headers: string[];
  kinds: ReportColumn["kind"][];
  rows: (string | number | null)[][];
  totals: (string | number | null)[] | null;
}

/**
 * Report and pivot exports (CSV / XLSX / PDF). The request is recorded and queued; a BullMQ
 * consumer in the API process (API_JOBS=true, like the IRN and credit queues) re-runs the same
 * query the screen uses, as the requesting user and with the cost visibility they had then,
 * stores the file through the storage adapter (ADR-0023) and marks it Ready with an expiry.
 * PDFs are rendered by the worker's Chromium (ADR-0024). An hourly sweep deletes expired files.
 */
@Injectable()
export class ExportsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExportsService.name);
  readonly queue: Queue<ExportJob>;
  private worker: Worker<ExportJob> | null = null;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly reports: ReportsService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.queue = new Queue(EXPORT_QUEUE, {
      connection: { url: env.REDIS_URL },
      prefix: env.QUEUE_PREFIX,
    });
  }

  private title(req: ExportRequest) {
    return req.kind === "report"
      ? REPORTS[req.reportId!].title
      : `Pivot: ${req.spec!.rows.join(" × ") || "total"}${req.spec!.cols.length ? ` by ${req.spec!.cols.join(" × ")}` : ""}`;
  }

  async request(req: ExportRequest): Promise<ExportItem> {
    if (req.kind === "report" && !this.reports.allowed(req.reportId!))
      throw forbidden("see this report");
    const id = await this.uow.run(async (tx) => {
      const [row] = await tx
        .insert(reportExports)
        .values({
          companyId: actor().companyId,
          userId: actor().userId,
          title: this.title(req),
          format: req.format,
          request: req,
          includesCost: this.reports.canCost(),
          createdBy: actor().userId,
        })
        .returning({ id: reportExports.id });
      return row!.id;
    });
    // The row is committed; the consumer picks the job up (tests call build() themselves).
    await this.queue.add(
      "export.build",
      { exportId: id },
      { jobId: id, removeOnComplete: true, removeOnFail: 50 },
    );
    return this.get(id);
  }

  async list(): Promise<ExportItem[]> {
    const rows = await this.uow.db
      .select()
      .from(reportExports)
      .where(
        and(
          eq(reportExports.userId, actor().userId),
          eq(reportExports.companyId, actor().companyId),
        ),
      )
      .orderBy(desc(reportExports.createdAt))
      .limit(50);
    return rows.map((r) => this.item(r));
  }

  async get(id: string): Promise<ExportItem> {
    return this.item(await this.mine(id));
  }

  private async mine(id: string) {
    const [row] = await this.uow.db
      .select()
      .from(reportExports)
      .where(and(eq(reportExports.id, id), eq(reportExports.userId, actor().userId)));
    if (!row) throw notFound("Export");
    return row;
  }

  private item(r: typeof reportExports.$inferSelect): ExportItem {
    const expired = r.status === "Expired" || (r.expiresAt !== null && r.expiresAt < new Date());
    const status = r.status === "Ready" && expired ? "Expired" : r.status;
    return {
      id: r.id,
      title: r.title,
      format: r.format,
      status,
      rowCount: r.rowCount,
      sizeBytes: r.sizeBytes,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      readyAt: r.readyAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      downloadUrl: status === "Ready" ? `/api/reports/exports/${r.id}/download` : null,
    };
  }

  async download(
    id: string,
  ): Promise<{ stream: Readable; size: number; type: string; fileName: string }> {
    const row = await this.mine(id);
    const item = this.item(row);
    if (item.status !== "Ready" || !row.storageKey) {
      throw new AppError(
        409,
        "EXPORT_NOT_READY",
        item.status === "Expired"
          ? "This export has expired. Export again."
          : "This export isn't ready yet.",
      );
    }
    const file = await this.storage.open(row.storageKey);
    const safe =
      row.title
        .replace(/[^A-Za-z0-9 _-]+/g, "")
        .trim()
        .replace(/\s+/g, "-") || "export";
    return {
      ...file,
      type: MIME[row.format],
      fileName: `${safe}-${row.createdAt.toISOString().slice(0, 10)}.${row.format}`,
    };
  }

  // ── building ───────────────────────────────────────────────────────────────

  /** Builds one export (the consumer calls it; tests call it directly). */
  async build(exportId: string): Promise<void> {
    const [row] = await this.uow.db
      .select()
      .from(reportExports)
      .where(eq(reportExports.id, exportId));
    if (!row || row.status !== "Queued") return;
    await this.uow.db
      .update(reportExports)
      .set({ status: "Running", startedAt: new Date() })
      .where(eq(reportExports.id, exportId));
    try {
      const req = exportRequestSchema.parse(row.request);
      const sheet = await runAsSystem(
        { companyId: row.companyId, userId: row.userId, name: "Export" },
        async () => {
          const s = await this.sheet(req, row.includesCost);
          return { ...s, days: await this.settings.value("reports.exportLinkDays") };
        },
      );
      const bytes = await this.encode(row.format, sheet);
      const key = await this.storage.put("exports", bytes, row.format);
      const expiresAt = new Date(Date.now() + sheet.days * 86_400_000);
      await this.uow.db
        .update(reportExports)
        .set({
          status: "Ready",
          storageKey: key,
          rowCount: sheet.rows.length,
          sizeBytes: bytes.length,
          readyAt: new Date(),
          expiresAt,
        })
        .where(eq(reportExports.id, exportId));
    } catch (error) {
      this.logger.error({ err: error, exportId }, "export failed");
      await this.uow.db
        .update(reportExports)
        .set({
          status: "Failed",
          error: error instanceof AppError ? error.message : "The export couldn't be built.",
        })
        .where(eq(reportExports.id, exportId));
    }
  }

  private async sheet(req: ExportRequest, canCost: boolean): Promise<Sheet> {
    if (req.kind === "report") {
      const r: ReportResponse = await this.reports.run(
        req.reportId!,
        req.query ?? reportQuery.parse({}),
        {
          all: true,
          canCost,
          trusted: true,
        },
      );
      const range =
        r.from && r.to ? `${r.from} to ${r.to}` : `As of ${r.asOf ?? new Date().toISOString()}`;
      return {
        title: r.title,
        subtitle: range,
        headers: r.columns.map((c) => c.label),
        kinds: r.columns.map((c) => c.kind),
        rows: r.rows.map((row) => r.columns.map((c) => row.cells[c.key] ?? null)),
        totals: r.totals
          ? r.columns.map((c, i) => (i === 0 ? "Total" : (r.totals![c.key] ?? null)))
          : null,
      };
    }
    const p: PivotResponse = await this.reports.pivot(req.spec!, canCost);
    const measures = req.spec!.measures.filter((m) => !p.hiddenMeasures.includes(m));
    const colLabel = (k: string[]) => (k.length ? k.join(" · ") : "Total");
    const headers = [
      req.spec!.rows.join(" · ") || "",
      ...p.colKeys.flatMap((ck) => measures.map((m) => `${colLabel(ck)} — ${m}`)),
      ...measures.map((m) => `Total — ${m}`),
    ];
    const kindOf = (m: string): ReportColumn["kind"] =>
      m === "metres" ? "metres" : m === "rolls" ? "count" : m === "marginPct" ? "percent" : "money";
    const cell = (t: PivotResponse["grandTotal"] | null, m: string) =>
      t ? ((t as Record<string, string | number | null | undefined>)[m] ?? null) : null;
    return {
      title: "Pivot",
      subtitle: `${req.spec!.from} to ${req.spec!.to}`,
      headers,
      kinds: ["text", ...p.colKeys.flatMap(() => measures.map(kindOf)), ...measures.map(kindOf)],
      rows: p.rowKeys.map((rk, i) => [
        rk.join(" · ") || "Total",
        ...p.colKeys.flatMap((_, j) => measures.map((m) => cell(p.cells[i]![j]!, m))),
        ...measures.map((m) => cell(p.rowTotals[i]!, m)),
      ]),
      totals: [
        "Total",
        ...p.colKeys.flatMap((_, j) => measures.map((m) => cell(p.colTotals[j]!, m))),
        ...measures.map((m) => cell(p.grandTotal, m)),
      ],
    };
  }

  private async encode(format: "csv" | "xlsx" | "pdf", s: Sheet): Promise<Buffer> {
    if (format === "csv") {
      const esc = (v: string | number | null) => {
        const t = v === null ? "" : String(v);
        // Leading = + - @ would run as a formula in a spreadsheet (CSV injection).
        const safe = /^[=+\-@]/.test(t) && Number.isNaN(Number(t)) ? `'${t}` : t;
        return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const lines = [s.headers, ...s.rows, ...(s.totals ? [s.totals] : [])].map((r) =>
        r.map(esc).join(","),
      );
      return Buffer.from(`${BOM}${lines.join("\r\n")}\r\n`, "utf8");
    }
    if (format === "xlsx") {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(s.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
      ws.addRow([s.title]).font = { bold: true, size: 13 };
      ws.addRow([s.subtitle]);
      ws.addRow([]);
      ws.addRow(s.headers).font = { bold: true };
      const num = (k: ReportColumn["kind"]) =>
        ["money", "metres", "count", "percent", "days", "hours"].includes(k);
      const fmt = (k: ReportColumn["kind"]) =>
        k === "money"
          ? "#,##,##0.00"
          : k === "percent"
            ? "0.0"
            : k === "metres" || k === "count"
              ? "#,##,##0"
              : undefined;
      const toCell = (v: string | number | null, i: number) =>
        v !== null && num(s.kinds[i]!) && !Number.isNaN(Number(v)) ? Number(v) : v;
      for (const r of s.rows) ws.addRow(r.map(toCell));
      if (s.totals) ws.addRow(s.totals.map(toCell)).font = { bold: true };
      s.kinds.forEach((k, i) => {
        const c = ws.getColumn(i + 1);
        const f = fmt(k);
        if (f) c.numFmt = f;
        c.width = Math.min(40, Math.max(10, (s.headers[i] ?? "").length + 2));
      });
      return Buffer.from(await wb.xlsx.writeBuffer());
    }
    const esc = (v: unknown) =>
      String(v ?? "").replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
      );
    const right = (i: number) =>
      s.kinds[i] !== "text" && s.kinds[i] !== "code" && s.kinds[i] !== "date" ? ' class="n"' : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4 landscape; margin: 12mm; }
      body { font-family: Inter, Arial, sans-serif; font-size: 9pt; color: #101828; }
      h1 { font-size: 14pt; margin: 0 0 2pt; } p { margin: 0 0 8pt; color: #475467; }
      table { width: 100%; border-collapse: collapse; } th, td { padding: 3pt 5pt; border-bottom: 0.5pt solid #E4E7EC; text-align: left; }
      th { background: #F2F4F7; font-weight: 600; } .n { text-align: right; font-variant-numeric: tabular-nums; }
      tfoot td { font-weight: 600; border-top: 1pt solid #D0D5DD; }
    </style></head><body><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p><table>
      <thead><tr>${s.headers.map((h, i) => `<th${right(i)}>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${s.rows.map((r) => `<tr>${r.map((v, i) => `<td${right(i)}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>
      ${s.totals ? `<tfoot><tr>${s.totals.map((v, i) => `<td${right(i)}>${esc(v)}</td>`).join("")}</tr></tfoot>` : ""}
    </table></body></html>`;
    return this.pdf.render(html);
  }

  /** Marks expired exports and deletes their files. */
  async sweep(): Promise<number> {
    const due = await this.uow.db
      .select({ id: reportExports.id, key: reportExports.storageKey })
      .from(reportExports)
      .where(and(eq(reportExports.status, "Ready"), lt(reportExports.expiresAt, new Date())));
    for (const d of due) {
      if (d.key) await this.storage.remove(d.key);
      await this.uow.db
        .update(reportExports)
        .set({ status: "Expired", storageKey: sql`NULL` })
        .where(eq(reportExports.id, d.id));
    }
    return due.length;
  }

  async onApplicationBootstrap() {
    if (!this.env.API_JOBS) return;
    await this.queue.upsertJobScheduler(
      "export-sweep",
      { every: 60 * 60_000 },
      { name: "export.sweep", data: { exportId: "" } },
    );
    this.worker = new Worker<ExportJob>(
      EXPORT_QUEUE,
      async (job) => (job.name === "export.sweep" ? this.sweep() : this.build(job.data.exportId)),
      {
        connection: { url: this.env.REDIS_URL, maxRetriesPerRequest: null },
        prefix: this.env.QUEUE_PREFIX,
        concurrency: 2,
      },
    );
    this.worker.on("error", (err) => this.logger.error({ err }, "export worker error"));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }
}
