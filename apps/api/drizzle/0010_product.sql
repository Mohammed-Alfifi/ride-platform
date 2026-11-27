CREATE TYPE "public"."pickup_mode" AS ENUM('door', 'meeting_point');--> statement-breakpoint
CREATE TYPE "public"."wallet_kind" AS ENUM('compensation', 'refund', 'redeem', 'adjustment');--> statement-breakpoint
CREATE TABLE "meeting_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"name_ar" varchar(120) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"location" geometry(Point,4326) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"kind" "wallet_kind" NOT NULL,
	"amount_halalas" integer NOT NULL,
	"trip_id" uuid,
	"subscription_id" uuid,
	"payment_id" uuid,
	"note_ar" varchar(200) NOT NULL,
	"note_en" varchar(200) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_entries_amount_ck" CHECK ("wallet_entries"."amount_halalas" <> 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "wallet_halalas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "pickup_mode" "pickup_mode" DEFAULT 'door' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "period_days" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "renewable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "once_per_rider" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "meeting_point_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "period_days" integer;--> statement-breakpoint
ALTER TABLE "meeting_points" ADD CONSTRAINT "meeting_points_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_points" ADD CONSTRAINT "meeting_points_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_points_zone_idx" ON "meeting_points" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "meeting_points_location_gix" ON "meeting_points" USING gist ("location");--> statement-breakpoint
CREATE INDEX "wallet_entries_rider_idx" ON "wallet_entries" USING btree ("rider_id","partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_entries_trip_uq" ON "wallet_entries" USING btree ("trip_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_entries_payment_uq" ON "wallet_entries" USING btree ("payment_id","kind");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_meeting_point_id_meeting_points_id_fk" FOREIGN KEY ("meeting_point_id") REFERENCES "public"."meeting_points"("id") ON DELETE set null ON UPDATE no action;