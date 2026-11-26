CREATE TYPE "public"."organization_credit_kind" AS ENUM('compensation', 'cancellation');--> statement-breakpoint
CREATE TABLE "organization_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"kind" "organization_credit_kind" NOT NULL,
	"amount_halalas" integer NOT NULL,
	"key" varchar(120) NOT NULL,
	"subscription_id" uuid,
	"trip_id" uuid,
	"note_ar" varchar(200) NOT NULL,
	"note_en" varchar(200) NOT NULL,
	"org_invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_credits_amount_ck" CHECK ("organization_credits"."amount_halalas" > 0)
);
--> statement-breakpoint
CREATE TABLE "organization_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_invoice_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount_halalas" integer NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_payment_id" varchar(120),
	"checkout_url" varchar(2048),
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"failure_reason" varchar(200),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organization_invoices" ADD COLUMN "gross_halalas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invoices" ADD COLUMN "credit_halalas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_credits" ADD CONSTRAINT "organization_credits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_credits" ADD CONSTRAINT "organization_credits_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_credits" ADD CONSTRAINT "organization_credits_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_credits" ADD CONSTRAINT "organization_credits_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_credits" ADD CONSTRAINT "organization_credits_org_invoice_id_organization_invoices_id_fk" FOREIGN KEY ("org_invoice_id") REFERENCES "public"."organization_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_payments" ADD CONSTRAINT "organization_payments_org_invoice_id_organization_invoices_id_fk" FOREIGN KEY ("org_invoice_id") REFERENCES "public"."organization_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_payments" ADD CONSTRAINT "organization_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_payments" ADD CONSTRAINT "organization_payments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_payments" ADD CONSTRAINT "organization_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_credits_key_uq" ON "organization_credits" USING btree ("key");--> statement-breakpoint
CREATE INDEX "organization_credits_open_idx" ON "organization_credits" USING btree ("organization_id","org_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_payments_provider_uq" ON "organization_payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "organization_payments_invoice_idx" ON "organization_payments" USING btree ("org_invoice_id");--> statement-breakpoint
UPDATE "organization_invoices" SET "gross_halalas" = "total_halalas" WHERE "gross_halalas" = 0;
