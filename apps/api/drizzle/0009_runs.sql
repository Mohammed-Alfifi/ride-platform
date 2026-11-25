CREATE TYPE "public"."run_status" AS ENUM('planned', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_stop_kind" AS ENUM('pickup', 'dropoff');--> statement-breakpoint
CREATE TABLE "run_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "run_stop_kind" NOT NULL,
	"planned_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"leg" "trip_leg" NOT NULL,
	"status" "run_status" DEFAULT 'planned' NOT NULL,
	"planned_start_at" timestamp with time zone NOT NULL,
	"planned_end_at" timestamp with time zone NOT NULL,
	"drive_seconds" integer NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"optimizer" varchar(20) NOT NULL,
	"routing" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_stops" ADD CONSTRAINT "run_stops_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_stops" ADD CONSTRAINT "run_stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_stops_run_seq_uq" ON "run_stops" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "run_stops_trip_kind_uq" ON "run_stops" USING btree ("trip_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_driver_day_leg_uq" ON "runs" USING btree ("driver_id","service_date","leg");--> statement-breakpoint
CREATE INDEX "runs_partner_day_idx" ON "runs" USING btree ("partner_id","service_date");