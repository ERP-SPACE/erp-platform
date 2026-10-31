import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audited, createdOnly, id } from "./columns.js";
import { user } from "./identity.js";
import { companies } from "./tenancy.js";

/**
 * Stage 6: the Opening Balance Wizard (PRD §5.10) and the Go-Live lock. Opening stock is
 * created through opening GRNs and opening AR / AP as opening invoices (columns on those
 * tables point back to their batch); this file holds the batches, chapter confirmations,
 * bank / cash balances and the lock. Triggers in migration 0014 make everything read-only
 * once the company is live.
 */

export const openingBatchKind = pgEnum("opening_batch_kind", [
  "STOCK_ROLLS",
  "STOCK_SKU",
  "AR",
  "AP",
]);
export const openingBatchStatus = pgEnum("opening_batch_status", ["Imported", "Discarded"]);
export const openingChapterCode = pgEnum("opening_chapter", ["STOCK", "AR", "AP", "CASH"]);
export const openingChapterStatus = pgEnum("opening_chapter_status", [
  "Draft",
  "Confirmed",
  "NotNeeded",
]);
export const cashAccountKind = pgEnum("cash_account_kind", ["BANK", "CASH"]);

/** One uploaded CSV. Discarding removes what it created (only while untouched, before go-live). */
export const openingBatches = pgTable(
  "opening_batches",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    kind: openingBatchKind("kind").notNull(),
    status: openingBatchStatus("status").notNull().default("Imported"),
    fileName: text("file_name").notNull(),
    rowCount: integer("row_count").notNull(),
    /** Σ stock value or Σ invoice amounts. */
    total: numeric("total", { precision: 16, scale: 2 }).notNull(),
    metres: integer("metres"),
    /** The checked rows as imported, kept for the audit trail. */
    rows: jsonb("rows").notNull(),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardedBy: text("discarded_by").references(() => user.id),
    discardReason: text("discard_reason"),
    ...createdOnly,
  },
  (t) => [
    index("opening_batches_company_idx").on(t.companyId, t.kind, t.status),
    check(
      "opening_batches_discard_ck",
      sql`(${t.status} = 'Discarded') = (${t.discardedAt} IS NOT NULL)`,
    ),
  ],
);

/** A chapter confirmed against the old books' figure (Q43) or marked not needed. */
export const openingChapters = pgTable(
  "opening_chapters",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    chapter: openingChapterCode("chapter").notNull(),
    status: openingChapterStatus("status").notNull().default("Draft"),
    booksTotal: numeric("books_total", { precision: 16, scale: 2 }),
    notNeededReason: text("not_needed_reason"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.chapter] }),
    check(
      "opening_chapters_status_ck",
      sql`(${t.status} <> 'Confirmed' OR (${t.booksTotal} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL))
        AND (${t.status} <> 'NotNeeded' OR ${t.notNeededReason} IS NOT NULL)`,
    ),
  ],
);

/** Opening bank and cash balances: data for the Accounting stage; nothing posts (PRD §5.10). */
export const openingCashBalances = pgTable(
  "opening_cash_balances",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    kind: cashAccountKind("kind").notNull(),
    bankName: text("bank_name"),
    accountLast4: text("account_last4"),
    balance: numeric("balance", { precision: 16, scale: 2 }).notNull(),
    asOf: date("as_of").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    uniqueIndex("opening_cash_name_uq").on(t.companyId, t.name),
    check("opening_cash_bank_ck", sql`${t.kind} = 'CASH' OR ${t.bankName} IS NOT NULL`),
    check(
      "opening_cash_last4_ck",
      sql`${t.accountLast4} IS NULL OR ${t.accountLast4} ~ '^[0-9]{4}$'`,
    ),
  ],
);

/** The Go-Live lock, one row per company once it is live (Q44). */
export const goLive = pgTable("go_live", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  /** The user who pressed "Go live"; null when the first live posting locked it. */
  lockedBy: text("locked_by").references(() => user.id),
  /** "manual", or the document that locked it, e.g. "SI SI/2627/00001". */
  lockedByDoc: text("locked_by_doc").notNull(),
});
