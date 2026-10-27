CREATE TYPE "public"."dc_status" AS ENUM('Draft', 'Open', 'Closed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."einvoice_status" AS ENUM('NotRequired', 'Pending', 'Generated', 'Failed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."length_change_kind" AS ENUM('CORRECTION', 'CUT', 'RETURN');--> statement-breakpoint
CREATE TYPE "public"."note_kind" AS ENUM('CREDIT', 'DEBIT');--> statement-breakpoint
CREATE TYPE "public"."note_reason" AS ENUM('RETURN', 'RATE_DIFFERENCE', 'DISCOUNT', 'SHORTAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."proforma_status" AS ENUM('Draft', 'Sent', 'Converted', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."return_outcome" AS ENUM('RESTOCK', 'SCRAP');--> statement-breakpoint
CREATE TYPE "public"."sales_line_kind" AS ENUM('GOODS', 'CHARGE');--> statement-breakpoint
CREATE TYPE "public"."si_source" AS ENUM('DC', 'DIRECT', 'PROFORMA');--> statement-breakpoint
CREATE TYPE "public"."so_rate_source" AS ENUM('PARTY_RATE', 'SALESMAN_DEFAULT', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."so_status" AS ENUM('Draft', 'Confirmed', 'OnHold', 'PartiallyFulfilled', 'Closed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."supply_type" AS ENUM('B2B', 'B2C', 'SEZWP', 'SEZWOP');--> statement-breakpoint
CREATE TABLE "customer_note_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"hsn_code" text NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "customer_note_lines_taxable_ck" CHECK ("customer_note_lines"."taxable" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid NOT NULL,
	"kind" "note_kind" NOT NULL,
	"note_no" text,
	"si_id" uuid,
	"sales_return_id" uuid,
	"date" date NOT NULL,
	"status" "purchase_doc_status" DEFAULT 'Draft' NOT NULL,
	"reason_code" "note_reason" NOT NULL,
	"reason" text NOT NULL,
	"regime" "gst_regime" NOT NULL,
	"place_of_supply" text NOT NULL,
	"supply_type" "supply_type" NOT NULL,
	"customer_name" text NOT NULL,
	"customer_gstin" text,
	"billing_address" text NOT NULL,
	"shipping_address" text NOT NULL,
	"gross" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bill_discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(8, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"einvoice_status" "einvoice_status" DEFAULT 'NotRequired' NOT NULL,
	"irn" text,
	"ack_no" text,
	"ack_date" timestamp with time zone,
	"signed_invoice" text,
	"signed_qr" text,
	"irn_attempts" integer DEFAULT 0 NOT NULL,
	"irn_last_error" text,
	"irn_cancelled_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "customer_notes_no_ck" CHECK ("customer_notes"."note_no" IS NULL OR length("customer_notes"."note_no") <= 16),
	CONSTRAINT "customer_notes_return_ck" CHECK (("customer_notes"."reason_code" = 'RETURN') = ("customer_notes"."sales_return_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "delivery_challan_rolls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dc_id" uuid NOT NULL,
	"so_line_id" uuid NOT NULL,
	"roll_id" uuid NOT NULL,
	"length_m" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "delivery_challan_rolls_length_ck" CHECK ("delivery_challan_rolls"."length_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_challans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid NOT NULL,
	"dc_no" text NOT NULL,
	"so_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "dc_status" DEFAULT 'Draft' NOT NULL,
	"transporter_id" uuid,
	"vehicle_no" text,
	"lr_no" text,
	"lr_date" date,
	"distance_km" integer,
	"eway_bill_no" text,
	"eway_bill_date" date,
	"eway_bill_valid_until" date,
	"value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "delivery_challans_distance_ck" CHECK ("delivery_challans"."distance_km" IS NULL OR "delivery_challans"."distance_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "einvoice_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"action" text NOT NULL,
	"provider" text NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"ok" boolean NOT NULL,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "einvoice_requests_doc_type_ck" CHECK ("einvoice_requests"."doc_type" IN ('SI','CN','DN')),
	CONSTRAINT "einvoice_requests_action_ck" CHECK ("einvoice_requests"."action" IN ('GENERATE','CANCEL','EWAY_BILL','MANUAL'))
);
--> statement-breakpoint
CREATE TABLE "proforma_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proforma_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sku_id" uuid NOT NULL,
	"description" text NOT NULL,
	"width_in" numeric(5, 2) NOT NULL,
	"hsn_code" text,
	"gst_rate" numeric(5, 2),
	"metres" integer NOT NULL,
	"rate_per_m" numeric(12, 4) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "proforma_lines_qty_ck" CHECK ("proforma_lines"."metres" > 0 AND "proforma_lines"."rate_per_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "proformas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid NOT NULL,
	"proforma_no" text NOT NULL,
	"so_id" uuid,
	"date" date NOT NULL,
	"valid_until" date NOT NULL,
	"status" "proforma_status" DEFAULT 'Draft' NOT NULL,
	"regime" "gst_regime" NOT NULL,
	"place_of_supply" text NOT NULL,
	"charges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gross" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bill_discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(8, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sent_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roll_cuts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_roll_id" uuid NOT NULL,
	"child_roll_id" uuid NOT NULL,
	"cut_m" integer NOT NULL,
	"waste_m" integer DEFAULT 0 NOT NULL,
	"parent_length_before" integer NOT NULL,
	"parent_length_after" integer NOT NULL,
	"child_cost" numeric(14, 2) NOT NULL,
	"waste_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"dc_id" uuid,
	"so_line_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "roll_cuts_length_ck" CHECK ("roll_cuts"."cut_m" > 0 AND "roll_cuts"."waste_m" >= 0 AND "roll_cuts"."parent_length_after" > 0 AND "roll_cuts"."parent_length_before" = "roll_cuts"."cut_m" + "roll_cuts"."waste_m" + "roll_cuts"."parent_length_after")
);
--> statement-breakpoint
CREATE TABLE "roll_length_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"roll_id" uuid NOT NULL,
	"kind" "length_change_kind" NOT NULL,
	"from_m" integer NOT NULL,
	"to_m" integer NOT NULL,
	"reason" text,
	"ref_type" text,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_dcs" (
	"si_id" uuid NOT NULL,
	"dc_id" uuid NOT NULL,
	CONSTRAINT "sales_invoice_dcs_si_id_dc_id_pk" PRIMARY KEY("si_id","dc_id")
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"si_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" "sales_line_kind" NOT NULL,
	"so_line_id" uuid,
	"proforma_line_id" uuid,
	"sku_id" uuid,
	"charge_code" text,
	"description" text NOT NULL,
	"hsn_code" text NOT NULL,
	"width_in" numeric(5, 2),
	"metres" integer,
	"rate_per_m" numeric(12, 4),
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bill_discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cogs" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "sales_invoice_lines_kind_ck" CHECK (("sales_invoice_lines"."kind" = 'GOODS' AND "sales_invoice_lines"."sku_id" IS NOT NULL AND "sales_invoice_lines"."metres" > 0 AND "sales_invoice_lines"."rate_per_m" IS NOT NULL) OR ("sales_invoice_lines"."kind" = 'CHARGE' AND "sales_invoice_lines"."charge_code" IS NOT NULL)),
	CONSTRAINT "sales_invoice_lines_discount_ck" CHECK ("sales_invoice_lines"."discount_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_rolls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"si_id" uuid NOT NULL,
	"si_line_id" uuid NOT NULL,
	"roll_id" uuid NOT NULL,
	"length_m" integer NOT NULL,
	"cost_per_m" numeric(12, 4),
	"cogs" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "sales_invoice_rolls_length_ck" CHECK ("sales_invoice_rolls"."length_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid NOT NULL,
	"si_no" text,
	"date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" "purchase_doc_status" DEFAULT 'Draft' NOT NULL,
	"source" "si_source" NOT NULL,
	"proforma_id" uuid,
	"regime" "gst_regime" NOT NULL,
	"place_of_supply" text NOT NULL,
	"supply_type" "supply_type" NOT NULL,
	"customer_name" text NOT NULL,
	"customer_gstin" text,
	"billing_address" text NOT NULL,
	"shipping_address" text NOT NULL,
	"gross" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bill_discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(8, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cogs" numeric(14, 2),
	"einvoice_status" "einvoice_status" DEFAULT 'NotRequired' NOT NULL,
	"irn" text,
	"ack_no" text,
	"ack_date" timestamp with time zone,
	"signed_invoice" text,
	"signed_qr" text,
	"irn_attempts" integer DEFAULT 0 NOT NULL,
	"irn_last_error" text,
	"irn_cancelled_at" timestamp with time zone,
	"transporter_id" uuid,
	"vehicle_no" text,
	"lr_no" text,
	"lr_date" date,
	"distance_km" integer,
	"eway_bill_no" text,
	"eway_bill_date" date,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sales_invoices_si_no_ck" CHECK ("sales_invoices"."si_no" IS NULL OR length("sales_invoices"."si_no") <= 16),
	CONSTRAINT "sales_invoices_due_ck" CHECK ("sales_invoices"."due_date" >= "sales_invoices"."date")
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"so_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sku_id" uuid NOT NULL,
	"description" text NOT NULL,
	"gsm" integer NOT NULL,
	"width_in" numeric(5, 2) NOT NULL,
	"hsn_code" text,
	"gst_rate" numeric(5, 2),
	"total_m" integer NOT NULL,
	"length_mix" jsonb,
	"qty_rolls" integer NOT NULL,
	"allow_cut" boolean NOT NULL,
	"rate_source" "so_rate_source" NOT NULL,
	"base_44" numeric(12, 4),
	"derived_rate_per_m" numeric(12, 4),
	"rate_per_m" numeric(12, 4) NOT NULL,
	"deviation_pct" numeric(7, 2),
	"needs_approval" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"dispatched_m" integer DEFAULT 0 NOT NULL,
	"invoiced_m" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "sales_order_lines_qty_ck" CHECK ("sales_order_lines"."total_m" > 0 AND "sales_order_lines"."qty_rolls" > 0 AND "sales_order_lines"."rate_per_m" >= 0),
	CONSTRAINT "sales_order_lines_discount_ck" CHECK ("sales_order_lines"."discount_pct" BETWEEN 0 AND 100),
	CONSTRAINT "sales_order_lines_done_ck" CHECK ("sales_order_lines"."dispatched_m" >= 0 AND "sales_order_lines"."invoiced_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid NOT NULL,
	"so_no" text NOT NULL,
	"date" date NOT NULL,
	"status" "so_status" DEFAULT 'Draft' NOT NULL,
	"regime" "gst_regime" NOT NULL,
	"place_of_supply" text NOT NULL,
	"shipping_address_id" uuid,
	"salesman_id" uuid,
	"customer_ref" text,
	"charges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gross" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bill_discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(8, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit_check" jsonb,
	"held_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"released_at" timestamp with time zone,
	"released_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_return_rolls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" uuid NOT NULL,
	"si_roll_id" uuid NOT NULL,
	"roll_id" uuid NOT NULL,
	"dispatched_m" integer NOT NULL,
	"returned_m" integer NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"cost" numeric(14, 2),
	"outcome" "return_outcome",
	"inspected_at" timestamp with time zone,
	"inspected_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "sales_return_rolls_length_ck" CHECK ("sales_return_rolls"."returned_m" > 0 AND "sales_return_rolls"."returned_m" <= "sales_return_rolls"."dispatched_m")
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid NOT NULL,
	"sr_no" text,
	"si_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "purchase_doc_status" DEFAULT 'Draft' NOT NULL,
	"reason" text NOT NULL,
	"gross" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bill_discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(8, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rolls" ADD COLUMN "label_reprint_due" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_note_lines" ADD CONSTRAINT "customer_note_lines_note_id_customer_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."customer_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_si_id_sales_invoices_id_fk" FOREIGN KEY ("si_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_sales_return_id_sales_returns_id_fk" FOREIGN KEY ("sales_return_id") REFERENCES "public"."sales_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challan_rolls" ADD CONSTRAINT "delivery_challan_rolls_dc_id_delivery_challans_id_fk" FOREIGN KEY ("dc_id") REFERENCES "public"."delivery_challans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challan_rolls" ADD CONSTRAINT "delivery_challan_rolls_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challan_rolls" ADD CONSTRAINT "delivery_challan_rolls_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_requests" ADD CONSTRAINT "einvoice_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_lines" ADD CONSTRAINT "proforma_lines_proforma_id_proformas_id_fk" FOREIGN KEY ("proforma_id") REFERENCES "public"."proformas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_lines" ADD CONSTRAINT "proforma_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_cuts" ADD CONSTRAINT "roll_cuts_parent_roll_id_rolls_id_fk" FOREIGN KEY ("parent_roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_cuts" ADD CONSTRAINT "roll_cuts_child_roll_id_rolls_id_fk" FOREIGN KEY ("child_roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_cuts" ADD CONSTRAINT "roll_cuts_dc_id_delivery_challans_id_fk" FOREIGN KEY ("dc_id") REFERENCES "public"."delivery_challans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_cuts" ADD CONSTRAINT "roll_cuts_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_length_changes" ADD CONSTRAINT "roll_length_changes_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_dcs" ADD CONSTRAINT "sales_invoice_dcs_si_id_sales_invoices_id_fk" FOREIGN KEY ("si_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_dcs" ADD CONSTRAINT "sales_invoice_dcs_dc_id_delivery_challans_id_fk" FOREIGN KEY ("dc_id") REFERENCES "public"."delivery_challans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_si_id_sales_invoices_id_fk" FOREIGN KEY ("si_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_proforma_line_id_proforma_lines_id_fk" FOREIGN KEY ("proforma_line_id") REFERENCES "public"."proforma_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_rolls" ADD CONSTRAINT "sales_invoice_rolls_si_id_sales_invoices_id_fk" FOREIGN KEY ("si_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_rolls" ADD CONSTRAINT "sales_invoice_rolls_si_line_id_sales_invoice_lines_id_fk" FOREIGN KEY ("si_line_id") REFERENCES "public"."sales_invoice_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_rolls" ADD CONSTRAINT "sales_invoice_rolls_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_proforma_id_proformas_id_fk" FOREIGN KEY ("proforma_id") REFERENCES "public"."proformas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_shipping_address_id_customer_shipping_addresses_id_fk" FOREIGN KEY ("shipping_address_id") REFERENCES "public"."customer_shipping_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salesman_id_salesmen_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."salesmen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_rolls" ADD CONSTRAINT "sales_return_rolls_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_rolls" ADD CONSTRAINT "sales_return_rolls_si_roll_id_sales_invoice_rolls_id_fk" FOREIGN KEY ("si_roll_id") REFERENCES "public"."sales_invoice_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_rolls" ADD CONSTRAINT "sales_return_rolls_roll_id_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_rolls" ADD CONSTRAINT "sales_return_rolls_inspected_by_user_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_si_id_sales_invoices_id_fk" FOREIGN KEY ("si_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_note_lines_no_uq" ON "customer_note_lines" USING btree ("note_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notes_no_uq" ON "customer_notes" USING btree ("company_id","kind","note_no") WHERE "customer_notes"."note_no" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notes_irn_uq" ON "customer_notes" USING btree ("irn") WHERE "customer_notes"."irn" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notes_return_uq" ON "customer_notes" USING btree ("sales_return_id") WHERE "customer_notes"."sales_return_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("customer_id","date");--> statement-breakpoint
CREATE INDEX "customer_notes_si_idx" ON "customer_notes" USING btree ("si_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_challan_rolls_uq" ON "delivery_challan_rolls" USING btree ("dc_id","roll_id");--> statement-breakpoint
CREATE INDEX "delivery_challan_rolls_roll_idx" ON "delivery_challan_rolls" USING btree ("roll_id");--> statement-breakpoint
CREATE INDEX "delivery_challan_rolls_line_idx" ON "delivery_challan_rolls" USING btree ("so_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_challans_no_uq" ON "delivery_challans" USING btree ("company_id","dc_no");--> statement-breakpoint
CREATE INDEX "delivery_challans_so_idx" ON "delivery_challans" USING btree ("so_id");--> statement-breakpoint
CREATE INDEX "delivery_challans_customer_idx" ON "delivery_challans" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "einvoice_requests_doc_idx" ON "einvoice_requests" USING btree ("doc_type","doc_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proforma_lines_no_uq" ON "proforma_lines" USING btree ("proforma_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "proformas_no_uq" ON "proformas" USING btree ("company_id","proforma_no");--> statement-breakpoint
CREATE INDEX "proformas_customer_idx" ON "proformas" USING btree ("customer_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "roll_cuts_child_uq" ON "roll_cuts" USING btree ("child_roll_id");--> statement-breakpoint
CREATE INDEX "roll_cuts_parent_idx" ON "roll_cuts" USING btree ("parent_roll_id");--> statement-breakpoint
CREATE INDEX "roll_length_changes_roll_idx" ON "roll_length_changes" USING btree ("roll_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_invoice_dcs_dc_idx" ON "sales_invoice_dcs" USING btree ("dc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_lines_no_uq" ON "sales_invoice_lines" USING btree ("si_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_so_line_idx" ON "sales_invoice_lines" USING btree ("so_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_rolls_uq" ON "sales_invoice_rolls" USING btree ("si_id","roll_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_rolls_roll_idx" ON "sales_invoice_rolls" USING btree ("roll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_no_uq" ON "sales_invoices" USING btree ("company_id","si_no") WHERE "sales_invoices"."si_no" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_irn_uq" ON "sales_invoices" USING btree ("irn") WHERE "sales_invoices"."irn" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_invoices_customer_idx" ON "sales_invoices" USING btree ("customer_id","date");--> statement-breakpoint
CREATE INDEX "sales_invoices_status_idx" ON "sales_invoices" USING btree ("company_id","status","date");--> statement-breakpoint
CREATE INDEX "sales_invoices_einvoice_idx" ON "sales_invoices" USING btree ("einvoice_status") WHERE "sales_invoices"."einvoice_status" IN ('Pending','Failed');--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_lines_no_uq" ON "sales_order_lines" USING btree ("so_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_order_lines_sku_idx" ON "sales_order_lines" USING btree ("sku_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_no_uq" ON "sales_orders" USING btree ("company_id","so_no");--> statement-breakpoint
CREATE INDEX "sales_orders_customer_idx" ON "sales_orders" USING btree ("customer_id","date");--> statement-breakpoint
CREATE INDEX "sales_orders_status_idx" ON "sales_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_return_rolls_open_uq" ON "sales_return_rolls" USING btree ("roll_id") WHERE "sales_return_rolls"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sales_return_rolls_return_idx" ON "sales_return_rolls" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_returns_no_uq" ON "sales_returns" USING btree ("company_id","sr_no") WHERE "sales_returns"."sr_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_returns_si_idx" ON "sales_returns" USING btree ("si_id");--> statement-breakpoint
CREATE INDEX "sales_returns_customer_idx" ON "sales_returns" USING btree ("customer_id","date");