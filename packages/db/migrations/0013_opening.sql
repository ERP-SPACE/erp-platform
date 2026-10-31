CREATE TYPE "public"."cash_account_kind" AS ENUM('BANK', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."opening_batch_kind" AS ENUM('STOCK_ROLLS', 'STOCK_SKU', 'AR', 'AP');--> statement-breakpoint
CREATE TYPE "public"."opening_batch_status" AS ENUM('Imported', 'Discarded');--> statement-breakpoint
CREATE TYPE "public"."opening_chapter" AS ENUM('STOCK', 'AR', 'AP', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."opening_chapter_status" AS ENUM('Draft', 'Confirmed', 'NotNeeded');--> statement-breakpoint
ALTER TYPE "public"."si_source" ADD VALUE 'OPENING';--> statement-breakpoint
CREATE TABLE "go_live" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_by_doc" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "opening_batch_kind" NOT NULL,
	"status" "opening_batch_status" DEFAULT 'Imported' NOT NULL,
	"file_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"total" numeric(16, 2) NOT NULL,
	"metres" integer,
	"rows" jsonb NOT NULL,
	"discarded_at" timestamp with time zone,
	"discarded_by" text,
	"discard_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "opening_batches_discard_ck" CHECK (("opening_batches"."status" = 'Discarded') = ("opening_batches"."discarded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "opening_cash_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "cash_account_kind" NOT NULL,
	"bank_name" text,
	"account_last4" text,
	"balance" numeric(16, 2) NOT NULL,
	"as_of" date NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "opening_cash_bank_ck" CHECK ("opening_cash_balances"."kind" = 'CASH' OR "opening_cash_balances"."bank_name" IS NOT NULL),
	CONSTRAINT "opening_cash_last4_ck" CHECK ("opening_cash_balances"."account_last4" IS NULL OR "opening_cash_balances"."account_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "opening_chapters" (
	"company_id" uuid NOT NULL,
	"chapter" "opening_chapter" NOT NULL,
	"status" "opening_chapter_status" DEFAULT 'Draft' NOT NULL,
	"books_total" numeric(16, 2),
	"not_needed_reason" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "opening_chapters_company_id_chapter_pk" PRIMARY KEY("company_id","chapter"),
	CONSTRAINT "opening_chapters_status_ck" CHECK (("opening_chapters"."status" <> 'Confirmed' OR ("opening_chapters"."books_total" IS NOT NULL AND "opening_chapters"."confirmed_at" IS NOT NULL))
        AND ("opening_chapters"."status" <> 'NotNeeded' OR "opening_chapters"."not_needed_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "opening_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "opening_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "legacy_no" text;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "opening_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "go_live" ADD CONSTRAINT "go_live_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "go_live" ADD CONSTRAINT "go_live_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_batches" ADD CONSTRAINT "opening_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_batches" ADD CONSTRAINT "opening_batches_discarded_by_user_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_cash_balances" ADD CONSTRAINT "opening_cash_balances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_cash_balances" ADD CONSTRAINT "opening_cash_balances_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_chapters" ADD CONSTRAINT "opening_chapters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_chapters" ADD CONSTRAINT "opening_chapters_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_batches_company_idx" ON "opening_batches" USING btree ("company_id","kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "opening_cash_name_uq" ON "opening_cash_balances" USING btree ("company_id","name");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_opening_batch_id_opening_batches_id_fk" FOREIGN KEY ("opening_batch_id") REFERENCES "public"."opening_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_opening_batch_id_opening_batches_id_fk" FOREIGN KEY ("opening_batch_id") REFERENCES "public"."opening_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_opening_batch_id_opening_batches_id_fk" FOREIGN KEY ("opening_batch_id") REFERENCES "public"."opening_batches"("id") ON DELETE no action ON UPDATE no action;