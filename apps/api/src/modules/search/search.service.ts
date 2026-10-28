import type { DashboardSummary, PermissionCode, SearchResult } from "@erp/contracts";
import {
  categories,
  creditPolicies,
  customers,
  products,
  qualities,
  salesmen,
  skus,
  suppliers,
  transporters,
} from "@erp/db";
import { D, istToday } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { productName } from "../catalogue/catalogue.service.js";
import { siOutstanding } from "../collections/outstanding.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { searchFilter } from "../suppliers/suppliers.service.js";

const PER_TYPE = 5;

/**
 * Ctrl K search across masters, and the dashboard's KPI counts. Each section is included only
 * when the actor may view it; customers respect the customer scope.
 */
@Injectable()
export class SearchService {
  constructor(private readonly uow: UnitOfWork) {}

  async search(q: string): Promise<{ results: SearchResult[] }> {
    const term = q.trim();
    if (term.length < 2) return { results: [] };
    const can = (p: PermissionCode) => actor().permissions.has(p);
    const db = this.uow.db;
    const companyId = actor().companyId;
    const tasks: Promise<SearchResult[]>[] = [];

    if (can("customers.view")) {
      tasks.push(
        loadCustomerScope(db).then(async (scope) => {
          const rows = await db
            .select({
              id: customers.id,
              code: customers.code,
              legalName: customers.legalName,
              gstin: customers.gstin,
              address: customers.billingAddress,
            })
            .from(customers)
            .where(
              and(
                customerScopeFilter(scope),
                searchFilter(
                  sql`(${customers.legalName} || ' ' || coalesce(${customers.tradeName}, '') || ' ' || ${customers.code} || ' ' || coalesce(${customers.gstin}, '') || ' ' || coalesce(${customers.phone}, ''))`,
                  term,
                ),
              ),
            )
            .orderBy(asc(customers.legalName))
            .limit(PER_TYPE);
          return rows.map((r) => ({
            type: "customer" as const,
            id: r.id,
            title: r.legalName,
            subtitle: [r.code, r.address.city, r.gstin].filter(Boolean).join(" · "),
          }));
        }),
      );
    }
    if (can("suppliers.view")) {
      tasks.push(
        db
          .select({
            id: suppliers.id,
            code: suppliers.code,
            name: suppliers.name,
            gstin: suppliers.gstin,
          })
          .from(suppliers)
          .where(
            and(
              eq(suppliers.companyId, companyId),
              searchFilter(
                sql`(${suppliers.name} || ' ' || ${suppliers.code} || ' ' || coalesce(${suppliers.gstin}, ''))`,
                term,
              ),
            ),
          )
          .orderBy(asc(suppliers.name))
          .limit(PER_TYPE)
          .then((rows) =>
            rows.map((r) => ({
              type: "supplier" as const,
              id: r.id,
              title: r.name,
              subtitle: [r.code, r.gstin].filter(Boolean).join(" · "),
            })),
          ),
      );
    }
    if (can("transporters.view")) {
      tasks.push(
        db
          .select({ id: transporters.id, code: transporters.code, name: transporters.name })
          .from(transporters)
          .where(
            and(
              eq(transporters.companyId, companyId),
              searchFilter(sql`(${transporters.name} || ' ' || ${transporters.code})`, term),
            ),
          )
          .orderBy(asc(transporters.name))
          .limit(PER_TYPE)
          .then((rows) =>
            rows.map((r) => ({
              type: "transporter" as const,
              id: r.id,
              title: r.name,
              subtitle: r.code,
            })),
          ),
      );
    }
    if (can("salesmen.view")) {
      tasks.push(
        db
          .select({
            id: salesmen.id,
            code: salesmen.code,
            name: salesmen.name,
            phone: salesmen.phone,
          })
          .from(salesmen)
          .where(
            and(
              eq(salesmen.companyId, companyId),
              searchFilter(
                sql`(${salesmen.name} || ' ' || ${salesmen.code} || ' ' || coalesce(${salesmen.phone}, ''))`,
                term,
              ),
            ),
          )
          .orderBy(asc(salesmen.name))
          .limit(PER_TYPE)
          .then((rows) =>
            rows.map((r) => ({
              type: "salesman" as const,
              id: r.id,
              title: r.name,
              subtitle: [r.code, r.phone].filter(Boolean).join(" · "),
            })),
          ),
      );
    }
    if (can("catalogue.view")) {
      tasks.push(
        db
          .selectDistinct({
            id: products.id,
            gsm: products.gsm,
            categoryName: categories.name,
            qualityName: qualities.name,
          })
          .from(products)
          .innerJoin(categories, eq(categories.id, products.categoryId))
          .innerJoin(qualities, eq(qualities.id, products.qualityId))
          .leftJoin(skus, eq(skus.productId, products.id))
          .where(
            and(
              eq(products.companyId, companyId),
              or(
                searchFilter(
                  sql`(${categories.name} || ' ' || ${qualities.name} || ' ' || ${products.gsm} || ' gsm')`,
                  term,
                ),
                searchFilter(sql`coalesce(${skus.code}, '')`, term),
              ),
            ),
          )
          .orderBy(asc(categories.name), asc(qualities.name), asc(products.gsm))
          .limit(PER_TYPE)
          .then((rows) =>
            rows.map((r) => ({
              type: "product" as const,
              id: r.id,
              title: productName(r.categoryName, r.qualityName, r.gsm),
              subtitle: r.categoryName,
            })),
          ),
      );
    }
    return { results: (await Promise.all(tasks)).flat() };
  }

