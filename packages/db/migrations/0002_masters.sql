CREATE TYPE "public"."block_rule" AS ENUM('OVER_LIMIT', 'OVER_DUE', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."gst_type" AS ENUM('Regular', 'Composition', 'Unregistered', 'SEZ');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_language" AS ENUM('English', 'Hindi', 'Gujarati');--> statement-breakpoint
CREATE TYPE "public"."rate_source" AS ENUM('manual', 'bulk_revision', 'salesman_default');--> statement-breakpoint
CREATE TYPE "public"."commission_method" AS ENUM('PER_METER', 'PERCENT_SALES');--> statement-breakpoint
CREATE TYPE "public"."commission_trigger" AS ENUM('ON_SI_POSTED', 'ON_PAYMENT_RECEIVED');--> statement-breakpoint
CREATE TYPE "public"."salesman_block_mode" AS ENUM('None', 'All', 'Selective');--> statement-breakpoint
CREATE TABLE "master_sequences" (
	"company_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"prefix" text NOT NULL,
	"padding" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "master_sequences_company_id_entity_pk" PRIMARY KEY("company_id","entity")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"hsn_code" text,
	"gst_rate" numeric(5, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "categories_hsn_ck" CHECK ("categories"."hsn_code" IS NULL OR "categories"."hsn_code" ~ '^[0-9]{4}([0-9]{2}){0,2}$')
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"quality_id" uuid NOT NULL,
	"gsm" integer NOT NULL,
	"default_length_m" integer DEFAULT 1000 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "products_gsm_ck" CHECK ("products"."gsm" > 0),
	CONSTRAINT "products_length_ck" CHECK ("products"."default_length_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "qualities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"width_in" numeric(5, 2) NOT NULL,
	"tax_rate_override" numeric(5, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "skus_width_ck" CHECK ("skus"."width_in" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_policies" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"credit_limit" numeric(14, 2) NOT NULL,
	"credit_days" integer NOT NULL,
	"grace_days" integer NOT NULL,
	"auto_block" boolean DEFAULT true NOT NULL,
	"block_rule" "block_rule" DEFAULT 'BOTH' NOT NULL,
	"manual_block" boolean DEFAULT false NOT NULL,
	"block_reason" text,
	"blocked_at" timestamp with time zone,
	"blocked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "credit_policies_limit_ck" CHECK ("credit_policies"."credit_limit" >= 0),
	CONSTRAINT "credit_policies_days_ck" CHECK ("credit_policies"."credit_days" >= 0 AND "credit_policies"."grace_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_group_members" (
	"customer_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "customer_group_members_customer_id_group_id_pk" PRIMARY KEY("customer_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_shipping_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address" jsonb NOT NULL,
	"state_code" char(2) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"gst_type" "gst_type" DEFAULT 'Regular' NOT NULL,
	"gstin" char(15),
	"state_code" char(2) NOT NULL,
	"pan" char(10),
	"billing_address" jsonb NOT NULL,
	"phone" text,
	"email" text,
	"business_type" text,
	"monthly_capacity_m" integer,
	"target_sales_m" integer,
	"referral" jsonb,
	"tcs_applicable" boolean DEFAULT false NOT NULL,
	"whatsapp_number" text,
	"whatsapp_language" "whatsapp_language" DEFAULT 'English' NOT NULL,
	"whatsapp_consent" boolean DEFAULT false NOT NULL,
	"whatsapp_consent_at" timestamp with time zone,
	"whatsapp_consent_by" text,
	"allow_cut" boolean DEFAULT true NOT NULL,
	"salesman_id" uuid,
	"account_manager_user_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "customers_gstin_required_ck" CHECK ("customers"."gst_type" IN ('Unregistered') OR "customers"."gstin" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"short_code" char(3) NOT NULL,
	"name" text NOT NULL,
	"gstin" char(15),
	"state_code" char(2) NOT NULL,
	"pan" char(10),
	"address" jsonb NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"payment_days" integer DEFAULT 30 NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transporters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"gstin" char(15),
	"transporter_id" text,
	"state_code" char(2) NOT NULL,
	"phone" text,
	"contact_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"base_rate_44" numeric(12, 4) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" "rate_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "party_rates_rate_ck" CHECK ("party_rates"."base_rate_44" >= 0),
	CONSTRAINT "party_rates_range_ck" CHECK ("party_rates"."valid_to" IS NULL OR "party_rates"."valid_to" >= "party_rates"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "rate_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"previous_rate_44" numeric(12, 4),
	"new_rate_44" numeric(12, 4) NOT NULL,
	"valid_from" date NOT NULL,
	"source" "rate_source" NOT NULL,
	"reason" text,
	"so_id" uuid,
	"si_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"salesman_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"method" "commission_method" NOT NULL,
	"rate" numeric(12, 4) NOT NULL,
	"trigger_event" "commission_trigger" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "commission_rules_rate_ck" CHECK ("commission_rules"."rate" >= 0),
	CONSTRAINT "commission_rules_range_ck" CHECK ("commission_rules"."valid_to" IS NULL OR "commission_rules"."valid_to" >= "commission_rules"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "salesman_blocked_customers" (
	"salesman_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	CONSTRAINT "salesman_blocked_customers_salesman_id_customer_id_pk" PRIMARY KEY("salesman_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "salesman_default_rates" (
	"salesman_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"base_rate_44" numeric(12, 4) NOT NULL,
	CONSTRAINT "salesman_default_rates_salesman_id_product_id_pk" PRIMARY KEY("salesman_id","product_id"),
	CONSTRAINT "salesman_default_rates_ck" CHECK ("salesman_default_rates"."base_rate_44" >= 0)
);
--> statement-breakpoint
CREATE TABLE "salesman_kyc_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"salesman_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "salesman_kyc_documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "salesmen" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"whatsapp" text,
	"email" text,
	"address" jsonb,
	"state_code" char(2),
	"target_sales_m" integer,
	"block_mode" "salesman_block_mode" DEFAULT 'None' NOT NULL,
	"default_credit_limit" numeric(14, 2),
	"default_credit_days" integer,
	"default_grace_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "master_sequences" ADD CONSTRAINT "master_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_quality_id_qualities_id_fk" FOREIGN KEY ("quality_id") REFERENCES "public"."qualities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualities" ADD CONSTRAINT "qualities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_policies" ADD CONSTRAINT "credit_policies_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group_members" ADD CONSTRAINT "customer_group_members_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group_members" ADD CONSTRAINT "customer_group_members_group_id_customer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_shipping_addresses" ADD CONSTRAINT "customer_shipping_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_account_manager_user_id_user_id_fk" FOREIGN KEY ("account_manager_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transporters" ADD CONSTRAINT "transporters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_rates" ADD CONSTRAINT "party_rates_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_rates" ADD CONSTRAINT "party_rates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_salesman_id_salesmen_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."salesmen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesman_blocked_customers" ADD CONSTRAINT "salesman_blocked_customers_salesman_id_salesmen_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."salesmen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesman_blocked_customers" ADD CONSTRAINT "salesman_blocked_customers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesman_default_rates" ADD CONSTRAINT "salesman_default_rates_salesman_id_salesmen_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."salesmen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesman_default_rates" ADD CONSTRAINT "salesman_default_rates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesman_kyc_documents" ADD CONSTRAINT "salesman_kyc_documents_salesman_id_salesmen_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."salesmen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesmen" ADD CONSTRAINT "salesmen_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_company_code_uq" ON "categories" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "products_unique_triple_uq" ON "products" USING btree ("category_id","quality_id","gsm");--> statement-breakpoint
CREATE UNIQUE INDEX "qualities_company_name_uq" ON "qualities" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "skus_product_width_uq" ON "skus" USING btree ("product_id","width_in");--> statement-breakpoint
CREATE UNIQUE INDEX "skus_company_code_uq" ON "skus" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "skus_product_idx" ON "skus" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "customer_contacts_customer_idx" ON "customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contacts_one_primary_uq" ON "customer_contacts" USING btree ("customer_id") WHERE "customer_contacts"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "customer_groups_company_code_uq" ON "customer_groups" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "customer_shipping_customer_idx" ON "customer_shipping_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_shipping_one_default_uq" ON "customer_shipping_addresses" USING btree ("customer_id") WHERE "customer_shipping_addresses"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_code_uq" ON "customers" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_gstin_uq" ON "customers" USING btree ("company_id","gstin") WHERE "customers"."gstin" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customers_salesman_idx" ON "customers" USING btree ("salesman_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_code_uq" ON "suppliers" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_short_code_uq" ON "suppliers" USING btree ("company_id","short_code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_gstin_uq" ON "suppliers" USING btree ("company_id","gstin") WHERE "suppliers"."gstin" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transporters_company_code_uq" ON "transporters" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "party_rates_customer_product_idx" ON "party_rates" USING btree ("customer_id","product_id","valid_from");--> statement-breakpoint
CREATE INDEX "rate_history_customer_idx" ON "rate_history" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "commission_rules_salesman_idx" ON "commission_rules" USING btree ("salesman_id","customer_id");--> statement-breakpoint
CREATE INDEX "salesman_kyc_salesman_idx" ON "salesman_kyc_documents" USING btree ("salesman_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salesmen_company_code_uq" ON "salesmen" USING btree ("company_id","code");