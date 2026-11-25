import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { addDays, riyadhToday } from '../common/saudi';
import { DB, Database } from '../database/database.module';
import { trips } from '../database/schema';

/**
 * Turns subscriptions into dated trips. Runs every night for today and tomorrow, and again for a
 * single subscription as soon as it is paid, paused, resumed or given a driver. Safe to repeat:
 * a trip is unique per subscription, day and leg.
 */
@Injectable()
export class TripGenerator {
  private readonly logger = new Logger(TripGenerator.name);
  private readonly listeners: ((driverIds: string[]) => Promise<unknown>)[] = [];

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Called with the drivers whose upcoming trips just changed (a rider joined, left, paused or
   * moved). The run planner listens so each car's order is redone. Never throws to the caller.
   */
  onDriversChanged(fn: (driverIds: string[]) => Promise<unknown>): void {
    this.listeners.push(fn);
  }

  async driversChanged(driverIds: (string | null | undefined)[]): Promise<void> {
    const ids = [...new Set(driverIds.filter((d): d is string => Boolean(d)))];
    if (ids.length === 0) return;
    for (const fn of this.listeners) {
      await fn(ids).catch((err: Error) => this.logger.error(`Re-planning runs failed: ${err.message}`));
    }
  }

  private async driverOf(subscriptionId: string): Promise<string | null> {
    const [row] = await this.db.execute<{ driver_id: string | null }>(sql`SELECT driver_id FROM subscriptions WHERE id = ${subscriptionId}`).then((r) => r.rows);
    return row?.driver_id ?? null;
  }

  async generate(opts: { from?: string; days?: number; subscriptionId?: string } = {}): Promise<number> {
    const from = opts.from ?? riyadhToday();
    const days = opts.days ?? 2;
    let created = 0;
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      created += await this.forDay(day, 'outbound', opts.subscriptionId);
      created += await this.forDay(day, 'return', opts.subscriptionId);
    }
    if (created > 0) this.logger.log(`Created ${created} trips from ${from} (${days} days)`);
    // One subscription's new trips change its driver's runs; the nightly run plans everyone after.
    if (opts.subscriptionId && created > 0) await this.driversChanged([await this.driverOf(opts.subscriptionId)]);
    return created;
  }

  private async forDay(day: string, leg: 'outbound' | 'return', subscriptionId?: string): Promise<number> {
    const outbound = leg === 'outbound';
    const time = outbound ? sql.raw('s.outbound_time') : sql.raw('s.return_time');
    // The return leg goes from the drop-off back to the pick-up.
    const [from, to] = outbound ? [sql.raw('p'), sql.raw('q')] : [sql.raw('q'), sql.raw('p')];
    const res = await this.db.execute(sql`
      INSERT INTO trips (subscription_id, partner_id, rider_id, driver_id, service_date, leg, scheduled_at,
                         pickup, pickup_name, dropoff, dropoff_name, passenger_name)
      SELECT s.id, s.partner_id, s.rider_id, s.driver_id, ${day}::date, ${leg}::trip_leg,
             ((${day}::text || ' ' || ${time})::timestamp AT TIME ZONE 'Asia/Riyadh'),
             ${from}.location, ${from}.name, ${to}.location, ${to}.name, m.name
      FROM subscriptions s
      LEFT JOIN family_members m ON m.id = s.member_id
      JOIN places p ON p.id = s.pickup_place_id
      JOIN places q ON q.id = s.dropoff_place_id
      WHERE s.status IN ('active', 'past_due')
        AND ${time} IS NOT NULL
        AND ${day}::date BETWEEN s.current_period_start AND s.current_period_end
        AND extract(dow FROM ${day}::date)::int = ANY(s.days)
        AND NOT (s.paused_from IS NOT NULL AND ${day}::date BETWEEN s.paused_from AND s.paused_until)
        ${subscriptionId ? sql`AND s.id = ${subscriptionId}` : sql``}
      ON CONFLICT (subscription_id, service_date, leg) DO NOTHING`);
    return res.rowCount ?? 0;
  }

  /** Cancels trips that have not started, from a day on (pause, expiry, cancellation). */
  async cancelFuture(subscriptionId: string, opts: { from: string; until?: string; reason: string }): Promise<number> {
    const rows = await this.db
      .update(trips)
      .set({ status: 'cancelled', endedReason: opts.reason })
      .where(
        and(
          eq(trips.subscriptionId, subscriptionId),
          eq(trips.status, 'scheduled'),
          gte(trips.serviceDate, opts.from),
          opts.until ? sql`${trips.serviceDate} <= ${opts.until}` : undefined,
        ),
      )
      .returning({ id: trips.id, driverId: trips.driverId });
    if (rows.length > 0) await this.driversChanged(rows.map((r) => r.driverId));
    return rows.length;
  }

  /** Undo a pause: trips cancelled for it are removed so they can be generated again. */
  async restorePaused(subscriptionId: string): Promise<void> {
    await this.db
      .delete(trips)
      .where(
        and(
          eq(trips.subscriptionId, subscriptionId),
          eq(trips.status, 'cancelled'),
          eq(trips.endedReason, 'paused'),
          gte(trips.serviceDate, riyadhToday()),
        ),
      );
    await this.generate({ subscriptionId });
  }

  /** New regular driver: every trip that has not started moves to them. */
  async reassignFuture(subscriptionId: string, driverId: string | null): Promise<void> {
    const before = await this.db
      .selectDistinct({ driverId: trips.driverId })
      .from(trips)
      .where(and(eq(trips.subscriptionId, subscriptionId), eq(trips.status, 'scheduled'), gte(trips.serviceDate, riyadhToday())));
    await this.db
      .update(trips)
      .set({ driverId })
      .where(
        and(
          eq(trips.subscriptionId, subscriptionId),
          inArray(trips.status, ['scheduled']),
          gte(trips.serviceDate, riyadhToday()),
        ),
      );
    await this.driversChanged([...before.map((b) => b.driverId), driverId]);
  }
}
