CREATE TYPE "public"."trip_leg" AS ENUM('outbound', 'return');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('scheduled', 'en_route', 'arrived', 'on_board', 'completed', 'no_show', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TABLE "trip_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"location" geometry(Point,4326) NOT NULL,
	"speed_kmh" integer,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"driver_id" uuid,
	"service_date" date NOT NULL,
	"leg" "trip_leg" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"pickup" geometry(Point,4326) NOT NULL,
	"pickup_name" varchar(80) NOT NULL,
	"dropoff" geometry(Point,4326) NOT NULL,
	"dropoff_name" varchar(80) NOT NULL,
	"status" "trip_status" DEFAULT 'scheduled' NOT NULL,
	"started_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"ended_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "driver_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_points" ADD CONSTRAINT "trip_points_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_points_trip_idx" ON "trip_points" USING btree ("trip_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_subscription_day_leg_uq" ON "trips" USING btree ("subscription_id","service_date","leg");--> statement-breakpoint
CREATE INDEX "trips_partner_day_idx" ON "trips" USING btree ("partner_id","service_date");--> statement-breakpoint
CREATE INDEX "trips_driver_day_idx" ON "trips" USING btree ("driver_id","service_date");--> statement-breakpoint
CREATE INDEX "trips_rider_day_idx" ON "trips" USING btree ("rider_id","service_date");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_driver_idx" ON "subscriptions" USING btree ("driver_id");