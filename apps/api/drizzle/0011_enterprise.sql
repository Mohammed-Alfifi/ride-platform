CREATE TYPE "public"."organization_invoice_status" AS ENUM('issued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."organization_kind" AS ENUM('company', 'school');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'org_admin';--> statement-breakpoint
CREATE TABLE "organization_invoice_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"number" varchar(30) NOT NULL,
	"seller_name" varchar(200) NOT NULL,
	"seller_vat_number" varchar(15),
	"buyer_name" varchar(200) NOT NULL,
	"buyer_vat_number" varchar(15),
	"buyer_cr_number" varchar(20),
	"lines" integer NOT NULL,
	"total_halalas" integer NOT NULL,
	"vat_halalas" integer NOT NULL,
	"platform_fee_halalas" integer NOT NULL,
	"partner_share_halalas" integer NOT NULL,
	"qr_tlv" varchar(600),
	"status" "organization_invoice_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"method" varchar(20),
	"reference" varchar(80),
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"phone" varchar(16) NOT NULL,
	"name" varchar(120) NOT NULL,
	"reference" varchar(60),
	"added_by" uuid,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"name_ar" varchar(160) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"cr_number" varchar(20),
	"vat_number" varchar(15),
	"address" varchar(200),
	"contact_phone" varchar(16),
	"coverage_bps" integer NOT NULL,
	"plan_ids" uuid[] NOT NULL,
	"status" "partner_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_coverage_ck" CHECK ("organizations"."coverage_bps" BETWEEN 100 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_partner_role_ck";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_audience_ck";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "org_halalas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "org_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "org_share_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_invoices" ADD CONSTRAINT "organization_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invoices" ADD CONSTRAINT "organization_invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invoices" ADD CONSTRAINT "organization_invoices_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invoices_month_uq" ON "organization_invoices" USING btree ("organization_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invoices_number_uq" ON "organization_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "organization_invoices_partner_idx" ON "organization_invoices" USING btree ("partner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_phone_uq" ON "organization_members" USING btree ("partner_id","phone") WHERE "organization_members"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "organization_members_org_idx" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizations_partner_idx" ON "organizations" USING btree ("partner_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_invoice_id_organization_invoices_id_fk" FOREIGN KEY ("org_invoice_id") REFERENCES "public"."organization_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_org_idx" ON "payments" USING btree ("organization_id","org_invoice_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_partner_role_ck" CHECK (("users"."role"::text IN ('partner_admin','dispatcher') AND "users"."partner_id" IS NOT NULL)
        OR ("users"."role"::text = 'super_admin' AND "users"."partner_id" IS NULL)
        OR ("users"."role"::text = 'org_admin' AND "users"."partner_id" IS NULL AND "users"."organization_id" IS NOT NULL)
        OR "users"."role"::text IN ('rider','driver'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_audience_ck" CHECK (("users"."role"::text = 'rider' AND "users"."audience" = 'rider')
        OR ("users"."role"::text = 'driver' AND "users"."audience" = 'driver')
        OR ("users"."role"::text IN ('partner_admin','dispatcher','super_admin','org_admin') AND "users"."audience" = 'admin'));