CREATE TYPE "public"."user_audience" AS ENUM('rider', 'driver', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_locale" AS ENUM('ar', 'en');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('rider', 'driver', 'partner_admin', 'dispatcher', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'pending', 'suspended');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"partner_id" uuid,
	"action" varchar(80) NOT NULL,
	"entity" varchar(60) NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" varchar(160) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"legal_name" varchar(200),
	"cr_number" varchar(20),
	"tga_license_number" varchar(40),
	"contact_phone" varchar(16),
	"commission_bps" integer DEFAULT 0 NOT NULL,
	"status" "partner_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_commission_range" CHECK ("partners"."commission_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" varchar(255),
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(16) NOT NULL,
	"audience" "user_audience" NOT NULL,
	"role" "user_role" NOT NULL,
	"partner_id" uuid,
	"name" varchar(120),
	"locale" "user_locale" DEFAULT 'ar' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_partner_role_ck" CHECK (("users"."role" IN ('partner_admin','dispatcher') AND "users"."partner_id" IS NOT NULL)
        OR ("users"."role" = 'super_admin' AND "users"."partner_id" IS NULL)
        OR "users"."role" IN ('rider','driver')),
	CONSTRAINT "users_role_audience_ck" CHECK (("users"."role" = 'rider' AND "users"."audience" = 'rider')
        OR ("users"."role" = 'driver' AND "users"."audience" = 'driver')
        OR ("users"."role" IN ('partner_admin','dispatcher','super_admin') AND "users"."audience" = 'admin'))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_partner_idx" ON "audit_logs" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_cr_number_uq" ON "partners" USING btree ("cr_number");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_audience_uq" ON "users" USING btree ("phone","audience") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_partner_idx" ON "users" USING btree ("partner_id");