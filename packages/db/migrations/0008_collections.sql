CREATE TYPE "public"."commission_entry_status" AS ENUM('Accrued', 'Paid');--> statement-breakpoint
CREATE TYPE "public"."commission_source" AS ENUM('SI', 'CN', 'RC');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('CUSTOMER', 'SUPPLIER');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('CASH', 'NEFT', 'RTGS', 'UPI', 'CHEQUE');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('Draft', 'Paid', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('Draft', 'Posted', 'Reversed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."reversal_kind" AS ENUM('BOUNCED', 'MISTAKE');--> statement-breakpoint
CREATE TYPE "public"."settlement_source" AS ENUM('RECEIPT', 'PAYMENT', 'CREDIT_NOTE', 'DEBIT_NOTE');--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"source" "settlement_source" NOT NULL,
	"receipt_id" uuid,
	"customer_note_id" uuid,
	"purchase_return_id" uuid,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"deduction" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "allocations_amount_ck" CHECK ("allocations"."amount" >= 0 AND "allocations"."deduction" >= 0 AND "allocations"."amount" + "allocations"."deduction" > 0),
	CONSTRAINT "allocations_source_ck" CHECK (("allocations"."source" IN ('RECEIPT', 'PAYMENT') AND "allocations"."receipt_id" IS NOT NULL AND "allocations"."customer_note_id" IS NULL AND "allocations"."purchase_return_id" IS NULL)
       OR ("allocations"."source" = 'CREDIT_NOTE' AND "allocations"."customer_note_id" IS NOT NULL AND "allocations"."receipt_id" IS NULL AND "allocations"."purchase_return_id" IS NULL)
       OR ("allocations"."source" = 'DEBIT_NOTE' AND "allocations"."purchase_return_id" IS NOT NULL AND "allocations"."receipt_id" IS NULL AND "allocations"."customer_note_id" IS NULL)),
	CONSTRAINT "allocations_target_ck" CHECK (("allocations"."sales_invoice_id" IS NULL) <> ("allocations"."purchase_invoice_id" IS NULL)),
	CONSTRAINT "allocations_deduction_ck" CHECK ("allocations"."deduction" = 0 OR "allocations"."source" IN ('RECEIPT', 'PAYMENT'))
);
--> statement-breakpoint
CREATE TABLE "commission_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"salesman_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"source_type" "commission_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"date" date NOT NULL,
	"method" "commission_method" NOT NULL,
	"rate" numeric(12, 4) NOT NULL,
	"base" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reversal_reason" text,
	"status" "commission_entry_status" DEFAULT 'Accrued' NOT NULL,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "commission_entries_nonzero_ck" CHECK ("commission_entries"."amount" <> 0),
	CONSTRAINT "commission_entries_reversal_ck" CHECK ("commission_entries"."amount" > 0 OR "commission_entries"."reversal_reason" IS NOT NULL),
	CONSTRAINT "commission_entries_paid_ck" CHECK (("commission_entries"."status" = 'Paid') = ("commission_entries"."payout_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "commission_payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"payout_no" text,
	"salesman_id" uuid NOT NULL,
	"up_to" date NOT NULL,
	"status" "payout_status" DEFAULT 'Draft' NOT NULL,
	"gross" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tds" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_on" date,
	"mode" "payment_mode",
	"reference" text,
	"notes" text,
	"paid_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commission_payouts_net_ck" CHECK ("commission_payouts"."net" = "commission_payouts"."gross" - "commission_payouts"."tds" AND "commission_payouts"."tds" >= 0),
	CONSTRAINT "commission_payouts_paid_ck" CHECK (("commission_payouts"."status" = 'Paid') = ("commission_payouts"."paid_on" IS NOT NULL AND "commission_payouts"."payout_no" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"party_type" "party_type" NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"doc_no" text,
	"date" date NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reference" text,
	"bank_name" text,
	"instrument_date" date,
	"notes" text,
	"status" "receipt_status" DEFAULT 'Draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"reversed_at" timestamp with time zone,
	"reversed_by" text,
	"reversal_kind" "reversal_kind",
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "receipts_amount_ck" CHECK ("receipts"."amount" > 0),
	CONSTRAINT "receipts_party_ck" CHECK (("receipts"."party_type" = 'CUSTOMER' AND "receipts"."customer_id" IS NOT NULL AND "receipts"."supplier_id" IS NULL)
       OR ("receipts"."party_type" = 'SUPPLIER' AND "receipts"."supplier_id" IS NOT NULL AND "receipts"."customer_id" IS NULL)),
	CONSTRAINT "receipts_reversal_ck" CHECK (("receipts"."status" = 'Reversed') = ("receipts"."reversed_at" IS NOT NULL AND "receipts"."reversal_kind" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "credit_policies" ADD COLUMN "system_block" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_policies" ADD COLUMN "system_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_policies" ADD COLUMN "system_block_reason" text;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "salesman_id" uuid;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_customer_note_id_customer_notes_id_fk" FOREIGN KEY ("customer_note_id") REFERENCES "public"."customer_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_purchase_return_id_purchase_returns_id_fk" FOREIGN KEY ("purchase_return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_reversed_by_user_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_salesman_id_salesmen_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."salesmen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_payout_id_commission_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."commission_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_salesman_id_salesmen_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."salesmen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_reversed_by_user_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_si_idx" ON "allocations" USING btree ("sales_invoice_id") WHERE "allocations"."reversed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "allocations_pi_idx" ON "allocations" USING btree ("purchase_invoice_id") WHERE "allocations"."reversed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "allocations_receipt_idx" ON "allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "allocations_note_idx" ON "allocations" USING btree ("customer_note_id");--> statement-breakpoint
CREATE INDEX "allocations_pr_idx" ON "allocations" USING btree ("purchase_return_id");--> statement-breakpoint
CREATE INDEX "commission_entries_salesman_idx" ON "commission_entries" USING btree ("salesman_id","status","date");--> statement-breakpoint
CREATE INDEX "commission_entries_si_idx" ON "commission_entries" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "commission_entries_source_idx" ON "commission_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_payouts_no_uq" ON "commission_payouts" USING btree ("company_id","payout_no") WHERE "commission_payouts"."payout_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "commission_payouts_salesman_idx" ON "commission_payouts" USING btree ("salesman_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_no_uq" ON "receipts" USING btree ("company_id","party_type","doc_no") WHERE "receipts"."doc_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "receipts_customer_idx" ON "receipts" USING btree ("customer_id","date");--> statement-breakpoint
CREATE INDEX "receipts_supplier_idx" ON "receipts" USING btree ("supplier_id","date");--> statement-breakpoint
CREATE INDEX "receipts_status_idx" ON "receipts" USING btree ("company_id","party_type","status","date");--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_salesman_id_salesmen_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."salesmen"("id") ON DELETE no action ON UPDATE no action;