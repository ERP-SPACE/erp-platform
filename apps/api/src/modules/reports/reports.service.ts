import {
  LINKED_REPORTS,
  REPORTS,
  REPORT_IDS,
  type PermissionCode,
  type PivotResponse,
  type PivotSpec,
  type ReportId,
  type ReportMeta,
  type ReportQuery,
  type ReportResponse,
  type SavedPivot,
  pivotSpec as pivotSpecSchema,
  type savedPivotInput,
  type savedPivotUpdate,
} from "@erp/contracts";
import { creditPolicies, customers, savedPivots, user } from "@erp/db";
import {
  COST_MEASURES,
  D,
  type PivotDimension,
  type PivotFact,
  fyRange,
  istToday,
  periodKey,
  periodRange,
  pivot,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { type SQL, and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor } from "../../common/context.js";
import { forbidden, notFound, validationError } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { CreditService } from "../sales/credit.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { REPORT_DEFS, type ReportCtx, type ReportDef, type Row } from "./report-definitions.js";

/** Pivot results are capped so a careless grouping cannot build a 50,000-row grid. */
const PIVOT_MAX_ROWS = 500;
const PIVOT_MAX_COLS = 60;
const PERIOD_DIMS = new Set<PivotDimension>(["day", "month", "quarter", "fy"]);

/** Label column in mv_sales_lines for each pivot dimension (periods are derived from `date`). */
const DIM_SQL: Record<Exclude<PivotDimension, "day" | "month" | "quarter" | "fy">, SQL> = {
  sku: sql`coalesce(f.sku_code, '—')`,
  category: sql`coalesce(f.category_name, '—')`,
  gsm: sql`coalesce(f.gsm::text, '—')`,
  quality: sql`coalesce(f.quality_name, '—')`,
  width: sql`coalesce(trim(trailing '.' FROM trim(trailing '0' FROM f.width_in::text)) || '″', '—')`,
  customer: sql`f.customer_name`,
  customerGroup: sql`coalesce(f.customer_group_name, '—')`,
  supplier: sql`coalesce(f.supplier_name, '—')`,
  salesman: sql`coalesce(f.salesman_name, '—')`,
};

export interface RunOptions {
  /** Every row (exports); no paging. */
  all?: boolean;
  /** Override the actor's cost permission (exports keep what was allowed at request time). */
  canCost?: boolean;
  /** Skip the permission check (already done when the export was requested). */
  trusted?: boolean;
}

/**
 * Reports (PRD §9), the pivot builder, saved pivots. Every report runs inside the actor's
 * customer scope; cost columns and measures are removed unless the actor has
 * `reports.margin.view` (Q36) — they are never sent, not just hidden.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
    private readonly credit: CreditService,
  ) {}

  private has(p: string) {
    return actor().permissions.has(p as PermissionCode);
  }

  canCost() {
    return this.has("reports.margin.view");
  }

  allowed(id: ReportId) {
    const meta: ReportMeta = REPORTS[id];
    return !meta.permission || this.has(meta.permission);
  }

  async asOf(view: string | undefined): Promise<string | null> {
    if (!view) return null;
    const { rows } = await this.uow.db.execute<{ at: Date | string | null }>(
      sql`SELECT max(refreshed_at) AS at FROM ${sql.identifier(view)}`,
    );
    const at = rows[0]?.at;
    return at ? new Date(at).toISOString() : null;
  }

  async catalogue() {
    const views = [...new Set(REPORT_IDS.map((id) => REPORT_DEFS[id].view).filter(Boolean))];
    const stamps = await Promise.all(views.map((v) => this.asOf(v)));
    const oldest = stamps.filter(Boolean).sort()[0] ?? null;
    return {
      reports: REPORT_IDS.filter((id) => this.allowed(id)).map((id) => {
        const m: ReportMeta = REPORTS[id];
        return {
          id,
          title: m.title,
          section: m.section,
          description: m.description,
          prd: m.prd,
          source: m.source,
          dated: m.dated ?? false,
        };
      }),
      linked: LINKED_REPORTS.filter((l) =>
        this.has(l.title.startsWith("AP") ? "payables.view" : "collections.view"),
      ).map((l) => ({ ...l })),
      asOf: oldest,
    };
  }

  private async context(q: ReportQuery, canCost: boolean): Promise<ReportCtx> {
    const today = istToday();
    const db = this.uow.db;
    const scope = customerScopeFilter(await loadCustomerScope(db));
    return {
      q,
      company: actor().companyId,
      scope,
      canCost,
      from: q.from ?? fyRange(today).from,
      to: q.to ?? today,
      setting: (key) => this.settings.value(key),
      has: (p) => this.has(p),
      raw: (query) => db.execute(query) as never,
      exposures: () => this.exposures(scope),
    };
  }

  /** Live exposure for every scoped customer with a credit limit (credit utilisation). */
  private async exposures(scope: SQL) {
    const db = this.uow.db;
    const rows = await db
      .select({
        id: customers.id,
        name: customers.legalName,
        creditLimit: creditPolicies.creditLimit,
        creditDays: creditPolicies.creditDays,
        graceDays: creditPolicies.graceDays,
        autoBlock: creditPolicies.autoBlock,
        blockRule: creditPolicies.blockRule,
        manualBlock: creditPolicies.manualBlock,
        systemBlock: creditPolicies.systemBlock,
      })
      .from(customers)
      .innerJoin(creditPolicies, eq(creditPolicies.customerId, customers.id))
      .where(and(scope, eq(customers.active, true), sql`${creditPolicies.creditLimit} > 0`));
    const out = [];
    for (const r of rows) {
      const check = await this.credit.check(db, r.id, 0, null, r);
      out.push({
        customerId: r.id,
        name: r.name,
        limit: D(r.creditLimit).toFixed(2),
        exposure: check.exposure,
        blocked: r.manualBlock || r.systemBlock,
      });
    }
    return out;
  }

  async run(id: ReportId, q: ReportQuery, opts: RunOptions = {}): Promise<ReportResponse> {
    if (!opts.trusted && !this.allowed(id)) throw forbidden("see this report");
    const def: ReportDef = REPORT_DEFS[id];
    const meta: ReportMeta = REPORTS[id];
    const canCost = opts.canCost ?? this.canCost();
    const ctx = await this.context(q, canCost);
    const columns = def.columns.filter((c) => canCost || !c.cost);
    const keys = new Set(def.columns.map((c) => c.key));
    const [sortKey, sortDir] =
      q.sort && keys.has(q.sort)
        ? [q.sort, q.dir ?? def.sort[1]]
        : [def.sort[0], q.dir ?? def.sort[1]];
    const extra = def.extra ? await def.extra(ctx) : {};
    const searchCols = (def.search ?? []).filter((k) => keys.has(k));
    const needle = q.q ? `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;

    let rows: Row[];
    let total: number;
    let totalsRow: Record<string, unknown> | null = null;
    const totalCols = def.columns.filter((c) => c.total);

    if (def.compute) {
      let all = await def.compute(ctx);
      if (needle) {
        const n = q.q!.toLowerCase();
        all = all.filter((r) =>
          searchCols.some((k) =>
            String(r[k] ?? "")
              .toLowerCase()
              .includes(n),
          ),
        );
      }
      const cmp = new Intl.Collator("en-IN", { numeric: true });
      all.sort((a, b) => {
        const x = a[sortKey];
        const y = b[sortKey];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const n = Number(x) - Number(y);
        const r = Number.isNaN(n) ? cmp.compare(String(x), String(y)) : n;
        return sortDir === "asc" ? r : -r;
      });
      total = all.length;
      if (totalCols.length) {
        totalsRow = Object.fromEntries(
          totalCols.map((c) => [
            c.key,
            all.reduce((s, r) => s.plus(D(r[c.key] ?? 0)), D(0)).toString(),
          ]),
        );
      }
      rows = opts.all ? all : all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    } else {
      const inner = await def.query!.call(def, ctx);
      const where = needle
        ? sql`WHERE ${sql.join(
            searchCols.map((k) => sql`${sql.identifier(k)}::text ILIKE ${needle}`),
            sql` OR `,
          )}`
        : sql``;
      const base = sql`(${inner}) t ${where}`;
      const order = sql`ORDER BY ${sql.identifier(sortKey)} ${sortDir === "asc" ? sql`ASC` : sql`DESC`} NULLS LAST`;
      const page = opts.all ? sql`` : sql`LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
      const [data, agg] = await Promise.all([
        this.uow.db.execute<Row>(sql`SELECT * FROM ${base} ${order} ${page}`),
        this.uow.db.execute<Record<string, unknown>>(sql`
          SELECT count(*)::int AS __n
          ${
            totalCols.length
              ? sql`, ${sql.join(
                  totalCols.map(
                    (c) => sql`sum(${sql.identifier(c.key)})::text AS ${sql.identifier(c.key)}`,
                  ),
                  sql`, `,
                )}`
              : sql``
          }
          FROM ${base}`),
      ]);
      rows = data.rows;
      total = Number(agg.rows[0]?.__n ?? 0);
      if (totalCols.length) totalsRow = agg.rows[0] ?? null;
    }

    const format = (kind: string, v: unknown): string | number | null => {
      if (v === null || v === undefined) return null;
      switch (kind) {
        case "money":
          return D(v as string).toFixed(kindDecimals(v));
        case "metres":
          return D(v as string).toFixed(0);
        case "count":
        case "days":
        case "hours":
          return Number(v);
        case "percent":
          return D(v as string).toFixed(1);
        default:
          return String(v);
      }
    };
    const fullCtx = { ...ctx, extra };
    const out = rows.map((r) => {
      const cells: Record<string, string | number | null> = {};
      for (const c of columns) cells[c.key] = format(c.kind, r[c.key]);
      const links = def.links
        ? Object.fromEntries(
            Object.entries(def.links)
              .filter(([k, l]) => columns.some((c) => c.key === k) && r[l.idKey])
              .map(([k, l]) => [k, { kind: l.kind, id: String(r[l.idKey]) }]),
          )
        : undefined;
      const tone = def.tone?.(r, fullCtx);
      return {
        cells,
        ...(links && Object.keys(links).length ? { links } : {}),
        ...(tone ? { tone } : {}),
      };
    });
    const seriesSql = def.series?.(ctx);
    const series = seriesSql
      ? (
          await this.uow.db.execute<{ key: string; label: string; value: string }>(seriesSql)
        ).rows.map((s) => ({
          key: String(s.key),
          label: String(s.label),
          value: D(s.value ?? 0).toFixed(2),
        }))
      : undefined;
    return {
      id,
      title: meta.title,
      columns,
      rows: out,
      totals: totalsRow
        ? Object.fromEntries(
            columns
              .filter((c) => c.total)
              .map((c) => [c.key, format(c.kind, totalsRow![c.key] ?? 0)]),
          )
        : null,
      total,
      page: opts.all ? 1 : q.page,
      pageSize: opts.all ? total : q.pageSize,
      asOf: await this.asOf(def.view),
      from: meta.dated ? ctx.from : null,
      to: meta.dated ? ctx.to : null,
      ...(series ? { series } : {}),
    };
  }

  // ── pivot ──────────────────────────────────────────────────────────────────

  async pivot(spec: PivotSpec, canCost = this.canCost()): Promise<PivotResponse> {
    const scope = customerScopeFilter(await loadCustomerScope(this.uow.db));
    const dims = [...spec.rows, ...spec.cols];
    const labelDims = dims.filter((d): d is keyof typeof DIM_SQL => !PERIOD_DIMS.has(d));
    const needsDate = dims.some((d) => PERIOD_DIMS.has(d));
    const f = spec.filters ?? {};
    const inList = (column: SQL, ids?: string[]) =>
      ids?.length
        ? sql`AND ${column} IN (${sql.join(
            ids.map((i) => sql`${i}`),
            sql`, `,
          )})`
        : sql``;
    const selects = [
      ...labelDims.map((d) => sql`${DIM_SQL[d]} AS ${sql.identifier(d)}`),
      ...(needsDate ? [sql`f.date::text AS date`] : []),
    ];
    const groups = [...labelDims.map((d) => DIM_SQL[d]), ...(needsDate ? [sql`f.date`] : [])];
    const { rows } = await this.uow.db.execute<Record<string, string>>(sql`
      SELECT ${sql.join(
        [
          ...selects,
          sql`sum(f.metres)::text AS metres`,
          sql`sum(f.rolls)::int AS rolls`,
          sql`sum(f.value)::text AS value`,
          sql`sum(f.cogs)::text AS cogs`,
        ],
        sql`, `,
      )}
      FROM mv_sales_lines f JOIN customers ON customers.id = f.customer_id
      WHERE ${scope} AND f.date BETWEEN ${spec.from} AND ${spec.to}
        ${inList(sql`f.customer_id`, f.customerIds)} ${inList(sql`f.customer_group_id`, f.customerGroupIds)}
        ${inList(sql`f.supplier_id`, f.supplierIds)} ${inList(sql`f.salesman_id`, f.salesmanIds)}
        ${inList(sql`f.sku_id`, f.skuIds)} ${inList(sql`f.category_id`, f.categoryIds)}
      ${groups.length ? sql`GROUP BY ${sql.join(groups, sql`, `)}` : sql``}`);
    const facts: PivotFact[] = rows.map((r) => ({
      dims: Object.fromEntries(
        dims.map((d) => [d, PERIOD_DIMS.has(d) ? periodKey(r.date!, d as "day") : String(r[d])]),
      ),
      metres: r.metres ?? "0",
      rolls: Number(r.rolls ?? 0),
      value: r.value ?? "0",
      cogs: r.cogs ?? "0",
    }));
    const result = pivot(facts, spec.rows, spec.cols);
    const truncated =
      result.rowKeys.length > PIVOT_MAX_ROWS || result.colKeys.length > PIVOT_MAX_COLS;
    const hidden = canCost ? [] : spec.measures.filter((m) => COST_MEASURES.includes(m));
    const strip = <T extends { cogs?: string; margin?: string; marginPct?: string | null }>(
      t: T,
    ) => {
      if (canCost) return t;
      const { cogs: _c, margin: _m, marginPct: _p, ...rest } = t;
      return rest;
    };
    return {
      rowKeys: result.rowKeys.slice(0, PIVOT_MAX_ROWS),
      colKeys: result.colKeys.slice(0, PIVOT_MAX_COLS),
      cells: result.cells
        .slice(0, PIVOT_MAX_ROWS)
        .map((row) => row.slice(0, PIVOT_MAX_COLS).map((c) => (c ? strip(c) : null))),
      rowTotals: result.rowTotals.slice(0, PIVOT_MAX_ROWS).map(strip),
      colTotals: result.colTotals.slice(0, PIVOT_MAX_COLS).map(strip),
      grandTotal: strip(result.grandTotal),
      hiddenMeasures: hidden,
      truncated,
      asOf: await this.asOf("mv_sales_lines"),
    };
  }

  // ── saved pivots (Q39: private unless shared with roles) ───────────────────

  /** Resolves a saved pivot's relative range to dates, today in IST. */
  resolveRange(spec: PivotSpec, range: string): PivotSpec {
    const today = istToday();
    const back = (days: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    switch (range) {
      case "thisMonth":
        return { ...spec, ...periodRange(today, "month"), to: today };
      case "lastMonth":
        return { ...spec, ...periodRange(back(Number(today.slice(8, 10))), "month") };
      case "thisQuarter":
        return { ...spec, from: periodRange(today, "quarter").from, to: today };
      case "thisFy":
        return { ...spec, from: fyRange(today).from, to: today };
      case "last30":
        return { ...spec, from: back(29), to: today };
      case "last90":
        return { ...spec, from: back(89), to: today };
      default:
        return spec;
    }
  }

  private toSaved(r: typeof savedPivots.$inferSelect & { ownerName: string | null }): SavedPivot {
    const spec = pivotSpecSchema.parse(r.spec);
    return {
      id: r.id,
      name: r.name,
      spec: this.resolveRange(spec, r.range),
      range: r.range as SavedPivot["range"],
      sharedWithRoles: r.sharedWithRoles,
      ownerId: r.ownerId,
      ownerName: r.ownerName ?? "—",
      mine: r.ownerId === actor().userId,
      version: r.version,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private visible() {
    const roles = actor().roles;
    return and(
      eq(savedPivots.companyId, actor().companyId),
      sql`(${savedPivots.ownerId} = ${actor().userId} OR ${savedPivots.sharedWithRoles} && ${sql`ARRAY[${sql.join(
        roles.length ? roles.map((r) => sql`${r}`) : [sql`''`],
        sql`, `,
      )}]::text[]`})`,
    )!;
  }

  async listPivots(): Promise<SavedPivot[]> {
    const rows = await this.uow.db
      .select({ p: savedPivots, ownerName: user.name })
      .from(savedPivots)
      .leftJoin(user, eq(user.id, savedPivots.ownerId))
      .where(this.visible())
      .orderBy(savedPivots.name);
    return rows.map((r) => this.toSaved({ ...r.p, ownerName: r.ownerName }));
  }

  async getPivot(id: string): Promise<SavedPivot> {
    const [r] = await this.uow.db
      .select({ p: savedPivots, ownerName: user.name })
      .from(savedPivots)
      .leftJoin(user, eq(user.id, savedPivots.ownerId))
      .where(and(eq(savedPivots.id, id), this.visible()));
    if (!r) throw notFound("Saved pivot");
    return this.toSaved({ ...r.p, ownerName: r.ownerName });
  }

  private checkShare(roles: string[]) {
    if (roles.length && !this.has("reports.pivot.share")) throw forbidden("share pivots");
  }

  async createPivot(input: z.infer<typeof savedPivotInput>): Promise<SavedPivot> {
    this.checkShare(input.sharedWithRoles);
    const id = await this.uow.run(async (tx) => {
      const clash = await tx
        .select({ id: savedPivots.id })
        .from(savedPivots)
        .where(and(eq(savedPivots.ownerId, actor().userId), eq(savedPivots.name, input.name)));
      if (clash.length) {
        throw validationError("You already have a pivot with this name.", [
          { path: "name", message: "Choose another name" },
        ]);
      }
      const [row] = await tx
        .insert(savedPivots)
        .values({
          companyId: actor().companyId,
          ownerId: actor().userId,
          name: input.name,
          spec: input.spec,
          range: input.range,
          sharedWithRoles: input.sharedWithRoles,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning({ id: savedPivots.id });
      return row!.id;
    });
    return this.getPivot(id);
  }

  private async own(id: string) {
    const [row] = await this.uow.db
      .select()
      .from(savedPivots)
      .where(and(eq(savedPivots.id, id), eq(savedPivots.companyId, actor().companyId)));
    if (!row) throw notFound("Saved pivot");
    if (row.ownerId !== actor().userId) throw forbidden("change someone else's pivot");
    return row;
  }

  async updatePivot(id: string, input: z.infer<typeof savedPivotUpdate>): Promise<SavedPivot> {
    await this.own(id);
    this.checkShare(input.sharedWithRoles);
    await this.uow.run((tx) =>
      updateVersioned(
        tx,
        savedPivots,
        eq(savedPivots.id, id),
        input.version,
        {
          name: input.name,
          spec: input.spec,
          range: input.range,
          sharedWithRoles: input.sharedWithRoles,
          updatedBy: actor().userId,
          updatedAt: new Date(),
        },
        "Saved pivot",
      ),
    );
    return this.getPivot(id);
  }

  async deletePivot(id: string): Promise<void> {
    await this.own(id);
    await this.uow.run((tx) => tx.delete(savedPivots).where(eq(savedPivots.id, id)));
  }
}

/** Rates per metre keep 4 decimals (ADR-0013); every other amount has 2. */
function kindDecimals(v: unknown): number {
  const s = String(v);
  const dot = s.indexOf(".");
  return dot >= 0 && s.length - dot - 1 > 2 && /[1-9]/.test(s.slice(dot + 3)) ? 4 : 2;
}
