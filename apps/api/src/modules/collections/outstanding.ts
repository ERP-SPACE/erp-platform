import { type SQL, sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import type { Db } from "../sales/sales-common.js";

/**
 * What a document still owes, in one place so credit, aging, statements and allocation agree.
 *
 * Sales invoice: total − credit notes against it + debit notes against it − live allocations
 * (money and TDS from receipts, unused credit notes applied to it).
 * Purchase invoice: total − purchase-return debit notes against it − live allocations.
 */
export const siOutstanding = (si: SQL = sql.raw("si")) => sql`(${si}.total
  - coalesce((SELECT sum(n.total) FROM customer_notes n
              WHERE n.si_id = ${si}.id AND n.status = 'Posted' AND n.kind = 'CREDIT'), 0)
  + coalesce((SELECT sum(n.total) FROM customer_notes n
              WHERE n.si_id = ${si}.id AND n.status = 'Posted' AND n.kind = 'DEBIT'), 0)
  - coalesce((SELECT sum(a.amount + a.deduction) FROM allocations a
              WHERE a.sales_invoice_id = ${si}.id AND a.reversed_at IS NULL), 0))`;

export const piOutstanding = (pi: SQL = sql.raw("pi")) => sql`(${pi}.total
  - coalesce((SELECT sum(pr.total) FROM purchase_returns pr
              WHERE pr.pi_id = ${pi}.id AND pr.status = 'Posted'), 0)
  - coalesce((SELECT sum(a.amount + a.deduction) FROM allocations a
              WHERE a.purchase_invoice_id = ${pi}.id AND a.reversed_at IS NULL), 0))`;

export type OpenDoc = {
  id: string;
  doc_no: string;
  date: string;
  due_date: string;
  total: string;
  outstanding: string;
};

/** A customer's posted invoices that still owe something, oldest due first. */
export async function openSalesInvoices(db: Db, customerId: string, lock = false) {
  return (
    await db.execute<OpenDoc>(sql`
      SELECT * FROM (
        SELECT si.id, si.si_no AS doc_no, si.date::text, si.due_date::text, si.total::text,
               ${siOutstanding()}::numeric(14,2)::text AS outstanding
        FROM sales_invoices si
        WHERE si.company_id = ${actor().companyId} AND si.customer_id = ${customerId}
          AND si.status = 'Posted'
        ${lock ? sql`FOR UPDATE OF si` : sql``}
      ) x WHERE outstanding::numeric > 0
      ORDER BY due_date, date, doc_no`)
  ).rows;
}

/** A supplier's posted purchase invoices that still owe something (due = date + payment days). */
export async function openPurchaseInvoices(db: Db, supplierId: string, lock = false) {
  return (
    await db.execute<OpenDoc>(sql`
      SELECT * FROM (
        SELECT pi.id, coalesce(pi.supplier_invoice_no, pi.pi_no) AS doc_no,
               pi.supplier_invoice_date::text AS date,
               (pi.supplier_invoice_date + s.payment_days)::text AS due_date, pi.total::text,
               ${piOutstanding()}::numeric(14,2)::text AS outstanding
        FROM purchase_invoices pi
        JOIN suppliers s ON s.id = pi.supplier_id
        WHERE pi.company_id = ${actor().companyId} AND pi.supplier_id = ${supplierId}
          AND pi.status = 'Posted'
        ${lock ? sql`FOR UPDATE OF pi` : sql``}
      ) x WHERE outstanding::numeric > 0
      ORDER BY due_date, date, doc_no`)
  ).rows;
}

export type UnusedCreditRow = {
  source: "RECEIPT" | "PAYMENT" | "CREDIT_NOTE" | "DEBIT_NOTE";
  id: string;
  doc_no: string;
  date: string;
  available: string;
};

/**
 * Money on account and notes not tied to an invoice, with what is left of each: posted receipts
 * (or supplier payments) less their live allocations; credit notes (customers) / purchase-return
 * debit notes (suppliers) raised without an invoice, less theirs.
 */
export async function unusedCredits(
  db: Db,
  partyType: "CUSTOMER" | "SUPPLIER",
  partyId: string,
): Promise<UnusedCreditRow[]> {
  const company = actor().companyId;
  const money = sql`
    SELECT ${partyType === "CUSTOMER" ? "RECEIPT" : "PAYMENT"}::text AS source, r.id, r.doc_no,
           r.date::text,
           (r.amount - coalesce((SELECT sum(a.amount) FROM allocations a
                                 WHERE a.receipt_id = r.id AND a.reversed_at IS NULL), 0))::text AS available
    FROM receipts r
    WHERE r.company_id = ${company} AND r.status = 'Posted' AND r.party_type = ${partyType}
      AND ${partyType === "CUSTOMER" ? sql`r.customer_id` : sql`r.supplier_id`} = ${partyId}`;
  const notes =
    partyType === "CUSTOMER"
      ? sql`
    SELECT 'CREDIT_NOTE', n.id, n.note_no, n.date::text,
           (n.total - coalesce((SELECT sum(a.amount) FROM allocations a
                                WHERE a.customer_note_id = n.id AND a.reversed_at IS NULL), 0))::text
    FROM customer_notes n
    WHERE n.company_id = ${company} AND n.customer_id = ${partyId} AND n.status = 'Posted'
      AND n.kind = 'CREDIT' AND n.si_id IS NULL`
      : sql`
    SELECT 'DEBIT_NOTE', pr.id, pr.dn_no, pr.date::text,
           (pr.total - coalesce((SELECT sum(a.amount) FROM allocations a
                                 WHERE a.purchase_return_id = pr.id AND a.reversed_at IS NULL), 0))::text
    FROM purchase_returns pr
    WHERE pr.company_id = ${company} AND pr.supplier_id = ${partyId} AND pr.status = 'Posted'
      AND pr.pi_id IS NULL`;
  return (
    await db.execute<UnusedCreditRow>(sql`
      SELECT * FROM (${money} UNION ALL ${notes}) x
      WHERE available::numeric > 0
      ORDER BY date, doc_no`)
  ).rows;
}