  async dashboard(): Promise<DashboardSummary> {
    const db = this.uow.db;
    const companyId = actor().companyId;
    const has = (p: PermissionCode) => actor().permissions.has(p);
    const count = (n: unknown) => Number(n ?? 0);

    const [customerStats, supplierCount, skuCount, missingTax] = await Promise.all([
      has("customers.view")
        ? loadCustomerScope(db).then((scope) =>
            db
              .select({
                active: sql<number>`count(*) FILTER (WHERE ${customers.active})::int`,
                blocked: sql<number>`count(*) FILTER (WHERE ${customers.active} AND ${creditPolicies.manualBlock})::int`,
                totalCredit: sql<string>`coalesce(sum(${creditPolicies.creditLimit}) FILTER (WHERE ${customers.active}), 0)::text`,
              })
              .from(customers)
              .innerJoin(creditPolicies, eq(creditPolicies.customerId, customers.id))
              .where(customerScopeFilter(scope)),
          )
        : Promise.resolve([{ active: 0, blocked: 0, totalCredit: "0" }]),
      has("suppliers.view")
        ? db
            .select({ n: sql<number>`count(*)::int` })
            .from(suppliers)
            .where(and(eq(suppliers.companyId, companyId), eq(suppliers.active, true)))
        : Promise.resolve([{ n: 0 }]),
      has("catalogue.view")
        ? db
            .select({ n: sql<number>`count(*)::int` })
            .from(skus)
            .where(and(eq(skus.companyId, companyId), eq(skus.active, true)))
        : Promise.resolve([{ n: 0 }]),
      has("catalogue.view")
        ? db
            .select({ n: sql<number>`count(*)::int` })
            .from(categories)
            .where(
              and(
                eq(categories.companyId, companyId),
                eq(categories.active, true),
                or(isNull(categories.hsnCode), isNull(categories.gstRate)),
              ),
            )
        : Promise.resolve([{ n: 0 }]),
    ]);
    const c = customerStats[0]!;
    return {
      activeCustomers: count(c.active),
      blockedCustomers: count(c.blocked),
      totalCreditLimit: trimDecimal(c.totalCredit),
      suppliers: count(supplierCount[0]?.n),
      skus: count(skuCount[0]?.n),
      categoriesMissingTax: count(missingTax[0]?.n),
      sales: has("sales.view") ? await this.salesKpis() : null,
      collections: has("collections.view") ? await this.collectionKpis() : null,
    };
  }

