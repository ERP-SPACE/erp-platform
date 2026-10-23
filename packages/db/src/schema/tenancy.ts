import { boolean, char, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { audited, id } from "./columns.js";

export interface PostalAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface BankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  branch?: string;
}

/** Company GST profile — prints on every document and drives intra/inter-state GST. */
export const companies = pgTable("companies", {
  id: id(),
  code: text("code").notNull().unique(),
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name"),
  gstin: char("gstin", { length: 15 }),
  stateCode: char("state_code", { length: 2 }).notNull(),
  pan: char("pan", { length: 10 }),
  address: jsonb("address").$type<PostalAddress>().notNull(),
  bank: jsonb("bank").$type<BankDetails | null>(),
  email: text("email"),
  phone: text("phone"),
  logoKey: text("logo_key"),
  signatoryName: text("signatory_name"),
  /** True while the profile still holds seed placeholders (open question Q1). */
  isPlaceholder: boolean("is_placeholder").notNull().default(true),
  ...audited,
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    stateCode: char("state_code", { length: 2 }).notNull(),
    address: jsonb("address").$type<PostalAddress>(),
    isDefault: boolean("is_default").notNull().default(false),
    ...audited,
  },
  (t) => [uniqueIndex("branches_company_code_uq").on(t.companyId, t.code)],
);
