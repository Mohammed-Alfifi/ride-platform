CREATE TYPE "public"."join_kind" AS ENUM('rider', 'driver');--> statement-breakpoint
CREATE TYPE "public"."join_status" AS ENUM('new', 'invited', 'declined');--> statement-breakpoint
CREATE TABLE "access_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(16) NOT NULL,
	"audience" "user_audience" NOT NULL,
	"name" varchar(120),
	"partner_id" uuid,
	"join_request_id" uuid,
	"code_hash" varchar(128),
	"code_expires_at" timestamp with time zone,
	"code_failures" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(400) NOT NULL,
	"platform" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "join_kind" NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(16) NOT NULL,
	"city" varchar(60) NOT NULL,
	"district" varchar(80),
	"destination" varchar(120),
	"morning_time" varchar(5),
	"return_time" varchar(5),
	"riders" integer,
	"car" varchar(80),
	"note" varchar(500),
	"status" "join_status" DEFAULT 'new' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method" varchar(20) DEFAULT 'gateway' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reference" varchar(80);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_invites" ADD CONSTRAINT "access_invites_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_invites" ADD CONSTRAINT "access_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_invites_phone_uq" ON "access_invites" USING btree ("phone","audience") WHERE "access_invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "access_invites_partner_idx" ON "access_invites" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_uq" ON "device_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "device_tokens_user_idx" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "join_requests_status_idx" ON "join_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "join_requests_phone_idx" ON "join_requests" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;