import { type Db, type Tx, customerGroupMembers, customers, userScopes } from "@erp/db";
import { type SQL, and, eq, inArray, or, sql } from "drizzle-orm";
import { actor } from "../../common/context.js";

export interface CustomerScope {
  /** No scope rows → the user sees every customer of the company. */
  unrestricted: boolean;
  groupIds: string[];
  ownCustomers: boolean;
}

/**
 * Customer data scoping (PRD §4.2, CLAUDE.md rule 10), enforced in the query layer.
 * A user's scopes are a union: customers in any of their `customer_group` scopes, plus
 * customers they are account manager for when they have `own_customers`.
 * `product_family` scopes restrict products, not customers, and are ignored here.
 */
export async function loadCustomerScope(db: Db | Tx): Promise<CustomerScope> {
  const rows = await db
    .select({ type: userScopes.scopeType, value: userScopes.scopeValue })
    .from(userScopes)
    .where(eq(userScopes.userId, actor().userId));
  const relevant = rows.filter((r) => r.type === "customer_group" || r.type === "own_customers");
  return {
    unrestricted: relevant.length === 0,
    groupIds: relevant.flatMap((r) => (r.type === "customer_group" && r.value ? [r.value] : [])),
    ownCustomers: relevant.some((r) => r.type === "own_customers"),
  };
}

/** WHERE fragment limiting `customers` to the actor's scope (always includes the company). */
export function customerScopeFilter(scope: CustomerScope): SQL {
  const company = eq(customers.companyId, actor().companyId);
  if (scope.unrestricted) return company;
  const parts: SQL[] = [];
  if (scope.groupIds.length) {
    parts.push(
      sql`EXISTS (SELECT 1 FROM ${customerGroupMembers} m WHERE m.customer_id = ${customers.id} AND ${inArray(sql`m.group_id`, scope.groupIds)})`,
    );
  }
  if (scope.ownCustomers) parts.push(eq(customers.accountManagerUserId, actor().userId));
  // A scoped user with no usable scope value sees nothing rather than everything.
  return and(company, parts.length ? or(...parts) : sql`false`)!;
}
