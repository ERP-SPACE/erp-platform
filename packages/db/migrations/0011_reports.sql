CREATE TYPE "public"."export_format" AS ENUM('csv', 'xlsx', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('Queued', 'Running', 'Ready', 'Failed', 'Expired');--> statement-breakpoint
CREATE TABLE "report_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"format" "export_format" NOT NULL,
	"request" jsonb NOT NULL,
	"includes_cost" boolean DEFAULT false NOT NULL,
	"status" "export_status" DEFAULT 'Queued' NOT NULL,
	"storage_key" text,
	"row_count" integer,
	"size_bytes" bigint,
	"error" text,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "report_exports_ready_ck" CHECK ("report_exports"."status" <> 'Ready' OR ("report_exports"."storage_key" IS NOT NULL AND "report_exports"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "saved_pivots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"range" text DEFAULT 'custom' NOT NULL,
	"shared_with_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_pivots" ADD CONSTRAINT "saved_pivots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_pivots" ADD CONSTRAINT "saved_pivots_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_exports_user_idx" ON "report_exports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "report_exports_expiry_idx" ON "report_exports" USING btree ("expires_at") WHERE "report_exports"."status" = 'Ready';--> statement-breakpoint
CREATE UNIQUE INDEX "saved_pivots_owner_name_uq" ON "saved_pivots" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "saved_pivots_shared_idx" ON "saved_pivots" USING gin ("shared_with_roles");