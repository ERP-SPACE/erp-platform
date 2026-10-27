import type { StockRow, StockSummary } from "@erp/contracts";
import { D, sum } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { SettingsService } from "../settings/settings.service.js";
import { canSeeCost } from "./rolls.service.js";

interface MvRow extends Record<string, unknown> {
  sku_id: string | null;
  sku_code: string | null;
  description: string;
  category_name: string | null;
  gsm: number;
  width_in: string;
  rolls: number;
  metres: string;
  value: string | null;
  unmapped_rolls: number;
  oldest_received_at: string;
  refreshed_at: string;
}

/**
 * Stock summaries from the materialized views (ADR-0005), refreshed every 3 min by the worker
 * and stamped "as of". Live per-roll status for picking comes from `rolls` directly.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
  ) {}

  async summary(by: "sku" | "batch" | "supplier"): Promise<StockSummary> {
    const companyId = actor().companyId;
    const query =
      by === "sku"
        ? sql`SELECT m.sku_id, s.code AS sku_code,
                     coalesce(c.name || ' ' || q.name || ' ' || p.gsm || ' GSM ' || trim(trailing '.' from trim(trailing '0' from m.width_in::text)) || '″', m.description) AS description,
                     c.name AS category_name, m.gsm, m.width_in::text, m.rolls, m.metres::text, m.value::text,
                     m.unmapped_rolls, m.oldest_received_at, m.refreshed_at
              FROM mv_stock_by_sku m
              LEFT JOIN skus s ON s.id = m.sku_id
              LEFT JOIN products p ON p.id = s.product_id
              LEFT JOIN categories c ON c.id = p.category_id
              LEFT JOIN qualities q ON q.id = p.quality_id
              WHERE m.company_id = ${companyId}
              ORDER BY description`
        : by === "batch"
          ? sql`SELECT NULL AS sku_id, NULL AS sku_code,
                       sp.name || ' · lot ' || lpad(m.batch_seq::text, 4, '0') || coalesce(' (' || m.supplier_batch_ref || ')', '') AS description,
                       NULL AS category_name, 0 AS gsm, '0' AS width_in, m.rolls, m.metres::text, m.value::text,
                       0 AS unmapped_rolls, m.oldest_received_at, m.refreshed_at
                FROM mv_stock_by_batch m JOIN suppliers sp ON sp.id = m.supplier_id
                WHERE m.company_id = ${companyId}
                ORDER BY m.oldest_received_at`
          : sql`SELECT NULL AS sku_id, NULL AS sku_code, sp.name AS description,
                       NULL AS category_name, 0 AS gsm, '0' AS width_in, m.rolls, m.metres::text, m.value::text,
                       m.unmapped_rolls, m.oldest_received_at, m.refreshed_at
                FROM mv_stock_by_supplier m JOIN suppliers sp ON sp.id = m.supplier_id
                WHERE m.company_id = ${companyId}
                ORDER BY sp.name`;
    const result = await this.uow.db.execute<MvRow>(query);
    const rows = result.rows as MvRow[];
    const showCost = canSeeCost();
    const deadDays = (await this.settings.value("inventory.aging")).deadStockDays;
    const now = Date.now();
    const age = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);
    const [unmapped] = (
      await this.uow.db.execute<{ unmapped: number; dead: number; asof: string | null }>(sql`
        SELECT coalesce(sum(unmapped_rolls), 0)::int AS unmapped,
               (SELECT count(*) FROM rolls r WHERE r.company_id = ${companyId}
                  AND r.status IN ('Unmapped','Mapped','Allocated')
                  AND r.received_at < now() - make_interval(days => ${deadDays}))::int AS dead,
               min(refreshed_at) AS asof
        FROM mv_stock_by_sku WHERE company_id = ${companyId}`)
    ).rows as { unmapped: number; dead: number; asof: string | null }[];
    const items: StockRow[] = rows.map((r) => ({
      skuId: r.sku_id,
      skuCode: r.sku_code,
      description: r.description,
      categoryName: r.category_name,
      gsm: Number(r.gsm),
      widthIn: trimDecimal(String(r.width_in)),
      rolls: Number(r.rolls),
      metres: Number(r.metres),
      value: showCost ? D(r.value ?? 0).toFixed(2) : null,
      oldestDays: age(r.oldest_received_at),
    }));
    return {
      asOf: unmapped?.asof ? new Date(unmapped.asof).toISOString() : new Date().toISOString(),
      rows: items,
      totals: {
        rolls: items.reduce((s, r) => s + r.rolls, 0),
        metres: items.reduce((s, r) => s + r.metres, 0),
        value: showCost ? sum(rows.map((r) => r.value ?? 0)).toFixed(2) : null,
        unmappedRolls: unmapped?.unmapped ?? 0,
        deadStockRolls: unmapped?.dead ?? 0,
      },
    };
  }

  /** Refreshes the stock views now (the worker does this every 3 min in business hours). */
  async refresh(): Promise<void> {
    await this.uow.db.execute(sql`SELECT public.refresh_stock_views()`);
  }
}
