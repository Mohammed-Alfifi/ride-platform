import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { addDays, daysBetween, riyadhToday } from '../common/saudi';
import { partnerScope } from '../common/tenant';
import { DB, Database } from '../database/database.module';

export interface DayPoint {
  date: string;
  value: number;
}

/** Numbers for the dashboard's reports. Every figure is computed in Riyadh calendar days. */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async report(actor: AuthUser, q: { partnerId?: string; from?: string; to?: string }) {
    const scope = partnerScope(actor, q.partnerId) ?? null;
    const to = q.to ?? riyadhToday();
    const from = q.from ?? addDays(to, -29);
    const days = Math.min(Math.max(daysBetween(from, to) + 1, 1), 366);
    const p = (col: string) => (scope ? sql`AND ${sql.raw(col)} = ${scope}` : sql``);
    const day = (col: string) => sql.raw(`(${col} AT TIME ZONE 'Asia/Riyadh')::date`);

    const revenue = await this.db.execute<{ d: string; amount: string; fee: string; n: string }>(sql`
      SELECT ${day('paid_at')} AS d, sum(amount_halalas) AS amount, sum(platform_fee_halalas) AS fee, count(*) AS n
      FROM payments
      WHERE status = 'paid' AND ${day('paid_at')} BETWEEN ${from}::date AND ${to}::date ${p('partner_id')}
      GROUP BY 1`);

    const newSubs = await this.db.execute<{ d: string; n: string }>(sql`
      SELECT ${day('paid_at')} AS d, count(*) AS n
      FROM payments
      WHERE status = 'paid' AND purpose = 'start' AND ${day('paid_at')} BETWEEN ${from}::date AND ${to}::date ${p('partner_id')}
      GROUP BY 1`);

    const tripStats = await this.db.execute<{ status: string; n: string; on_time: string; arrived: string }>(sql`
      SELECT status, count(*) AS n,
             count(*) FILTER (WHERE arrived_at IS NOT NULL AND arrived_at <= scheduled_at + interval '5 minutes') AS on_time,
             count(*) FILTER (WHERE arrived_at IS NOT NULL) AS arrived
      FROM trips
      WHERE service_date BETWEEN ${from}::date AND ${to}::date ${p('partner_id')}
      GROUP BY status`);

    const tripsByDay = await this.db.execute<{ d: string; done: string; missed: string }>(sql`
      SELECT service_date::text AS d,
             count(*) FILTER (WHERE status = 'completed') AS done,
             count(*) FILTER (WHERE status = 'no_show') AS missed
      FROM trips
      WHERE service_date BETWEEN ${from}::date AND ${to}::date ${p('partner_id')}
      GROUP BY 1`);

    const subs = await this.db.execute<{ active: string; past_due: string; ended: string }>(sql`
      SELECT count(*) FILTER (WHERE status = 'active') AS active,
             count(*) FILTER (WHERE status = 'past_due') AS past_due,
             count(*) FILTER (WHERE status IN ('cancelled', 'expired') AND updated_at >= ${from}::date) AS ended
      FROM subscriptions WHERE true ${p('partner_id')}`);

    const rating = await this.db.execute<{ avg: string | null; n: string }>(sql`
      SELECT avg(stars) AS avg, count(*) AS n FROM trip_ratings
      WHERE ${day('created_at')} BETWEEN ${from}::date AND ${to}::date ${p('partner_id')}`);

    const tickets = await this.db.execute<{ open: string }>(sql`
      SELECT count(*) FILTER (WHERE status <> 'closed') AS open FROM support_tickets WHERE true ${p('partner_id')}`);

    const fill = (rows: { d: string }[], pick: (r: never) => number): DayPoint[] => {
      const map = new Map(rows.map((r) => [String(r.d).slice(0, 10), pick(r as never)]));
      return Array.from({ length: days }, (_, i) => {
        const date = addDays(from, i);
        return { date, value: map.get(date) ?? 0 };
      });
    };

    const statusCount = (s: string) => Number(tripStats.rows.find((r) => r.status === s)?.n ?? 0);
    const arrived = tripStats.rows.reduce((a, r) => a + Number(r.arrived), 0);
    const onTime = tripStats.rows.reduce((a, r) => a + Number(r.on_time), 0);
    const completed = statusCount('completed');
    const noShow = statusCount('no_show');
    const sum = (rows: { amount?: string; fee?: string; n?: string }[], k: 'amount' | 'fee' | 'n') =>
      rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);

    return {
      from,
      to,
      totals: {
        collectedHalalas: sum(revenue.rows, 'amount'),
        platformFeeHalalas: sum(revenue.rows, 'fee'),
        payments: sum(revenue.rows, 'n'),
        newSubscriptions: newSubs.rows.reduce((a, r) => a + Number(r.n), 0),
        activeSubscriptions: Number(subs.rows[0]?.active ?? 0),
        pastDue: Number(subs.rows[0]?.past_due ?? 0),
        ended: Number(subs.rows[0]?.ended ?? 0),
        tripsCompleted: completed,
        noShows: noShow,
        skipped: statusCount('skipped'),
        /** Share of arrivals at the pick-up no later than 5 minutes after the scheduled time. */
        onTimeRate: arrived ? Math.round((onTime / arrived) * 1000) / 10 : null,
        completionRate: completed + noShow ? Math.round((completed / (completed + noShow)) * 1000) / 10 : null,
        averageRating: rating.rows[0]?.avg ? Math.round(Number(rating.rows[0].avg) * 10) / 10 : null,
        ratings: Number(rating.rows[0]?.n ?? 0),
        openTickets: Number(tickets.rows[0]?.open ?? 0),
      },
      series: {
        revenue: fill(revenue.rows, (r: { amount: string }) => Number(r.amount)),
        newSubscriptions: fill(newSubs.rows, (r: { n: string }) => Number(r.n)),
        tripsCompleted: fill(tripsByDay.rows, (r: { done: string }) => Number(r.done)),
        noShows: fill(tripsByDay.rows, (r: { missed: string }) => Number(r.missed)),
      },
    };
  }

  /** Paid payments as CSV for the accountant (UTF-8 with BOM so Excel shows Arabic). */
  async paymentsCsv(actor: AuthUser, q: { partnerId?: string; from?: string; to?: string }): Promise<string> {
    const scope = partnerScope(actor, q.partnerId) ?? null;
    const to = q.to ?? riyadhToday();
    const from = q.from ?? addDays(to, -29);
    const rows = await this.db.execute<Record<string, string | number | null>>(sql`
      SELECT to_char(p.paid_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') AS paid_at,
             i.number AS invoice, u.name AS rider, u.phone, p.purpose, p.provider,
             p.amount_halalas, p.discount_halalas, i.vat_halalas, p.platform_fee_halalas, p.partner_share_halalas
      FROM payments p
      JOIN users u ON u.id = p.rider_id
      LEFT JOIN invoices i ON i.payment_id = p.id
      WHERE p.status = 'paid'
        AND (p.paid_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN ${from}::date AND ${to}::date
        ${scope ? sql`AND p.partner_id = ${scope}` : sql``}
      ORDER BY p.paid_at`);
    const sar = (h: unknown) => (h === null || h === undefined ? '' : (Number(h) / 100).toFixed(2));
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['التاريخ', 'رقم الفاتورة', 'الراكب', 'الجوال', 'النوع', 'البوابة', 'المبلغ', 'الخصم', 'الضريبة', 'عمولة المنصة', 'حصة الشريك'];
    const lines = rows.rows.map((r) =>
      [
        r.paid_at,
        r.invoice,
        r.rider,
        r.phone,
        r.purpose === 'start' ? 'اشتراك جديد' : 'تجديد',
        r.provider,
        sar(r.amount_halalas),
        sar(r.discount_halalas),
        sar(r.vat_halalas),
        sar(r.platform_fee_halalas),
        sar(r.partner_share_halalas),
      ]
        .map(esc)
        .join(','),
    );
    return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
  }
}
