import type { CreditCheck } from "@erp/contracts";
import { D, type DecimalLike, evaluateCredit, istToday, sum } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { SettingsService } from "../settings/settings.service.js";
import { siOutstanding, unusedCredits } from "../collections/outstanding.js";
import type { Db } from "./sales-common.js";

/**
 * Credit exposure (PRD §8.5, ADR-0016), computed live — no cached exposure column:
 * - each posted invoice owes what is left after notes and allocations (`siOutstanding`);
 *   opening balances join in Stage 6;
 * - money on account and credit notes not tied to an invoice reduce exposure; debit notes not
 *   tied to one owe from their own date;
 * - orders count for their uninvoiced share: undelivered metres of Confirmed / PartiallyFulfilled
 *   orders plus dispatched-but-unbilled metres of any order (OnHold never counts);
 * - the order being confirmed counts in full.
 */
@Injectable()
export class CreditService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
  ) {}

  async check(
    db: Db,
    customerId: string,
    thisOrder: DecimalLike,
    excludeSoId: string | null,
    policy: {
      creditLimit: string;
      creditDays: number;
      graceDays: number;
      autoBlock: boolean;
      blockRule: "OVER_LIMIT" | "OVER_DUE" | "BOTH";
      manualBlock: boolean;
    } | null,
  ): Promise<CreditCheck> {
    const p = policy ?? { ...(await this.settings.value("credit.defaults")), manualBlock: false };
    const companyId = actor().companyId;
    const invoices = (
      await db.execute<{ date: string; outstanding: string }>(sql`
        SELECT si.date::text AS date, ${siOutstanding()}::text AS outstanding
        FROM sales_invoices si
        WHERE si.company_id = ${companyId} AND si.customer_id = ${customerId} AND si.status = 'Posted'
        UNION ALL
        SELECT n.date::text, n.total::text FROM customer_notes n
        WHERE n.company_id = ${companyId} AND n.customer_id = ${customerId} AND n.status = 'Posted'
          AND n.kind = 'DEBIT' AND n.si_id IS NULL`)
    ).rows;
    // Money on account and credit notes not tied to an invoice (Stage 4).
    const credits = sum((await unusedCredits(db, "CUSTOMER", customerId)).map((c) => c.available));
    const [orders] = (
      await db.execute<{ total: string }>(sql`
        SELECT coalesce(sum(so.total * u.share), 0)::numeric(14,2)::text AS total
        FROM sales_orders so
        JOIN LATERAL (
          -- Not yet invoiced: undelivered metres of open orders, and metres dispatched on challans
          -- but not billed yet (also on closed orders) — a challan's goods stay in exposure until
          -- the invoice takes over (Stage 4).
          SELECT CASE WHEN sum(l.amount) = 0 THEN 0
                      ELSE sum(l.amount * (CASE WHEN so.status IN ('Confirmed', 'PartiallyFulfilled')
                                                THEN greatest(l.total_m - l.invoiced_m, 0)
                                                ELSE greatest(l.dispatched_m - l.invoiced_m, 0) END)
                               / l.total_m) / sum(l.amount)
                 END AS share
          FROM sales_order_lines l WHERE l.so_id = so.id
        ) u ON true
        WHERE so.company_id = ${companyId} AND so.customer_id = ${customerId}
          AND so.status IN ('Confirmed', 'PartiallyFulfilled', 'Closed')
          AND (${excludeSoId}::uuid IS NULL OR so.id <> ${excludeSoId}::uuid)`)
    ).rows;
    const result = evaluateCredit({
      policy: {
        creditLimit: p.creditLimit,
        creditDays: p.creditDays,
        graceDays: p.graceDays,
        autoBlock: p.autoBlock,
        blockRule: p.blockRule,
      },
      manualBlock: p.manualBlock,
      openInvoices: invoices,
      unappliedCredits: credits,
      otherOpenOrders: orders?.total ?? "0",
      thisOrder,
      today: istToday(),
    });
    return {
      blocked: result.blocked,
      reasons: result.reasons,
      outstanding: result.outstanding.toFixed(2),
      otherOpenOrders: D(orders?.total ?? 0).toFixed(2),
      thisOrder: D(thisOrder).toFixed(2),
      exposure: result.exposure.toFixed(2),
      limit: D(p.creditLimit).toFixed(2),
      headroom: result.headroom.toFixed(2),
      overdueInvoices: result.overdueInvoices,
      maxDaysPastDue: result.maxDaysPastDue,
      autoBlock: p.autoBlock,
      checkedAt: new Date().toISOString(),
    };
  }

  /** Read-only check for a customer (Customer 360, SO form), with no order of its own. */
  async forCustomer(customerId: string, policy: Parameters<CreditService["check"]>[4]) {
    return this.check(this.uow.db, customerId, 0, null, policy);
  }
}
