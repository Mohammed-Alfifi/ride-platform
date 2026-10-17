CREATE TYPE "public"."payment_purpose" AS ENUM('start', 'renewal');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."place_label" AS ENUM('home', 'school', 'work', 'other');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending_payment', 'active', 'past_due', 'paused', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"seller_name" varchar(200) NOT NULL,
	"seller_vat_number" varchar(15),
	"buyer_name" varchar(160),
	"description" varchar(255) NOT NULL,
	"total_halalas" integer NOT NULL,
	"vat_halalas" integer NOT NULL,
	"qr_tlv" varchar(600),
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"brand" varchar(20) NOT NULL,
	"last4" varchar(4) NOT NULL,
	"exp_month" integer,
	"exp_year" integer,
	"provider_customer_id" varchar(80),
	"provider_card_id" varchar(80) NOT NULL,
	"provider_agreement_id" varchar(80),
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_payment_id" varchar(80),
	"checkout_url" varchar(500),
	"amount_halalas" integer NOT NULL,
	"platform_fee_halalas" integer NOT NULL,
	"partner_share_halalas" integer NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"failure_reason" varchar(200),
	"idempotency_key" varchar(120),
	"period_start" date,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"label" "place_label" NOT NULL,
	"name" varchar(80) NOT NULL,
	"location" geometry(Point,4326) NOT NULL,
	"address" varchar(255),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"pickup_place_id" uuid NOT NULL,
	"dropoff_place_id" uuid NOT NULL,
	"days" integer[] NOT NULL,
	"outbound_time" varchar(5) NOT NULL,
	"return_time" varchar(5),
	"distance_km" integer NOT NULL,
	"price_halalas" integer NOT NULL,
	"status" "subscription_status" DEFAULT 'pending_payment' NOT NULL,
	"current_period_start" date,
	"current_period_end" date,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"paused_from" date,
	"paused_until" date,
	"renewal_attempts" integer DEFAULT 0 NOT NULL,
	"payment_method_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "vat_number" varchar(15);--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "gateway_account_id" varchar(80);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pickup_place_id_places_id_fk" FOREIGN KEY ("pickup_place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_dropoff_place_id_places_id_fk" FOREIGN KEY ("dropoff_place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_payment_uq" ON "invoices" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "payment_methods_rider_idx" ON "payment_methods" USING btree ("rider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_card_uq" ON "payment_methods" USING btree ("provider","provider_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_uq" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_uq" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_partner_idx" ON "payments" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_subscription_idx" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "places_rider_idx" ON "places" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "subscriptions_rider_idx" ON "subscriptions" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "subscriptions_partner_idx" ON "subscriptions" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_renewal_idx" ON "subscriptions" USING btree ("status","current_period_end");