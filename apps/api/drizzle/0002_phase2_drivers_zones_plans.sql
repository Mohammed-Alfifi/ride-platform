CREATE TYPE "public"."document_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('national_id', 'driving_license', 'driver_photo', 'vehicle_registration', 'vehicle_insurance', 'periodic_inspection');--> statement-breakpoint
CREATE TYPE "public"."driver_onboarding_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."plan_trip_type" AS ENUM('round_trip', 'one_way');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"mime" varchar(60) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"expires_at" date,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" varchar(300),
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid,
	"full_name" varchar(120),
	"national_id_encrypted" varchar(200),
	"national_id_hash" varchar(64),
	"national_id_last4" varchar(4),
	"date_of_birth" date,
	"saudi_confirmed" boolean DEFAULT false NOT NULL,
	"status" "driver_onboarding_status" DEFAULT 'draft' NOT NULL,
	"rejection_reason" varchar(500),
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"compliance_hold" boolean DEFAULT false NOT NULL,
	"compliance_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(60) NOT NULL,
	"title_ar" varchar(160) NOT NULL,
	"title_en" varchar(160) NOT NULL,
	"body_ar" varchar(500) NOT NULL,
	"body_en" varchar(500) NOT NULL,
	"data" jsonb,
	"dedupe_key" varchar(160),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"name_ar" varchar(120) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"trip_type" "plan_trip_type" NOT NULL,
	"days_per_week" integer NOT NULL,
	"price_halalas" integer NOT NULL,
	"max_distance_km" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_days_ck" CHECK ("plans"."days_per_week" BETWEEN 1 AND 7),
	CONSTRAINT "plans_price_ck" CHECK ("plans"."price_halalas" > 0),
	CONSTRAINT "plans_distance_ck" CHECK ("plans"."max_distance_km" BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"plate_letters" varchar(3) NOT NULL,
	"plate_numbers" varchar(4) NOT NULL,
	"make" varchar(60) NOT NULL,
	"model" varchar(60) NOT NULL,
	"year" integer NOT NULL,
	"color" varchar(30) NOT NULL,
	"seats" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_seats_ck" CHECK ("vehicles"."seats" BETWEEN 1 AND 14)
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"name_ar" varchar(120) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"area" geometry(Polygon,4326) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "join_code" varchar(8);--> statement-breakpoint
UPDATE "partners" SET "join_code" = upper(substr(md5(gen_random_uuid()::text), 1, 6)) WHERE "join_code" IS NULL;--> statement-breakpoint
ALTER TABLE "partners" ALTER COLUMN "join_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_driver_idx" ON "documents" USING btree ("driver_id","type");--> statement-breakpoint
CREATE INDEX "documents_expiry_idx" ON "documents" USING btree ("expires_at") WHERE "documents"."superseded_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_current_uq" ON "documents" USING btree ("driver_id","type") WHERE "documents"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "driver_profiles_partner_idx" ON "driver_profiles" USING btree ("partner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_profiles_national_id_uq" ON "driver_profiles" USING btree ("national_id_hash");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "plans_zone_idx" ON "plans" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_driver_uq" ON "vehicles" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_uq" ON "vehicles" USING btree ("plate_letters","plate_numbers");--> statement-breakpoint
CREATE INDEX "vehicles_partner_idx" ON "vehicles" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "zones_partner_idx" ON "zones" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "zones_area_gix" ON "zones" USING gist ("area");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_join_code_uq" ON "partners" USING btree ("join_code");