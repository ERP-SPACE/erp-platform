import type { CustomerLedger } from "@erp/contracts";
import { D, istToday } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { SettingsService } from "../settings/settings.service.js";
import { customerContext, daysBetween } from "./sales-common.js";

type Row = {
  date: string;
  due_date: string | null;
  doc_type: "SI" | "CN" | "DN";
  doc_id: string;
  doc_no: string;
  debit: string;
  credit: string;
};

/**
 * The customer's sub-ledger (ADR-0016) from `v_customer_ledger`: invoices and debit notes owe,
 * credit notes reduce. Receipts (Stage 4) and opening balances (Stage 6) join the view later.
 * Ageing is by due date over what each invoice still owes.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
  ) {}

  async ledger(customerId: string, from?: string, to?: string): Promise<CustomerLedger> {
    await customerContext(this.uow.db, customerId); // scope check
    const companyId = actor().companyId;
    const rows = (
      await this.uow.db.execute<Row>(sql`
        SELECT date::text, due_date::text, doc_type, doc_id, doc_no, debit::text, credit::text
        FROM v_customer_ledger
        WHERE company_id = ${companyId} AND customer_id = ${customerId}
        ORDER BY date, posted_at`)
    ).rows;
    let balance = D(0);
    let opening = D(0);
    const entries: CustomerLedger["entries"] = [];
    for (const r of rows) {
      balance = balance.plus(D(r.debit)).minus(D(r.credit));
      if (from && r.date < from) {
        opening = balance;
        continue;
      }
      if (to && r.date > to) continue;
      entries.push({
        date: r.date,
        docType: r.doc_type,
        docId: r.doc_id,
        docNo: r.doc_no,
        debit: D(r.debit).toFixed(2),
        credit: D(r.credit).toFixed(2),
        balance: balance.toFixed(2),
        dueDate: r.due_date,
      });
    }
    const closing = entries.length ? D(entries.at(-1)!.balance) : opening;
    return {
      customerId,
      opening: opening.toFixed(2),
      entries,
      closing: closing.toFixed(2),
      aging: await this.aging(customerId),
    };
  }

  /** Not yet due, then the `inventory.aging` buckets (30/60/90/180) past the due date. */
  private async aging(customerId: string) {
    const open = (
      await this.uow.db.execute<{ due_date: string; owed: string }>(sql`
        SELECT si.due_date::text,
               (si.total - coalesce((SELECT sum(n.total) FROM customer_notes n
                 WHERE n.si_id = si.id AND n.status = 'Posted' AND n.kind = 'CREDIT'), 0)
                 + coalesce((SELECT sum(n.total) FROM customer_notes n
                 WHERE n.si_id = si.id AND n.status = 'Posted' AND n.kind = 'DEBIT'), 0))::text AS owed
        FROM sales_invoices si
        WHERE si.company_id = ${actor().companyId} AND si.customer_id = ${customerId} AND si.status = 'Posted'`)
    ).rows;
    const { bucketsDays } = await this.settings.value("inventory.aging");
    const labels = [
      "Not due",
      ...bucketsDays.map((d, i) => `${i ? bucketsDays[i - 1]! + 1 : 1}–${d} days`),
      `Over ${bucketsDays.at(-1)} days`,
    ];
    const totals = labels.map(() => D(0));
    const today = istToday();
    for (const r of open) {
      if (D(r.owed).lessThanOrEqualTo(0)) continue;
      const late = daysBetween(r.due_date, today);
      const idx =
        late <= 0
          ? 0
          : (() => {
              const i = bucketsDays.findIndex((d) => late <= d);
              return i === -1 ? labels.length - 1 : i + 1;
            })();
      totals[idx] = totals[idx]!.plus(D(r.owed));
    }
    return labels.map((bucket, i) => ({ bucket, amount: totals[i]!.toFixed(2) }));
  }
}
