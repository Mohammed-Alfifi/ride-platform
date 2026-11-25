CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."service_class" AS ENUM('commute', 'education');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'professional_driver_card';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'criminal_record';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'operating_card';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'first_aid_certificate';--> statement-breakpoint
CREATE TABLE "partner_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"service_class" "service_class" NOT NULL,
	"license_number" varchar(40) NOT NULL,
	"unified_code" varchar(40),
	"expires_at" date NOT NULL,
	"min_price_halalas" integer,
	"max_price_halalas" integer,
	"pricing_reference" varchar(80),
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_licenses_price_ck" CHECK ("partner_licenses"."min_price_halalas" IS NULL OR "partner_licenses"."max_price_halalas" IS NULL OR "partner_licenses"."min_price_halalas" <= "partner_licenses"."max_price_halalas")
);
--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "gender" "gender";--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "service_class" "service_class" DEFAULT 'commute' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "women_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "requires_escort" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "passenger_gender" "gender";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "women_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "shared_ride_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "contract_version" varchar(20);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "contract_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cabin_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" "gender";--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "escort_name" varchar(120);--> statement-breakpoint
ALTER TABLE "partner_licenses" ADD CONSTRAINT "partner_licenses_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_licenses" ADD CONSTRAINT "partner_licenses_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_licenses_class_uq" ON "partner_licenses" USING btree ("partner_id","service_class");