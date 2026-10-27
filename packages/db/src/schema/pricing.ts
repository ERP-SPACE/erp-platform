import { sql } from "drizzle-orm";
import { check, date, index, numeric, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { audited, createdOnly, id } from "./columns.js";
import { products } from "./catalogue.js";
import { customers } from "./parties.js";

export const rateSource = pgEnum("rate_source", ["manual", "bulk_revision", "salesman_default"]);

/**
 * Customer rate per metre at the 44″ benchmark (ADR-0013), valid over a date range.
 * Overlapping ranges for the same customer + product are rejected by an EXCLUDE constraint
 * (btree_gist) added in the SQL migration — the Stage 1 gate check.
 */
export const partyRates = pgTable(
  "party_rates",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    baseRate44: numeric("base_rate_44", { precision: 12, scale: 4 }).notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    source: rateSource("source").notNull().default("manual"),
    ...audited,
  },
  (t) => [
    index("party_rates_customer_product_idx").on(t.customerId, t.productId, t.validFrom),
    check("party_rates_rate_ck", sql`${t.baseRate44} >= 0`),
    check("party_rates_range_ck", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
);

/** Append-only history of every effective rate (PRD §5.5 Rate History); SO/SI links in Stage 3. */
export const rateHistory = pgTable(
  "rate_history",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    previousRate44: numeric("previous_rate_44", { precision: 12, scale: 4 }),
    newRate44: numeric("new_rate_44", { precision: 12, scale: 4 }).notNull(),
    validFrom: date("valid_from").notNull(),
    source: rateSource("source").notNull(),
    reason: text("reason"),
    soId: uuid("so_id"),
    siId: uuid("si_id"),
    ...createdOnly,
  },
  (t) => [index("rate_history_customer_idx").on(t.customerId, t.createdAt)],
);
