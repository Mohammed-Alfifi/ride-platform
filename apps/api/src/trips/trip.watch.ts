import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';

interface WatchRow extends Record<string, unknown> {
  id: string;
  partner_id: string;
  rider_id: string;
  driver_id: string | null;
  scheduled_at: Date;
  pickup_name: string;
  passenger_name: string | null;
  driver_name: string | null;
  status: string;
}

export interface WatchResult {
  lateStart: number;
  overdue: number;
  unassignedPartners: number;
}

const hhmm = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

/**
 * Runs every two minutes and raises the problems a dispatcher must not miss:
 * - a driver who has not set off shortly before a pick-up,
 * - a pick-up that is late (the rider is told too),
 * - trips in the next 12 hours with no driver.
 * Each alert goes out once (dedupe keys), so the team is not flooded.
 */
@Injectable()
export class TripWatch {
  private readonly logger = new Logger(TripWatch.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<WatchResult> {
    const result: WatchResult = { lateStart: 0, overdue: 0, unassignedPartners: 0 };
    const lead = this.env.LATE_ALERT_MINUTES;
    const at = now.toISOString();

    // Driver still not on the way, pick-up within the next few minutes (or already passed).
    const notStarted = await this.rows(sql`
      t.status = 'scheduled' AND t.driver_id IS NOT NULL
      AND t.scheduled_at <= ${at}::timestamptz + make_interval(mins => ${lead})
      AND t.scheduled_at > ${at}::timestamptz - interval '60 minutes'`);
    for (const t of notStarted) {
      const admins = await this.notifications.partnerAdminIds(t.partner_id);
      const n = await this.notifications.notify(admins, {
        kind: 'trip_not_started',
        titleAr: 'سائق لم ينطلق بعد',
        titleEn: 'Driver has not set off',
        bodyAr: `${t.driver_name ?? 'السائق'} لم يبدأ رحلة ${hhmm(t.scheduled_at)} من ${t.pickup_name}. تواصل معه أو عيّن بديلا.`,
        bodyEn: `${t.driver_name ?? 'The driver'} has not started the ${hhmm(t.scheduled_at)} trip from ${t.pickup_name}. Call them or assign a substitute.`,
        data: { tripId: t.id },
        dedupeKey: `late-start:${t.id}`,
      });
      if (t.driver_id) {
        await this.notifications.notify([t.driver_id], {
          kind: 'trip_reminder',
          titleAr: 'حان وقت الانطلاق',
          titleEn: 'Time to set off',
          bodyAr: `رحلة ${hhmm(t.scheduled_at)} من ${t.pickup_name}. اضغط «انطلقت» في التطبيق.`,
          bodyEn: `Your ${hhmm(t.scheduled_at)} trip from ${t.pickup_name}. Tap "On my way" in the app.`,
          data: { tripId: t.id },
          dedupeKey: `late-start:${t.id}`,
        });
      }
      if (n > 0) result.lateStart++;
    }

    // Pick-up time passed by 10 minutes and the driver has not arrived.
    const overdue = await this.rows(sql`
      t.status IN ('scheduled', 'en_route') AND t.arrived_at IS NULL
      AND t.scheduled_at < ${at}::timestamptz - interval '10 minutes'
      AND t.scheduled_at > ${at}::timestamptz - interval '3 hours'`);
    for (const t of overdue) {
      const who = t.passenger_name ? ` (${t.passenger_name})` : '';
      const n = await this.notifications.notify([t.rider_id], {
        kind: 'trip_delayed',
        titleAr: 'السائق متأخر',
        titleEn: 'Your driver is running late',
        bodyAr: `نعتذر، رحلة ${hhmm(t.scheduled_at)}${who} متأخرة. فريق التشغيل يتابعها الآن.`,
        bodyEn: `Sorry, the ${hhmm(t.scheduled_at)} trip${who} is late. Our team is on it.`,
        data: { tripId: t.id },
        dedupeKey: `overdue:${t.id}`,
      });
      await this.notifications.notify(await this.notifications.partnerAdminIds(t.partner_id), {
        kind: 'trip_overdue',
        titleAr: 'رحلة متأخرة',
        titleEn: 'Trip is late',
        bodyAr: `رحلة ${hhmm(t.scheduled_at)} من ${t.pickup_name} لم يصل سائقها بعد.`,
        bodyEn: `The ${hhmm(t.scheduled_at)} trip from ${t.pickup_name}: the driver has not arrived.`,
        data: { tripId: t.id },
        dedupeKey: `overdue:${t.id}`,
      });
      if (n > 0) result.overdue++;
    }

    // Trips in the next 12 hours with no driver: one summary per partner, again only if the count changes.
    const unassigned = await this.db.execute<{ partner_id: string; n: number; first_at: Date }>(sql`
      SELECT partner_id, count(*)::int AS n, min(scheduled_at) AS first_at FROM trips
      WHERE status = 'scheduled' AND driver_id IS NULL
        AND scheduled_at > ${at}::timestamptz AND scheduled_at < ${at}::timestamptz + interval '12 hours'
      GROUP BY partner_id`);
    for (const r of unassigned.rows) {
      const created = await this.notifications.notify(await this.notifications.partnerAdminIds(r.partner_id), {
        kind: 'trips_unassigned',
        titleAr: 'رحلات بدون سائق',
        titleEn: 'Trips without a driver',
        bodyAr: `${r.n} رحلة خلال الساعات القادمة بدون سائق، أولها ${hhmm(r.first_at)}. عيّن سائقا من شاشة التشغيل اليومي.`,
        bodyEn: `${r.n} upcoming trips have no driver, the first at ${hhmm(r.first_at)}. Assign one on the dispatch board.`,
        dedupeKey: `unassigned:${r.partner_id}:${new Date(r.first_at).toISOString().slice(0, 13)}:${r.n}`,
      });
      if (created > 0) result.unassignedPartners++;
    }

    if (result.lateStart || result.overdue || result.unassignedPartners) this.logger.log(`Trip watch: ${JSON.stringify(result)}`);
    return result;
  }

  /** Deletes driver location history and old share links past the retention period (privacy). */
  async purge(now = new Date()): Promise<{ points: number; shares: number }> {
    const cutoff = new Date(now.getTime() - this.env.LOCATION_RETENTION_DAYS * 86_400_000).toISOString();
    const points = await this.db.execute(sql`DELETE FROM trip_points WHERE recorded_at < ${cutoff}::timestamptz`);
    const shares = await this.db.execute(sql`DELETE FROM trip_shares WHERE expires_at < ${now.toISOString()}::timestamptz - interval '7 days'`);
    const result = { points: points.rowCount ?? 0, shares: shares.rowCount ?? 0 };
    this.logger.log(`Retention purge: ${JSON.stringify(result)}`);
    return result;
  }

  private async rows(cond: ReturnType<typeof sql>): Promise<WatchRow[]> {
    const res = await this.db.execute<WatchRow>(sql`
      SELECT t.id, t.partner_id, t.rider_id, t.driver_id, t.scheduled_at, t.pickup_name, t.passenger_name, t.status, d.name AS driver_name
      FROM trips t LEFT JOIN users d ON d.id = t.driver_id
      WHERE ${cond}
      ORDER BY t.scheduled_at
      LIMIT 500`);
    return res.rows;
  }
}