  /** Money in and owed (Stage 4), within the actor's customer scope. */
  private async collectionKpis(): Promise<NonNullable<DashboardSummary["collections"]>> {
    const db = this.uow.db;
    const scope = customerScopeFilter(await loadCustomerScope(db));
    const today = istToday();
    const month = today.slice(0, 8) + "01";
    const [r] = (
      await db.execute<Record<string, string>>(sql`
        SELECT
          (SELECT coalesce(sum(r.amount), 0) FROM receipts r JOIN customers ON customers.id = r.customer_id
            WHERE ${scope} AND r.party_type = 'CUSTOMER' AND r.status = 'Posted' AND r.date = ${today})::text AS today,
          (SELECT coalesce(sum(r.amount), 0) FROM receipts r JOIN customers ON customers.id = r.customer_id
            WHERE ${scope} AND r.party_type = 'CUSTOMER' AND r.status = 'Posted' AND r.date >= ${month})::text AS month,
          (SELECT coalesce(sum(${siOutstanding()}), 0) FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
            WHERE ${scope} AND si.status = 'Posted')::text AS receivable,
          (SELECT coalesce(sum(${siOutstanding()}), 0) FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
            WHERE ${scope} AND si.status = 'Posted' AND si.due_date < ${today})::text AS overdue,
          (SELECT coalesce(sum(r.amount - coalesce((SELECT sum(a.amount) FROM allocations a
                  WHERE a.receipt_id = r.id AND a.reversed_at IS NULL), 0)), 0)
             FROM receipts r JOIN customers ON customers.id = r.customer_id
            WHERE ${scope} AND r.party_type = 'CUSTOMER' AND r.status = 'Posted')::text AS on_account
      `)
    ).rows;
    return {
      collectedToday: D(r!.today!).toFixed(2),
      collectedThisMonth: D(r!.month!).toFixed(2),
      receivable: D(r!.receivable!).toFixed(2),
      overdue: D(r!.overdue!).toFixed(2),
      onAccount: D(r!.on_account!).toFixed(2),
    };
  }

  /** Sales Board / dashboard counts (Stage 3), within the actor's customer scope. */
  private async salesKpis(): Promise<NonNullable<DashboardSummary["sales"]>> {
    const db = this.uow.db;
    const scope = customerScopeFilter(await loadCustomerScope(db));
    const month = istToday().slice(0, 8) + "01";
    const [r] = (
      await db.execute<Record<string, string | number>>(sql`
        SELECT
          (SELECT count(*) FROM sales_orders so JOIN customers ON customers.id = so.customer_id
            WHERE ${scope} AND so.status IN ('Confirmed','PartiallyFulfilled'))::int AS open_orders,
          (SELECT count(*) FROM sales_orders so JOIN customers ON customers.id = so.customer_id
            WHERE ${scope} AND so.status = 'OnHold')::int AS on_hold,
          (SELECT count(DISTINCT so.id) FROM sales_orders so
             JOIN customers ON customers.id = so.customer_id
             JOIN sales_order_lines l ON l.so_id = so.id
            WHERE ${scope} AND so.status = 'Draft' AND l.needs_approval AND l.approved_at IS NULL)::int AS awaiting,
          (SELECT count(*) FROM delivery_challans dc JOIN customers ON customers.id = dc.customer_id
            WHERE ${scope} AND dc.status = 'Open')::int AS to_invoice,
          (SELECT coalesce(sum(si.total), 0)::text FROM sales_invoices si
             JOIN customers ON customers.id = si.customer_id
            WHERE ${scope} AND si.status = 'Posted' AND si.date >= ${month}) AS month_total,
          (SELECT count(*) FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
            WHERE ${scope} AND si.status = 'Posted' AND si.date >= ${month})::int AS month_count,
          (SELECT count(*) FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
            WHERE ${scope} AND si.status = 'Posted' AND si.einvoice_status = 'Pending')::int
          + (SELECT count(*) FROM customer_notes n JOIN customers ON customers.id = n.customer_id
            WHERE ${scope} AND n.status = 'Posted' AND n.einvoice_status = 'Pending')::int AS irn_pending,
          (SELECT count(*) FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
            WHERE ${scope} AND si.status = 'Posted' AND si.einvoice_status = 'Failed')::int
          + (SELECT count(*) FROM customer_notes n JOIN customers ON customers.id = n.customer_id
            WHERE ${scope} AND n.status = 'Posted' AND n.einvoice_status = 'Failed')::int AS irn_failed
      `)
    ).rows;
    return {
      openOrders: Number(r!.open_orders),
      onHold: Number(r!.on_hold),
      awaitingApproval: Number(r!.awaiting),
      challansToInvoice: Number(r!.to_invoice),
      invoicedThisMonth: D(r!.month_total!).toFixed(2),
      invoicesThisMonth: Number(r!.month_count),
      irnPending: Number(r!.irn_pending),
      irnFailed: Number(r!.irn_failed),
    };
  }
}
