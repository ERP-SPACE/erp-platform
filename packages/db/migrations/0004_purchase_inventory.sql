CREATE TYPE "public"."grn_status" AS ENUM('Created', 'Posted', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."gst_regime" AS ENUM('CGST_SGST', 'IGST');--> statement-breakpoint
CREATE TYPE "public"."landed_cost_basis" AS ENUM('ROLL', 'METER', 'VALUE', 'WEIGHT');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('Draft', 'Approved', 'PartiallyReceived', 'Closed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."purchase_doc_status" AS ENUM('Draft', 'Posted', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."allocation_kind" AS ENUM('ALLOCATE', 'REVERSE', 'VARIANCE');--> statement-breakpoint
CREATE TYPE "public"."roll_status" AS ENUM('Unmapped', 'Mapped', 'Allocated', 'Dispatched', 'Returned', 'ReturnedToSupplier', 'Scrap');--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"batch_seq" integer NOT NULL,
	"supplier_batch_ref" text,
	"date" date NOT NULL,
	"next_roll_seq" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "batches_seq_ck" CHECK ("batches"."batch_seq" BETWEEN 1 AND 9999)
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grn_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"po_line_id" uuid,
	"sku_id" uuid,
	"description" text NOT NULL,
	"gsm" integer NOT NULL,
	"width_in" numeric(5, 2) NOT NULL,
	"quality_name" text,
	"roll_list" text NOT NULL,
	"rejected_roll_list" text,
	"reject_reason" text,
	"roll_count" integer NOT NULL,
	"accepted_m" integer NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"rejected_m" integer DEFAULT 0 NOT NULL,
	"over_receipt_m" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "goods_receipt_lines_qty_ck" CHECK ("goods_receipt_lines"."roll_count" > 0 AND "goods_receipt_lines"."accepted_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"supplier_id" uuid NOT NULL,
	"grn_no" text NOT NULL,
	"po_id" uuid,
	"date" date NOT NULL,
	"status" "grn_status" DEFAULT 'Created' NOT NULL,
	"supplier_invoice_no" text,
	"supplier_batch_ref" text,
	"vehicle_no" text,
	"notes" text,
	"batch_id" uuid,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"over_receipt_approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_cost_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pi_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"basis" "landed_cost_basis" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"vendor_name" text,
	"bill_ref" text,
	"allocated_at" timestamp with time zone,
	"allocated_by" text,
	"reversed_at" timestamp with time zone,
	"reversed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "landed_cost_charges_amount_ck" CHECK ("landed_cost_charges"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_invoice_grns" (
	"pi_id" uuid NOT NULL,
	"grn_id" uuid NOT NULL,
	CONSTRAINT "purchase_invoice_grns_pi_id_grn_id_pk" PRIMARY KEY("pi_id","grn_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pi_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"po_line_id" uuid,
	"sku_id" uuid,
	"description" text NOT NULL,
	"gsm" integer NOT NULL,
	"width_in" numeric(5, 2) NOT NULL,
	"quality_name" text,
	"hsn_code" text NOT NULL,
	"quantity_m" integer NOT NULL,
	"rate_per_m" numeric(12, 4) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "purchase_invoice_lines_qty_ck" CHECK ("purchase_invoice_lines"."quantity_m" > 0 AND "purchase_invoice_lines"."rate_per_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"supplier_id" uuid NOT NULL,
	"pi_no" text,
	"supplier_invoice_no" text NOT NULL,
	"supplier_invoice_date" date NOT NULL,
	"po_id" uuid,
	"status" "purchase_doc_status" DEFAULT 'Draft' NOT NULL,
	"regime" "gst_regime" NOT NULL,
	"irn" text,
	"eway_bill_no" text,
	"taxable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(8, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sku_id" uuid,
	"description" text NOT NULL,
	"gsm" integer NOT NULL,
	"width_in" numeric(5, 2) NOT NULL,
	"quality_name" text,
	"quantity_m" integer NOT NULL,
	"rate_per_m" numeric(12, 4) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"notes" text,
	"received_m" integer DEFAULT 0 NOT NULL,
	"invoiced_m" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "purchase_order_lines_qty_ck" CHECK ("purchase_order_lines"."quantity_m" > 0 AND "purchase_order_lines"."rate_per_m" >= 0),
	CONSTRAINT "purchase_order_lines_done_ck" CHECK ("purchase_order_lines"."received_m" >= 0 AND "purchase_order_lines"."invoiced_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"supplier_id" uuid NOT NULL,
	"po_no" text NOT NULL,
	"date" date NOT NULL,
	"expected_date" date,
	"status" "po_status" DEFAULT 'Draft' NOT NULL,
	"regime" "gst_regime" NOT NULL,
	"notes" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_prints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"roll_id" uuid NOT NULL,
	"reprint" boolean DEFAULT false NOT NULL,
	"reason" text,
	"format" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "landed_cost_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"charge_id" uuid NOT NULL,
	"roll_id" uuid NOT NULL,
	"kind" "allocation_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "purchase_return_rolls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" uuid NOT NULL,
	"roll_id" uuid NOT NULL,
	"length_m" integer NOT NULL,
	"rate_per_m" numeric(12, 4) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"supplier_id" uuid NOT NULL,
	"pr_no" text,
	"dn_no" text,
	"pi_id" uuid,
	"date" date NOT NULL,
	"status" "purchase_doc_status" DEFAULT 'Draft' NOT NULL,
	"regime" "gst_regime" NOT NULL,
	"reason" text NOT NULL,
	"taxable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(8, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rolls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"barcode" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"roll_seq" integer NOT NULL,
	"supplier_id" uuid NOT NULL,
	"grn_id" uuid NOT NULL,
	"grn_line_id" uuid NOT NULL,
	"sku_id" uuid,
	"description" text NOT NULL,
	"gsm" integer NOT NULL,
	"width_in" numeric(5, 2) NOT NULL,
	"quality_name" text,
	"original_length_m" integer NOT NULL,
	"current_length_m" integer NOT NULL,
	"status" "roll_status" NOT NULL,
	"base_cost_per_m" numeric(12, 4),
	"base_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"landed_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cost_per_m" numeric(12, 4),
	"pi_id" uuid,
	"parent_roll_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"mapped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rolls_length_ck" CHECK ("rolls"."original_length_m" > 0 AND "rolls"."current_length_m" >= 0 AND "rolls"."current_length_m" <= "rolls"."original_length_m"),
	CONSTRAINT "rolls_mapped_sku_ck" CHECK ("rolls"."status" = 'Unmapped' OR "rolls"."sku_id" IS NOT NULL),
	CONSTRAINT "rolls_money_ck" CHECK ("rolls"."base_value" >= 0 AND "rolls"."landed_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_over_receipt_approved_by_user_id_fk" FOREIGN KEY ("over_receipt_approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_charges" ADD CONSTRAINT "landed_cost_charges_pi_id_purchase_invoices_id_fk" FOREIGN KEY ("pi_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_charges" ADD CONSTRAINT "landed_cost_charges_allocated_by_user_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_charges" ADD CONSTRAINT "landed_cost_charges_reversed_by_user_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_grns" ADD CONSTRAINT "purchase_invoice_grns_pi_id_purchase_invoices_id_fk" FOREIGN KEY ("pi_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_grns" ADD CONSTRAINT "purchase_invoice_grns_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_pi_id_purchase_invoices_id_fk" FOREIGN KEY ("pi_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_prints" ADD CONSTRAINT "label_prints_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_charge_id_landed_cost_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."landed_cost_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_rolls" ADD CONSTRAINT "purchase_return_rolls_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_rolls" ADD CONSTRAINT "purchase_return_rolls_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_pi_id_purchase_invoices_id_fk" FOREIGN KEY ("pi_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_grn_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("grn_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_pi_id_purchase_invoices_id_fk" FOREIGN KEY ("pi_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_parent_roll_id_rolls_id_fk" FOREIGN KEY ("parent_roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batches_supplier_seq_uq" ON "batches" USING btree ("supplier_id","batch_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipt_lines_no_uq" ON "goods_receipt_lines" USING btree ("grn_id","line_no");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_po_line_idx" ON "goods_receipt_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_no_uq" ON "goods_receipts" USING btree ("company_id","grn_no");--> statement-breakpoint
CREATE INDEX "goods_receipts_supplier_idx" ON "goods_receipts" USING btree ("supplier_id","date");--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "landed_cost_charges_pi_idx" ON "landed_cost_charges" USING btree ("pi_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_lines_no_uq" ON "purchase_invoice_lines" USING btree ("pi_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_no_uq" ON "purchase_invoices" USING btree ("company_id","pi_no") WHERE "purchase_invoices"."pi_no" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_supplier_no_uq" ON "purchase_invoices" USING btree ("supplier_id","supplier_invoice_no") WHERE "purchase_invoices"."status" <> 'Cancelled';--> statement-breakpoint
CREATE INDEX "purchase_invoices_po_idx" ON "purchase_invoices" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_no_uq" ON "purchase_order_lines" USING btree ("po_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_no_uq" ON "purchase_orders" USING btree ("company_id","po_no");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id","date");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "label_prints_roll_idx" ON "label_prints" USING btree ("roll_id");--> statement-breakpoint
CREATE INDEX "landed_cost_allocations_charge_idx" ON "landed_cost_allocations" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "landed_cost_allocations_roll_idx" ON "landed_cost_allocations" USING btree ("roll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_return_rolls_roll_uq" ON "purchase_return_rolls" USING btree ("roll_id");--> statement-breakpoint
CREATE INDEX "purchase_return_rolls_return_idx" ON "purchase_return_rolls" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_pr_uq" ON "purchase_returns" USING btree ("company_id","pr_no") WHERE "purchase_returns"."pr_no" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_dn_uq" ON "purchase_returns" USING btree ("company_id","dn_no") WHERE "purchase_returns"."dn_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "purchase_returns_supplier_idx" ON "purchase_returns" USING btree ("supplier_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "rolls_barcode_uq" ON "rolls" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "rolls_batch_seq_uq" ON "rolls" USING btree ("batch_id","roll_seq");--> statement-breakpoint
CREATE INDEX "rolls_status_idx" ON "rolls" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "rolls_sku_idx" ON "rolls" USING btree ("sku_id","status");--> statement-breakpoint
CREATE INDEX "rolls_supplier_idx" ON "rolls" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "rolls_grn_idx" ON "rolls" USING btree ("grn_id");--> statement-breakpoint
CREATE INDEX "rolls_pi_idx" ON "rolls" USING btree ("pi_id");--> statement-breakpoint
CREATE INDEX "rolls_in_stock_idx" ON "rolls" USING btree ("sku_id","received_at") WHERE "rolls"."status" IN ('Unmapped','Mapped','Allocated');