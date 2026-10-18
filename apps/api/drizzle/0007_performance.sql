DROP INDEX "trips_partner_day_idx";--> statement-breakpoint
CREATE INDEX "trips_driver_active_idx" ON "trips" USING btree ("driver_id") WHERE "trips"."status" IN ('en_route', 'arrived', 'on_board');--> statement-breakpoint
CREATE INDEX "trips_partner_day_status_idx" ON "trips" USING btree ("partner_id","service_date","status");